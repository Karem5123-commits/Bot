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

const OWNERS = process.env.OWNER_IDS.split(',').map(id => id.trim());

// --- COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder().setName('quality_method').setDescription('6K Ultra-Render Engine').addStringOption(o => o.setName('url').setRequired(true)),
    new SlashCommandBuilder().setName('nuke').setDescription('OWNER: Atomize and reconstruct channel'),
    new SlashCommandBuilder().setName('profile').setDescription('View ELO, Rank, and Stats'),
    new SlashCommandBuilder().setName('quarantine').setDescription('Lockdown a user').addUserOption(o => o.setName('target').setRequired(true)),
    new SlashCommandBuilder().setName('rank_adjust').setDescription('OWNER: Adjust ELO').addUserOption(o => o.setName('target').setRequired(true)).addIntegerOption(o => o.setName('delta').setRequired(true)),
    new SlashCommandBuilder().setName('clear').setDescription('Purge messages').addIntegerOption(o => o.setName('amount').setRequired(true)),
    new SlashCommandBuilder().setName('leaderboard').setDescription('View Top 10 Elite Players')
].map(c => c.toJSON());

// --- ON READY ---
client.once('ready', async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log(`🚀 OMEGA PRIME ONLINE | Overlord: ${client.user.tag}`);
});

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;
    const isOwner = OWNERS.includes(i.user.id);
    const { commandName, options, guild, channel } = i;

    // 1. ATOMIC NUKE
    if (commandName === 'nuke') {
        if (!isOwner) return i.reply({ content: "❌ Clearance Level 5 Required.", ephemeral: true });
        const pos = channel.position;
        const newCh = await channel.clone();
        await channel.delete();
        await newCh.setPosition(pos);
        return;
    }

    // 2. QUALITY ENGINE (FFMPEG PRO)
    if (commandName === 'quality_method') {
        await i.deferReply();
        const url = options.getString('url');
        const id = uuidv4();
        const pathIn = `./in_${id}.mp4`;
        const pathOut = `./out_${id}.mp4`;

        try {
            await ytdl(url, { output: pathIn });
            await new Promise((res, rej) => {
                ffmpeg(pathIn)
                    .videoFilters("scale=3240:4050:flags=lanczos,unsharp=6:6:1.2:6:6:0.0,hqdn3d=1.5:1.5:4:4")
                    .outputOptions(['-c:v libx264', '-crf 12', '-preset slower', '-pix_fmt yuv420p'])
                    .save(pathOut).on('end', res).on('error', rej);
            });
            await i.editReply({ content: "✅ **Render Complete.** Highest quality achieved.", files: [pathOut] });
        } catch (e) { 
            await i.editReply("❌ **Engine Failure.** Check source URL."); 
        } finally { 
            await fs.unlink(pathIn).catch(()=>{}); 
            await fs.unlink(pathOut).catch(()=>{}); 
        }
    }

    // 3. ELO PROFILE
    if (commandName === 'profile') {
        const data = await User.findOne({ userId: i.user.id }) || await User.create({ userId: i.user.id, username: i.user.username });
        const embed = new EmbedBuilder()
            .setTitle(`👤 ${i.user.username}'s Profile`)
            .setColor("Gold")
            .addFields(
                { name: 'ELO Score', value: `\`${data.elo}\``, inline: true },
                { name: 'Rank', value: `\`${data.rank}\``, inline: true },
                { name: 'Enhanced Clips', value: `\`${data.stats.enhanced}\``, inline: true }
            );
        return i.reply({ embeds: [embed] });
    }

    // 4. QUARANTINE
    if (commandName === 'quarantine') {
        if (!isOwner && !i.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) return i.reply("❌ Access Denied.");
        const target = options.getMember('target');
        let role = guild.roles.cache.find(r => r.name === 'Quarantined');
        if (!role) role = await guild.roles.create({ name: 'Quarantined', color: 'DarkRed', permissions: [] });
        await target.roles.add(role);
        return i.reply(`🚫 **Target Quarantined.** Permissions revoked.`);
    }

    // 5. RANK ADJUST (ELO MATH)
    if (commandName === 'rank_adjust') {
        if (!isOwner) return i.reply("❌ Level 4 Clearance Required.");
        const target = options.getUser('target');
        const delta = options.getInteger('delta');
        const data = await User.findOneAndUpdate({ userId: target.id }, { $inc: { elo: delta } }, { upsert: true, new: true });
        return i.reply(`🏆 Updated **${target.username}**. New ELO: \`${data.elo}\` (${delta > 0 ? '+' : ''}${delta})`);
    }
});

// --- WEB SERVER ---
const app = express();
app.get('/', (req, res) => res.send('Omega Overlord is Active'));
app.listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
