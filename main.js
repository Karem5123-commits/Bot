import {
  Client, GatewayIntentBits, Partials,
  REST, Routes,
  SlashCommandBuilder,
  ActivityType,
  PermissionsBitField
} from "discord.js";

import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

dotenv.config();

// ================= SAFE =================
process.on("uncaughtException", e => console.error("💥", e));
process.on("unhandledRejection", e => console.error("💥", e));

// ================= CONFIG =================
const PREFIX = "!";
const CONFIG = {
  STAFF: PermissionsBitField.Flags.ManageGuild,
  SPAM_LIMIT: 5,
  SPAM_TIME: 10000
};

// ================= DB =================
await mongoose.connect(process.env.MONGO_URI);

const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  mmr: { type: Number, default: 1000 },
  rank: { type: String, default: "Bronze" },
  balance: { type: Number, default: 1000 }
}));

const Settings = mongoose.model("Settings", new mongoose.Schema({
  key: String,
  value: mongoose.Schema.Types.Mixed
}));

// ================= RANKS =================
const RANKS = [
  { name: "Bronze", mmr: 0 },
  { name: "Silver", mmr: 800 },
  { name: "Gold", mmr: 1000 },
  { name: "Platinum", mmr: 1300 },
  { name: "Diamond", mmr: 1600 },
  { name: "Master", mmr: 2000 }
];

function getRank(mmr) {
  let r = RANKS[0];
  for (const rank of RANKS) if (mmr >= rank.mmr) r = rank;
  return r.name;
}

// ================= DISCORD =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember]
});

// ================= COMMAND TOGGLE =================
async function isEnabled(cmd) {
  const s = await Settings.findOne({ key: cmd });
  return s?.value !== false;
}

async function setEnabled(cmd, val) {
  await Settings.updateOne({ key: cmd }, { value: val }, { upsert: true });
}

// ================= AUTO ROLE =================
async function applyRankRole(member, mmr) {
  const rank = getRank(mmr);
  let role = member.guild.roles.cache.find(r => r.name === rank);

  if (!role) {
    role = await member.guild.roles.create({ name: rank }).catch(()=>null);
  }

  if (!role) return;

  const all = RANKS.map(r=>r.name);
  const remove = member.roles.cache.filter(r=>all.includes(r.name));

  await member.roles.remove(remove).catch(()=>{});
  await member.roles.add(role).catch(()=>{});
}

// ================= QUEUE =================
const queue = [];
let processing = false;

async function processQueue(io) {
  if (processing || queue.length === 0) return;
  processing = true;

  const job = queue.shift();

  try {
    await job.reply("⚙️ Processing...");
    await new Promise(r => setTimeout(r, 4000));

    await job.reply("✅ Done");

    await User.updateOne(
      { userId: job.userId },
      { $inc: { balance: 10 } },
      { upsert: true }
    );

    io.emit("update");

  } catch {
    job.reply("❌ Failed");
  }

  processing = false;
  processQueue(io);
}

// ================= ANTI SPAM =================
const spamMap = new Map();

function checkSpam(id) {
  const now = Date.now();
  if (!spamMap.has(id)) spamMap.set(id, []);
  const arr = spamMap.get(id).filter(t => now - t < CONFIG.SPAM_TIME);
  arr.push(now);
  spamMap.set(id, arr);
  return arr.length > CONFIG.SPAM_LIMIT;
}

// ================= EXPRESS =================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ================= ADMIN API =================
app.get("/api/admin/commands", async (_,res)=>{
  const all = ["quality","profile","leaderboard","gamble"];
  const data = {};
  for (const c of all) data[c] = await isEnabled(c);
  res.json(data);
});

app.post("/api/admin/toggle", async (req,res)=>{
  const { command, enabled } = req.body;
  await setEnabled(command, enabled);
  io.emit("update");
  res.json({ success:true });
});

// ================= PUBLIC API =================
app.get("/api/status", (_,res)=>{
  res.json({ online:true, queue:queue.length });
});

app.get("/api/leaderboard", async (_,res)=>{
  res.json(await User.find().sort({ mmr:-1 }).limit(50));
});

app.get("/api/dashboard", async (_,res)=>{
  res.json({
    users: await User.countDocuments(),
    queue: queue.length
  });
});

// ================= READY =================
client.once("ready", async () => {
  console.log("🚀 FULL POWER READY");

  client.user.setActivity("Ultra AI Engine", {
    type: ActivityType.Playing
  });

  const cmds = [
    new SlashCommandBuilder().setName("quality").setDescription("Enhance").addStringOption(o=>o.setName("url").setRequired(true)),
    new SlashCommandBuilder().setName("profile").setDescription("Profile"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Top"),
    new SlashCommandBuilder().setName("gamble").setDescription("Bet").addIntegerOption(o=>o.setName("amount").setRequired(true)),
    new SlashCommandBuilder().setName("enable").setDescription("Enable command").addStringOption(o=>o.setName("cmd").setRequired(true)),
    new SlashCommandBuilder().setName("disable").setDescription("Disable command").addStringOption(o=>o.setName("cmd").setRequired(true))
  ].map(c=>c.toJSON());

  const rest = new REST({ version:"10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body:cmds });
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {
  try {
    if (!i.isChatInputCommand()) return;

    if (!(await isEnabled(i.commandName))) {
      return i.reply({ content:"Command disabled", ephemeral:true });
    }

    if (checkSpam(i.user.id)) {
      return i.reply({ content:"Slow down", ephemeral:true });
    }

    let user = await User.findOne({ userId:i.user.id });
    if (!user) user = await User.create({ userId:i.user.id });

    if (i.commandName === "quality") {
      await i.reply("⏳ Queued");
      queue.push({ reply: (m)=>i.followUp(m), userId:i.user.id });
      processQueue(io);
    }

    if (i.commandName === "profile") {
      return i.reply(`Rank: ${user.rank} | Balance: ${user.balance}`);
    }

    if (i.commandName === "leaderboard") {
      const top = await User.find().sort({ mmr:-1 }).limit(10);
      return i.reply(top.map((u,i)=>`${i+1}. <@${u.userId}>`).join("\n"));
    }

    if (i.commandName === "gamble") {
      const amt = i.options.getInteger("amount");

      if (amt > user.balance) return i.reply("Not enough");

      if (Math.random() > 0.5) {
        user.balance += amt;
      } else {
        user.balance -= amt;
      }

      await user.save();
      return i.reply(`Balance: ${user.balance}`);
    }

    if (i.commandName === "enable" || i.commandName === "disable") {
      if (!i.member.permissions.has(CONFIG.STAFF)) {
        return i.reply({ content:"Admin only", ephemeral:true });
      }

      const cmd = i.options.getString("cmd");
      await setEnabled(cmd, i.commandName === "enable");
      return i.reply(`✅ ${cmd} updated`);
    }

    const member = await i.guild.members.fetch(i.user.id);
    await applyRankRole(member, user.mmr);

  } catch (e) {
    console.error(e);
    if (!i.replied) i.reply("Error");
  }
});

// ================= PREFIX COMMANDS =================
client.on("messageCreate", async msg => {
  try {
    if (msg.author.bot) return;
    if (!msg.content.startsWith(PREFIX)) return;

    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    if (!(await isEnabled(cmd))) return msg.reply("Command disabled");
    if (checkSpam(msg.author.id)) return msg.reply("Slow down");

    let user = await User.findOne({ userId: msg.author.id });
    if (!user) user = await User.create({ userId: msg.author.id });

    if (cmd === "quality") {
      msg.reply("⏳ Queued");
      queue.push({ reply: (m)=>msg.reply(m), userId: msg.author.id });
      processQueue(io);
    }

    if (cmd === "profile") {
      return msg.reply(`Rank: ${user.rank} | Balance: ${user.balance}`);
    }

    if (cmd === "leaderboard") {
      const top = await User.find().sort({ mmr:-1 }).limit(10);
      return msg.reply(top.map((u,i)=>`${i+1}. <@${u.userId}>`).join("\n"));
    }

    if (cmd === "gamble") {
      const amt = parseInt(args[0]);
      if (!amt) return msg.reply("Enter amount");

      if (amt > user.balance) return msg.reply("Not enough");

      if (Math.random() > 0.5) user.balance += amt;
      else user.balance -= amt;

      await user.save();
      return msg.reply(`Balance: ${user.balance}`);
    }

    if (cmd === "enable" || cmd === "disable") {
      if (!msg.member.permissions.has(CONFIG.STAFF)) return msg.reply("Admin only");

      const target = args[0];
      await setEnabled(target, cmd === "enable");
      return msg.reply(`✅ ${target} updated`);
    }

    const member = await msg.guild.members.fetch(msg.author.id);
    await applyRankRole(member, user.mmr);

  } catch (e) {
    console.error(e);
    msg.reply("Error");
  }
});

// ================= START =================
server.listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
