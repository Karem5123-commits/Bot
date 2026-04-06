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
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import { google } from "googleapis";
import cors from "cors";

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

// ================= GOOGLE DRIVE =================
const drive = google.drive({
  version: "v3",
  auth: new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || "{}"),
    scopes: ["https://www.googleapis.com/auth/drive"]
  })
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
  const { interaction, id } = job;

  const input = `${TEMP_DIR}/in_${id}.mp4`;
  const output = `${TEMP_DIR}/out_${id}.mp4`;

  try {
    await interaction.editReply("📥 Downloading...");
    
    // TEMP DISABLED DOWNLOAD
    throw new Error("Video download temporarily disabled");

    await interaction.editReply("⚙️ Processing...");
    await enhance(input, output);

    await interaction.editReply("☁️ Uploading...");
    const file = await drive.files.create({
      requestBody: { name: `video_${id}.mp4`, parents: [process.env.GOOGLE_FOLDER_ID] },
      media: { mimeType: "video/mp4", body: fsSync.createReadStream(output) }
    });

    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: { role: "reader", type: "anyone" }
    });

    const link = `https://drive.google.com/file/d/${file.data.id}/view`;

    await interaction.user.send(`🎬 Your video: ${link}`);
    await interaction.editReply("✅ Check DMs!");

  } catch (e) {
    console.error(e);
    await interaction.editReply("❌ Video system disabled (fix coming)");
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
    new SlashCommandBuilder()
      .setName("quality_method")
      .setDescription("Enhance video")
      .addStringOption(o => o.setName("url").setDescription("Video URL").setRequired(true))
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands.map(c => c.toJSON()) }
  );
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
          .setCustomId("
