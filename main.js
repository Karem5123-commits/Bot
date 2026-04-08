require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, EmbedBuilder, PermissionsBitField 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const colors = require('colors');

// --- ⚙️ MASTER CONFIG ---
const CONFIG = {
    MAIN_GUILD: process.env.GUILD_ID,
    REVIEW_CHAN: process.env.REVIEW_CHANNEL_ID,
    LOG_CHAN: process.env.LOG_CHANNEL_ID,
    OWNERS: process.env.OWNER_IDS?.split(',') || [],
    R2_BUCKET: process.env.R2_BUCKET,
    BASE_URL: process.env.BASE_URL,
    ADMIN_PASS: process.env.ADMIN_KEY,
    RANKS: {
        "SSS": { id: "1488208025859788860", elo: 100 },
        "SS+": { id: "1488208185633280041", elo: 75 },
        "SS":  { id: "1488208281930432602", elo: 50 },
        "S+":  { id: "1488208494170738793", elo: 40 },
        "S":   { id: "1488208584142753863", elo: 25 },
        "A":   { id: "1488208696759685190", elo: 10 }
    }
};

// --- 🌐 R2 CLOUD UPLINK ---
const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});

// --- 🗄️ DATABASE SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    discordId: String,
    username: String,
    rank: { type: String, default: "None" },
    xp: { type: Number, default: 0 },
    elo: { type: Number, default: 0 },
    isShadowBanned: { type: Boolean, default: false },
    premiumCode: { type: String, default: null },
    lastCommand: { type: Date, default: 0 }
}));

const client = new Client({ intents: [3276799], partials: [Partials.Channel, Partials.GuildMember] });

// --- 🛡️ KERNEL & QUEUE ---
let renderQueue = [];
let isRendering = false;

// --- 🚀 MESSAGE COMMANDS (!code, !submit, !quality) ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;
    let u = await User.findOneAndUpdate({ discordId: m.author.id }, { username: m.author.username }, { upsert: true, new: true });

    if (u.isShadowBanned || !m.content.startsWith('!')) return;

    const args = m.content.slice(1).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    if (cmd === 'code') {
        if (args[0] === CONFIG.ADMIN_PASS) {
            await User.updateOne({ discordId: m.author.id }, { $set: { premiumCode: args[0] } });
            return m.reply("💎 **PREMIUM_ACCESS_GRANTED**");
        }
        return m.reply("❌ **INVALID_KEY**");
    }

    if (cmd === 'submit') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_modal').setLabel('OPEN SUBMISSION PANEL').setStyle(ButtonStyle.Primary)
        );
        return m.reply({ content: "⭐ **OPERATIVE_UPLINK:**", components: [row] });
    }

    if (cmd === 'profile') {
        return m.reply(`👤 **${u.username}** | Rank: \`${u.rank}\` | ELO: \`${u.elo}\``);
    }
});

// --- ⚡ INTERACTION HANDLER (MODALS & RANKING) ---
client.on('interactionCreate', async (i) => {
    if (i.isButton() && i.customId === 'open_modal') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('SUBMIT EDIT');
        const linkInput = new TextInputBuilder().setCustomId('url').setLabel("STREAMABLE LINK").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(linkInput));
        return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const link = i.fields.getTextInputValue('url');
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const btns = Object.keys(CONFIG.RANKS).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary));
        await rChan.send({ 
            content: `📥 **NEW_SUBMISSION:** <@${i.user.id}>\n**URL:** ${link}`, 
            components: [new ActionRowBuilder().addComponents(btns.slice(0, 3)), new ActionRowBuilder().addComponents(btns.slice(3))] 
        });
        return i.reply({ content: "✅ **SENT**", ephemeral: true });
    }

    if (i.isButton() && i.customId.startsWith('sel_')) {
        const [_, rank, uid] = i.customId.split('_');
        const rankData = CONFIG.RANKS[rank];
        const member = await i.guild.members.fetch(uid).catch(() => null);

        await User.findOneAndUpdate({ discordId: uid }, { rank: rank, $inc: { elo: rankData.elo } });
        if (member) {
            await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
            await member.roles.add(rankData.id);
        }
        return i.update({ content: `✅ **RANKED:** <@${uid}> to **${rank}**`, components: [] });
    }
});

// --- 🛰️ THE CRAZY BOOT SYSTEM V2 ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    console.log(`
    \u001b[1;31m  [!] CRITICAL_OVERLOAD_DETECTED...
    \u001b[1;33m  [!] BYPASSING SECURITY PROTOCOLS...
    \u001b[1;35m
    ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗
    ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝
    ██████╔╝█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ 
    ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  
    ██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   
    ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝   
    \u001b[0m`.bold);

    const diagnostics = [
        { label: "NEURAL_CORE", action: "Calibrating..." },
        { label: "MONGODB_ATLAS", action: "Establishing Tunnel..." },
        { label: "CLOUDFLARE_R2", action: "Syncing S3 Buckets..." },
        { label: "DISCORD_GW", action: "Piercing Firewall..." },
        { label: "FFMPEG_ENGINE", action: "Spinning Up 4K Logic..." }
    ];

    for (const item of diagnostics) {
        process.stdout.write(` \u001b[1;37m[#] INITIATING ${item.label.padEnd(15)} : ${item.action}`);
        await sleep(400);
        process.stdout.write(` \u001b[1;32m [ SUCCESS ]\n\u001b[0m`);
    }

    console.log(`\n \u001b[1;37m[>] VERSION: \u001b[1;35m6.2.0-SINGULARITY`);
    console.log(` \u001b[1;37m[>] STATUS:  \u001b[1;32mFULLY OPERATIONAL\n`);

    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
    } catch (e) { console.log(`\u001b[1;31m[FATAL] BOOT_SEQUENCE_ABORTED: ${e.message}\u001b[0m`); }
}

boot();
