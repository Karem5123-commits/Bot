import {
  Client, GatewayIntentBits, SlashCommandBuilder,
  REST, Routes, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle
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

// ===== CONFIG =====
const OWNERS = ["1347959266539081768","1399094217846030346"];

// ===== SAFE =====
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ===== EXPRESS =====
const app = express();
app.use(express.json());
app.use(cors());

app.get('/', (_, res) => res.send('🔥 Bot Running'));

// ===== DB =====
mongoose.connect(process.env.MONGO_URI);

// ===== MODELS =====
const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  coins: { type: Number, default: 1000 },
  submissions: { type: Number, default: 0 }
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "pending" },
  processedFile: String,
  progress: { type: Number, default: 0 }
}));

const PremiumCode = mongoose.model("PremiumCode", new mongoose.Schema({
  userId: String,
  code: String,
  used: { type: Boolean, default: false }
}));

// ===== RANK =====
function getRank(mmr) {
  if (mmr >= 1800) return "Grandmaster";
  if (mmr >= 1600) return "Master";
  if (mmr >= 1400) return "Diamond";
  if (mmr >= 1200) return "Platinum";
  if (mmr >= 1000) return "Gold";
  if (mmr >= 800) return "Silver";
  return "Bronze";
}

// ===== VIDEO =====
async function processVideo(sub) {
  const input = `./in_${sub.id}.mp4`;
  const output = `./out_${sub.id}.mp4`;

  try {
    sub.status = "downloading"; await sub.save();

    await ytdlp(sub.link, { output: input });

    sub.status = "processing"; await sub.save();

    await new Promise((res, rej) => {
      ffmpeg(input)
        .videoFilters(["scale=3840:2160:flags=lanczos","unsharp=5:5:1.0"])
        .on("progress", p => sub.progress = Math.floor(p.percent || 0))
        .on("end", res)
        .on("error", rej)
        .save(output);
    });

    sub.status = "done";
    sub.processedFile = output;
    await sub.save();

    fs.existsSync(input) && fs.unlinkSync(input);

    // ===== DISCORD PANEL =====
    const channel = await client.channels.fetch(process.env.REVIEW_CHANNEL);

    const buttons = [];
    for (let i = 1; i <= 10; i++) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`rate_${sub.id}_${i}`)
          .setLabel(`${i}`)
          .setStyle(ButtonStyle.Primary)
      );
    }

    const row = new ActionRowBuilder().addComponents(buttons);

    channel.send({
      content: `🎬 Submission Ready\n${sub.link}`,
      components: [row]
    });

  } catch (e) {
    console.error(e);
    sub.status = "failed";
    await sub.save();
  }
}

// ===== DISCORD =====
const client = new Client({ intents: Object.values(GatewayIntentBits) });

// ===== SLASH =====
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

// ===== INTERACTIONS =====
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

        return i.reply(`MMR: ${user.mmr} | Rank: ${getRank(user.mmr)} | Coins: ${user.coins}`);
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

      await User.updateOne(
        { userId: i.user.id },
        { $inc: { submissions: 1 }, username: i.user.tag },
        { upsert: true }
      );

      processVideo(sub);

      return i.reply({ content: "🚀 Processing started!", ephemeral: true });
    }

    if (i.isButton()) {
      const [type, subId, score] = i.customId.split("_");

      if (type === "rate") {

        if (!i.member.permissions.has("ManageRoles"))
          return i.reply({ content: "Staff only", ephemeral: true });

        const sub = await Submission.findOne({ id: subId });
        if (!sub) return;

        const user = await User.findOne({ userId: sub.userId });

        const mmrMap = {
          1:100,2:200,3:300,4:500,5:700,
          6:900,7:1100,8:1300,9:1400,10:1500
        };

        const gain = mmrMap[score];
        user.mmr += gain;

        await user.save();

        sub.status = "done";
        await sub.save();

        return i.update({
          content: `✅ Rated ${score}/10 → +${gain} MMR`,
          components: []
        });
      }
    }

  } catch (e) {
    console.error(e);
  }
});

// ===== PREFIX COMMANDS =====
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith("!") && !msg.content.startsWith("?")) return;
  if (msg.author.bot) return;

  const args = msg.content.slice(1).split(/ +/);
  const cmd = args.shift().toLowerCase();

  let user = await User.findOne({ userId: msg.author.id });
  if (!user) user = await User.create({ userId: msg.author.id, username: msg.author.tag });

  // OWNER CODE
  if (msg.content.startsWith("?") && cmd === "code") {
    if (!OWNERS.includes(msg.author.id)) return msg.reply("Owner only");

    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    await PremiumCode.create({ userId: msg.author.id, code });

    return msg.reply(`🔥 Code: ${code}`);
  }

  // ECONOMY
  if (cmd === "balance") return msg.reply(`💰 ${user.coins}`);
  if (cmd === "daily") { user.coins += 500; await user.save(); return msg.reply("+500"); }

  // GAMBLING
  if (cmd === "coinflip") {
    const win = Math.random() > 0.5;
    user.coins += win ? 100 : -100;
    await user.save();
    return msg.reply(win ? "Win" : "Lose");
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

  // FUN
  if (cmd === "ping") msg.reply("Pong");
  if (cmd === "8ball") msg.reply(["Yes","No","Maybe"][Math.floor(Math.random()*3)]);
});

// ===== API =====
app.get('/api/status', (_, res) => res.json({ online: client.isReady() }));

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

app.get('/api/download/:id', async (req, res) => {
  const sub = await Submission.findOne({ id: req.params.id });
  if (!sub || !sub.processedFile) return res.status(404).send("Not found");

  res.download(sub.processedFile);
});

app.post('/api/redeem', async (req, res) => {
  const { code } = req.body;
  const found = await PremiumCode.findOne({ code, used: false });

  if (!found) return res.json({ success: false });

  found.used = true;
  await found.save();

  res.json({ success: true });
});

// ===== START =====
app.listen(process.env.PORT || 3000, () => console.log("🌐 API running"));
client.login(process.env.DISCORD_TOKEN);
