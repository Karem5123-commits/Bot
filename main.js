import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
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

// ================= FAILSAFE =================
process.on("uncaughtException", e => console.error("💥", e));
process.on("unhandledRejection", e => console.error("💥", e));

// ================= CONFIG =================
const PREFIX = "!";
const TEMP_DIR = "./temp";
const active = new Set();

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

await fs.mkdir(TEMP_DIR, { recursive: true });

// ================= DB =================
await mongoose.connect(process.env.MONGO_URI);

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  username: String,
  mmr: { type: Number, default: 1000 },
  warnings: { type: Number, default: 0 },
  bans: { type: Number, default: 0 }
});

const configSchema = new mongoose.Schema({
  guildId: String,
  disabledCommands: [String]
});

const User = mongoose.model("User", userSchema);
const Config = mongoose.model("Config", configSchema);

// ================= DISCORD =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ================= HELPERS =================
function isDisabled(guildId, cmd) {
  return Config.findOne({ guildId }).then(c => c?.disabledCommands?.includes(cmd));
}

// ================= DOWNLOAD =================
const downloadVideo = async (url, output) => {
  if (!url.startsWith("http")) throw new Error("Invalid URL");

  const res = await axios({ url, method: "GET", responseType: "stream" });

  await new Promise((resolve, reject) => {
    const s = fsSync.createWriteStream(output);
    res.data.pipe(s);
    s.on("finish", resolve);
    s.on("error", reject);
  });
};

// ================= VIDEO =================
const enhance = (input, output) => {
  return new Promise((res, rej) => {
    ffmpeg(input)
      .videoFilters([
        "scale=1280:720:force_original_aspect_ratio=decrease",
        "pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "minterpolate=fps=60"
      ])
      .outputOptions(["-c:v libx264", "-crf 20"])
      .on("end", res)
      .on("error", rej)
      .save(output);
  });
};

// ================= COMMAND HANDLER =================
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(PREFIX.length).split(/ +/);
  const cmd = args.shift().toLowerCase();

  if (await isDisabled(msg.guild?.id, cmd)) {
    return msg.reply("❌ Command disabled");
  }

  // ================= PROFILE =================
  if (cmd === "profile") {
    let u = await User.findOne({ userId: msg.author.id }) ||
      await User.create({ userId: msg.author.id, username: msg.author.tag });

    return msg.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`👤 ${msg.author.username}`)
          .addFields(
            { name: "MMR", value: `${u.mmr}`, inline: true },
            { name: "Warnings", value: `${u.warnings}`, inline: true }
          )
      ]
    });
  }

  // ================= LEADERBOARD =================
  if (cmd === "leaderboard") {
    const top = await User.find().sort({ mmr: -1 }).limit(10);

    return msg.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Leaderboard")
          .setDescription(top.map((u,i)=>`${i+1}. <@${u.userId}> - ${u.mmr}`).join("\n"))
      ]
    });
  }

  // ================= WARN =================
  if (cmd === "warn") {
    if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return msg.reply("Admin only");
    }

    const target = msg.mentions.users.first();
    if (!target) return msg.reply("Mention user");

    await User.updateOne(
      { userId: target.id },
      { $inc: { warnings: 1 } },
      { upsert: true }
    );

    return msg.reply(`⚠️ Warned ${target.tag}`);
  }

  // ================= TOGGLE COMMAND =================
  if (cmd === "toggle") {
    if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return msg.reply("Admin only");
    }

    const targetCmd = args[0];
    if (!targetCmd) return msg.reply("Specify command");

    let config = await Config.findOne({ guildId: msg.guild.id }) ||
      await Config.create({ guildId: msg.guild.id, disabledCommands: [] });

    if (config.disabledCommands.includes(targetCmd)) {
      config.disabledCommands = config.disabledCommands.filter(c => c !== targetCmd);
      await config.save();
      return msg.reply(`✅ Enabled ${targetCmd}`);
    } else {
      config.disabledCommands.push(targetCmd);
      await config.save();
      return msg.reply(`❌ Disabled ${targetCmd}`);
    }
  }

  // ================= ENHANCE =================
  if (cmd === "enhance") {
    const url = args[0];
    if (!url) return msg.reply("Provide URL");

    if (active.has(msg.author.id)) return msg.reply("Busy");

    active.add(msg.author.id);

    const id = crypto.randomBytes(4).toString("hex");
    const input = `${TEMP_DIR}/in_${id}.mp4`;
    const output = `${TEMP_DIR}/out_${id}.mp4`;

    try {
      await msg.reply("📥 Downloading...");
      await downloadVideo(url, input);

      await msg.channel.send("⚙️ Enhancing...");
      await enhance(input, output);

      await msg.author.send({ files: [output] });
      await msg.channel.send("✅ Done");

      await User.updateOne(
        { userId: msg.author.id },
        { $inc: { mmr: 5 } },
        { upsert: true }
      );

    } catch (e) {
      console.error(e);
      msg.channel.send("❌ Failed");
    }

    await fs.unlink(input).catch(()=>{});
    await fs.unlink(output).catch(()=>{});
    active.delete(msg.author.id);
  }
});

// ================= READY =================
client.once("ready", () => {
  console.log("🔥 FULL GOD MODE READY");
  client.user.setActivity("God Engine", { type: ActivityType.Playing });
});

// ================= DASHBOARD API =================
const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_,res)=>res.send("OK"));

app.get("/dashboard/:guild", async (req,res)=>{
  const config = await Config.findOne({ guildId: req.params.guild });
  res.json(config || { disabledCommands: [] });
});

app.post("/dashboard/toggle", async (req,res)=>{
  const { guildId, command } = req.body;

  let config = await Config.findOne({ guildId }) ||
    await Config.create({ guildId, disabledCommands: [] });

  if (config.disabledCommands.includes(command)) {
    config.disabledCommands = config.disabledCommands.filter(c => c !== command);
  } else {
    config.disabledCommands.push(command);
  }

  await config.save();
  res.json(config);
});

app.get("/leaderboard", async (_,res)=>{
  const top = await User.find().sort({ mmr:-1 }).limit(20);
  res.json(top);
});

app.listen(process.env.PORT || 3000);

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);
