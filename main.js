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

// Commands Logic (Same as before, perfectly combined)
const commands = [
    new SlashCommandBuilder().setName('quality_method').setDescription('6K Ultra-Render Engine').addStringOption(o => o.setName('url').setRequired(true)),
    new SlashCommandBuilder().setName('nuke').setDescription('OWNER: Atomize and reconstruct channel'),
    new SlashCommandBuilder().setName('profile').setDescription('View ELO, Rank, and Stats'),
    new SlashCommandBuilder().setName('quarantine').setDescription('Lockdown a user').addUserOption(o => o.setName('target').setRequired(true)),
    new SlashCommandBuilder().setName('rank_adjust').setDescription('OWNER: Adjust ELO').addUserOption(o => o.setName('target').setRequired(true)).addIntegerOption(o => o.setName('delta').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Purge messages').addIntegerOption(o => o.setName('amount').setRequired(true))
].map(c => c.toJSON());

client.once('ready', async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
        console.log(`🚀 OMEGA PRIME ONLINE | Overlord: ${client.user.tag}`);
    } catch (err) {
        console.error("Setup Error:", err);
    }
});

client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    const isOwner = OWNERS.includes(i.user.id);
    const { commandName, options, guild, channel } = i;

    if (commandName === 'nuke') {
        if (!isOwner) return i.reply({ content: "❌ Level 5 Clearance Required.", ephemeral: true });
        const pos = channel.position;
        const newCh = await channel.clone();
        await channel.delete();
        await newCh.setPosition(pos);
        return;
    }

    if (commandName === 'quality_method') {
        await i.deferReply();
        const url = options.getString('url');
        const id = uuidv4();
        const pathIn = `/tmp/in_${id}.mp4`; // Using /tmp for Railway compatibility
        const pathOut = `/tmp/out_${id}.mp4`;

        try {
            await ytdl(url, { output: pathIn });
            await new Promise((res, rej) => {
                ffmpeg(pathIn)
                    .videoFilters("scale=3240:4050:flags=lanczos,unsharp=6:6:1.2:6:6:0.0,hqdn3d=1.5:1.5:4:4")
                    .outputOptions(['-c:v libx264', '-crf 12', '-preset slower', '-pix_fmt yuv420p'])
                    .save(pathOut).on('end', res).on('error', rej);
            });
            await i.editReply({ content: "✅ **Render Complete.**", files: [pathOut] });
        } catch (e) { 
            console.error(e);
            await i.editReply("❌ **Engine Failure.** Check source URL."); 
        } finally { 
            await fs.unlink(pathIn).catch(()=>{}); 
            await fs.unlink(pathOut).catch(()=>{}); 
        }
    }

    if (commandName === 'profile') {
        const data = await User.findOne({ userId: i.user.id }) || await User.create({ userId: i.user.id, username: i.user.username });
        const embed = new EmbedBuilder().setTitle(`👤 ${i.user.username}'s Profile`).setColor("Gold").addFields(
            { name: 'ELO', value: `\`${data.elo}\``, inline: true },
            { name: 'Rank', value: `\`${data.rank}\``, inline: true }
        );
        return i.reply({ embeds: [embed] });
    }
    
    // ... rest of your ranking/quarantine commands here
});

// CRITICAL RAILWAY BINDING
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Status: Online'));
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Health check live on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
