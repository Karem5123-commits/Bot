import {
  Client, GatewayIntentBits, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionsBitField
} from 'discord.js';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';

dotenv.config();

// ================= SAFE =================
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ================= EXPRESS =================
const app = express();
app.use(express.json());

// Dashboard UI
app.get("/", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Bot Dashboard</title>
      <style>
        body { background:#0f172a; color:white; text-align:center; font-family:sans-serif; }
        button { padding:12px; margin:10px; border:none; border-radius:8px; cursor:pointer; }
      </style>
    </head>
    <body>
      <h1>🔥 Bot Dashboard</h1>
      <button onclick="toggle('ranking')">Toggle Ranking</button>
      <button onclick="toggle('moderation')">Toggle Moderation</button>

      <script>
        async function toggle(type){
          await fetch('/toggle',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({guildId:'${process.env.GUILD_ID}', type})
          });
          alert(type + ' toggled');
        }
      </script>
    </body>
    </html>
  `);
});

// Toggle route
const Config = mongoose.model("Config", new mongoose.Schema({
  guildId: String,
  rankingEnabled: { type: Boolean, default: true },
  moderationEnabled: { type: Boolean, default: true }
}));

app.post("/toggle", async (req, res) => {
  const { guildId, type } = req.body;

  let config = await Config.findOne({ guildId });
  if (!config) config = await Config.create({ guildId });

  if (type === "ranking") config.rankingEnabled = !config.rankingEnabled;
  if (type === "moderation") config.moderationEnabled = !config.moderationEnabled;

  await config.save();
  res.json({ success: true });
});

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo Connected"))
  .catch(console.error);

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  rank: { type: String, default: "Gold" },
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
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// ================= COMMANDS =================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  let config = await Config.findOne({ guildId: msg.guild.id });
  if (!config) config = await Config.create({ guildId: msg.guild.id });

  // ===== PREFIX MODERATION (!) =====
  if (msg.content.startsWith("!")) {
    if (!config.moderationEnabled) return;

    if (!msg.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;

    const args = msg.content.split(" ");
    const cmd = args[0].toLowerCase();

    if (cmd === "!kick") {
      const user = msg.mentions.members.first();
      if (user) user.kick();
    }

    if (cmd === "!ban") {
      const user = msg.mentions.members.first();
      if (user) user.ban();
    }

    if (cmd === "!clear") {
      msg.channel.bulkDelete(args[1] || 10);
    }
  }

  // ===== PREFIX RANKING (?) =====
  if (msg.content.startsWith("?")) {
    if (!config.rankingEnabled) return;

    const args = msg.content.split(" ");
    const cmd = args[0].toLowerCase();

    if (cmd === "?profile") {
      let user = await User.findOne({ userId: msg.author.id });
      if (!user) user = await User.create({ userId: msg.author.id, username: msg.author.tag });

      return msg.reply(`MMR: ${user.mmr} | Rank: ${user.rank}`);
    }

    if (cmd === "?leaderboard") {
      const top = await User.find().sort({ mmr: -1 }).limit(10);

      const text = top.map((u, i) => `#${i + 1} <@${u.userId}> - ${u.mmr}`).join("\n");

      return msg.reply(`🏆 Leaderboard:\n${text}`);
    }

    if (cmd === "?submit") {
      const link = args[1];
      if (!link) return msg.reply("Provide link");

      const id = crypto.randomBytes(4).toString("hex");

      await Submission.create({
        id,
        userId: msg.author.id,
        link
      });

      await User.updateOne(
        { userId: msg.author.id },
        { $inc: { submissions: 1 } },
        { upsert: true }
      );

      return msg.reply("✅ Submitted");
    }

    if (cmd === "?review") {
      if (!msg.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return;

      const sub = await Submission.findOne({ status: "pending" });
      if (!sub) return msg.reply("No submissions");

      const score = generateScore();
      const mmr = calculateMMRChange(score);
      const user = await User.findOne({ userId: sub.userId });

      const newMMR = (user?.mmr || 1000) + mmr;
      const rank = getRank(newMMR);

      sub.aiScore = score;
      sub.suggestedMMR = mmr;
      sub.suggestedRank = rank;
      await sub.save();

      const embed = new EmbedBuilder()
        .setTitle("🎯 Judgment")
        .setDescription(sub.link)
        .addFields(
          { name: "Score", value: `${score}`, inline: true },
          { name: "MMR", value: `${mmr}`, inline: true },
          { name: "Rank", value: rank, inline: true }
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_${sub.id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_${sub.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
      );

      return msg.reply({ embeds: [embed], components: [row] });
    }
  }
});

// ================= BUTTONS =================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  const [action, id] = i.customId.split("_");
  const sub = await Submission.findOne({ id });

  if (!sub) return;

  if (action === "accept") {
    const user = await User.findOne({ userId: sub.userId });

    const newMMR = (user?.mmr || 1000) + sub.suggestedMMR;
    const rank = getRank(newMMR);

    await User.updateOne(
      { userId: sub.userId },
      {
        $inc: { mmr: sub.suggestedMMR, accepted: 1 },
        $set: { rank }
      }
    );

    return i.update({ content: "✅ Accepted", components: [] });
  }

  if (action === "reject") {
    await User.updateOne(
      { userId: sub.userId },
      { $inc: { rejected: 1 } }
    );

    return i.update({ content: "❌ Rejected", components: [] });
  }
});

// ================= START =================
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("✅ Bot Online"))
  .catch(console.error);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Dashboard running on ${PORT}`);
});
