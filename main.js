import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
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
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import crypto from "crypto";
import fs from "fs";

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ================= CONFIG =================
const PREFIX = "!";
const REVIEW_CHANNEL = process.env.REVIEW_CHANNEL;

const RANKS = [
  { name: "SSS", role: "1488208025859788860", mmr: 2000 },
  { name: "SS+", role: "1488208185633280041", mmr: 1700 },
  { name: "SS", role: "1488208281930432602", mmr: 1500 },
  { name: "S+", role: "1488208494170738793", mmr: 1300 },
  { name: "S", role: "1488208584142753863", mmr: 1100 },
  { name: "A", role: "1488208696759685190", mmr: 900 }
];

// ================= EXPRESS =================
const app = express();
app.get("/", (_, res) => res.send("🔥 Bot Running"));
app.listen(process.env.PORT || 3000);

// ================= DATABASE =================
await mongoose.connect(process.env.MONGO_URI);

const User = mongoose.model("User", new mongoose.Schema({
  userId: { type: String, index: true },
  mmr: { type: Number, default: 900, index: true },
  coins: { type: Number, default: 1000 },
  lastBoost: { type: Number, default: 0 },
  boostStreak: { type: Number, default: 0 },
  peakMMR: { type: Number, default: 900 }
}));

// ================= RANK LOGIC =================
function getRank(mmr) {
  let r = RANKS[RANKS.length - 1];
  for (const rank of RANKS) if (mmr >= rank.mmr) r = rank;
  return r;
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

client.once("ready", () => {
  console.log(`🔥 ${client.user.tag} ONLINE`);
});

// ================= VIDEO PROCESS =================
async function processVideo(link, id, userId) {
  const output = `out_${id}.mp4`;

  try {
    await Promise.race([
      new Promise((res, rej) => {
        ffmpeg(link)
          .videoFilters(["scale=1920:1080", "unsharp=5:5:1.0"])
          .on("end", res)
          .on("error", rej)
          .save(output);
      }),
      new Promise((_, rej) => setTimeout(() => rej("Timeout"), 300000))
    ]);

    const channel = await client.channels.fetch(REVIEW_CHANNEL);

    const buttons = RANKS.map(r =>
      new ButtonBuilder()
        .setCustomId(`rank_${r.name}_${userId}`)
        .setLabel(r.name)
        .setStyle(ButtonStyle.Primary)
    );

    const row1 = new ActionRowBuilder().addComponents(buttons.slice(0, 5));
    const row2 = new ActionRowBuilder().addComponents(
      buttons.slice(5),
      new ButtonBuilder().setCustomId(`mmr_up_${userId}`).setLabel("+MMR").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`mmr_down_${userId}`).setLabel("-MMR").setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `🎬 Submission from <@${userId}>\n${link}`,
      components: [row1, row2]
    });

  } catch (e) {
    console.error("Processing failed:", e);
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
    const modal = new ModalBuilder()
      .setCustomId("submit_modal")
      .setTitle("Submit Clip");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Direct Video URL")
          .setStyle(TextInputStyle.Short)
      )
    );

    return msg.reply("Use slash command version or paste link here soon");
  }

  // ===== BOOST SYSTEM =====
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

    return msg.reply(`🚀 Boosted!\n+${reward} coins\n+25 MMR\n🔥 Streak: ${user.boostStreak}`);
  }

  // ===== PROFILE =====
  if (cmd === "profile") {
    return msg.reply(
      `Rank: ${getRank(user.mmr).name}\nMMR: ${user.mmr}\nPeak: ${user.peakMMR}\nCoins: ${user.coins}`
    );
  }

  // ===== LEADERBOARD =====
  if (cmd === "leaderboard") {
    const top = await User.find().sort({ mmr: -1 }).limit(10);

    return msg.reply(
      top.map((u, i) => `${i+1}. <@${u.userId}> (${u.mmr})`).join("\n")
    );
  }
});

// ================= MODAL =================
client.on("interactionCreate", async i => {
  if (!i.isModalSubmit()) return;

  if (i.customId === "submit_modal") {
    const link = i.fields.getTextInputValue("link");

    if (!link.startsWith("http"))
      return i.reply({ content: "Invalid link", ephemeral: true });

    const id = crypto.randomBytes(4).toString("hex");

    processVideo(link, id, i.user.id);

    return i.reply({ content: "🚀 Processing started!", ephemeral: true });
  }
});

// ================= STAFF BUTTONS =================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
    return i.reply({ content: "Staff only", ephemeral: true });

  const [type, value, userId] = i.customId.split("_");

  const user = await User.findOneAndUpdate(
    { userId },
    {},
    { upsert: true, new: true }
  );

  const member = await i.guild.members.fetch(userId).catch(()=>{});
  if (!member) return;

  // ===== SET RANK =====
  if (type === "rank") {
    const rank = RANKS.find(r => r.name === value);

    user.mmr = rank.mmr;
    if (user.mmr > user.peakMMR) user.peakMMR = user.mmr;

    await user.save();
    await applyRank(member, user.mmr);

    return i.reply({ content: `✅ Set ${rank.name}`, ephemeral: true });
  }

  // ===== MMR CHANGE =====
  if (type === "mmr") {
    const change = value === "up" ? 50 : -50;

    user.mmr += change;
    if (user.mmr < 0) user.mmr = 0;

    if (user.mmr > user.peakMMR) user.peakMMR = user.mmr;

    await user.save();
    await applyRank(member, user.mmr);

    return i.reply({
      content: `MMR: ${user.mmr} (${change > 0 ? "+" : ""}${change})`,
      ephemeral: true
    });
  }
});

// ================= AUTO CLEANUP =================
setInterval(() => {
  fs.readdirSync(".")
    .filter(f => f.startsWith("out_"))
    .forEach(f => {
      const stat = fs.statSync(f);
      if (Date.now() - stat.mtimeMs > 1800000)
        fs.unlinkSync(f);
    });
}, 3600000);

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);
