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

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"]
}));

app.use(express.json());

app.get("/", (_, res) => {
  res.send("🔥 GOD MODE API ONLINE");
});

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

// ===== READY =====
client.once("clientReady", () => {
  console.log(`
██████╗  ██████╗ ██████╗ 
██╔══██╗██╔═══██╗██╔══██╗
██████╔╝██║   ██║██████╔╝
██╔═══╝ ██║   ██║██╔══██╗
██║     ╚██████╔╝██║  ██║
╚═╝      ╚═════╝ ╚═╝  ╚═╝

🔥 GOD MODE ACTIVATED
🤖 ${client.user.tag} ONLINE
`);
});

// ===== AUTO APPLY ROLE ON JOIN =====
client.on("guildMemberAdd", async member => {
  const user = await User.findOne({ userId: member.id });
  if (!user) return;
  applyRank(member, user.mmr);
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
      ...buttons.slice(5),
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

  if (cmd === "submit") {
    return msg.reply({
      content: "🎬 Click below to submit your clip",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("open_submit_modal")
            .setLabel("Submit Clip")
            .setStyle(ButtonStyle.Primary)
        )
      ]
    });
  }

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

    return msg.reply(`🚀 Boosted!\n+${reward} coins\n+25 MMR\n🔥 Streak: ${user.boostStreak}`);
  }

  if (cmd === "profile") {
    return msg.reply(
      `Rank: ${getRank(user.mmr).name}\nMMR: ${user.mmr}\nPeak: ${user.peakMMR}\nCoins: ${user.coins}`
    );
  }

  if (cmd === "leaderboard") {
    const top = await User.find().sort({ mmr: -1 }).limit(10);

    return msg.reply(
      top.map((u, i) => `${i+1}. <@${u.userId}> (${u.mmr})`).join("\n")
    );
  }
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {

  if (i.isButton() && i.customId === "open_submit_modal") {
    const modal = new ModalBuilder()
      .setCustomId("submit_modal")
      .setTitle("Submit Clip");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("link")
          .setLabel("Direct Video URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

    return i.showModal(modal);
  }

  if (i.isModalSubmit() && i.customId === "submit_modal") {
    const link = i.fields.getTextInputValue("link");

    if (!link.startsWith("http"))
      return i.reply({ content: "Invalid link", ephemeral: true });

    const id = crypto.randomBytes(4).toString("hex");

    processVideo(link, id, i.user.id);

    return i.reply({ content: "🚀 Processing started!", ephemeral: true });
  }

  if (i.isButton()) {
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

    if (type === "rank") {
      const rank = RANKS.find(r => r.name === value);

      user.mmr = rank.mmr;
      await user.save();
      await applyRank(member, user.mmr);

      if (LOG_CHANNEL) {
        const log = await client.channels.fetch(LOG_CHANNEL);
        log.send(`🛠️ ${i.user.tag} set ${userId} → ${rank.name}`);
      }

      return i.reply({ content: `✅ Set ${rank.name}`, ephemeral: true });
    }

    if (type === "mmr") {
      const change = value === "up" ? 50 : -50;

      user.mmr += change;
      await user.save();
      await applyRank(member, user.mmr);

      return i.reply({
        content: `MMR: ${user.mmr}`,
        ephemeral: true
      });
    }
  }
});

// ================= API =================
app.get("/api/status", (_, res) => {
  res.json({
    online: client.isReady(),
    uptime: process.uptime()
  });
});

app.get("/api/leaderboard", async (_, res) => {
  const users = await User.find().sort({ mmr: -1 }).limit(50);
  res.json(users);
});

app.get("/api/dashboard", async (_, res) => {
  const users = await User.countDocuments();
  const top = await User.find().sort({ mmr: -1 }).limit(1);

  res.json({
    users,
    topPlayer: top[0] || null
  });
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
