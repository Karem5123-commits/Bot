import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials,
  REST, Routes, EmbedBuilder,
  SlashCommandBuilder, ActivityType,
  PermissionsBitField
} from "discord.js";

import mongoose from "mongoose";
import express from "express";

import { User, Guild, Job } from "./models.js";
import { getRank, calcElo, applyRank } from "./systems/ranking.js";
import { processVideo } from "./systems/quality.js";

// ============================
// CLIENT
// ============================
const client = new Client({
  intents: [3276799],
  partials: [Partials.GuildMember]
});

// ============================
// DATABASE
// ============================
await mongoose.connect(process.env.MONGO_URI);
console.log("✅ Mongo Connected");

// ============================
// QUEUE SYSTEM
// ============================
let processing = false;

async function runQueue() {
  if (processing) return;
  processing = true;

  while (true) {
    const job = await Job.findOne({ status: "pending" });
    if (!job) break;

    job.status = "processing";
    await job.save();

    try {
      const output = await processVideo(job.url);
      job.status = "done";
      job.result = output;
    } catch {
      job.status = "failed";
    }

    await job.save();
  }

  processing = false;
}

// ============================
// READY
// ============================
client.once("ready", async () => {
  console.log(`🔥 ONLINE: ${client.user.tag}`);

  client.user.setPresence({
    activities: [{
      name: "made from https://discord.gg/g2Ff4vHfhM",
      type: ActivityType.Playing
    }]
  });

  const commands = [
    new SlashCommandBuilder().setName("profile").setDescription("View stats"),

    new SlashCommandBuilder()
      .setName("quality_method")
      .setDescription("Ultra enhance")
      .addAttachmentOption(o => o.setName("file").setRequired(true)),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Top players"),

    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn user")
      .addUserOption(o => o.setName("user").setRequired(true)),

    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban user")
      .addUserOption(o => o.setName("user").setRequired(true))

  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Commands synced");
});

// ============================
// INTERACTIONS
// ============================
client.on("interactionCreate", async i => {
  try {
    if (!i.isChatInputCommand()) return;

    // PROFILE
    if (i.commandName === "profile") {
      const user = await User.findOneAndUpdate(
        { userId: i.user.id },
        {},
        { upsert: true, new: true }
      );

      const rank = getRank(user.elo);

      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(i.user.username)
            .setColor(rank.color)
            .addFields(
              { name: "ELO", value: `${user.elo}`, inline: true },
              { name: "Rank", value: rank.name, inline: true }
            )
        ]
      });
    }

    // LEADERBOARD
    if (i.commandName === "leaderboard") {
      const top = await User.find().sort({ elo: -1 }).limit(10);

      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏆 Leaderboard")
            .setDescription(
              top.map((u, i) =>
                `**${i + 1}.** <@${u.userId}> — ${u.elo}`
              ).join("\n")
            )
        ]
      });
    }

    // QUALITY METHOD (QUEUE)
    if (i.commandName === "quality_method") {
      await i.deferReply();

      const file = i.options.getAttachment("file");

      const job = await Job.create({
        userId: i.user.id,
        url: file.url,
        status: "pending"
      });

      runQueue();

      return i.editReply(`📥 Added to queue (ID: ${job._id})`);
    }

    // WARN
    if (i.commandName === "warn") {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
        return i.reply({ content: "No permission", ephemeral: true });

      return i.reply("⚠️ User warned");
    }

    // BAN
    if (i.commandName === "ban") {
      if (!i.member.permissions.has(PermissionsBitField.Flags.BanMembers))
        return i.reply({ content: "No permission", ephemeral: true });

      const user = i.options.getUser("user");
      await i.guild.members.ban(user.id);

      return i.reply("🔨 Banned");
    }

  } catch (e) {
    console.error(e);
  }
});

// ============================
// ANTI RAID
// ============================
const joins = new Map();

client.on("guildMemberAdd", async m => {
  const now = Date.now();
  if (!joins.has(m.guild.id)) joins.set(m.guild.id, []);
  const arr = joins.get(m.guild.id);

  arr.push(now);
  while (arr.length && now - arr[0] > 10000) arr.shift();

  if (arr.length >= 5) {
    const role = m.guild.roles.cache.find(r => r.name === "Quarantine")
      || await m.guild.roles.create({ name: "Quarantine", color: 0xff0000 });

    await m.roles.add(role);
  }

  await User.findOneAndUpdate({ userId: m.id }, {}, { upsert: true });
  await applyRank(m, 1000);
});

// ============================
// WEB
// ============================
const app = express();
app.get("/", (_, res) => res.send("🔥 GOD BOT ONLINE"));
app.listen(process.env.PORT || 3000);

// ============================
client.login(process.env.DISCORD_TOKEN);
