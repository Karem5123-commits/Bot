import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

// ================= EXPRESS =================
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/", (_, res) => res.send("🔥 GOD MODE API ONLINE"));

// ================= DATABASE =================
await mongoose.connect(process.env.MONGO_URI);

// ===== USER =====
const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  mmr: { type: Number, default: 900 },
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

async function applyRank(member, mmr) {
  const rank = [...RANKS].reverse().find(r => mmr >= r.mmr);
  if (!rank) return;
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

// ================= PANEL =================
const panel = (t,d,c=0x00ffff) =>
  new EmbedBuilder().setTitle(t).setDescription(d).setColor(c).setTimestamp();

// ================= STARTUP (YOUR BIRD KEPT) =================
client.once("ready", async () => {
  console.clear();
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const type = async (t,s=10)=>{for(const c of t){process.stdout.write(c);await sleep(s);}console.log();};

  await type("🔌 Booting GOD CORE...");
  await sleep(200);
  await type("⚙️ Injecting modules...");
  await sleep(200);

  console.log(`
        🐦
      🐦🐦
    🐦   🐦
   🐦     🐦
 🐦  GOD   🐦
   🐦     🐦
    🐦   🐦
      🐦🐦
        🐦
  `);

  await type("🔥 GOD MODE ACTIVATED");
  await type(`🤖 ${client.user.tag} ONLINE`);
});

// ================= VIDEO =================
async function processVideo(link, id, userId) {
  const sub = await Submission.create({ id, userId, link });

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
    embeds:[panel("🎬 NEW SUBMISSION", `<@${userId}>\n${link}`)],
    components:[row1,row2]
  });

  // background processing
  ffmpeg(link)
    .on("end", async ()=>{ sub.status="done"; await sub.save(); })
    .on("error", async ()=>{ sub.status="failed"; await sub.save(); })
    .save(`out_${id}.mp4`);
}

// ================= COMMANDS =================
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const cmd = msg.content.slice(1).toLowerCase();

  const user = await User.findOneAndUpdate(
    { userId: msg.author.id }, {}, { upsert:true,new:true }
  );

  if (cmd === "submit") {
    return msg.reply({
      embeds:[panel("🎬 SUBMIT","Click below")],
      components:[new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("submit").setLabel("Submit").setStyle(ButtonStyle.Primary)
      )]
    });
  }

  if (cmd === "boost") {
    user.coins += 100;
    user.mmr += 25;
    user.qualityCode = crypto.randomBytes(3).toString("hex").toUpperCase();
    await user.save();

    try {
      await msg.author.send(`Code: ${user.qualityCode}`);
    } catch {}

    return msg.reply({embeds:[panel("BOOSTED","+MMR + coins")]});
  }
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {

  if (i.isButton() && i.customId === "submit") {
    const modal = new ModalBuilder().setCustomId("m").setTitle("Submit");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("l").setLabel("Link").setStyle(TextInputStyle.Short)
    ));
    return i.showModal(modal);
  }

  if (i.isModalSubmit()) {
    const link = i.fields.getTextInputValue("l");
    processVideo(link, crypto.randomBytes(4).toString("hex"), i.user.id);

    return i.reply({embeds:[panel("📨 SENT","Sent for review")],ephemeral:true});
  }

  // ===== RANK =====
  if (i.isButton() && i.customId.startsWith("rank_")) {
    const [, rankName, userId] = i.customId.split("_");
    const rank = RANKS.find(r => r.name === rankName);

    const user = await User.findOneAndUpdate(
      { userId }, {}, { upsert:true,new:true }
    );

    user.mmr = rank.mmr;
    await user.save();

    const member = await i.guild.members.fetch(userId);
    await applyRank(member, user.mmr);

    return i.reply({embeds:[panel("RANK SET",`${rank.name}`)]});
  }

  // ===== MMR =====
  if (i.isButton() && i.customId.startsWith("mmr_")) {
    const [, type, userId] = i.customId.split("_");

    const user = await User.findOne({ userId });

    if (type === "up") user.mmr += 25;
    if (type === "down") user.mmr -= 25;

    await user.save();

    const member = await i.guild.members.fetch(userId);
    await applyRank(member, user.mmr);

    return i.reply({embeds:[panel("MMR UPDATED",`${user.mmr}`)]});
  }
});

// ================= START =================
app.listen(process.env.PORT || 3000, () => {
  console.log("API running");
});

client.login(process.env.DISCORD_TOKEN);
