import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActivityType
} from "discord.js";

import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ytdl from "yt-dlp-exec";

dotenv.config();

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

// ================= CONFIG =================
const PREFIX = "!";
const TEMP_DIR = "./temp";

const CONFIG = {
  MAX_MB: 24,
  MAX_DURATION: 90,
  STAFF: PermissionsBitField.Flags.ManageGuild
};

// ================= FAIL SAFE =================
process.on("uncaughtException", e => console.log("💥", e));
process.on("unhandledRejection", e => console.log("💥", e));

// ================= DB =================
await mongoose.connect(process.env.MONGO_URI);

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  warnings: { type: Number, default: 0 }
}));

// ================= BOT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// ================= HELPERS =================
const active = new Set();

function uid() {
  return crypto.randomBytes(6).toString("hex");
}

async function safeUnlink(f) {
  await fs.unlink(f).catch(()=>{});
}

async function getInfo(file) {
  return new Promise((res, rej) => {
    ffmpeg.ffprobe(file, (e, d) => {
      if (e) return rej(e);
      res({
        duration: d.format.duration || 0,
        size: d.format.size / 1024 / 1024
      });
    });
  });
}

async function processVideo(input, output) {
  return new Promise((res, rej) => {
    ffmpeg(input)
      .videoFilters([
        "scale=1920:1080",
        "minterpolate=fps=60"
      ])
      .outputOptions(["-crf 18"])
      .save(output)
      .on("end", res)
      .on("error", rej);
  });
}

// ================= READY =================
client.once("clientReady", async () => {
  console.log("🚀 FULL POWER READY");
  await fs.mkdir(TEMP_DIR, { recursive: true });
  client.user.setActivity("Ultra AI Engine", { type: ActivityType.Playing });
});

// ================= COMMANDS =================
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(PREFIX.length).trim().split(" ");
  const cmd = args.shift().toLowerCase();

  // ================= ENHANCE =================
  if (cmd === "enhance") {
    const url = args[0];
    if (!url) return msg.reply("Give URL");

    if (active.has(msg.author.id)) return msg.reply("Already processing");
    active.add(msg.author.id);

    const id = uid();
    const input = path.join(TEMP_DIR, `in_${id}.mp4`);
    const output = path.join(TEMP_DIR, `out_${id}.mp4`);

    try {
      await msg.reply("📥 Downloading...");

      await ytdl(url, {
        output: input,
        format: "mp4"
      });

      const info = await getInfo(input);
      if (info.duration > CONFIG.MAX_DURATION) {
        return msg.reply("Too long");
      }

      await msg.reply("⚙️ Enhancing...");
      await processVideo(input, output);

      await msg.reply({ files: [output] });

      await User.updateOne(
        { userId: msg.author.id },
        { $inc: { mmr: 10 }, $setOnInsert: { username: msg.author.tag } },
        { upsert: true }
      );

    } catch {
      msg.reply("❌ Failed");
    } finally {
      active.delete(msg.author.id);
      await safeUnlink(input);
      await safeUnlink(output);
    }
  }

  // ================= PROFILE =================
  if (cmd === "profile") {
    let user = await User.findOne({ userId: msg.author.id });
    if (!user) user = await User.create({ userId: msg.author.id });

    const embed = new EmbedBuilder()
      .setTitle("Profile")
      .setDescription(`MMR: ${user.mmr}\nWarnings: ${user.warnings}`);

    msg.reply({ embeds: [embed] });
  }

  // ================= LEADERBOARD =================
  if (cmd === "lb") {
    const top = await User.find().sort({ mmr: -1 }).limit(10);

    const text = top.map((u, i) =>
      `${i + 1}. <@${u.userId}> - ${u.mmr}`
    ).join("\n");

    msg.reply(text || "No data");
  }

  // ================= WARN =================
  if (cmd === "warn") {
    if (!msg.member.permissions.has(CONFIG.STAFF)) return;

    const user = msg.mentions.users.first();
    if (!user) return msg.reply("Mention user");

    await User.updateOne(
      { userId: user.id },
      { $inc: { warnings: 1 } },
      { upsert: true }
    );

    msg.reply(`Warned ${user.tag}`);
  }
});

// ================= API =================
const app = express();

app.get("/", (_, res) => res.send("OK"));

app.get("/api/status", (_, res) => {
  res.json({
    status: "online",
    users: client.users.cache.size
  });
});

app.get("/api/leaderboard", async (_, res) => {
  const top = await User.find().sort({ mmr: -1 }).limit(10);
  res.json(top);
});

app.listen(process.env.PORT || 3000);

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);
