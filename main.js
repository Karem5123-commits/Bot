import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ytdl from "yt-dlp-exec";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { User, GuildConfig } from "./models.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const PREFIX = "?";
const ADMIN_KEY = process.env.ADMIN_KEY;
const MAIN_GUILD_ID = process.env.GUILD_ID;

const TEMP_DIR = path.join(process.cwd(), "temp");
await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// ===== DATABASE =====
await mongoose.connect(process.env.MONGO_URL);
console.log("✅ DB Connected");

// ===== EXPRESS =====
const app = express();
app.use(express.json());

// ===== COMMAND TOGGLES =====
let commandToggles = {};

// ===== RANK SYSTEM =====
const RANKS = [
  { name: "Bronze", mmr: 0, color: "#8d6e63", icon: "🥉" },
  { name: "Silver", mmr: 1200, color: "#b0bec5", icon: "🥈" },
  { name: "Gold", mmr: 1800, color: "#f1c40f", icon: "🥇" },
  { name: "Platinum", mmr: 2500, color: "#00bcd4", icon: "💎" },
  { name: "Diamond", mmr: 3500, color: "#3498db", icon: "🛡️" },
  { name: "Master", mmr: 4800, color: "#9b59b6", icon: "🔮" },
  { name: "Legend", mmr: 6500, color: "#e74c3c", icon: "👑" }
];

const getRank = (elo) =>
  [...RANKS].reverse().find(r => elo >= r.mmr) || RANKS[0];

const calcElo = (score, elo) => {
  return Math.round((score - 5) * 40);
};

// ===== APPLY ROLE =====
async function applyRank(member, elo) {
  const rank = getRank(elo);
  let role = member.guild.roles.cache.find(r => r.name === rank.name);

  if (!role) {
    role = await member.guild.roles.create({
      name: rank.name,
      color: rank.color
    });
  }

  const rankNames = RANKS.map(r => r.name);

  const removeRoles = member.roles.cache.filter(r =>
    rankNames.includes(r.name) && r.name !== rank.name
  );

  await member.roles.remove(removeRoles).catch(() => {});
  await member.roles.add(role).catch(() => {});
}

// ===== READY =====
client.once("clientReady", () => {
  console.log(`🔥 ${client.user.tag} ONLINE`);
});

// ===== MESSAGE COMMANDS =====
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(1).split(" ");
  const cmd = args.shift().toLowerCase();

  // TOGGLE CHECK
  if (commandToggles[cmd] === false) {
    return msg.reply("❌ Command disabled");
  }

  let user = await User.findOneAndUpdate(
    { userId: msg.author.id },
    { username: msg.author.username, elo: 1000 },
    { upsert: true, new: true }
  );

  // ===== COMMANDS =====

  if (cmd === "profile") {
    const rank = getRank(user.elo);

    return msg.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`${rank.icon} ${msg.author.username}`)
          .setColor(rank.color)
          .addFields(
            { name: "ELO", value: `${user.elo}`, inline: true },
            { name: "Rank", value: rank.name, inline: true }
          )
      ]
    });
  }

  if (cmd === "coinflip") {
    return msg.reply(Math.random() > 0.5 ? "Heads" : "Tails");
  }

  if (cmd === "balance") {
    return msg.reply(`💰 Coins: ${user.coins || 0}`);
  }

  if (cmd === "ping") {
    return msg.reply("🏓 Pong");
  }
});

// ===== JOIN =====
client.on("guildMemberAdd", async member => {
  await User.findOneAndUpdate(
    { userId: member.id },
    { elo: 1000 },
    { upsert: true }
  );

  await applyRank(member, 1000);
});

// ===== DASHBOARD ROUTES =====

// GET dashboard
app.get("/dashboard", async (_, res) => {
  const users = await User.countDocuments();
  const top = await User.find().sort({ elo: -1 }).limit(10);

  res.json({
    totalUsers: users,
    leaderboard: top
  });
});

// RUN COMMAND
app.post("/run-command", async (req, res) => {
  try {
    if (req.headers.key !== ADMIN_KEY)
      return res.status(403).send("Forbidden");

    const { command, args, userId } = req.body;

    const guild = client.guilds.cache.get(MAIN_GUILD_ID);
    const channel = guild.channels.cache
      .filter(c => c.isTextBased())
      .first();

    const fakeMsg = {
      author: { id: userId || "dashboard", bot: false },
      guild,
      channel,
      member: await guild.members.fetch(userId).catch(() => null),
      reply: (msg) => channel.send(`📊 ${msg}`),
      content: `?${command} ${args?.join(" ") || ""}`
    };

    client.emit("messageCreate", fakeMsg);

    res.send("OK");
  } catch {
    res.status(500).send("Error");
  }
});

// TOGGLE COMMAND
app.post("/toggle-command", (req, res) => {
  try {
    if (req.headers.key !== ADMIN_KEY)
      return res.status(403).send("Forbidden");

    const { command, enabled } = req.body;

    commandToggles[command] = enabled;

    res.json({ success: true });
  } catch {
    res.status(500).send("Error");
  }
});

// ===== QUALITY METHOD =====
app.post("/quality", async (req, res) => {
  try {
    const { url } = req.body;
    const id = uuidv4();

    const input = path.join(TEMP_DIR, `${id}.mp4`);
    const output = path.join(TEMP_DIR, `out_${id}.mp4`);

    await ytdl(url, { output: input });

    await new Promise((resolve, reject) => {
      ffmpeg(input)
        .videoFilters(["scale=1920:-1"])
        .save(output)
        .on("end", resolve)
        .on("error", reject);
    });

    res.download(output);

    await fs.unlink(input).catch(() => {});
    await fs.unlink(output).catch(() => {});
  } catch {
    res.status(500).send("Error");
  }
});

// ===== START =====
app.listen(process.env.PORT || 3000, () =>
  console.log("🌐 Web running")
);

client.login(process.env.DISCORD_TOKEN);
