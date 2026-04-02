import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField
} from "discord.js";

import mongoose from "mongoose";
import express from "express";

/* ================= CONFIG ================= */
const MAIN_GUILD_ID = "1488203882130837704";
const PREFIX = "?";

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

/* ================= DATABASE ================= */
await mongoose.connect(process.env.MONGO_URL);
console.log("✅ MongoDB Connected");

/* ================= MODEL ================= */
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  elo: { type: Number, default: 1000 },
  coins: { type: Number, default: 500 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  warns: { type: Number, default: 0 }
});

const User = mongoose.model("User", userSchema);

/* ================= CACHE ================= */
const userCache = new Map();
const bounties = new Map();

/* ================= HELPERS ================= */
async function getUser(id, username = "Unknown") {
  let user = userCache.get(id);

  if (!user) {
    user = await User.findOne({ userId: id });
    if (!user) user = await User.create({ userId: id, username });
    userCache.set(id, user);
  }

  return user;
}

const ranks = [
  { name: "Bronze", mmr: 0 },
  { name: "Silver", mmr: 1200 },
  { name: "Gold", mmr: 1800 },
  { name: "Platinum", mmr: 2500 },
  { name: "Diamond", mmr: 3500 },
  { name: "Master", mmr: 4800 },
  { name: "Legend", mmr: 6500 }
];

const getRank = elo =>
  [...ranks].reverse().find(r => elo >= r.mmr) || ranks[0];

const getRankLevel = elo =>
  ranks.findIndex(r => r.name === getRank(elo).name);

/* ================= ROLE SYSTEM ================= */
async function updateRank(member, elo) {
  try {
    const rank = getRank(elo);

    let role = member.guild.roles.cache.find(r => r.name === rank.name);
    if (!role) role = await member.guild.roles.create({ name: rank.name });

    const remove = member.roles.cache.filter(r =>
      ranks.map(x => x.name).includes(r.name) && r.name !== rank.name
    );

    await member.roles.remove(remove).catch(() => {});
    await member.roles.add(role).catch(() => {});
  } catch {}
}

/* ================= READY ================= */
client.once("clientReady", () => {
  console.log(`🔥 ${client.user.tag} ONLINE`);
});

/* ================= LOCK SERVER ================= */
client.on("guildCreate", g => {
  if (g.id !== MAIN_GUILD_ID) g.leave();
});

/* ================= JOIN ================= */
client.on("guildMemberAdd", async member => {
  if (member.guild.id !== MAIN_GUILD_ID) return;

  const user = await getUser(member.id, member.user.username);
  await updateRank(member, user.elo);
});

/* ================= COMMAND HANDLER ================= */
async function handleCommand(msg) {
  const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const user = await getUser(msg.author.id, msg.author.username);

  /* XP */
  user.xp += 5;
  if (user.xp >= user.level * 100) {
    user.level++;
    user.xp = 0;
    msg.reply(`🎉 Level ${user.level}`);
  }

  /* PROFILE */
  if (cmd === "profile") {
    return msg.reply(
      `🏆 ELO: ${user.elo}\n💰 Coins: ${user.coins}\n⭐ Level: ${user.level}`
    );
  }

  /* GAMBLE */
  if (cmd === "gamble") {
    const bet = parseInt(args[0]) || 50;
    if (user.coins < bet) return msg.reply("❌ Not enough coins");

    const win = Math.random() > 0.5;
    user.coins += win ? bet : -bet;

    const top = await User.find().sort({ elo: -1 }).limit(3);
    for (let t of top) {
      t.coins += 5;
      await t.save();
    }

    await user.save();
    return msg.reply(win ? "💰 You won!" : "❌ You lost!");
  }

  /* BOUNTY */
  if (cmd === "bounty") {
    const target = msg.mentions.users.first();
    const amount = parseInt(args[0]);

    if (!target || !amount) return;
    if (user.coins < amount) return;

    user.coins -= amount;
    await user.save();

    bounties.set(target.id, amount);
    return msg.reply("🎯 Bounty set");
  }

  /* WARN */
  if (cmd === "warn") {
    if (!msg.member?.permissions?.has(PermissionsBitField.Flags.ModerateMembers))
      return msg.reply("❌ No permission");

    const member = msg.mentions.members.first();
    if (!member) return;

    const target = await getUser(member.id);

    const attackerLevel = getRankLevel(user.elo);
    const targetLevel = getRankLevel(target.elo);

    if (targetLevel >= 4 && attackerLevel < 2)
      return msg.reply("🛡️ Immune");

    target.warns++;
    await target.save();

    msg.reply(`⚠️ Warned (${target.warns})`);

    if (bounties.has(member.id)) {
      const reward = bounties.get(member.id);
      user.coins += reward;
      bounties.delete(member.id);
      msg.channel.send("💰 Bounty claimed");
    }

    if (target.warns >= 5) {
      let jail = msg.guild.roles.cache.find(r => r.name === "Jail");
      if (!jail) jail = await msg.guild.roles.create({ name: "Jail" });

      await member.roles.set([jail]).catch(() => {});
    }
  }

  /* BROADCAST */
  if (cmd === "broadcast") {
    if (getRankLevel(user.elo) < 3)
      return msg.reply("❌ Platinum required");

    msg.channel.send(`📢 ${args.join(" ")}`);
  }

  /* SLOWMODE */
  if (cmd === "slowmode") {
    if (getRankLevel(user.elo) < 6)
      return msg.reply("❌ Legend required");

    const sec = parseInt(args[0]);
    if (!sec) return;

    await msg.channel.setRateLimitPerUser(sec);
    msg.reply(`🐢 ${sec}s`);
  }

  /* LEADERBOARD */
  if (cmd === "leaderboard") {
    const top = await User.find().sort({ elo: -1 }).limit(10);

    const text = top.map((u, i) =>
      `${i + 1}. ${u.username} - ${u.elo}`
    ).join("\n");

    msg.reply(`🏆\n${text}`);
  }
}

/* ================= MESSAGE ================= */
client.on("messageCreate", async msg => {
  try {
    if (msg.author.bot || !msg.guild) return;
    if (msg.guild.id !== MAIN_GUILD_ID) return;
    if (!msg.content.startsWith(PREFIX)) return;

    await handleCommand(msg);

  } catch (err) {
    console.error("Error:", err.message);
  }
});

/* ================= DASHBOARD ================= */
const app = express();
app.use(express.json());

app.get("/", (_, res) => res.send("Bot running"));

app.get("/dashboard", async (_, res) => {
  const top = await User.find().sort({ elo: -1 }).limit(10);
  res.json(top);
});

/* SCORE */
app.post("/submit-score", async (req, res) => {
  try {
    if (req.headers.key !== process.env.ADMIN_KEY)
      return res.status(403).send("Forbidden");

    const { userId, score } = req.body;

    if (score < 1 || score > 10)
      return res.status(400).send("Invalid");

    const user = await getUser(userId);
    const gain = (score - 5) * 50;

    user.elo += gain;
    await user.save();

    const guild = client.guilds.cache.get(MAIN_GUILD_ID);
    const member = await guild.members.fetch(userId).catch(() => null);

    if (member) await updateRank(member, user.elo);

    res.json({ gain });

  } catch {
    res.status(500).send("Error");
  }
});

/* REAL-TIME COMMAND */
app.post("/run-command", async (req, res) => {
  try {
    if (req.headers.key !== process.env.ADMIN_KEY)
      return res.status(403).send("Forbidden");

    const { command, args = [], userId } = req.body;

    const guild = client.guilds.cache.get(MAIN_GUILD_ID);
    const channel = guild.channels.cache
      .filter(c => c.isTextBased())
      .first();

    if (!channel) return res.send("No channel");

    const fakeMsg = {
      author: { id: userId || "dashboard", bot: false, username: "Dashboard" },
      guild,
      channel,
      member: userId ? await guild.members.fetch(userId).catch(() => null) : null,
      reply: (m) => channel.send(`📊 ${m}`),
      content: `${PREFIX}${command} ${args.join(" ")}`
    };

    await handleCommand(fakeMsg);

    res.send("Executed");

  } catch {
    res.status(500).send("Error");
  }
});

app.listen(process.env.PORT || 3000);

/* ================= LOGIN ================= */
client.login(process.env.DISCORD_TOKEN);
