import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField
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

app.use(cors({ origin: "*"}));
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
  peakMMR: { type: Number, default: 900 }
}));

// ===== SUBMISSIONS =====
const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "processing" },
  createdAt: { type: Date, default: Date.now }
}));

// ===== PREMIUM CODE =====
const PremiumCode = mongoose.model("PremiumCode", new mongoose.Schema({
  code: String,
  used: { type: Boolean, default: false },
  usedBy: String,
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
  return RANKS.reverse().find(r => mmr >= r.mmr) || RANKS[RANKS.length - 1];
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

client.once("clientReady", () => {
  console.log(`
🔥 GOD MODE ACTIVATED
🤖 ${client.user.tag} ONLINE
`);
});

// ================= VIDEO =================
async function processVideo(link, id, userId) {
  const output = `out_${id}.mp4`;

  const sub = await Submission.create({ id, userId, link });

  try {
    await Promise.race([
      new Promise((res, rej) => {
        ffmpeg(link)
          .videoFilters(["scale=1920:1080"])
          .on("end", res)
          .on("error", rej)
          .save(output);
      }),
      new Promise((_, rej) => setTimeout(() => rej("Timeout"), 300000))
    ]);

    sub.status = "done";
    await sub.save();

    const channel = await client.channels.fetch(REVIEW_CHANNEL);

    const buttons = RANKS.map(r =>
      new ButtonBuilder()
        .setCustomId(`rank_${r.name}_${userId}`)
        .setLabel(r.name)
        .setStyle(ButtonStyle.Primary)
    );

    const row1 = new ActionRowBuilder().addComponents(buttons.slice(0,5));
    const row2 = new ActionRowBuilder().addComponents(
      ...buttons.slice(5),
      new ButtonBuilder().setCustomId(`mmr_up_${userId}`).setLabel("+MMR").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`mmr_down_${userId}`).setLabel("-MMR").setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `🎬 <@${userId}>`,
      components: [row1, row2]
    });

  } catch (e) {
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

  // ===== CODE =====
  if (cmd === "code") {
    if (msg.author.id !== OWNER_ID) return msg.reply("Owner only");

    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    await PremiumCode.create({ code });

    return msg.reply(`🔥 CODE: ${code}`);
  }

  // ===== SUBMIT =====
  if (cmd === "submit") {
    return msg.reply({
      content: "🎬 Submit clip",
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
      return msg.reply("⏳ Wait 1 hour");

    user.boostStreak++;
    user.lastBoost = now;

    const reward = Math.floor(50 * Math.pow(1.1, user.boostStreak));
    user.coins += reward;
    user.mmr += 25;

    if (user.mmr > user.peakMMR) user.peakMMR = user.mmr;

    await user.save();

    const member = await msg.guild.members.fetch(msg.author.id);
    await applyRank(member, user.mmr);

    return msg.reply(`🚀 +${reward} coins | +25 MMR`);
  }

  if (cmd === "profile") {
    return msg.reply(`MMR: ${user.mmr} | Coins: ${user.coins}`);
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

    return i.reply({ content: "🚀 Processing", ephemeral: true });
  }

});

// ================= API =================
app.get("/api/status", (_, res) => res.json({ online: true }));

app.get("/api/leaderboard", async (_, res) => {
  const users = await User.find().sort({ mmr: -1 }).limit(50);
  res.json(users);
});

app.get("/api/submissions", async (_, res) => {
  const subs = await Submission.find().sort({ _id: -1 }).limit(20);
  res.json(subs);
});

app.post("/api/redeem", async (req, res) => {
  const { code, userId } = req.body;

  const found = await PremiumCode.findOne({ code, used: false });

  if (!found) return res.json({ success: false });

  found.used = true;
  found.usedBy = userId;
  await found.save();

  res.json({ success: true });
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
app.listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
