import "dotenv/config";
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Collection
} from "discord.js";

// ======================
// 🌐 EXPRESS SERVER (FIXES OFFLINE)
// ======================
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

app.get("/health", (req, res) => {
  res.json({ status: "online" });
});

// Dashboard endpoint
app.get("/dashboard", (req, res) => {
  res.json({
    users: client.users.cache.size,
    highestElo: 1000,
    averageElo: 500,
    coins: economy.size,
    leaderboard: []
  });
});

// Command runner
app.post("/run-command", async (req, res) => {
  try {
    const { command, args } = req.body;

    if (!command) {
      return res.status(400).json({ error: "No command" });
    }

    // Fake execution response (safe)
    return res.json({
      success: true,
      message: `Executed ${command}`
    });

  } catch (err) {
    return res.json({ success: false });
  }
});

// Quality submit
app.post("/submit-score", (req, res) => {
  const { userId, score } = req.body;

  if (!userId || !score) {
    return res.status(400).json({ error: "Invalid data" });
  }

  quality.set(userId, score);

  return res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on ${PORT}`);
});

// ======================
// 🤖 DISCORD BOT
// ======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PREFIX = "?";

// ======================
// 🧠 MEMORY SYSTEMS
// ======================
const economy = new Map();
const quality = new Map();
const elo = new Map();

// ======================
// ⚡ READY EVENT
// ======================
client.once("clientReady", () => {
  console.log(`🔥 Logged in as ${client.user.tag}`);
});

// ======================
// 💬 PREFIX COMMANDS
// ======================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ======================
  // 🏓 PING
  // ======================
  if (command === "ping") {
    return message.reply("🏓 Pong!");
  }

  // ======================
  // 💰 BALANCE
  // ======================
  if (command === "balance") {
    const bal = economy.get(message.author.id) || 0;
    return message.reply(`💰 Balance: ${bal}`);
  }

  // ======================
  // 💵 WORK (earn coins)
  // ======================
  if (command === "work") {
    const earned = Math.floor(Math.random() * 100) + 1;
    const current = economy.get(message.author.id) || 0;
    economy.set(message.author.id, current + earned);

    return message.reply(`💵 You earned ${earned} coins!`);
  }

  // ======================
  // 📊 RANK
  // ======================
  if (command === "rank") {
    const score = elo.get(message.author.id) || 1000;
    return message.reply(`📊 Your ELO: ${score}`);
  }

  // ======================
  // ⭐ QUALITY SYSTEM
  // ======================
  if (command === "quality") {
    const score = parseInt(args[0]);

    if (!score || score < 1 || score > 10) {
      return message.reply("❌ Use: ?quality 1-10");
    }

    quality.set(message.author.id, score);

    return message.reply(`✅ Quality score set to ${score}`);
  }

  // ======================
  // 🏆 LEADERBOARD
  // ======================
  if (command === "leaderboard") {
    const sorted = [...elo.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (sorted.length === 0) {
      return message.reply("📉 No leaderboard data yet.");
    }

    let text = "🏆 Leaderboard:\n";

    sorted.forEach((user, i) => {
      text += `${i + 1}. <@${user[0]}> - ${user[1]} ELO\n`;
    });

    return message.reply(text);
  }
});

// ======================
// 🚀 LOGIN
// ======================
client.login(process.env.TOKEN);
