import {
  Client, GatewayIntentBits, Partials,
  REST, Routes,
  SlashCommandBuilder,
  EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
  PermissionsBitField
} from 'discord.js';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';

dotenv.config();

// ================= SAFE =================
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ================= EXPRESS =================
const app = express();
app.use(express.json());
app.use(cors());

let requestCount = 0;
const startTime = Date.now();

app.use((req, res, next) => {
  requestCount++;
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`🌐 ${req.method} ${req.url} | ${res.statusCode} | ${duration}ms | Total: ${requestCount}`);
  });
  next();
});

app.get('/', (_, res) => res.send('🔥 Bot Running'));

// ================= DATABASE =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongo Connected"))
  .catch(console.error);

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  username: String,
  mmr: { type: Number, default: 1000 },
  balance: { type: Number, default: 1000 },
  submissions: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  rejected: { type: Number, default: 0 },
  premiumCode: String
}));

const Submission = mongoose.model("Submission", new mongoose.Schema({
  id: String,
  userId: String,
  link: String,
  status: { type: String, default: "pending" },
  score: Number,
  mmrChange: Number
}));

// ================= HELPERS =================
const calcMMR = (score) => 100 + (score - 1) * 150;

const getRank = (mmr) => {
  if (mmr >= 1800) return "Grandmaster";
  if (mmr >= 1600) return "Master";
  if (mmr >= 1400) return "Diamond";
  if (mmr >= 1200) return "Platinum";
  if (mmr >= 1000) return "Gold";
  if (mmr >= 800) return "Silver";
  return "Bronze";
};

function generatePremiumCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

// ================= DISCORD =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const PREFIX = "!";
const OWNERS = ["1347959266539081768","1399094217846030346"];

// ================= ROLE SYSTEM =================
const FULL_MOD_ROLE = "1488205041885122581";
const KICK_MUTE_ROLE = "1488205040811245740";
const MUTE_ONLY_ROLE = "1488207431753531485";
const hasRole = (member, roleId) => member.roles.cache.has(roleId);

// ================= AUTO BOOST DM =================
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    if (!oldMember.premiumSince && newMember.premiumSince) {
      let user = await User.findOne({ userId: newMember.id });
      if (!user) user = await User.create({ userId: newMember.id, username: newMember.user.tag });

      const code = generatePremiumCode();
      user.premiumCode = code;
      await user.save();

      await newMember.send(`🚀 Thanks for boosting!\n🔐 Code: \`${code}\`\nUse !quality`);

      console.log(`💎 Boost → Code sent to ${newMember.user.tag}`);
    }
  } catch (e) {
    console.error("Boost DM error:", e);
  }
});

// ================= READY =================
client.once("clientReady", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  const cmds = [
    new SlashCommandBuilder().setName("submit").setDescription("Submit clip"),
    new SlashCommandBuilder().setName("profile").setDescription("View profile"),
    new SlashCommandBuilder().setName("review").setDescription("Review clips")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: cmds }
  );

  console.log("⚡ Slash commands loaded");
});

// ================= MESSAGE COMMANDS =================
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(PREFIX.length).split(" ");
  const cmd = args.shift().toLowerCase();

  let user = await User.findOne({ userId: msg.author.id });
  if (!user) user = await User.create({ userId: msg.author.id, username: msg.author.tag });

  if (cmd === "code") {
    if (!OWNERS.includes(msg.author.id)) return;
    const code = generatePremiumCode();
    user.premiumCode = code;
    await user.save();
    await msg.author.send(`🔑 Code: ${code}`);
    return msg.reply("📩 Sent to DM");
  }

  if (cmd === "quality") {
    if (!user.premiumCode) return msg.reply("❌ Premium only");
    return msg.reply("🚀 6K QUALITY ENABLED");
  }

  if (cmd === "balance") return msg.reply(`💰 ${user.balance}`);
  if (cmd === "daily") { user.balance+=500; await user.save(); return msg.reply("+500"); }

  const gamble = (amt)=>Math.random()>0.5?(user.balance+=amt):(user.balance-=amt);

  if (["coinflip","slots","roulette","blackjack","crash","double","triple","risk","jackpot"].includes(cmd)){
    gamble(200);
    await user.save();
    return msg.reply(`🎰 Balance: ${user.balance}`);
  }

  // ORIGINAL PERMISSION SYSTEM (unchanged)
  if (!msg.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;

  const m = msg.mentions.members.first();
  if (cmd==="kick"&&m) await m.kick();
  if (cmd==="ban"&&m) await m.ban();
  if (cmd==="mute"&&m) await m.timeout(600000);
  if (cmd==="clear") await msg.channel.bulkDelete(parseInt(args[0])||10);

  // ================= ROLE EXTRA SYSTEM =================
  if (hasRole(msg.member, FULL_MOD_ROLE)) {
    if (cmd==="kick"&&m) await m.kick();
    if (cmd==="ban"&&m) await m.ban();
    if (cmd==="mute"&&m) await m.timeout(600000);
    if (cmd==="clear") await msg.channel.bulkDelete(parseInt(args[0])||10);
  }

  if (hasRole(msg.member, KICK_MUTE_ROLE)) {
    if (cmd==="kick"&&m) await m.kick();
    if (cmd==="mute"&&m) await m.timeout(600000);
  }

  if (hasRole(msg.member, MUTE_ONLY_ROLE)) {
    if (cmd==="mute"&&m) await m.timeout(600000);
  }
});

// ================= INTERACTIONS =================
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
        const user = await User.findOne({ userId: i.user.id });
        return i.reply(`MMR: ${user?.mmr||1000} | Rank: ${getRank(user?.mmr||1000)}`);
      }

      if (i.commandName === "review") {

        // ROLE LOCK
        if (!i.member.roles.cache.has(FULL_MOD_ROLE)) {
          return i.reply({ content: "Staff only", ephemeral: true });
        }

        const sub = await Submission.findOne({ status: "pending" });
        if (!sub) return i.reply("No submissions");

        const buttons = [];
        for (let x=1;x<=10;x++){
          buttons.push(
            new ButtonBuilder()
              .setCustomId(`rate_${sub.id}_${x}`)
              .setLabel(`${x}`)
              .setStyle(ButtonStyle.Primary)
          );
        }

        return i.reply({
          content: sub.link,
          components: [new ActionRowBuilder().addComponents(buttons)]
        });
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
      const [_, id, score] = i.customId.split("_");

      const sub = await Submission.findOne({ id });
      if (!sub) return;

      const user = await User.findOne({ userId: sub.userId });

      const mmr = calcMMR(Number(score));
      user.mmr += mmr;

      await user.save();

      sub.status = "done";
      sub.score = score;
      sub.mmrChange = mmr;
      await sub.save();

      return i.update({
        content: `Rated ${score}/10 (+${mmr} MMR)`,
        components: []
      });
    }

  } catch (e) {
    console.error(e);
  }
});

// ================= API =================
app.get('/api/status', (_,res)=>{
  res.json({
    online: client.isReady(),
    uptime: Math.floor((Date.now()-startTime)/1000),
    requests: requestCount
  });
});

app.get('/api/dashboard', async (_,res)=>{
  const users=await User.countDocuments();
  const subs=await Submission.countDocuments();
  const processed=await Submission.countDocuments({status:"done"});
  res.json({users,submissions:subs,stats:{totalProcessed:processed}});
});

app.get('/api/leaderboard', async (_,res)=>{
  const users=await User.find().sort({mmr:-1}).limit(50);
  res.json(users);
});

app.get('/api/submissions', async (_,res)=>{
  const subs=await Submission.find();
  res.json(subs.length?subs:{message:"No submissions"});
});

app.get('/api/season', (_,res)=>res.json({season:1,daysLeft:30}));

// ================= START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🌐 API STARTED SUCCESSFULLY");
});

client.login(process.env.DISCORD_TOKEN)
  .then(()=>console.log("✅ Discord Connected"))
  .catch(console.error);
