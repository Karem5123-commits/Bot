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
  Routes,
  EmbedBuilder,
  ActivityType,
  SlashCommandBuilder
} from "discord.js";

import mongoose from "mongoose";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ytdl from "yt-dlp-exec";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";

// ===== SYSTEM SETUP =====
ffmpeg.setFfmpegPath(ffmpegPath);

const TEMP_DIR = path.join(process.cwd(), "temp");
await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// ===== DATABASE =====
if (!process.env.MONGO_URL) {
  console.error("❌ MONGO_URL is missing");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGO_URL);
  console.log("✅ MongoDB Connected");
} catch (err) {
  console.error("❌ MongoDB FAILED:", err.message);
  process.exit(1);
}

// ===== RANK SYSTEM =====
const CONFIG = {
  RANKS: [
    { name: "Bronze", mmr: 0, color: "#8d6e63", icon: "🥉" },
    { name: "Silver", mmr: 1200, color: "#b0bec5", icon: "🥈" },
    { name: "Gold", mmr: 1800, color: "#f1c40f", icon: "🥇" },
    { name: "Platinum", mmr: 2500, color: "#00bcd4", icon: "💎" },
    { name: "Diamond", mmr: 3500, color: "#3498db", icon: "🛡️" },
    { name: "Master", mmr: 4800, color: "#9b59b6", icon: "🔮" },
    { name: "Legend", mmr: 6500, color: "#e74c3c", icon: "👑" }
  ]
};

const getRank = (elo) =>
  [...CONFIG.RANKS].reverse().find(r => elo >= r.mmr) || CONFIG.RANKS[0];

const calcElo = (score, elo, streak) => {
  let gain = (score - 5.5) * 50;
  if (streak >= 3) gain *= 1.5;
  if (elo > 3500) gain *= 0.7;
  return Math.round(gain);
};

// ===== READY =====
client.once("clientReady", async () => {
  console.log(`🔥 ONLINE: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      { name: "made from discord.gg/g2Ff4vHfhM", type: ActivityType.Playing }
    ],
    status: "online"
  });

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  const commands = [
    new SlashCommandBuilder()
      .setName("profile")
      .setDescription("View stats"),

    new SlashCommandBuilder()
      .setName("submit")
      .setDescription("Submit clip"),

    new SlashCommandBuilder()
      .setName("quality_method")
      .setDescription("Enhance video")
      .addStringOption(option =>
        option
          .setName("url")
          .setDescription("Video URL")
          .setRequired(true)
      )
  ].map(cmd => cmd.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, "1488203882130837704"),
    { body: commands }
  );

  console.log("⚡ Commands synced");
});

// ===== INTERACTIONS =====
client.on("interactionCreate", async i => {
  try {
    if (i.isChatInputCommand()) {

      if (i.commandName === "profile") {
        const embed = new EmbedBuilder()
          .setTitle(`👤 ${i.user.username}`)
          .setDescription("Your profile");

        return i.reply({ embeds: [embed] });
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
              .setRequired(true)
          )
        );

        return i.showModal(modal);
      }
    }

    if (i.isModalSubmit()) {
      const url = i.fields.getTextInputValue("url");

      const channel = await client.channels.fetch(process.env.REVIEW_CHANNEL_ID);

      const row = new ActionRowBuilder().addComponents(
        [4, 7, 10].map(score =>
          new ButtonBuilder()
            .setCustomId(`rank_${score}_${i.user.id}`)
            .setLabel(`Score ${score}`)
            .setStyle(ButtonStyle.Primary)
        )
      );

      await channel.send({
        content: `Submission from <@${i.user.id}>\n${url}`,
        components: [row]
      });

      return i.reply({ content: "✅ Submitted", ephemeral: true });
    }

    if (i.isButton()) {
      const [_, score, userId] = i.customId.split("_");

      return i.update({
        content: `✅ Score ${score} received`,
        components: []
      });
    }

  } catch (err) {
    console.error("Interaction error:", err);
  }
});

// ===== WEB =====
const app = express();
app.get("/", (_, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN);
