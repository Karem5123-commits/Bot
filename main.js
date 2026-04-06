import {
  Client, GatewayIntentBits, Partials,
  REST, Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
  PermissionsBitField,
  ActivityType
} from "discord.js";

import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ytdl from "yt-dlp-exec";
import cors from "cors";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

dotenv.config();

// ================= SAFE =================
process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

// ================= CONFIG =================
const TEMP_DIR = "./temp";
const PREFIX = "!";
const queue = [];
let processing = false;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

// ================= R2 SETUP =================
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
});

// ================= DATABASE =================
await mongoose.connect(process.env.MONGO_URI);

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  balance: { type: Number, default: 1000 },
  submissions: { type: Number, default: 0 },
  uploads: { type: Number, default: 0 },
  premiumCode: String
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "pending" },
  score: Number
}));

// ================= RANK SYSTEM =================
const RANKS = {
  "sss": { role: "1488208025859788860", mmr: 500 },
  "ss+": { role: "1488208185633280041", mmr: 400 },
  "ss": { role: "1488208281930432602", mmr: 300 },
  "s+": { role: "1488208494170738793", mmr: 200 },
  "s": { role: "1488208584142753863", mmr: 100 },
  "a": { role: "1488208696759685190", mmr: 50 }
};

// ================= DISCORD =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// ================= BOOST AUTO DM =================
client.on("guildMemberUpdate", async (oldM, newM) => {
  if (!oldM.premiumSince && newM.premiumSince) {
    let user = await User.findOne({ userId: newM.id });
    if (!user) user = await User.create({ userId: newM.id, username: newM.user.tag });

    const code = crypto.randomBytes(5).toString("hex");
    user.premiumCode = code;
    await user.save();

    await newM.send(`🚀 Boost detected!\nCode: ${code}\nUse !quality`);
  }
});

// ================= VIDEO ENGINE =================
const enhance = (input, output) => {
  return new Promise((res, rej) => {
    ffmpeg(input)
      .videoFilters([
        "scale=1920:1080:force_original_aspect_ratio=decrease",
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        "minterpolate=fps=60"
      ])
      .outputOptions(["-c:v libx264", "-crf 18", "-preset fast"])
      .on("end", res)
      .on("error", rej)
      .save(output);
  });
};

// ================= QUEUE =================
const processQueue = async () => {
  if (processing || queue.length === 0) return;
  processing = true;

  const job = queue.shift();
  const { interaction, url, id } = job;

  const input = `${TEMP_DIR}/in_${id}.mp4`;
  const output = `${TEMP_DIR}/out_${id}.mp4`;

  try {
    await interaction.editReply("📥 Downloading...");
    await ytdl(url, { output: input });

    await interaction.editReply("⚙️ Processing...");
    await enhance(input, output);

    await interaction.editReply("☁️ Uploading...");

    const fileName = `video_${id}.mp4`;

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: fileName,
      Body: fsSync.createReadStream(output),
      ContentType: "video/mp4"
    }));

    const link = `https://${process.env.R2_BUCKET}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${fileName}`;

    await interaction.user.send(`🎬 Your video: ${link}`);
    await interaction.editReply("✅ Check DMs!");

  } catch (e) {
    console.error(e);
    await interaction.editReply("❌ Failed");
  }

  await fs.unlink(input).catch(()=>{});
  await fs.unlink(output).catch(()=>{});

  processing = false;
  processQueue();
};

// ================= READY =================
client.once("ready", async () => {
  console.log("Bot ready");
  await fs.mkdir(TEMP_DIR, { recursive: true });

  client.user.setActivity("God System", { type: ActivityType.Playing });

  const commands = [
    new SlashCommandBuilder().setName("submit").setDescription("Submit clip"),
    new SlashCommandBuilder().setName("profile").setDescription("Profile"),
    new SlashCommandBuilder().setName("quality_method")
      .setDescription("Enhance video")
      .addStringOption(o=>o.setName("url").setRequired(true))
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands.map(c=>c.toJSON()) }
  );
});

// ================= PREFIX COMMANDS =================
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(1).split(" ");
  const cmd = args.shift();

  let user = await User.findOne({ userId: msg.author.id });
  if (!user) user = await User.create({ userId: msg.author.id, username: msg.author.tag });

  if (cmd === "quality") {
    if (!user.premiumCode) return msg.reply("❌ premium only");
    return msg.reply("✅ quality unlocked");
  }

  if (cmd === "balance") return msg.reply(user.balance.toString());
  if (cmd === "daily") { user.balance += 500; await user.save(); return msg.reply("+500"); }

  if (cmd === "ban") {
    const m = msg.mentions.members.first();
    if (m) await m.ban();
  }

  if (cmd === "kick") {
    const m = msg.mentions.members.first();
    if (m) await m.kick();
  }
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {
  try {
    if (i.isChatInputCommand()) {

      if (i.commandName === "profile") {
        const user = await User.findOne({ userId: i.user.id });
        return i.reply(`MMR: ${user?.mmr}`);
      }

      if (i.commandName === "submit") {
        const modal = new ModalBuilder()
          .setCustomId("submit")
          .setTitle("Submit");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("link")
              .setLabel("URL")
              .setStyle(TextInputStyle.Short)
          )
        );

        return i.showModal(modal);
      }

      if (i.commandName === "quality_method") {
        const member = await i.guild.members.fetch(i.user.id);
        if (!member.premiumSince) {
          return i.reply({ content: "❌ boost required", ephemeral: true });
        }

        await i.reply("⏳ queued...");
        queue.push({
          interaction: i,
          url: i.options.getString("url"),
          id: crypto.randomBytes(4).toString("hex")
        });

        processQueue();
      }
    }

    if (i.isModalSubmit()) {
      const link = i.fields.getTextInputValue("link");
      await Submission.create({
        id: crypto.randomBytes(4).toString("hex"),
        userId: i.user.id,
        link
      });

      await i.reply({ content: "submitted", ephemeral: true });
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= API =================
const app = express();
app.use(cors());

app.get("/", (_,res)=>res.send("OK"));

app.get("/api/leaderboard", async (_,res)=>{
  const top = await User.find().sort({ mmr: -1 }).limit(10);
  res.json(top);
});

app.listen(process.env.PORT || 3000);

// ================= START =================
client.login(process.env.DISCORD_TOKEN);
