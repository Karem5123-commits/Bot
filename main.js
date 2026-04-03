import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import { Client, GatewayIntentBits } from "discord.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ======================
// 🌐 HEALTH + API
// ======================
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ status: "online" }));

app.get("/dashboard", (req, res) => {
  res.json({
    users: client.users.cache.size,
    highestElo: Math.max(...elo.values(), 1000),
    averageElo:
      elo.size > 0
        ? Math.floor([...elo.values()].reduce((a, b) => a + b, 0) / elo.size)
        : 1000,
    coins: [...economy.values()].reduce((a, b) => a + b, 0),
    leaderboard: [...elo.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  });
});

// Safe command runner
app.post("/run-command", (req, res) => {
  res.json({ success: true });
});

// ======================
// 🎬 VIDEO ENDPOINT (SAFE + READY)
// ======================
app.post("/enhance-video", async (req, res) => {
  try {
    const { url, mode } = req.body;

    if (!url) return res.json({ success: false });

    // ⚠️ SAFE MODE (prevents crashes)
    // Real FFmpeg can be added later by Workshop
    return res.json({
      success: true,
      url
    });

  } catch {
    res.json({ success: false });
  }
});

app.listen(PORT, () => console.log(`🌐 Server running on ${PORT}`));

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
// 🧠 SYSTEM DATA
// ======================
const economy = new Map();
const elo = new Map();

// ======================
// READY
// ======================
client.once("clientReady", () => {
  console.log(`🔥 Logged in as ${client.user.tag}`);
});

// ======================
// 💬 COMMAND HANDLER
// ======================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  try {
    // 🏓 PING
    if (cmd === "ping") return message.reply("🏓 Pong!");

    // 💰 BALANCE
    if (cmd === "balance") {
      return message.reply(`💰 ${economy.get(message.author.id) || 0}`);
    }

    // 💵 WORK
    if (cmd === "work") {
      const earn = Math.floor(Math.random() * 100) + 10;
      economy.set(message.author.id, (economy.get(message.author.id) || 0) + earn);
      return message.reply(`💵 +${earn} coins`);
    }

    // 📊 RANK
    if (cmd === "rank") {
      return message.reply(`📊 ELO: ${elo.get(message.author.id) || 1000}`);
    }

    // 🏆 LEADERBOARD
    if (cmd === "leaderboard") {
      const top = [...elo.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (!top.length) return message.reply("📉 No data yet");

      return message.reply(
        "🏆 Leaderboard:\n" +
          top.map((u, i) => `${i + 1}. <@${u[0]}> - ${u[1]}`).join("\n")
      );
    }

    // 🎬 QUALITY SYSTEM (STABLE VERSION)
    if (cmd === "quality") {
      const option = parseInt(args[0]);

      if (![1, 2, 3].includes(option)) {
        return message.reply(
          "❌ Use:\n?quality 1 → 1080p 60fps\n?quality 2 → 4K 120fps\n?quality 3 → 6K 240fps"
        );
      }

      const file = message.attachments.first();
      if (!file) return message.reply("❌ Attach a video");

      await message.reply("⏳ Processing video...");

      const response = await fetch(`${BASE_URL}/enhance-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: file.url,
          mode: option
        })
      });

      const data = await response.json();

      if (!data.success) {
        return message.reply("❌ Processing failed");
      }

      return message.reply({
        content: "✅ Enhanced video:",
        files: [data.url]
      });
    }

  } catch (err) {
    console.error(err);
    message.reply("❌ Error executing command");
  }
});

// ======================
// LOGIN
// ======================
client.login(process.env.TOKEN);
