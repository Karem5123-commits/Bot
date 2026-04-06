import {
  Client, SlashCommandBuilder, REST, Routes,
  EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionsBitField
} from 'discord.js';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ytdlp from 'yt-dlp-exec';
import fs from 'fs';

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ================= SAFE START =================
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ================= EXPRESS =================
const app = express();
app.use(express.json());
app.use(cors());

app.get('/', (_, res) => res.send('🔥 Bot Running'));
app.get('/api/test', (_, res) => res.json({ message: "API working" }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo Connected"))
  .catch(err => console.error(err));

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  rank: { type: String, default: "Bronze" },
  submissions: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  rejected: { type: Number, default: 0 }
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "pending" },
  processedFile: String,
  aiScore: Number,
  suggestedMMR: Number,
  suggestedRank: String
}));

// ================= VIDEO PROCESSOR =================
async function processVideo(sub) {
  try {
    console.log("🎬 Processing:", sub.link);

    const inputPath = `./input_${sub.id}.mp4`;
    const outputPath = `./output_${sub.id}.mp4`;

    // DOWNLOAD
    await ytdlp(sub.link, {
      output: inputPath,
      format: 'mp4'
    });

    console.log("⬇️ Download complete");

    // PROCESS (4K UPSCALE + SHARPEN)
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters([
          "scale=3840:2160:flags=lanczos",
          "unsharp=5:5:1.0:5:5:0.0"
        ])
        .outputOptions('-preset fast')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    fs.unlinkSync(inputPath);

    console.log("✅ Done:", outputPath);
    return outputPath;

  } catch (err) {
    console.error("❌ Processing failed:", err);
    return null;
  }
}

// ================= DISCORD =================
const client = new Client({ intents: 32767 });

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const cmds = [
    new SlashCommandBuilder().setName("submit").setDescription("Submit clip"),
    new SlashCommandBuilder().setName("profile").setDescription("View profile"),
    new SlashCommandBuilder().setName("review").setDescription("Review clips (staff)")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: cmds }
  );
});

// ================= COMMANDS =================
client.on("interactionCreate", async i => {
  try {

    if (i.isChatInputCommand()) {

      if (i.commandName === "submit") {
        const modal = new ModalBuilder()
          .setCustomId("submit_modal")
          .setTitle("Submit Clip");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("link")
              .setLabel("Video URL")
              .setStyle(TextInputStyle.Short)
          )
        );

        return i.showModal(modal);
      }

      if (i.commandName === "profile") {
        let user = await User.findOne({ userId: i.user.id });
        if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(i.user.username)
              .addFields(
                { name: "MMR", value: `${user.mmr}`, inline: true },
                { name: "Rank", value: user.rank, inline: true }
              )
          ]
        });
      }
    }

    if (i.isModalSubmit()) {
      const link = i.fields.getTextInputValue("link");
      const id = crypto.randomBytes(4).toString("hex");

      const sub = await Submission.create({
        id,
        userId: i.user.id,
        link,
        status: "processing"
      });

      await User.updateOne(
        { userId: i.user.id },
        { $inc: { submissions: 1 }, username: i.user.tag },
        { upsert: true }
      );

      // PROCESS IN BACKGROUND
      processVideo(sub).then(async (output) => {
        if (!output) {
          sub.status = "failed";
          return sub.save();
        }

        sub.status = "done";
        sub.processedFile = output;
        await sub.save();
      });

      return i.reply({
        content: "🚀 Processing started!",
        ephemeral: true
      });
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= API =================

// STATUS
app.get('/api/status', (req, res) => {
  res.json({
    online: client?.isReady?.() || false,
    tag: client?.user?.tag || null
  });
});

// DASHBOARD
app.get('/api/dashboard', async (req, res) => {
  try {
    const users = await User.countDocuments();
    const subs = await Submission.countDocuments();
    const processed = await Submission.countDocuments({ status: "done" });

    res.json({
      users,
      submissions: subs,
      stats: { totalProcessed: processed }
    });

  } catch {
    res.json({ users: 0, submissions: 0, stats: { totalProcessed: 0 } });
  }
});

// LEADERBOARD
app.get('/api/leaderboard', async (req, res) => {
  try {
    const users = await User.find().sort({ mmr: -1 }).limit(50);

    res.json(users.map((u, i) => ({
      position: i + 1,
      username: u.username,
      mmr: u.mmr
    })));
  } catch {
    res.json([]);
  }
});

// SUBMISSIONS (FIXED)
app.get('/api/submissions', async (req, res) => {
  try {
    const subs = await Submission.find().sort({ _id: -1 }).limit(20);

    res.json(subs.map(s => ({
      id: s.id,
      link: s.link,
      status: s.status,
      processed: s.processedFile || null
    })));

  } catch {
    res.json([]);
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🌐 API running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
