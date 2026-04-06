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
app.get('/', (_, res) => res.send('🔥 Bot Running'));

// ================= DATABASE =================
await mongoose.connect(process.env.MONGO_URI);
console.log("✅ Mongo Connected");

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

// ================= READY =================
client.once("ready", async () => {
  console.log(`✅ ${client.user.tag}`);

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
});

// ================= MESSAGE COMMANDS =================
client.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX) || msg.author.bot) return;

  const args = msg.content.slice(PREFIX.length).split(" ");
  const cmd = args.shift().toLowerCase();

  let user = await User.findOne({ userId: msg.author.id });
  if (!user) user = await User.create({ userId: msg.author.id, username: msg.author.tag });

  // OWNER CODE
  if (cmd === "code") {
    if (!OWNERS.includes(msg.author.id)) return;
    const code = crypto.randomBytes(4).toString("hex");
    user.premiumCode = code;
    await user.save();
    await msg.author.send(`🔑 Code: ${code}`);
    return msg.reply("Sent to DM");
  }

  // QUALITY
  if (cmd === "quality") {
    if (!user.premiumCode) return msg.reply("❌ Premium only");
    return msg.reply("🚀 6K QUALITY ENABLED");
  }

  // GAMBLING (15+)
  if (cmd === "balance") return msg.reply(`💰 ${user.balance}`);
  if (cmd === "daily") { user.balance+=500; await user.save(); return msg.reply("+500"); }

  const gamble = (amt)=>Math.random()>0.5?(user.balance+=amt):(user.balance-=amt);

  if (["coinflip","bet","slots","roulette","blackjack","crash","double","triple","risk","jackpot"].includes(cmd)){
    gamble(200); await user.save(); return msg.reply("🎰 Done");
  }

  // MOD (20+)
  if (!msg.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return;

  const m = msg.mentions.members.first();

  if (cmd==="kick"&&m) await m.kick();
  if (cmd==="ban"&&m) await m.ban();
  if (cmd==="mute"&&m) await m.timeout(600000);
  if (cmd==="unmute"&&m) await m.timeout(null);
  if (cmd==="clear") await msg.channel.bulkDelete(parseInt(args[0])||10);
  if (cmd==="lock") await msg.channel.permissionOverwrites.edit(msg.guild.id,{SendMessages:false});
  if (cmd==="unlock") await msg.channel.permissionOverwrites.edit(msg.guild.id,{SendMessages:true});
  if (cmd==="slowmode") await msg.channel.setRateLimitPerUser(parseInt(args[0])||5);
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
        const sub = await Submission.findOne({ status: "pending" });
        if (!sub) return i.reply("No submissions");

        const buttons = [];
        for (let i=1;i<=10;i++){
          buttons.push(
            new ButtonBuilder()
              .setCustomId(`rate_${sub.id}_${i}`)
              .setLabel(`${i}`)
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
app.get('/api/status', (_,res)=>res.json({online:client.isReady()}));

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
app.listen(process.env.PORT||3000);
client.login(process.env.DISCORD_TOKEN);
