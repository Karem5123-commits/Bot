// ============================
// IMPORTS
// ============================
import {
  Client, GatewayIntentBits, Partials,
  REST, Routes,
  SlashCommandBuilder,
  ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
  ActivityType
} from "discord.js";

import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import crypto from "crypto";
import fs from "fs/promises";
import fsSync from "fs";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import ytdl from "yt-dlp-exec";
import cors from "cors";

dotenv.config();

// ============================
// SAFE
// ============================
process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

// ============================
// CONFIG
// ============================
const TEMP_DIR = "./temp";
const queue = [];
let processing = false;

const RATE_LIMIT = new Map();
const ACTIVE = new Set();
const CACHE = new Map();

// ============================
// FFMPEG
// ============================
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

// ============================
// DB
// ============================
await mongoose.connect(process.env.MONGO_URI);

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  stats: {
    totalEnhanced: { type: Number, default: 0 },
    totalSubmissions: { type: Number, default: 0 }
  }
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: String,
  progress: Number
}));

// ============================
// DISCORD
// ============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ============================
// BOOST DETECT
// ============================
client.on("guildMemberUpdate", async (o, n) => {
  if (!o.premiumSince && n.premiumSince) {
    await n.send("💎 Boost detected!");
  }
});

// ============================
// HELPERS
// ============================
const uid = () => crypto.randomBytes(6).toString("hex");
const safeUnlink = f => fs.unlink(f).catch(()=>{});

// ============================
// SMART DOWNLOAD
// ============================
const downloadVideo = async (url, output) => {
  if (CACHE.has(url)) {
    await fs.copyFile(CACHE.get(url), output);
    return;
  }

  if (url.includes("cdn.discordapp") || url.endsWith(".mp4")) {
    const res = await axios({ url, method: "GET", responseType: "stream" });
    await new Promise((r, j) => {
      const s = fsSync.createWriteStream(output);
      res.data.pipe(s);
      s.on("finish", r);
      s.on("error", j);
    });
  } else {
    await ytdl(url, { output });
  }

  CACHE.set(url, output);
};

// ============================
// VIDEO ENGINE
// ============================
const enhance = (input, output, job) => {
  return new Promise((res, rej) => {
    ffmpeg(input)
      .videoFilters([
        "scale=1920:1080:force_original_aspect_ratio=decrease",
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        "minterpolate=fps=60"
      ])
      .outputOptions(["-c:v libx264", "-crf 18"])
      .on("progress", p => {
        job.progress = Math.round(p.percent || 0);
      })
      .on("end", res)
      .on("error", rej)
      .save(output);
  });
};

// ============================
// QUEUE SYSTEM
// ============================
const processQueue = async () => {
  if (processing || queue.length === 0) return;
  processing = true;

  const job = queue.shift();
  const { i, url, id } = job;

  const input = `${TEMP_DIR}/in_${id}.mp4`;
  const output = `${TEMP_DIR}/out_${id}.mp4`;

  try {
    job.status = "downloading";
    await i.editReply("📥 Downloading...");
    await downloadVideo(url, input);

    await Submission.updateOne({ id }, job);

    job.status = "processing";
    await i.editReply("⚙️ Processing...");
    await enhance(input, output, job);

    await Submission.updateOne({ id }, job);

    job.status = "done";

    await i.user.send({ files: [output] });
    await i.editReply("✅ Done");

    await User.updateOne(
      { userId: i.user.id },
      { $inc: { "stats.totalEnhanced": 1 } },
      { upsert: true }
    );

  } catch (e) {
    job.status = "failed";
    await i.editReply("❌ Failed");
  }

  await safeUnlink(input);
  await safeUnlink(output);

  processing = false;
  processQueue();
};

// ============================
// READY
// ============================
client.once("ready", async () => {
  console.log("🔥 READY");
  await fs.mkdir(TEMP_DIR, { recursive: true });

  client.user.setActivity("Ultra AI Engine", { type: ActivityType.Playing });

  const commands = [
    new SlashCommandBuilder()
      .setName("quality_method")
      .setDescription("Enhance video")
      .addStringOption(o => o.setName("url").setRequired(true)),

    new SlashCommandBuilder().setName("submit").setDescription("Submit clip"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Leaderboard"),
    new SlashCommandBuilder().setName("profile").setDescription("Profile")
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );
});

// ============================
// COMMANDS
// ============================
client.on("interactionCreate", async i => {
  try {
    if (i.isChatInputCommand()) {

      if (i.commandName === "quality_method") {

        if (ACTIVE.has(i.user.id)) {
          return i.reply({ content: "Already processing", ephemeral: true });
        }

        if (RATE_LIMIT.has(i.user.id)) {
          return i.reply({ content: "Slow down", ephemeral: true });
        }

        RATE_LIMIT.set(i.user.id, true);
        setTimeout(()=>RATE_LIMIT.delete(i.user.id), 30000);

        ACTIVE.add(i.user.id);

        await i.reply("⏳ Queued...");

        const id = uid();

        await Submission.create({
          id,
          userId: i.user.id,
          link: i.options.getString("url"),
          status: "queued",
          progress: 0
        });

        queue.push({
          i,
          url: i.options.getString("url"),
          id,
          status: "queued",
          progress: 0
        });

        processQueue();

        setTimeout(()=>ACTIVE.delete(i.user.id), 60000);
      }

      if (i.commandName === "leaderboard") {
        const top = await User.find().sort({ mmr: -1 }).limit(10).lean();
        return i.reply(top.map((u,x)=>`${x+1}. <@${u.userId}> - ${u.mmr}`).join("\n") || "No data");
      }

      if (i.commandName === "profile") {
        const u = await User.findOne({ userId: i.user.id });
        return i.reply(`MMR: ${u?.mmr || 1000}`);
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
    }

    if (i.isModalSubmit()) {
      const link = i.fields.getTextInputValue("link");

      await Submission.create({
        id: uid(),
        userId: i.user.id,
        link,
        status: "pending",
        progress: 0
      });

      return i.reply({ content: "Submitted", ephemeral: true });
    }

  } catch (e) {
    console.error(e);
  }
});

// ============================
// API + LIVE SYNC (SSE)
// ============================
const app = express();
app.use(cors());

const clients = [];

app.get("/api/live", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.push(res);

  req.on("close", () => {
    const i = clients.indexOf(res);
    if (i !== -1) clients.splice(i, 1);
  });
});

const broadcast = async () => {
  const payload = JSON.stringify({
    queue: queue.length,
    processing,
    leaderboard: await User.find().sort({ mmr: -1 }).limit(10).lean(),
    submissions: await Submission.find().limit(20).lean()
  });

  clients.forEach(c => c.write(`data: ${payload}\n\n`));
};

setInterval(broadcast, 2000);

// ============================
// API ENDPOINTS
// ============================
app.get("/", (_,res)=>res.send("OK"));

app.get("/api/status", (_,res)=>{
  res.json({ queue: queue.length, processing });
});

app.get("/api/leaderboard", async (_,res)=>{
  res.json(await User.find().sort({ mmr:-1 }).limit(50).lean());
});

app.get("/api/submissions", async (_,res)=>{
  res.json(await Submission.find().limit(50).lean());
});

app.listen(process.env.PORT || 3000);

// ============================
// START
// ============================
client.login(process.env.DISCORD_TOKEN);
