import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  EmbedBuilder,
  ActivityType,
  SlashCommandBuilder
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ytdl from "yt-dlp-exec";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";

// ===== CONFIG =====
const PREFIX = "?";
const MAIN_GUILD_ID = "1488203882130837704";

// ===== SYSTEM SETUP =====
ffmpeg.setFfmpegPath(ffmpegPath);

const TEMP_DIR = path.join(process.cwd(), "temp");
await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// ===== DATABASE =====
if (!process.env.MONGO_URL) {
  console.error("❌ MONGO_URL missing");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URL);
console.log("✅ MongoDB Connected");

// ===== MODELS =====
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  elo: { type: Number, default: 1000 },
  streak: { type: Number, default: 0 },
  coins: { type: Number, default: 0 }
});

const settingsSchema = new mongoose.Schema({
  guildId: String,
  gamble: { type: Boolean, default: true },
  moderation: { type: Boolean, default: true },
  economy: { type: Boolean, default: true },
  welcome: { type: Boolean, default: true }
});

const User = mongoose.model("User", userSchema);
const Settings = mongoose.model("Settings", settingsSchema);

// ===== HELPERS =====
async function getSettings(guildId) {
  let s = await Settings.findOne({ guildId });
  if (!s) s = await Settings.create({ guildId });
  return s;
}

const RANKS = [
  { name: "Bronze", mmr: 0 },
  { name: "Silver", mmr: 1200 },
  { name: "Gold", mmr: 1800 },
  { name: "Platinum", mmr: 2500 },
  { name: "Diamond", mmr: 3500 },
  { name: "Master", mmr: 4800 },
  { name: "Legend", mmr: 6500 }
];

function getRank(elo) {
  return [...RANKS].reverse().find(r => elo >= r.mmr) || RANKS[0];
}

async function updateRank(member, elo) {
  const rank = getRank(elo);

  let role = member.guild.roles.cache.find(r => r.name === rank.name);
  if (!role) {
    role = await member.guild.roles.create({ name: rank.name });
  }

  const rolesToRemove = member.roles.cache.filter(r =>
    RANKS.map(x => x.name).includes(r.name) && r.name !== rank.name
  );

  await member.roles.remove(rolesToRemove).catch(() => {});
  await member.roles.add(role).catch(() => {});
}

// ===== READY =====
client.once("clientReady", async () => {
  console.log(`🔥 ONLINE: ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "Overpowered Bot", type: ActivityType.Playing }],
    status: "online"
  });

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  const commands = [
    new SlashCommandBuilder().setName("profile").setDescription("View stats"),
    new SlashCommandBuilder()
      .setName("quality_method")
      .setDescription("Enhance video")
      .addStringOption(o => o.setName("url").setRequired(true))
  ].map(c => c.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, MAIN_GUILD_ID),
    { body: commands }
  );

  console.log("⚡ Commands synced");
});

// ===== MESSAGE COMMANDS =====
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const settings = await getSettings(msg.guild.id);

  let user = await User.findOne({ userId: msg.author.id });
  if (!user) {
    user = await User.create({
      userId: msg.author.id,
      username: msg.author.username
    });
  }

  // ===== GAMBLE =====
  if (cmd === "gamble") {
    if (!settings.gamble) return msg.reply("❌ Gamble disabled");

    const amount = Number(args[0]) || 0;
    if (amount <= 0) return msg.reply("Enter valid amount");

    const win = Math.random() > 0.5;
    user.coins += win ? amount : -amount;
    await user.save();

    return msg.reply(win ? `🎉 Won ${amount}` : `💀 Lost ${amount}`);
  }

  // ===== PROFILE =====
  if (cmd === "profile") {
    const rank = getRank(user.elo);

    return msg.reply(
      `🏆 ${msg.author.username}\nELO: ${user.elo}\nRank: ${rank.name}`
    );
  }

  // ===== LEADERBOARD =====
  if (cmd === "leaderboard") {
    const top = await User.find().sort({ elo: -1 }).limit(10);

    return msg.reply(
      top.map((u, i) => `${i + 1}. ${u.username} - ${u.elo}`).join("\n")
    );
  }
});

// ===== SLASH COMMANDS =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "profile") {
    const user = await User.findOne({ userId: i.user.id });
    if (!user) return i.reply("No data");

    return i.reply(`ELO: ${user.elo}`);
  }

  if (i.commandName === "quality_method") {
    await i.deferReply();

    try {
      const url = i.options.getString("url");
      const id = uuidv4();

      const input = path.join(TEMP_DIR, `${id}.mp4`);
      const output = path.join(TEMP_DIR, `out_${id}.mp4`);

      await ytdl(url, { output: input });

      await new Promise((res, rej) => {
        ffmpeg(input)
          .videoFilters(["scale=1920:-1"])
          .save(output)
          .on("end", res)
          .on("error", rej);
      });

      await i.editReply({ files: [output] });
    } catch {
      await i.editReply("❌ Failed");
    }
  }
});

// ===== EXPRESS API =====
const app = express();
app.use(cors());
app.use(express.json());

// Dashboard
app.get("/dashboard", async (_, res) => {
  const top = await User.find().sort({ elo: -1 }).limit(10);
  res.json(top);
});

// Run command
app.post("/run-command", async (req, res) => {
  if (req.headers.key !== process.env.ADMIN_KEY)
    return res.status(403).send("Forbidden");

  const { command, args = [], userId } = req.body;

  const guild = client.guilds.cache.get(MAIN_GUILD_ID);
  const channel = guild.channels.cache.find(c => c.isTextBased());

  const fakeMsg = {
    content: `${PREFIX}${command} ${args.join(" ")}`,
    author: { id: userId || "dashboard", bot: false },
    guild,
    channel,
    member: userId ? await guild.members.fetch(userId).catch(() => null) : null,
    reply: (m) => channel.send(`📊 ${m}`)
  };

  client.emit("messageCreate", fakeMsg);

  res.send("OK");
});

// Toggle
app.post("/toggle", async (req, res) => {
  if (req.headers.key !== process.env.ADMIN_KEY)
    return res.status(403).send("Forbidden");

  const { setting, value } = req.body;

  const s = await getSettings(MAIN_GUILD_ID);
  s[setting] = value;
  await s.save();

  res.json({ success: true });
});

// ===== START =====
app.get("/", (_, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
