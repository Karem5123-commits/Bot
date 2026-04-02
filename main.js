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

// --- SYSTEM INITIALIZATION ---
ffmpeg.setFfmpegPath(ffmpegPath);
const TEMP_DIR = path.join(process.cwd(), 'temp');
await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {});

const client = new Client({
  intents: [3276799],
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message]
});

// --- ELITE RANKING MATH ---
const calculateEloGain = (score, currentElo, streak) => {
    let baseChange = (score - 5.5) * 50; 
    if (streak >= 3) baseChange *= 1.5;
    if (currentElo > 3500) baseChange *= 0.7; 
    return Math.round(baseChange);
};

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

const getRankData = (mmr) => [...CONFIG.RANKS].reverse().find(r => mmr >= r.mmr) || CONFIG.RANKS[0];

// --- AUTO-ROLE ENGINE ---
async function applyRank(member, mmr) {
  try {
    let config = await GuildConfig.findOne({ guildId: member.guild.id }) || await GuildConfig.create({ guildId: member.guild.id });
    const currentRank = getRankData(mmr);
    let roleId = config.rankRoles.get(currentRank.name);
    let discordRole = member.guild.roles.cache.get(roleId);

    if (!discordRole) {
        discordRole = await member.guild.roles.create({ name: currentRank.name, color: currentRank.color, reason: "Omega Setup" });
        config.rankRoles.set(currentRank.name, discordRole.id);
        await config.save();
    }

    const allRankIds = Array.from(config.rankRoles.values());
    await member.roles.remove(allRankIds).catch(() => {});
    await member.roles.add(discordRole.id);
  } catch (e) { console.error("Role update error:", e.message); }
}

// --- STARTUP: DB ROTATION & COMMAND REFRESH ---
client.once("ready", async () => {
  // Database Connection Logic (Uses MAIN by default)
  const URI = process.env.MONGO_URI_MAIN || "mongodb+srv://inspiringabundance:Z2qWAzc73NVXeIMr@bot.vgep3.mongodb.net/main?retryWrites=true&w=majority";

  try {
    await mongoose.connect(URI);
    console.log("📂 Database Connected Successfully");
  } catch (e) {
    console.error("❌ DB Connection Failed. Check your Railway Variables and IP Whitelist.");
    process.exit(1); 
  }

  // FORCED COMMAND REFRESH
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const commands = [
    new SlashCommandBuilder().setName("profile").setDescription("View your stats"),
    new SlashCommandBuilder().setName("submit").setDescription("Submit clip for ranking"),
    new SlashCommandBuilder().setName("quality_method").setDescription("6K Ultra Render").addStringOption(o => o.setName('url').setRequired(true)),
    new SlashCommandBuilder().setName("setup_roles").setDescription("Admin: Build rank roles"),
    new SlashCommandBuilder().setName("8ball").setDescription("Ask a question").addStringOption(o => o.setName('q').setRequired(true)),
    new SlashCommandBuilder().setName("roll").setDescription("Roll dice").addStringOption(o => o.setName('d')),
    new SlashCommandBuilder().setName("avatar").setDescription("Get avatar").addUserOption(o => o.setName('t')),
    new SlashCommandBuilder().setName("echo").setDescription("Speak through bot").addStringOption(o => o.setName('m').setRequired(true))
  ].map(c => c.toJSON());

  try {
    console.log("🔄 Syncing Slash Commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Commands Updated Globally");
  } catch (error) { console.error("❌ Command Refresh Failed:", error); }

  console.log(`🔥 OMEGA PRIME ONLINE: ${client.user.tag}`);
});

// --- INTERACTION HANDLER ---
client.on("interactionCreate", async i => {
    try {
        if (i.isChatInputCommand()) {
            if (i.commandName === 'profile') {
                const user = await User.findOneAndUpdate({ userId: i.user.id }, { username: i.user.username }, { upsert: true, new: true });
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
                    await i.editReply({ content: "✅ **6K Render Ready.**", files: [pathOut] });
                } catch (e) { await i.editReply("❌ Render Failed. Ensure python3 and ffmpeg are in Nixpacks."); }
                finally { await fs.unlink(pathIn).catch(()=>{}); await fs.unlink(pathOut).catch(()=>{}); }
            }

            if (i.commandName === "submit") {
                const modal = new ModalBuilder().setCustomId("sub_modal").setTitle("Elite Submission");
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("url").setLabel("Clip Link").setStyle(TextInputStyle.Short).setRequired(true)));
                return i.showModal(modal);
            }

            // Fun & Tools
            if (i.commandName === '8ball') {
                const responses = ["Certainly.", "Maybe.", "Ask later.", "No.", "Absolutely.", "Doubtful."];
                return i.reply(`🎱 **Answer:** ${responses[Math.floor(Math.random() * responses.length)]}`);
            }
        }

        // --- BUTTON LOGIC ---
        if (i.isButton() && i.customId.startsWith("rank_")) {
            const [, score, , targetId] = i.customId.split("_");
            const user = await User.findOne({ userId: targetId }) || await User.create({ userId: targetId, username: "Player" });
            const gain = calculateEloGain(Number(score), user.elo, user.streak);
            const newElo = Math.max(0, user.elo + gain);
            const newStreak = Number(score) >= 8 ? user.streak + 1 : 0;

            await User.updateOne({ userId: targetId }, { $set: { elo: newElo, streak: newStreak }, $max: { peakElo: newElo } });
            const member = await i.guild.members.fetch(targetId).catch(() => null);
            if (member) await applyRank(member, newElo);
            
            return i.update({ content: `✅ Ranked. Change: **${gain > 0 ? "+" : ""}${gain}**`, components: [] });
        }

        if (i.isModalSubmit() && i.customId === "sub_modal") {
            const url = i.fields.getTextInputValue("url");
            const reviewCh = await client.channels.fetch(process.env.REVIEW_CHANNEL_ID);
            const row = new ActionRowBuilder().addComponents(
                [4, 7, 10].map(s => new ButtonBuilder().setCustomId(`rank_${s}_${uuidv4().slice(0,4)}_${i.user.id}`).setLabel(`Score: ${s}`).setStyle(s === 10 ? ButtonStyle.Success : ButtonStyle.Primary))
            );
            await reviewCh.send({ content: `📥 **Submission: <@${i.user.id}>**\nLink: ${url}`, components: [row] });
            return i.reply({ content: "🚀 Sent for Review.", ephemeral: true });
        }
    } catch (err) { console.error("Interaction Crash Protected:", err); }
});

client.on("guildMemberAdd", async (m) => {
    await User.findOneAndUpdate({ userId: m.id }, { username: m.user.username, elo: 1000 }, { upsert: true }).catch(() => {});
    await applyRank(m, 1000);
});

const app = express();
app.get("/", (req, res) => res.send("Omega System Online"));
app.listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
