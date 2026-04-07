import {
  Client, GatewayIntentBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionsBitField, REST, Routes, SlashCommandBuilder
} from "discord.js";

import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ytdlp from "yt-dlp-exec";

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ================= CONFIG =================
const RANKS = [
  { name: "SSS", role: "1488208025859788860", mmr: 2000 },
  { name: "SS+", role: "1488208185633280041", mmr: 1700 },
  { name: "SS", role: "1488208281930432602", mmr: 1500 },
  { name: "S+", role: "1488208494170738793", mmr: 1300 },
  { name: "S", role: "1488208584142753863", mmr: 1100 },
  { name: "A", role: "1488208696759685190", mmr: 900 }
];

// ================= DB =================
await mongoose.connect(process.env.MONGO_URI);

const userSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  username: String,
  mmr: { type: Number, default: 900, index: true },
  coins: { type: Number, default: 1000 },
  boostStreak: { type: Number, default: 0 },
  lastBoost: { type: Number, default: 0 },
  peakMMR: { type: Number, default: 900 }
});

const submissionSchema = new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: String,
  file: String
});

const User = mongoose.model("User", userSchema);
const Submission = mongoose.model("Submission", submissionSchema);

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= QUEUE =================
const queue = [];
let processing = false;

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  const sub = queue.shift();
  await processVideo(sub);

  processing = false;
  processQueue();
}

// ================= VIDEO =================
async function processVideo(sub) {
  const input = `./in_${sub.id}.mp4`;
  const output = `./out_${sub.id}.mp4`;

  try {
    sub.status = "downloading"; await sub.save();

    await ytdlp(sub.link, { output: input });

    sub.status = "processing"; await sub.save();

    await Promise.race([
      new Promise((res, rej) => {
        ffmpeg(input)
          .videoFilters(["scale=1920:1080", "unsharp=5:5:1.0"])
          .on("end", res)
          .on("error", rej)
          .save(output);
      }),
      new Promise((_, rej) => setTimeout(() => rej("Timeout"), 600000))
    ]);

    sub.status = "done";
    sub.file = output;
    await sub.save();

    sendToReview(sub);

  } catch (e) {
    sub.status = "failed";
    await sub.save();
  } finally {
    cleanup([input]);
  }
}

// ================= CLEANUP =================
function cleanup(files) {
  files.forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

// AUTO CLEAN LOOP
setInterval(() => {
  fs.readdirSync("./").forEach(f => {
    if ((f.startsWith("in_") || f.startsWith("out_"))) {
      const stat = fs.statSync(f);
      if (Date.now() - stat.mtimeMs > 30 * 60 * 1000) {
        fs.unlinkSync(f);
      }
    }
  });
}, 60 * 60 * 1000);

// ================= RANK =================
function getRank(mmr) {
  let r = RANKS[RANKS.length - 1];
  for (const rank of RANKS) {
    if (mmr >= rank.mmr) r = rank;
  }
  return r;
}

async function applyRank(member, mmr) {
  const rank = getRank(mmr);

  if (member.roles.cache.has(rank.role)) return rank;

  await member.roles.remove(RANKS.map(r => r.role)).catch(() => {});
  await member.roles.add(rank.role).catch(() => {});

  return rank;
}

// ================= REVIEW =================
async function sendToReview(sub) {
  const ch = await client.channels.fetch(process.env.REVIEW_CHANNEL);

  const buttons = RANKS.map(r =>
    new ButtonBuilder()
      .setCustomId(`rank_${r.name}_${sub.userId}`)
      .setLabel(r.name)
      .setStyle(ButtonStyle.Primary)
  );

  const row1 = new ActionRowBuilder().addComponents(buttons.slice(0, 5));
  const row2 = new ActionRowBuilder().addComponents(buttons.slice(5));

  await ch.send({
    content: `🎬 <@${sub.userId}>\n${sub.link}`,
    components: [row1, row2]
  });
}

// ================= SLASH =================
client.once("ready", async () => {
  console.log(`🔥 ${client.user.tag}`);

  const cmds = [
    new SlashCommandBuilder().setName("submit").setDescription("Submit clip"),
    new SlashCommandBuilder().setName("profile").setDescription("Profile"),
    new SlashCommandBuilder().setName("boost").setDescription("Boost MMR")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: cmds }
  );
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {

  // ===== COMMANDS =====
  if (i.isChatInputCommand()) {

    const user = await User.findOneAndUpdate(
      { userId: i.user.id },
      { $setOnInsert: { username: i.user.tag } },
      { upsert: true, new: true }
    );

    // SUBMIT
    if (i.commandName === "submit") {
      const modal = new ModalBuilder()
        .setCustomId("submit")
        .setTitle("Submit Clip");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("link")
            .setLabel("Streamable URL")
            .setStyle(TextInputStyle.Short)
        )
      );

      return i.showModal(modal);
    }

    // PROFILE
    if (i.commandName === "profile") {
      return i.reply(
        `MMR: ${user.mmr}\nRank: ${getRank(user.mmr).name}\nCoins: ${user.coins}`
      );
    }

    // BOOST SYSTEM 🔥
    if (i.commandName === "boost") {
      const now = Date.now();

      if (now - user.lastBoost < 3600000)
        return i.reply({ content: "⏳ 1h cooldown", ephemeral: true });

      user.boostStreak++;

      const reward = Math.floor(50 * Math.pow(1.1, user.boostStreak));

      user.mmr += reward;
      user.coins += reward;
      user.lastBoost = now;

      if (user.mmr > user.peakMMR) user.peakMMR = user.mmr;

      await user.save();

      const member = await i.guild.members.fetch(i.user.id);
      const rank = await applyRank(member, user.mmr);

      return i.reply(
        `🔥 Boost!\n+${reward} MMR\nStreak: ${user.boostStreak}\nRank: ${rank.name}`
      );
    }
  }

  // ===== MODAL =====
  if (i.isModalSubmit()) {
    const link = i.fields.getTextInputValue("link");

    if (!/^https?:\/\//.test(link))
      return i.reply({ content: "Invalid URL", ephemeral: true });

    const sub = await Submission.create({
      id: crypto.randomBytes(4).toString("hex"),
      userId: i.user.id,
      link,
      status: "queued"
    });

    queue.push(sub);
    processQueue();

    return i.reply({ content: "🚀 Queued!", ephemeral: true });
  }

  // ===== STAFF BUTTONS =====
  if (i.isButton()) {

    if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
      return i.reply({ content: "Staff only", ephemeral: true });

    const [type, rankName, userId] = i.customId.split("_");

    if (type === "rank") {

      const rank = RANKS.find(r => r.name === rankName);

      const user = await User.findOneAndUpdate(
        { userId },
        { mmr: rank.mmr },
        { upsert: true, new: true }
      );

      const member = await i.guild.members.fetch(userId);
      await applyRank(member, user.mmr);

      // LOG
      const log = await client.channels.fetch(process.env.LOG_CHANNEL);
      log.send(`🛠 ${i.user.tag} → ${rank.name} → <@${userId}>`);

      return i.reply({ content: `Set ${rank.name}`, ephemeral: true });
    }
  }
});

// ================= API =================
const app = express();
app.get("/", (_, res) => res.send("OK"));

app.get("/leaderboard", async (_, res) => {
  const top = await User.find().sort({ mmr: -1 }).limit(50);
  res.json(top);
});

app.listen(process.env.PORT || 3000);

// ================= LOGIN =================
client.login(process.env.TOKEN);
