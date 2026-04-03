import "dotenv/config";
import express from "express";
import cors from "cors";
import { Client, GatewayIntentBits, Partials } from "discord.js";

const app = express();

// ================== MIDDLEWARE ==================
app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "key"]
}));

// ================== DISCORD BOT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const PREFIX = "?";
const MAIN_GUILD_ID = process.env.GUILD_ID;

// ================== MEMORY DB ==================
const users = new Map();

// ================== RANK SYSTEM ==================
const ranks = [
  { name: "Bronze", min: 0 },
  { name: "Silver", min: 100 },
  { name: "Gold", min: 300 },
  { name: "Platinum", min: 600 },
  { name: "Diamond", min: 1000 },
  { name: "Legend", min: 1500 }
];

function getRank(elo) {
  return [...ranks].reverse().find(r => elo >= r.min) || ranks[0];
}

// ================== BOT READY ==================
client.once("ready", () => {
  console.log(`🔥 Bot online as ${client.user.tag}`);
});

// ================== AUTO ROLE ==================
client.on("guildMemberAdd", async (member) => {
  try {
    let role = member.guild.roles.cache.find(r => r.name === "Bronze");
    if (!role) {
      role = await member.guild.roles.create({ name: "Bronze" });
    }
    await member.roles.add(role);
  } catch (err) {
    console.log("Role error:", err.message);
  }
});

// ================== COMMANDS ==================
client.on("messageCreate", async (msg) => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  let user = users.get(msg.author.id) || { elo: 0, coins: 0 };
  users.set(msg.author.id, user);

  if (cmd === "ping") return msg.reply("🏓 Pong!");

  if (cmd === "balance") {
    return msg.reply(`💰 Coins: ${user.coins}`);
  }

  if (cmd === "profile") {
    const rank = getRank(user.elo);
    return msg.reply(`🏆 Elo: ${user.elo}\nRank: ${rank.name}`);
  }

  if (cmd === "daily") {
    user.coins += 100;
    return msg.reply("🎁 You got 100 coins!");
  }

  if (cmd === "leaderboard") {
    const top = [...users.entries()]
      .sort((a, b) => b[1].elo - a[1].elo)
      .slice(0, 10);

    let text = "🏆 Leaderboard:\n";
    top.forEach((u, i) => {
      text += `${i + 1}. <@${u[0]}> - ${u[1].elo}\n`;
    });

    return msg.reply(text);
  }
});

// ================== ROUTES ==================

// ✅ ROOT FIX
app.get("/", (req, res) => {
  res.send("Bot running");
});

// ✅ DASHBOARD DATA
app.get("/dashboard", (req, res) => {
  const allUsers = [...users.values()];
  const total = allUsers.length;
  const highest = Math.max(0, ...allUsers.map(u => u.elo));
  const avg = total
    ? Math.floor(allUsers.reduce((a, b) => a + b.elo, 0) / total)
    : 0;
  const coins = allUsers.reduce((a, b) => a + b.coins, 0);

  const leaderboard = [...users.entries()]
    .sort((a, b) => b[1].elo - a[1].elo)
    .slice(0, 10)
    .map(([id, data]) => ({ id, elo: data.elo }));

  res.json({ total, highest, avg, coins, leaderboard });
});

// ✅ RUN COMMAND (DASHBOARD)
app.post("/run-command", async (req, res) => {
  try {
    if (req.headers.key !== process.env.ADMIN_KEY) {
      return res.status(403).send("Forbidden");
    }

    const { command, args = [], userId } = req.body;

    const guild = client.guilds.cache.get(MAIN_GUILD_ID);
    if (!guild) return res.status(400).send("No guild");

    const channel = guild.channels.cache.find(c => c.isTextBased());
    if (!channel) return res.status(400).send("No channel");

    const fakeMsg = {
      author: { id: userId || "dashboard", bot: false },
      guild,
      channel,
      content: `${PREFIX}${command} ${args.join(" ")}`,
      reply: (msg) => channel.send(`📊 Dashboard: ${msg}`)
    };

    client.emit("messageCreate", fakeMsg);

    res.send("Command executed");
  } catch (err) {
    console.log(err);
    res.status(500).send("Error");
  }
});

// ✅ SUBMIT SCORE
app.post("/submit-score", (req, res) => {
  const { userId, score } = req.body;

  let user = users.get(userId) || { elo: 0, coins: 0 };
  user.elo += score;

  users.set(userId, user);

  res.send("Score updated");
});

// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server running on ${PORT}`);
});

// ================== LOGIN ==================
client.login(process.env.TOKEN);
