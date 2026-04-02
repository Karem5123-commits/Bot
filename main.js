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
import { User, GuildConfig } from './models.js';

ffmpeg.setFfmpegPath(ffmpegPath);

const client = new Client({
  intents: [3276799],
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

// --- RANKING ENGINE ---
const calculateEloGain = (score, currentElo, streak) => {
    let baseChange = (score - 5.5) * 50; 
    if (streak >= 3) baseChange *= 1.5;
    if (currentElo > 3500) baseChange *= 0.7; 
    return Math.round(baseChange);
};

const getRankData = (mmr) => [...CONFIG.RANKS].reverse().find(r => mmr >= r.mmr) || CONFIG.RANKS[0];

// --- ROLE ENGINE ---
async function applyRank(member, mmr) {
  let config = await GuildConfig.findOne({ guildId: member.guild.id }) || await GuildConfig.create({ guildId: member.guild.id });
  const currentRank = getRankData(mmr);
  let roleId = config.rankRoles.get(currentRank.name);
  let discordRole = member.guild.roles.cache.get(roleId);

  if (!discordRole) {
    discordRole = await member.guild.roles.create({ name: currentRank.name, color: currentRank.color, reason: "Omega Auto-Rank" });
    config.rankRoles.set(currentRank.name, discordRole.id);
    await config.save();
  }

  const allRankRoleIds = Array.from(config.rankRoles.values());
  await member.roles.remove(allRankRoleIds).catch(() => {});
  await member.roles.add(discordRole.id);
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
    // Elite Commands
    new SlashCommandBuilder().setName("profile").setDescription("View your Elite Stats"),
    new SlashCommandBuilder().setName("submit").setDescription("Submit a clip for Elite Ranking"),
    new SlashCommandBuilder().setName("quality_method").setDescription("6K Ultra Render").addStringOption(o => o.setName('url').setRequired(true)),
    new SlashCommandBuilder().setName("setup_roles").setDescription("Owner: Build rank roles"),
    
    // Fun & Tools Integration
    new SlashCommandBuilder().setName("8ball").setDescription("Ask the divine 8-ball a question").addStringOption(o => o.setName('question').setRequired(true)),
    new SlashCommandBuilder().setName("roll").setDescription("Roll dice (e.g. 2d20)").addStringOption(o => o.setName('dice').setDescription("Format: NdN")),
    new SlashCommandBuilder().setName("avatar").setDescription("Get a user's avatar").addUserOption(o => o.setName('target').setDescription("The user")),
    new SlashCommandBuilder().setName("echo").setDescription("Make the bot speak").addStringOption(o => o.setName('text').setRequired(true))
  ].map(c => c.toJSON());

  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log("🚀 OMEGA OVERLORD PRIME: Fun & Tools Integrated");
});

client.on("interactionCreate", async i => {
  if (i.isChatInputCommand()) {
    
    // --- FUN & TOOLS LOGIC ---
    if (i.commandName === '8ball') {
      const responses = ["It is certain.", "Outlooks not so good.", "Ask again later.", "Definitely.", "Very doubtful.", "Concentrate and ask again."];
      const question = i.options.getString('question');
      return i.reply(`**Question:** ${question}\n**🎱 Answer:** ${responses[Math.floor(Math.random() * responses.length)]}`);
    }

    if (i.commandName === 'roll') {
      const dice = i.options.getString('dice') || "1d6";
      try {
        const [rolls, limit] = dice.split('d').map(Number);
        const results = Array.from({ length: rolls }, () => Math.floor(Math.random() * limit) + 1);
        return i.reply(`🎲 Rolled **${dice}**: ${results.join(', ')} (Total: ${results.reduce((a, b) => a + b, 0)})`);
      } catch (e) { return i.reply({ content: "Format must be NdN (e.g. 2d20)!", ephemeral: true }); }
    }

    if (i.commandName === 'avatar') {
      const user = i.options.getUser('target') || i.user;
      return i.reply(user.displayAvatarURL({ dynamic: true, size: 1024 }));
    }

    if (i.commandName === 'echo') {
      const text = i.options.getString('text');
      await i.reply({ content: "Message sent.", ephemeral: true });
      return i.channel.send(text);
    }

    // --- ELITE SYSTEM LOGIC ---
    if (i.commandName === "setup_roles") {
      await i.deferReply({ ephemeral: true });
      let config = await GuildConfig.findOne({ guildId: i.guild.id }) || await GuildConfig.create({ guildId: i.guild.id });
      for (const r of CONFIG.RANKS) {
         const newRole = await i.guild.roles.create({ name: r.name, color: r.color }).catch(() => null);
         if(newRole) config.rankRoles.set(r.name, newRole.id);
      }
      await config.save();
      return i.editReply("✅ Rank Roles Synchronized.");
    }

    if (i.commandName === "profile") {
      const user = await User.findOne({ userId: i.user.id }) || await User.create({ userId: i.user.id, username: i.user.username });
      const rank = getRankData(user.elo);
      const embed = new EmbedBuilder()
        .setTitle(`${rank.icon} ${i.user.username}'s Standing`)
        .setColor(rank.color)
        .addFields(
          { name: "MMR / Elo", value: `\`${user.elo}\``, inline: true },
          { name: "Rank", value: `**${rank.name}**`, inline: true },
          { name: "Streak", value: `\`${user.streak} 🔥\``, inline: true }
        );
      return i.reply({ embeds: [embed] });
    }

    if (i.commandName === "quality_method") {
        await i.deferReply();
        const url = i.options.getString("url");
        const id = uuidv4();
        const pathIn = `/tmp/in_${id}.mp4`;
        const pathOut = `/tmp/out_${id}.mp4`;
        try {
            await ytdl(url, { output: pathIn });
            await new Promise((res, rej) => {
                ffmpeg(pathIn)
                    .videoFilters(["crop='if(gte(iw/ih,4/5),ih*4/5,iw)':'if(gte(iw/ih,4/5),ih,iw*5/4)'", "scale=3240:4050:flags=lanczos", "unsharp=6:6:1.2:6:6:0.0"])
                    .outputOptions(['-c:v libx264', '-crf 14', '-preset fast']).save(pathOut).on('end', res).on('error', rej);
            });
            await i.editReply({ content: "✅ **Render Complete.**", files: [pathOut] });
        } catch (e) { await i.editReply("❌ **Engine Error.**"); }
        finally { await fs.unlink(pathIn).catch(()=>{}); await fs.unlink(pathOut).catch(()=>{}); }
    }

    if (i.commandName === "submit") {
        const modal = new ModalBuilder().setCustomId("sub_modal").setTitle("Elite Clip Submission");
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("url").setLabel("Clip Link").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return i.showModal(modal);
    }
  }

  // --- BUTTON & MODAL HANDLERS ---
  if (i.isModalSubmit() && i.customId === "sub_modal") {
      const url = i.fields.getTextInputValue("url");
      const reviewCh = await client.channels.fetch(process.env.REVIEW_CHANNEL_ID);
      const subId = uuidv4().substring(0, 8);
      const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rank_1_${subId}_${i.user.id}`).setLabel("1").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`rank_5_${subId}_${i.user.id}`).setLabel("5").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`rank_8_${subId}_${i.user.id}`).setLabel("8").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`rank_10_${subId}_${i.user.id}`).setLabel("10").setStyle(ButtonStyle.Success)
      );
      await reviewCh.send({ content: `📥 **Submission from <@${i.user.id}>**\nLink: ${url}`, components: [row] });
      return i.reply({ content: "🚀 Sent for Review.", ephemeral: true });
  }

  if (i.isButton() && i.customId.startsWith("rank_")) {
    const [, score, subId, targetId] = i.customId.split("_");
    const user = await User.findOne({ userId: targetId }) || await User.create({ userId: targetId });
    const eloGain = calculateEloGain(Number(score), user.elo, user.streak);
    const newElo = Math.max(0, user.elo + eloGain);
    const newStreak = Number(score) >= 8 ? user.streak + 1 : 0;

    await User.updateOne({ userId: targetId }, { $set: { elo: newElo, streak: newStreak } });
    const member = await i.guild.members.fetch(targetId).catch(() => null);
    if (member) await applyRank(member, newElo);
    
    await i.update({ content: `✅ **Ranked!** Total: \`${newElo}\``, components: [], embeds: [] });
  }
});

const app = express();
app.get("/", (req, res) => res.send("Omega System Online"));
app.listen(process.env.PORT || 3000, '0.0.0.0');

client.login(process.env.DISCORD_TOKEN);
