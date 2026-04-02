import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder, SlashCommandBuilder, REST, Routes } from 'discord.js';
import mongoose from 'mongoose';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ytdl from 'yt-dlp-exec';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { User } from './models.js';
import express from 'express';

ffmpeg.setFfmpegPath(ffmpegPath);

const client = new Client({ 
    intents: [3276799], 
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember] 
});

const OWNERS = (process.env.OWNER_IDS || "").split(',').map(id => id.trim());

// --- FIXED COMMAND DEFINITIONS (No undefined strings) ---
const commands = [
    new SlashCommandBuilder()
        .setName('quality_method')
        .setDescription('Enhance a video to ultra-high quality settings')
        .addStringOption(o => o.setName('url').setDescription('The video link').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('OWNER ONLY: Atomize and reconstruct the current channel'),
    
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your current ELO, Rank, and personal stats'),
    
    new SlashCommandBuilder()
        .setName('quarantine')
        .setDescription('Lockdown a user and revoke their permissions')
        .addUserOption(o => o.setName('target').setDescription('User to quarantine').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('rank_adjust')
        .setDescription('OWNER ONLY: Manually adjust a users ELO score')
        .addUserOption(o => o.setName('target').setDescription('The user').setRequired(true))
        .addIntegerOption(o => o.setName('delta').setDescription('Amount to change').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Mass delete messages from the channel')
        .addIntegerOption(o => o.setName('amount').setDescription('Number of messages').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Display the top 10 elite players in the server')
].map(c => c.toJSON());

// --- CORE ENGINE ---
client.once('ready', async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("📂 MongoDB Connected");
        
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), 
            { body: commands }
        );
        console.log(`🚀 OMEGA PRIME ONLINE | ${client.user.tag}`);
    } catch (err) {
        console.error("Critical Startup Error:", err);
    }
});

client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    const isOwner = OWNERS.includes(i.user.id);

    // Atomic Nuke
    if (i.commandName === 'nuke') {
        if (!isOwner) return i.reply({ content: "❌ Clearance Level 5 Required.", ephemeral: true });
        const pos = i.channel.position;
        const newCh = await i.channel.clone();
        await i.channel.delete();
        await newCh.setPosition(pos);
    }

    // Quality Engine
    if (i.commandName === 'quality_method') {
        await i.deferReply();
        const url = i.options.getString('url');
        const id = uuidv4();
        const pathIn = `/tmp/in_${id}.mp4`;
        const pathOut = `/tmp/out_${id}.mp4`;

        try {
            await ytdl(url, { output: pathIn });
            await new Promise((res, rej) => {
                ffmpeg(pathIn)
                    .videoFilters("scale=3240:4050:flags=lanczos,unsharp=6:6:1.2:6:6:0.0")
                    .outputOptions(['-c:v libx264', '-crf 12', '-preset fast'])
                    .save(pathOut).on('end', res).on('error', rej);
            });
            await i.editReply({ content: "✅ **Render Complete.**", files: [pathOut] });
        } catch (e) { 
            await i.editReply("❌ **Engine Failure.** Check the link."); 
        } finally { 
            await fs.unlink(pathIn).catch(()=>{}); 
            await fs.unlink(pathOut).catch(()=>{}); 
        }
    }

    // ELO Profile
    if (i.commandName === 'profile') {
        const data = await User.findOne({ userId: i.user.id }) || await User.create({ userId: i.user.id, username: i.user.username });
        const embed = new EmbedBuilder()
            .setTitle(`👤 ${i.user.username}'s Profile`)
            .setColor("Gold")
            .addFields(
                { name: 'ELO Score', value: `\`${data.elo}\``, inline: true },
                { name: 'Rank', value: `\`${data.rank}\``, inline: true }
            );
        return i.reply({ embeds: [embed] });
    }
});

// Railway Health Check
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Omega Bot Active'));
app.listen(PORT, '0.0.0.0');

client.login(process.env.DISCORD_TOKEN);
