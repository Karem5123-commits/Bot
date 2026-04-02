import 'dotenv/config';
import { 
  Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, 
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, REST, 
  Routes, EmbedBuilder, PermissionsBitField, SlashCommandBuilder 
} from "discord.js";
import mongoose from "mongoose";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ytdl from "yt-dlp-exec";
import { v4 as uuidv4 } from 'uuid';
import fs from "fs/promises";
import path from "path";
import { User, GuildConfig } from './models.js';

// --- INITIALIZATION ---
ffmpeg.setFfmpegPath(ffmpegPath);
const TEMP_DIR = path.join(process.cwd(), 'temp');
await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message]
});

const CONFIG = {
  RANKS: [
    { name: "Bronze", mmr: 0, color: "#8d6e63", icon: "🥉" },
    { name: "Silver", mmr: 1200, color: "#b0bec5", icon: "🥈" },
    { name: "Gold", mmr: 1800, color: "#f1c40f", icon: "🥇" },
    { name: "Platinum", mmr: 2500, color: "#00bcd4", icon: "💎" },
    { name: "Diamond", mmr: 3500, color: "#3498db", icon: "🛡️" },
    { name: "Master", mmr: 4800, color: "#9b59b6", icon: "🔮" },
    { name: "Legend", mmr: 6500, color: "#e74c3c", icon: "👑" }
  ]
};

// --- RANKING ENGINE (4X MATH) ---
const calculateEloGain = (score, currentElo, streak) => {
    let baseChange = (score - 5.5) * 50; 
    if (streak >= 3) baseChange *= 1.5;
    if (currentElo > 3500) baseChange *= 0.7; 
    return Math.round(baseChange);
};

const getRankData = (mmr) => [...CONFIG.RANKS].reverse().find(r => mmr >= r.mmr) || CONFIG.RANKS[0];

// --- AUTO-ROLE ENGINE ---
async function applyRank(member, mmr) {
  let config = await GuildConfig.findOne({ guildId: member.guild.id }) || await GuildConfig.create({ guildId: member.guild.id });
  const currentRank = getRankData(mmr);
  
  let roleId = config.rankRoles.get(currentRank.name);
  let discordRole = member.guild.roles.cache.get(roleId);

  if (!discordRole) {
    discordRole = await member.guild.roles.create({
      name: currentRank.name,
      color: currentRank.color,
      reason: "Omega Automatic Setup"
    });
    config.rankRoles.set(currentRank.name, discordRole.id);
    await config.save();
  }

  const allRankRoleIds = Array.from(config.rankRoles.values());
  await member.roles.remove(allRankRoleIds).catch(() => {});
  await member.roles.add(discordRole.id).catch(e => console.error("Role Hierarchy Error: Move Bot Role Higher!"));
}

// --- CORE HANDLERS ---
client.on("guildMemberAdd", async (member) => {
  await User.findOneAndUpdate({ userId: member.id }, { username: member.user.username, elo: 1000 }, { upsert: true });
  await applyRank(member, 1000);
});

client.once("ready", async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  
  const commands = [
    new SlashCommandBuilder().setName("profile").setDescription("View your Elite Stats"),
    new SlashCommandBuilder().setName("submit").setDescription("Submit a clip for Elite Ranking"),
    new SlashCommandBuilder().setName("quality_method").setDescription("6K Ultra Render").addStringOption(o => o.setName('url').setRequired(true)),
    new SlashCommandBuilder().setName("setup_roles").setDescription("Admin: Force build all rank roles"),
    new SlashCommandBuilder().setName("8ball").setDescription("Ask a question").addStringOption(o => o.setName('question').setRequired(true)),
    new SlashCommandBuilder().setName("roll").setDescription("Roll dice (e.g. 2d20)").addStringOption(o => o.setName('dice').setDescription("NdN format")),
    new SlashCommandBuilder().setName("avatar").setDescription("Get user avatar").addUserOption(o => o.setName('target').setRequired(false)),
    new SlashCommandBuilder().setName("echo").setDescription("Speak through bot").addStringOption(o => o.setName('text').setRequired(true))
  ].map(c => c.toJSON());

  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log("🔥 OMEGA PRIME ONLINE");
});

client.on("interactionCreate", async i => {
  if (i.isChatInputCommand()) {
    
    // --- FUN & TOOLS ---
    if (i.commandName === '8ball') {
      const responses = ["Certainly.", "Maybe.", "Ask later.", "No.", "Absolutely.", "Doubtful."];
      return i.reply(`**Question:** ${i.options.getString('question')}\n**🎱 Answer:** ${responses[Math.floor(Math.random() * responses.length)]}`);
    }

    if (i.commandName === 'roll') {
      const dice = i.options.getString('dice') || "1d6";
      const [rolls, limit] = dice.split('d').map(Number);
      if (isNaN(rolls) || isNaN(limit)) return i.reply("Use format: 2d20");
      const results = Array.from({ length: rolls }, () => Math.floor(Math.random() * limit) + 1);
      return i.reply(`🎲 **${dice}**: ${results.join(', ')} (Sum: ${results.reduce((a,b)=>a+b,0)})`);
    }

    if (i.commandName === 'avatar') {
      const user = i.options.getUser('target') || i.user;
      return i.reply(user.displayAvatarURL({ dynamic: true, size: 1024 }));
    }

    if (i.commandName === 'echo') {
      if (!i.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return i.reply({ content: "Denied.", ephemeral: true });
      const text = i.options.getString('text');
      await i.channel.send(text);
      return i.reply({ content: "Sent.", ephemeral: true });
    }

    // --- ELITE SYSTEM ---
    if (i.commandName === "setup_roles") {
      if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator)) return i.reply("Admin only.");
      await i.deferReply({ ephemeral: true });
      let config = await GuildConfig.findOne({ guildId: i.guild.id }) || await GuildConfig.create({ guildId: i.guild.id });
      for (const r of CONFIG.RANKS) {
         const newRole = await i.guild.roles.create({ name: r.name, color: r.color, reason: "Setup" }).catch(() => null);
         if(newRole) config.rankRoles.set(r.name, newRole.id);
      }
      await config.save();
      return i.editReply("✅ Roles Configured.");
    }

    if (i.commandName === "profile") {
      const user = await User.findOne({ userId: i.user.id }) || await User.create({ userId: i.user.id, username: i.user.username });
      const rank = getRankData(user.elo);
      const embed = new EmbedBuilder()
        .setTitle(`${rank.icon} ${i.user.username}`)
        .setColor(rank.color)
        .addFields(
            { name: "ELO", value: `\`${user.elo}\``, inline: true },
            { name: "Rank", value: `**${rank.name}**`, inline: true },
            { name: "Streak", value: `**${user.streak}🔥**`, inline: true }
        );
      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === "quality_method") {
        await i.deferReply();
        const url = i.options.getString("url");
        const id = uuidv4();
        const pathIn = path.join(TEMP_DIR, `in_${id}.mp4`);
        const pathOut = path.join(TEMP_DIR, `out_${id}.mp4`);
        try {
            await ytdl(url, { output: pathIn });
            await new Promise((res, rej) => {
                ffmpeg(pathIn)
                    .videoFilters(["crop='if(gte(iw/ih,4/5),ih*4/5,iw)':'if(gte(iw/ih,4/5),ih,iw*5/4)'", "scale=3240:4050:flags=lanczos"])
                    .outputOptions(['-c:v libx264', '-crf 16', '-preset fast']).save(pathOut).on('end', res).on('error', rej);
            });
            await i.editReply({ content: "✅ **Render Complete.**", files: [pathOut] });
        } catch (e) { await i.editReply("❌ Render Failed."); }
        finally { await fs.unlink(pathIn).catch(()=>{}); await fs.unlink(pathOut).catch(()=>{}); }
    }

    if (i.commandName === "submit") {
        const modal = new ModalBuilder().setCustomId("sub_modal").setTitle("Elite Submission");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("url").setLabel("Clip Link").setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
    }
  }

  // --- BUTTONS & MODALS ---
  if (i.isModalSubmit() && i.customId === "sub_modal") {
      const url = i.fields.getTextInputValue("url");
      const reviewCh = await client.channels.fetch(process.env.REVIEW_CHANNEL_ID);
      const row = new ActionRowBuilder().addComponents(
          [4, 7, 10].map(s => new ButtonBuilder().setCustomId(`rank_${s}_${uuidv4().slice(0,4)}_${i.user.id}`).setLabel(`Score: ${s}`).setStyle(s === 10 ? ButtonStyle.Success : ButtonStyle.Primary))
      );
      await reviewCh.send({ content: `📥 **Submission: <@${i.user.id}>**\nLink: ${url}`, components: [row] });
      return i.reply({ content: "Sent for review.", ephemeral: true });
  }

  if (i.isButton() && i.customId.startsWith("rank_")) {
    const [, score, , targetId] = i.customId.split("_");
    const user = await User.findOne({ userId: targetId }) || await User.create({ userId: targetId });
    const gain = calculateEloGain(Number(score), user.elo, user.streak);
    const newElo = Math.max(0, user.elo + gain);
    const newStreak = Number(score) >= 8 ? user.streak + 1 : 0;

    await User.updateOne({ userId: targetId }, { $set: { elo: newElo, streak: newStreak }, $max: { peakElo: newElo } });
    const member = await i.guild.members.fetch(targetId).catch(() => null);
    if (member) await applyRank(member, newElo);
    
    return i.update({ content: `✅ Ranked. Change: **${gain > 0 ? "+" : ""}${gain}**`, components: [] });
  }
});

const app = express();
app.get("/", (req, res) => res.send("Omega System Online"));
app.listen(process.env.PORT || 3000, '0.0.0.0');
client.login(process.env.DISCORD_TOKEN);
