import {
  Client, GatewayIntentBits, SlashCommandBuilder,
  REST, Routes, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, EmbedBuilder
} from 'discord.js';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ytdlp from 'yt-dlp-exec';
import fs from 'fs';

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath);

// ================= CONFIG =================
const OWNERS = [
  "1347959266539081768",
  "1399094217846030346"
];

// ================= SAFE =================
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ================= EXPRESS =================
const app = express();
app.use(express.json());
app.use(cors());

app.get('/', (_, res) => res.send('🔥 Bot Running'));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI);

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  coins: { type: Number, default: 1000 }
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "pending" },
  processedFile: String
}));

const PremiumCode = mongoose.model("PremiumCode", new mongoose.Schema({
  userId: String,
  code: String,
  used: { type: Boolean, default: false }
}));

// ================= RANK =================
function getRank(mmr) {
  if (mmr >= 1800) return "Grandmaster";
  if (mmr >= 1600) return "Master";
  if (mmr >= 1400) return "Diamond";
  if (mmr >= 1200) return "Platinum";
  if (mmr >= 1000) return "Gold";
  if (mmr >= 800) return "Silver";
  return "Bronze";
}

// ================= VIDEO PROCESS =================
async function processVideo(sub) {
  const input = `./in_${sub.id}.mp4`;
  const output = `./out_${sub.id}.mp4`;

  try {
    await ytdlp(sub.link, { output: input });

    await new Promise((res, rej) => {
      ffmpeg(input)
        .videoFilters([
          "scale=3840:2160:flags=lanczos",
          "unsharp=5:5:1.0"
        ])
        .on("end", res)
        .on("error", rej)
        .save(output);
    });

    fs.existsSync(input) && fs.unlinkSync(input);
    return output;

  } catch {
    fs.existsSync(input) && fs.unlinkSync(input);
    return null;
  }
}

// ================= DISCORD =================
const client = new Client({
  intents: Object.values(GatewayIntentBits)
});

// ================= SLASH =================
client.once("ready", async () => {
  console.log(`✅ ${client.user.tag}`);

  const cmds = [
    new SlashCommandBuilder().setName("submit").setDescription("Submit video"),
    new SlashCommandBuilder().setName("profile").setDescription("View profile")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: cmds }
  );
});

// ================= SLASH HANDLER =================
client.on("interactionCreate", async i => {
  try {
    if (i.isChatInputCommand()) {

      if (i.commandName === "submit") {
        const modal = new ModalBuilder()
          .setCustomId("submit_modal")
          .setTitle("Submit Clip");

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

      if (i.commandName === "profile") {
        let user = await User.findOne({ userId: i.user.id });
        if (!user) user = await User.create({ userId: i.user.id, username: i.user.tag });

        return i.reply(`MMR: ${user.mmr} | Rank: ${getRank(user.mmr)}`);
      }
    }

    if (i.isModalSubmit()) {
      const link = i.fields.getTextInputValue("link");
      const id = crypto.randomBytes(4).toString("hex");

      const sub = await Submission.create({
        id,
        userId: i.user.id,
        link,
        status: "processing"
      });

      processVideo(sub).then(async file => {
        sub.status = file ? "done" : "failed";
        sub.processedFile = file;
        await sub.save();
      });

      return i.reply({ content: "🚀 Processing started!", ephemeral: true });
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= PREFIX COMMANDS =================
client.on("messageCreate", async msg => {
  try {
    if (!msg.content.startsWith("!") && !msg.content.startsWith("?")) return;
    if (msg.author.bot) return;

    const args = msg.content.slice(1).split(/ +/);
    const cmd = args.shift().toLowerCase();

    let user = await User.findOne({ userId: msg.author.id });
    if (!user) user = await User.create({ userId: msg.author.id, username: msg.author.tag });

    // OWNER
    if (msg.content.startsWith("?") && cmd === "code") {
      if (!OWNERS.includes(msg.author.id)) return msg.reply("Owner only");
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      await PremiumCode.create({ userId: msg.author.id, code });
      return msg.reply(`🔥 ${code}`);
    }

    // ECONOMY
    if (cmd === "balance") return msg.reply(`💰 ${user.coins}`);
    if (cmd === "daily") {
      user.coins += 500;
      await user.save();
      return msg.reply("💰 +500");
    }

    // GAMBLING
    if (cmd === "coinflip") {
      const win = Math.random() > 0.5;
      user.coins += win ? 100 : -100;
      await user.save();
      return msg.reply(win ? "Win" : "Lose");
    }

    if (cmd === "slots") {
      const items = ["🍒","🍋","🍉"];
      const s = () => items[Math.floor(Math.random()*3)];
      return msg.reply(`${s()}|${s()}|${s()}`);
    }

    if (cmd === "bet") {
      const amt = parseInt(args[0]) || 0;
      if (user.coins < amt) return msg.reply("No coins");

      const win = Math.random() > 0.5;
      user.coins += win ? amt : -amt;
      await user.save();

      return msg.reply(win ? `+${amt}` : `-${amt}`);
    }

    // MOD
    if (cmd === "kick") {
      if (!msg.member.permissions.has("KickMembers")) return;
      const u = msg.mentions.users.first();
      if (!u) return;
      await msg.guild.members.kick(u.id).catch(()=>{});
      msg.reply("Kicked");
    }

    if (cmd === "ban") {
      if (!msg.member.permissions.has("BanMembers")) return;
      const u = msg.mentions.users.first();
      if (!u) return;
      await msg.guild.members.ban(u.id).catch(()=>{});
      msg.reply("Banned");
    }

    // FUN (many)
    if (cmd === "ping") msg.reply("Pong");
    if (cmd === "8ball") {
      const r = ["Yes","No","Maybe"];
      msg.reply(r[Math.floor(Math.random()*3)]);
    }

    // RATING
    if (cmd === "rate") {
      if (!msg.member.permissions.has("ManageRoles")) return;

      const score = parseInt(args[0]);
      if (!score || score < 1 || score > 10) return;

      const sub = await Submission.findOne({ status: "processing" });
      if (!sub) return msg.reply("No submissions");

      const target = await User.findOne({ userId: sub.userId });

      const mmrMap = {
        1:100,2:200,3:300,4:500,5:700,
        6:900,7:1100,8:1300,9:1400,10:1500
      };

      target.mmr += mmrMap[score];
      await target.save();

      sub.status = "done";
      await sub.save();

      msg.reply(`Rated ${score}`);
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= API =================
app.get('/api/status', (_, res) => {
  res.json({ online: client.isReady() });
});

app.get('/api/dashboard', async (_, res) => {
  const users = await User.countDocuments();
  const subs = await Submission.countDocuments();
  const processed = await Submission.countDocuments({ status: "done" });

  res.json({ users, submissions: subs, stats: { totalProcessed: processed } });
});

app.get('/api/leaderboard', async (_, res) => {
  const users = await User.find().sort({ mmr: -1 }).limit(50);
  res.json(users);
});

app.get('/api/submissions', async (_, res) => {
  const subs = await Submission.find().sort({ _id: -1 }).limit(20);
  res.json(subs);
});

app.post('/api/redeem', async (req, res) => {
  const { code } = req.body;
  const found = await PremiumCode.findOne({ code, used: false });

  if (!found) return res.json({ success: false });

  found.used = true;
  await found.save();

  res.json({ success: true });
});

// ================= START =================
app.listen(process.env.PORT || 3000, () => console.log("🌐 API running"));

client.login(process.env.DISCORD_TOKEN);
