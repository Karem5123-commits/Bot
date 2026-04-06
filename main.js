import {
  Client, GatewayIntentBits, Partials,
  REST, Routes,
  SlashCommandBuilder,
  ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
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
import cors from "cors";

dotenv.config();

// ================= CONFIG =================
const TEMP_DIR = "./temp";
const PREFIX = "!";
const queue = [];
let processing = false;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

// ================= DB =================
await mongoose.connect(process.env.MONGO_URI);

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  balance: { type: Number, default: 1000 },
  premium: Boolean
}));

// ================= DISCORD =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ================= BOOST =================
client.on("guildMemberUpdate", async (o, n) => {
  if (!o.premiumSince && n.premiumSince) {
    let u = await User.findOne({ userId: n.id }) || await User.create({ userId: n.id });
    u.premium = true;
    await u.save();
    await n.send("💎 Premium unlocked!");
  }
});

// ================= DOWNLOADER =================
const downloadVideo = async (url, output) => {
  try {
    // Direct file
    if (url.endsWith(".mp4")) {
      const res = await axios({ url, method: "GET", responseType: "stream" });
      await new Promise((r, j) => {
        const s = fsSync.createWriteStream(output);
        res.data.pipe(s);
        s.on("finish", r);
        s.on("error", j);
      });
      return;
    }

    // YouTube via API
    const yt = await axios.get("https://youtube-video-download-info.p.rapidapi.com/dl", {
      params: { id: url },
      headers: { "X-RapidAPI-Key": process.env.RAPIDAPI_KEY }
    });

    const videoUrl = yt.data.link;
    const res = await axios({ url: videoUrl, method: "GET", responseType: "stream" });

    await new Promise((r, j) => {
      const s = fsSync.createWriteStream(output);
      res.data.pipe(s);
      s.on("finish", r);
      s.on("error", j);
    });

  } catch {
    throw new Error("Download failed");
  }
};

// ================= VIDEO =================
const enhance = (input, output) => {
  return new Promise((res, rej) => {
    ffmpeg(input)
      .videoFilters([
        "scale=1920:1080:force_original_aspect_ratio=decrease",
        "pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
        "minterpolate=fps=60"
      ])
      .outputOptions(["-c:v libx264", "-crf 18"])
      .on("end", res)
      .on("error", rej)
      .save(output);
  });
};

// ================= QUEUE =================
const processQueue = async () => {
  if (processing || queue.length === 0) return;
  processing = true;

  const { i, url, id } = queue.shift();

  const input = `${TEMP_DIR}/in_${id}.mp4`;
  const output = `${TEMP_DIR}/out_${id}.mp4`;

  try {
    await i.editReply("📥 Downloading...");
    await downloadVideo(url, input);

    await i.editReply("⚙️ Enhancing...");
    await enhance(input, output);

    await i.user.send({ files: [output] });
    await i.editReply("✅ Done (sent in DM)");

  } catch (e) {
    console.error(e);
    await i.editReply("❌ Failed");
  }

  await fs.unlink(input).catch(()=>{});
  await fs.unlink(output).catch(()=>{});

  processing = false;
  processQueue();
};

// ================= READY =================
client.once("ready", async () => {
  console.log("🔥 Ready");
  await fs.mkdir(TEMP_DIR, { recursive: true });

  client.user.setActivity("God System", { type: ActivityType.Playing });

  const cmds = [
    new SlashCommandBuilder()
      .setName("quality_method")
      .setDescription("Enhance video")
      .addStringOption(o=>o.setName("url").setRequired(true))
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: cmds });
});

// ================= COMMAND =================
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "quality_method") {
    await i.reply("⏳ Processing...");
    queue.push({
      i,
      url: i.options.getString("url"),
      id: crypto.randomBytes(4).toString("hex")
    });
    processQueue();
  }
});

// ================= API =================
const app = express();
app.use(cors());

app.get("/", (_,res)=>res.send("OK"));
app.listen(process.env.PORT || 3000);

// ================= START =================
client.login(process.env.DISCORD_TOKEN);
