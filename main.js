import {
  Client, GatewayIntentBits, SlashCommandBuilder,
  REST, Routes, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionsBitField
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

const OWNERS = ["1347959266539081768","1399094217846030346"];

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// EXPRESS
const app = express();
app.use(express.json());
app.use(cors());
app.get('/', (_, res) => res.send('🔥 Bot Running'));

// DB
mongoose.connect(process.env.MONGO_URI);

// MODELS
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

// RANK
function getRank(mmr) {
  if (mmr >= 1800) return "Grandmaster";
  if (mmr >= 1600) return "Master";
  if (mmr >= 1400) return "Diamond";
  if (mmr >= 1200) return "Platinum";
  if (mmr >= 1000) return "Gold";
  if (mmr >= 800) return "Silver";
  return "Bronze";
}

// VIDEO
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
    sub.status = "failed";
    await sub.save();
  }
}

// DISCORD
const client = new Client({ intents: Object.values(GatewayIntentBits) });

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

// INTERACTIONS
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

        if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
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

// PREFIX COMMANDS
client.on("messageCreate", async msg => {
  if ((!msg.content.startsWith("!") && !msg.content.startsWith("?")) || msg.author.bot) return;

  const args = msg.content.slice(1).split(/ +/);
  const cmd = args.shift().toLowerCase();

  let user = await User.findOne({ userId: msg.author.id });
  if (!user) user = await User.create({ userId: msg.author.id, username: msg.author.tag });

  // OWNER CODE
  if (msg.content.startsWith("?") && cmd === "code") {
    if (!OWNERS.includes(msg.author.id)) return;

    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    await PremiumCode.create({ userId: msg.author.id, code });

    await msg.author.send(`🔥 Code: ${code}`).catch(()=>{});
    return msg.reply("✅ Sent to DMs");
  }

  // BOOST QUALITY
  if (cmd === "quality") {
    if (!msg.member.premiumSince)
      return msg.reply("🔒 Boost server to use this");

    const link = args[0];
    if (!link) return;

    const id = crypto.randomBytes(4).toString("hex");

    const sub = await Submission.create({
      id,
      userId: msg.author.id,
      link,
      status: "processing"
    });

    msg.reply("🎬 Processing in DMs...");

    processVideo(sub).then(async () => {
      if (!sub.processedFile) return msg.author.send("❌ Failed");

      await msg.author.send({
        content: "🎥 Done:",
        files: [sub.processedFile]
      }).catch(()=>msg.reply("Enable DMs"));
    });
  }

  // ECONOMY
  if (cmd === "balance") return msg.author.send(`💰 ${user.coins}`);
  if (cmd === "daily") { user.coins += 500; await user.save(); return msg.author.send("+500"); }

  // GAMBLING
  if (cmd === "coinflip") {
    const win = Math.random() > 0.5;
    user.coins += win ? 100 : -100;
    await user.save();
    return msg.author.send(win ? "Win" : "Lose");
  }

  if (cmd === "bet") {
    const amt = parseInt(args[0]) || 0;
    if (user.coins < amt) return;

    const win = Math.random() > 0.5;
    user.coins += win ? amt : -amt;
    await user.save();

    return msg.author.send(win ? `+${amt}` : `-${amt}`);
  }

  // MOD COMMANDS
  if (!msg.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;

  if (cmd === "kick") {
    const m = msg.mentions.members.first();
    if (m) await m.kick().catch(()=>{});
  }

  if (cmd === "ban") {
    const m = msg.mentions.members.first();
    if (m) await m.ban().catch(()=>{});
  }

  if (cmd === "clear") {
    const n = parseInt(args[0]) || 10;
    await msg.channel.bulkDelete(n).catch(()=>{});
  }

  if (cmd === "lock")
    await msg.channel.permissionOverwrites.edit(msg.guild.id, { SendMessages: false });

  if (cmd === "unlock")
    await msg.channel.permissionOverwrites.edit(msg.guild.id, { SendMessages: true });

  if (cmd === "slowmode")
    await msg.channel.setRateLimitPerUser(parseInt(args[0]) || 5);

});

// API
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

app.listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
