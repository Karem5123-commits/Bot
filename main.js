import {
  Client, SlashCommandBuilder, REST, Routes,
  EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionsBitField
} from 'discord.js';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';

dotenv.config();

// ================= SAFE START =================
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ================= EXPRESS =================
const app = express();
app.use(express.json());
app.use(cors()); // ✅ FIXED CORS

app.get('/', (_, res) => res.send('🔥 Bot Running'));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo Connected"))
  .catch(err => console.error(err));

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  rank: { type: String, default: "Bronze" },
  submissions: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  rejected: { type: Number, default: 0 }
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "pending" },
  aiScore: Number,
  suggestedMMR: Number,
  suggestedRank: String
}));

// ================= RANK SYSTEM =================
const RANKS = [
  { name: "Bronze", mmr: 0 },
  { name: "Silver", mmr: 800 },
  { name: "Gold", mmr: 1000 },
  { name: "Platinum", mmr: 1200 },
  { name: "Diamond", mmr: 1400 },
  { name: "Master", mmr: 1600 },
  { name: "Grandmaster", mmr: 1800 }
];

function getRank(mmr) {
  let rank = RANKS[0];
  for (const r of RANKS) if (mmr >= r.mmr) rank = r;
  return rank.name;
}

// ================= AI =================
function generateScore() {
  return Math.floor(Math.random() * 10) + 1;
}
function calculateMMRChange(score) {
  return (score - 5) * 20;
}

// ================= DISCORD =================
const client = new Client({ intents: 32767 });

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const cmds = [
    new SlashCommandBuilder().setName("submit").setDescription("Submit clip"),
    new SlashCommandBuilder().setName("profile").setDescription("View profile"),
    new SlashCommandBuilder().setName("review").setDescription("Review clips (staff)")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: cmds }
  );
});

// ================= COMMANDS =================
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

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${i.user.username}`)
              .addFields(
                { name: "MMR", value: `${user.mmr}`, inline: true },
                { name: "Rank", value: `${getRank(user.mmr)}`, inline: true }
              )
          ]
        });
      }

      if (i.commandName === "review") {
        if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
          return i.reply({ content: "Staff only", ephemeral: true });
        }

        const sub = await Submission.findOne({ status: "pending" });
        if (!sub) return i.reply("No submissions.");

        const score = generateScore();
        const mmrChange = calculateMMRChange(score);

        const user = await User.findOne({ userId: sub.userId });
        const newMMR = (user?.mmr || 1000) + mmrChange;
        const suggestedRank = getRank(newMMR);

        sub.aiScore = score;
        sub.suggestedMMR = mmrChange;
        sub.suggestedRank = suggestedRank;
        await sub.save();

        const embed = new EmbedBuilder()
          .setTitle("🎯 AI Judgment")
          .setDescription(sub.link)
          .addFields(
            { name: "Score", value: `${score}/10`, inline: true },
            { name: "MMR Change", value: `${mmrChange}`, inline: true },
            { name: "Suggested Rank", value: `${suggestedRank}`, inline: true }
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`accept_${sub.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject_${sub.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
        );

        return i.reply({ embeds: [embed], components: [row] });
      }
    }

    if (i.isModalSubmit()) {
      const link = i.fields.getTextInputValue("link");
      const id = crypto.randomBytes(4).toString("hex");

      await Submission.create({ id, userId: i.user.id, link });

      await User.updateOne(
        { userId: i.user.id },
        { $inc: { submissions: 1 }, username: i.user.tag },
        { upsert: true }
      );

      return i.reply({ content: "✅ Submitted", ephemeral: true });
    }

    if (i.isButton()) {
      const [action, id] = i.customId.split("_");
      const sub = await Submission.findOne({ id });
      if (!sub) return;

      const user = await User.findOne({ userId: sub.userId });
      const newMMR = (user?.mmr || 1000) + sub.suggestedMMR;

      if (action === "accept") {
        await User.updateOne(
          { userId: sub.userId },
          {
            mmr: newMMR,
            rank: getRank(newMMR),
            $inc: { accepted: 1 }
          }
        );

        sub.status = "accepted";
        await sub.save();

        return i.update({ content: "✅ Accepted & applied", components: [] });
      }

      if (action === "reject") {
        await User.updateOne(
          { userId: sub.userId },
          { $inc: { rejected: 1 } }
        );

        sub.status = "rejected";
        await sub.save();

        return i.update({ content: "❌ Rejected", components: [] });
      }
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= API ROUTES =================

// STATUS
app.get('/api/status', (req, res) => {
  res.json({
    online: client.isReady(),
    tag: client.user ? client.user.tag : null
  });
});

// ✅ DASHBOARD (CRITICAL FIX)
app.get('/api/dashboard', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalSubs = await Submission.countDocuments();

    const processed = await Submission.countDocuments({
      status: { $in: ["accepted", "rejected"] }
    });

    res.json({
      users: totalUsers,
      submissions: totalSubs,
      stats: {
        totalProcessed: processed
      }
    });

  } catch (e) {
    res.status(500).json({ error: "Dashboard failed" });
  }
});

// LEADERBOARD
app.get('/api/leaderboard', async (req, res) => {
  try {
    const users = await User.find().sort({ mmr: -1 }).limit(50);

    res.json(users.map((u, i) => ({
      position: i + 1,
      username: u.username || "Unknown",
      mmr: u.mmr,
      rank: getRank(u.mmr)
    })));
  } catch (e) {
    res.status(500).json({ error: "Failed" });
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🌐 API running on port ${PORT}`);
});

console.log("🚀 Starting bot...");

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("✅ Discord login successful"))
  .catch(err => console.error(err));
