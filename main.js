import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  EmbedBuilder
} from "discord.js";

import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import crypto from "crypto";
import fs from "fs";

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ================= CONFIG =================
const PREFIX = "!";
const REVIEW_CHANNEL = process.env.REVIEW_CHANNEL;
const LOG_CHANNEL = process.env.LOG_CHANNEL;
const OWNER_ID = process.env.OWNER_ID;

// ================= EXPRESS =================
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/", (_, res) => res.send("🔥 GOD MODE API ONLINE"));

// ================= DATABASE =================
await mongoose.connect(process.env.MONGO_URI);

// ===== USER =====
const User = mongoose.model("User", new mongoose.Schema({
  userId: { type: String, index: true },
  mmr: { type: Number, default: 900, index: true },
  coins: { type: Number, default: 1000 },
  lastBoost: { type: Number, default: 0 },
  boostStreak: { type: Number, default: 0 },
  peakMMR: { type: Number, default: 900 },

  qualityCode: String,
  qualityUnlocked: { type: Boolean, default: false }
}));

// ===== SUBMISSIONS =====
const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "processing" },
  createdAt: { type: Date, default: Date.now }
}));

// ================= RANKS =================
const RANKS = [
  { name: "SSS", role: "1488208025859788860", mmr: 2000 },
  { name: "SS+", role: "1488208185633280041", mmr: 1700 },
  { name: "SS", role: "1488208281930432602", mmr: 1500 },
  { name: "S+", role: "1488208494170738793", mmr: 1300 },
  { name: "S", role: "1488208584142753863", mmr: 1100 },
  { name: "A", role: "1488208696759685190", mmr: 900 }
];

function getRank(mmr) {
  return [...RANKS].reverse().find(r => mmr >= r.mmr) || RANKS[RANKS.length - 1];
}

async function applyRank(member, mmr) {
  const rank = getRank(mmr);
  if (member.roles.cache.has(rank.role)) return;
  await member.roles.remove(RANKS.map(r => r.role)).catch(()=>{});
  await member.roles.add(rank.role).catch(()=>{});
}

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= PANEL HELPER =================
function panel(title, desc, color = 0x00ffff) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setFooter({ text: "GOD MODE SYSTEM" })
    .setTimestamp();
}

// ================= STARTUP =================
client.once("ready", () => {
  console.clear();
  console.log(`🔥 ${client.user.tag} ONLINE`);
});

// ================= VIDEO =================
async function processVideo(link, id, userId) {
  const output = `out_${id}.mp4`;
  const sub = await Submission.create({ id, userId, link });

  const user = await User.findOne({ userId });

  const filters = user?.qualityUnlocked
    ? ["scale=1920:1080", "unsharp=5:5:1.0"]
    : ["scale=1280:720"];

  try {
    await new Promise((res, rej) => {
      ffmpeg(link)
        .videoFilters(filters)
        .on("end", res)
        .on("error", rej)
        .save(output);
    });

    sub.status = "done";
    await sub.save();

    const channel = await client.channels.fetch(REVIEW_CHANNEL);

    await channel.send({
      embeds: [
        panel("🎬 NEW SUBMISSION", `<@${userId}>\n[View Clip](${link})`)
      ]
    });

  } catch {
    sub.status = "failed";
    await sub.save();
  }
}

// ================= COMMANDS =================
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const cmd = msg.content.slice(1).toLowerCase();

  const user = await User.findOneAndUpdate(
    { userId: msg.author.id },
    {},
    { upsert: true, new: true }
  );

  // ===== SUBMIT =====
  if (cmd === "submit") {
    return msg.reply({
      embeds: [panel("🎬 SUBMIT CLIP", "Click below")],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("open_submit_modal")
            .setLabel("Submit")
            .setStyle(ButtonStyle.Primary)
        )
      ]
    });
  }

  // ===== BOOST =====
  if (cmd === "boost") {
    const now = Date.now();
    if (now - user.lastBoost < 3600000)
      return msg.reply({ embeds: [panel("⏳ WAIT", "1 hour cooldown", 0xff0000)] });

    user.boostStreak++;
    user.lastBoost = now;

    const reward = Math.floor(50 * Math.pow(1.1, user.boostStreak));
    user.coins += reward;
    user.mmr += 25;

    // QUALITY CODE
    const code = crypto.randomBytes(3).toString("hex").toUpperCase();
    user.qualityCode = code;

    await user.save();

    try {
      await msg.author.send(
        `🔥 QUALITY CODE\nUse !quality and send:\n${code}`
      );
    } catch {}

    return msg.reply({
      embeds: [panel("🚀 BOOSTED", `+${reward} coins\n+25 MMR\n📩 Code sent to DMs`)]
    });
  }

  // ===== QUALITY =====
  if (cmd === "quality") {
    return msg.reply({
      embeds: [panel("📩 CHECK DMS", "Send your code in DM")]
    }).then(m => setTimeout(() => m.delete().catch(()=>{}), 10000));
  }

  // ===== PROFILE =====
  if (cmd === "profile") {
    return msg.reply({
      embeds: [panel("👤 PROFILE", `MMR: ${user.mmr}\nCoins: ${user.coins}`)]
    });
  }
});

// ================= DM CODE SYSTEM =================
client.on("messageCreate", async msg => {
  if (msg.guild || msg.author.bot) return;

  const user = await User.findOne({ userId: msg.author.id });
  if (!user || !user.qualityCode) return;

  if (msg.content.toUpperCase() === user.qualityCode) {
    user.qualityUnlocked = true;
    user.qualityCode = null;
    await user.save();

    const reply = await msg.reply("✅ QUALITY UNLOCKED");

    setTimeout(() => {
      msg.delete().catch(()=>{});
      reply.delete().catch(()=>{});
    }, 10000);
  }
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {
  if (i.isButton() && i.customId === "open_submit_modal") {
    const modal = new ModalBuilder()
      .setCustomId("submit_modal")
      .setTitle("Submit");

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

  if (i.isModalSubmit()) {
    const link = i.fields.getTextInputValue("link");
    const id = crypto.randomBytes(4).toString("hex");

    processVideo(link, id, i.user.id);

    return i.reply({
      embeds: [panel("🚀 PROCESSING", "Your clip is being processed")],
      ephemeral: true
    });
  }
});

// ================= API =================
app.get("/api/status", (_, res) => res.json({ online: client.isReady() }));

app.get("/api/leaderboard", async (_, res) => {
  const users = await User.find().sort({ mmr: -1 }).limit(50);
  res.json(users);
});

app.get("/api/submissions", async (_, res) => {
  const subs = await Submission.find().sort({ _id: -1 }).limit(20);
  res.json(subs);
});

// ================= CLEANUP =================
setInterval(() => {
  fs.readdirSync(".")
    .filter(f => f.startsWith("out_"))
    .forEach(f => {
      const stat = fs.statSync(f);
      if (Date.now() - stat.mtimeMs > 1800000)
        fs.unlinkSync(f);
    });
}, 3600000);

// ================= START =================
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 API running");
});

client.login(process.env.DISCORD_TOKEN);
