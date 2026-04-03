import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ytdl from "yt-dlp-exec";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";

// ===== CONFIG =====
const PREFIX = "?";
const GUILD_ID = "1488203882130837704";

ffmpeg.setFfmpegPath(ffmpegPath);

// ===== TEMP =====
const TEMP_DIR = path.join(process.cwd(), "temp");
await fs.mkdir(TEMP_DIR, { recursive: true });

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// ===== DB =====
await mongoose.connect(process.env.MONGO_URL);
console.log("✅ DB Connected");

// ===== MODELS =====
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  elo: { type: Number, default: 1000 },
  streak: { type: Number, default: 0 },
  coins: { type: Number, default: 1000 }
});

const User = mongoose.model("User", userSchema);

// ===== RANK SYSTEM =====
const RANKS = [
  { name: "Bronze", mmr: 0 },
  { name: "Silver", mmr: 1200 },
  { name: "Gold", mmr: 1800 },
  { name: "Platinum", mmr: 2500 },
  { name: "Diamond", mmr: 3500 },
  { name: "Master", mmr: 4800 },
  { name: "Legend", mmr: 6500 }
];

function getRank(elo) {
  return [...RANKS].reverse().find(r => elo >= r.mmr) || RANKS[0];
}

async function updateRank(member, elo) {
  const rank = getRank(elo);

  let role = member.guild.roles.cache.find(r => r.name === rank.name);
  if (!role) role = await member.guild.roles.create({ name: rank.name });

  const toRemove = member.roles.cache.filter(r =>
    RANKS.map(x => x.name).includes(r.name) && r.name !== rank.name
  );

  await member.roles.remove(toRemove).catch(() => {});
  await member.roles.add(role).catch(() => {});
}

// ===== READY =====
client.once("clientReady", async () => {
  console.log(`🔥 ${client.user.tag} ONLINE`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  // ✅ FIXED COMMANDS (NO CRASH)
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    {
      body: [
        {
          name: "profile",
          description: "View your profile"
        },
        {
          name: "submit",
          description: "Submit a clip"
        },
        {
          name: "quality_method",
          description: "Enhance a video",
          options: [
            {
              name: "url",
              description: "Video URL to enhance",
              type: 3,
              required: true
            }
          ]
        }
      ]
    }
  );

  console.log("✅ Slash commands synced");
});

// ===== AUTO JOIN =====
client.on("guildMemberAdd", async member => {
  await User.findOneAndUpdate(
    { userId: member.id },
    { username: member.user.username, elo: 1000 },
    { upsert: true }
  );

  await updateRank(member, 1000);
});

// ===== PREFIX COMMANDS =====
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(1).split(/ +/);
  const cmd = args.shift().toLowerCase();

  let user = await User.findOne({ userId: msg.author.id });
  if (!user) {
    user = await User.create({
      userId: msg.author.id,
      username: msg.author.username
    });
  }

  if (cmd === "profile") {
    const rank = getRank(user.elo);
    return msg.reply(`🏆 ${rank.name} | ELO: ${user.elo}`);
  }

  if (cmd === "leaderboard") {
    const top = await User.find().sort({ elo: -1 }).limit(10);
    return msg.reply(
      top.map((u, i) => `${i + 1}. ${u.username} - ${u.elo}`).join("\n")
    );
  }

  if (["gamble","coinflip","slots"].includes(cmd)) {
    const win = Math.random() > 0.5;
    user.coins += win ? 100 : -100;
    await user.save();
    return msg.reply(win ? "🎉 You won!" : "💀 You lost!");
  }
});

// ===== INTERACTIONS =====
client.on("interactionCreate", async i => {
  if (i.isChatInputCommand()) {

    if (i.commandName === "profile") {
      const user = await User.findOne({ userId: i.user.id });
      return i.reply(`ELO: ${user?.elo || 1000}`);
    }

    if (i.commandName === "submit") {
      const modal = new ModalBuilder()
        .setCustomId("submit")
        .setTitle("Submit Clip");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("url")
            .setLabel("Clip URL")
            .setStyle(TextInputStyle.Short)
        )
      );

      return i.showModal(modal);
    }

    if (i.commandName === "quality_method") {
      await i.deferReply();

      try {
        const url = i.options.getString("url");
        const id = uuidv4();

        const input = path.join(TEMP_DIR, `${id}.mp4`);
        const output = path.join(TEMP_DIR, `out_${id}.mp4`);

        await ytdl(url, { output: input });

        await new Promise((res, rej) => {
          ffmpeg(input)
            .videoFilters(["scale=1920:-1"])
            .save(output)
            .on("end", res)
            .on("error", rej);
        });

        await i.editReply({ files: [output] });

        await fs.unlink(input).catch(() => {});
        await fs.unlink(output).catch(() => {});
      } catch {
        await i.editReply("❌ Processing failed");
      }
    }
  }

  // ===== MODAL =====
  if (i.isModalSubmit()) {
    const url = i.fields.getTextInputValue("url");

    const row = new ActionRowBuilder().addComponents(
      Array.from({ length: 10 }, (_, x) =>
        new ButtonBuilder()
          .setCustomId(`rate_${x + 1}_${i.user.id}`)
          .setLabel(`${x + 1}`)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const channel = await client.channels.fetch(process.env.REVIEW_CHANNEL_ID);

    await channel.send({
      content: `Submission from <@${i.user.id}>\n${url}`,
      components: [row]
    });

    return i.reply({ content: "✅ Submitted", ephemeral: true });
  }

  // ===== BUTTON =====
  if (i.isButton()) {
    const [_, score, userId] = i.customId.split("_");

    let user = await User.findOne({ userId });
    if (!user) user = await User.create({ userId });

    user.elo += Number(score) * 10;
    await user.save();

    const member = await i.guild.members.fetch(userId);
    await updateRank(member, user.elo);

    return i.update({
      content: `+${score * 10} ELO`,
      components: []
    });
  }
});

// ===== DASHBOARD =====
const app = express();
app.use(express.json());

app.get("/", (_, res) => res.send("Bot running"));

app.get("/dashboard", async (req, res) => {
  const users = await User.find().sort({ elo: -1 }).limit(10);
  res.json(users);
});

app.post("/run-command", async (req, res) => {
  if (req.headers.key !== process.env.ADMIN_KEY)
    return res.sendStatus(403);

  const guild = client.guilds.cache.get(GUILD_ID);
  const channel = guild.channels.cache.find(c => c.isTextBased());

  client.emit("messageCreate", {
    content: `${PREFIX}${req.body.command}`,
    author: { bot: false },
    guild,
    channel,
    reply: (m) => channel.send(`📊 ${m}`)
  });

  res.send("OK");
});

app.listen(process.env.PORT || 3000);

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN);
