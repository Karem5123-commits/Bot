import {
  Client, SlashCommandBuilder, REST, Routes,
  EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder
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
process.on('uncaughtException', err => console.error("Uncaught:", err));
process.on('unhandledRejection', err => console.error("Unhandled:", err));

// ================= EXPRESS =================
const app = express();
app.use(express.json());
app.use(cors());

app.get('/', (_, res) => res.send('🔥 Bot Running'));
app.get('/api/test', (_, res) => res.json({ ok: true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo Connected"))
  .catch(err => console.error("Mongo Error:", err));

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  rank: { type: String, default: "Bronze" },
  submissions: { type: Number, default: 0 }
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "pending" },
  processedFile: String
}));

const PremiumCode = mongoose.model("PremiumCode", new mongoose.Schema({
  userId: String,
  code: String,
  used: { type: Boolean, default: false }
}));

// ================= VIDEO PROCESS =================
async function processVideo(sub) {
  const input = `./input_${sub.id}.mp4`;
  const output = `./output_${sub.id}.mp4`;

  try {
    console.log("⬇️ Downloading video...");

    await ytdlp(sub.link, {
      output: input,
      format: 'mp4'
    });

    console.log("⚙️ Processing video...");

    await new Promise((resolve, reject) => {
      ffmpeg(input)
        .videoFilters([
          "scale=3840:2160:flags=lanczos",
          "unsharp=5:5:1.0"
        ])
        .on('end', resolve)
        .on('error', reject)
        .save(output);
    });

    if (fs.existsSync(input)) fs.unlinkSync(input);

    console.log("✅ Processing complete");
    return output;

  } catch (err) {
    console.error("❌ Processing failed:", err);

    if (fs.existsSync(input)) fs.unlinkSync(input);
    return null;
  }
}

// ================= DISCORD =================
const client = new Client({ intents: 32767 });

// READY
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const cmds = [
    new SlashCommandBuilder().setName("submit").setDescription("Submit clip"),
    new SlashCommandBuilder().setName("profile").setDescription("View profile")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: cmds }
    );
  } catch (e) {
    console.error("Command register error:", e);
  }
});

// ================= BOOST DETECTION =================
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const role = newMember.guild.roles.premiumSubscriberRole;
    if (!role) return;

    const had = oldMember.roles.cache.has(role.id);
    const has = newMember.roles.cache.has(role.id);

    if (!had && has) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();

      await PremiumCode.create({ userId: newMember.id, code });

      await newMember.send(
        `🔥 Thanks for boosting!\n\nYour code: **${code}**`
      ).catch(() => {});
    }

  } catch (err) {
    console.error("Boost error:", err);
  }
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

        if (!user) {
          user = await User.create({
            userId: i.user.id,
            username: i.user.tag
          });
        }

        return i.reply(`MMR: ${user.mmr} | Rank: ${user.rank}`);
      }
    }

    // ================= SUBMIT =================
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

      processVideo(sub).then(async (file) => {
        try {
          if (!file) {
            sub.status = "failed";
          } else {
            sub.status = "done";
            sub.processedFile = file;
          }
          await sub.save();
        } catch (e) {
          console.error("Save error:", e);
        }
      });

      return i.reply({
        content: "🚀 Processing started!",
        ephemeral: true
      });
    }

  } catch (err) {
    console.error("Interaction error:", err);
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
app.get('/api/dashboard', async (_, res) => {
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
app.get('/api/leaderboard', async (_, res) => {
  try {
    const users = await User.find().sort({ mmr: -1 }).limit(50);
    res.json(users);
  } catch {
    res.json([]);
  }
});

// SUBMISSIONS (FIXED)
app.get('/api/submissions', async (_, res) => {
  try {
    const subs = await Submission.find().sort({ _id: -1 }).limit(20);
    res.json(subs);
  } catch {
    res.json([]);
  }
});

// REDEEM
app.post('/api/redeem', async (req, res) => {
  try {
    const { code } = req.body;

    const found = await PremiumCode.findOne({ code, used: false });
    if (!found) return res.json({ success: false });

    found.used = true;
    await found.save();

    res.json({ success: true });

  } catch {
    res.json({ success: false });
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🌐 API running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
