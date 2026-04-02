import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  ActivityType,
  SlashCommandBuilder
} from "discord.js";

import mongoose from "mongoose";
import express from "express";

// ===== CLIENT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ===== DATABASE =====
await mongoose.connect(process.env.MONGO_URL);
console.log("✅ MongoDB Connected");

// ===== USER MODEL =====
const userSchema = new mongoose.Schema({
  userId: String,
  username: String,
  elo: { type: Number, default: 1000 },
  streak: { type: Number, default: 0 },
  coins: { type: Number, default: 1000 }
});
const User = mongoose.model("User", userSchema);

// ===== GUILD CONFIG =====
const guildSchema = new mongoose.Schema({
  guildId: String,
  commands: Object,
  rankRoles: Object
});
const Guild = mongoose.model("Guild", guildSchema);

// ===== COMMAND STATE =====
let COMMANDS = {
  profile: true,
  submit: true,
  quality_method: true,
  leaderboard: true,
  coinflip: true,
  daily: true,
  balance: true
};

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

const getRank = elo =>
  [...RANKS].reverse().find(r => elo >= r.mmr) || RANKS[0];

const calcElo = (score, elo, streak) => {
  let gain = (score - 5.5) * 50;
  if (streak >= 3) gain *= 1.5;
  if (elo > 3500) gain *= 0.7;
  return Math.round(gain);
};

// ===== ROLE SYSTEM =====
async function applyRank(member, elo) {
  let config = await Guild.findOne({ guildId: member.guild.id }) ||
               await Guild.create({ guildId: member.guild.id, rankRoles: {} });

  const rank = getRank(elo);

  let roleId = config.rankRoles?.[rank.name];
  let role = member.guild.roles.cache.get(roleId);

  if (!role) {
    role = await member.guild.roles.create({ name: rank.name });
    config.rankRoles[rank.name] = role.id;
    await config.save();
  }

  await member.roles.remove(Object.values(config.rankRoles)).catch(()=>{});
  await member.roles.add(role).catch(()=>{});
}

// ===== EXPRESS =====
const app = express();
app.use(express.json());

// ===== API =====
app.get("/api/users", async (req, res) => {
  const users = await User.find().sort({ elo: -1 }).limit(50);
  res.json(users);
});

app.get("/api/commands", (req, res) => res.json(COMMANDS));

app.post("/api/commands/:cmd", (req, res) => {
  const cmd = req.params.cmd;
  if (COMMANDS[cmd] !== undefined) {
    COMMANDS[cmd] = !COMMANDS[cmd];
  }
  res.json(COMMANDS);
});

// ===== DASHBOARD =====
app.get("/dashboard", (req, res) => {
  res.send(`
  <html>
  <body style="background:#0f172a;color:white;font-family:sans-serif;">
  <h1>Omega Dashboard</h1>

  <h2>Commands</h2>
  <div id="cmds"></div>

  <h2>Leaderboard</h2>
  <div id="lb"></div>

  <script>
    async function load(){
      let c = await fetch('/api/commands').then(r=>r.json());
      let u = await fetch('/api/users').then(r=>r.json());

      let cmdDiv = document.getElementById('cmds');
      cmdDiv.innerHTML = '';

      for(let k in c){
        let b = document.createElement('button');
        b.innerText = k + ": " + (c[k] ? "ON" : "OFF");
        b.onclick = async ()=>{
          await fetch('/api/commands/'+k,{method:'POST'});
          load();
        };
        cmdDiv.appendChild(b);
      }

      let lbDiv = document.getElementById('lb');
      lbDiv.innerHTML = '';
      u.forEach((x,i)=>{
        let d = document.createElement('div');
        d.innerText = "#" + (i+1) + " " + x.username + " - " + x.elo;
        lbDiv.appendChild(d);
      });
    }
    load();
  </script>
  </body>
  </html>
  `);
});

app.get("/", (_, res) => res.send("Bot running"));
app.listen(process.env.PORT || 3000);

// ===== READY =====
client.once("ready", async () => {
  console.log(`🔥 ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: "Omega System", type: ActivityType.Playing }]
  });

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  const commands = [
    new SlashCommandBuilder().setName("profile").setDescription("Profile"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Top players"),
    new SlashCommandBuilder().setName("submit").setDescription("Submit score")
      .addIntegerOption(o=>o.setName("score").setRequired(true)),
    new SlashCommandBuilder().setName("quality_method").setDescription("Video"),
    new SlashCommandBuilder().setName("coinflip").setDescription("Gamble"),
    new SlashCommandBuilder().setName("daily").setDescription("Daily coins"),
    new SlashCommandBuilder().setName("balance").setDescription("Your money")
  ].map(c=>c.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, "1488203882130837704"),
    { body: commands }
  );

  console.log("✅ Commands synced");
});

// ===== COMMAND HANDLER =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (!COMMANDS[i.commandName]) {
    return i.reply({ content: "❌ Disabled", ephemeral: true });
  }

  let user = await User.findOneAndUpdate(
    { userId: i.user.id },
    { username: i.user.username },
    { upsert: true, new: true }
  );

  // PROFILE
  if (i.commandName === "profile") {
    const rank = getRank(user.elo);
    return i.reply({
      embeds: [new EmbedBuilder()
        .setTitle(i.user.username)
        .addFields(
          { name:"ELO", value:`${user.elo}`, inline:true },
          { name:"Rank", value:rank.name, inline:true },
          { name:"Coins", value:`${user.coins}`, inline:true }
        )]
    });
  }

  // SUBMIT
  if (i.commandName === "submit") {
    const score = i.options.getInteger("score");
    const gain = calcElo(score, user.elo, user.streak);

    user.elo += gain;
    user.streak = score >= 8 ? user.streak + 1 : 0;
    await user.save();

    const member = await i.guild.members.fetch(i.user.id);
    await applyRank(member, user.elo);

    return i.reply(`🏆 +${gain} ELO`);
  }

  // LEADERBOARD
  if (i.commandName === "leaderboard") {
    const top = await User.find().sort({ elo:-1 }).limit(10);
    return i.reply(top.map((u,i)=>`#${i+1} ${u.username} - ${u.elo}`).join("\\n"));
  }

  // ECONOMY
  if (i.commandName === "daily") {
    user.coins += 500;
    await user.save();
    return i.reply("💰 +500 coins");
  }

  if (i.commandName === "balance") {
    return i.reply(`💰 ${user.coins}`);
  }

  if (i.commandName === "coinflip") {
    const win = Math.random()>0.5;
    user.coins += win ? 200 : -200;
    await user.save();
    return i.reply(win ? "🪙 Win!" : "❌ Lose!");
  }

  // QUALITY (basic safe version)
  if (i.commandName === "quality_method") {
    return i.reply("🎥 Quality system ready");
  }
});

// ===== JOIN =====
client.on("guildMemberAdd", async m => {
  let user = await User.findOneAndUpdate(
    { userId: m.id },
    { username: m.user.username },
    { upsert:true, new:true }
  );
  await applyRank(m, user.elo);
});

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN);
