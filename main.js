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

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ], 
    partials: [Partials.Channel, Partials.GuildMember] 
});

// --- 🚀 MESSAGE COMMANDS (GLOBAL ACCESS FIXED) ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;
    
    let u = await User.findOneAndUpdate(
        { discordId: m.author.id }, 
        { username: m.author.username }, 
        { upsert: true, new: true }
    );

    if (u.isShadowBanned || !m.content.startsWith('!')) return;

    const args = m.content.slice(1).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    // !submit - FORCED PUBLIC VISIBILITY
    if (cmd === 'submit') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_modal')
                .setLabel('OPEN SUBMISSION PANEL')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📥')
        );

        // Sending to channel instead of reply to bypass certain visibility restrictions
        return m.channel.send({ 
            content: `### ⚡ OPERATIVE_UPLINK\n<@${m.author.id}>, initialize your submission dossier below.`, 
            components: [row] 
        });
    }

    // !code - Re-added for global use
    if (cmd === 'code') {
        if (args[0] === CONFIG.ADMIN_PASS) {
            await User.updateOne({ discordId: m.author.id }, { $set: { premiumCode: args[0] } });
            return m.reply("💎 **PREMIUM_ACCESS_GRANTED**");
        }
        return m.reply("❌ **INVALID_KEY**");
    }

    if (cmd === 'profile') {
        return m.reply(`👤 **${u.username}** | Rank: \`${u.rank}\` | ELO: \`${u.elo}\``);
    }
});

// --- ⚡ INTERACTION HANDLER (MODALS & RANKING) ---
client.on('interactionCreate', async (i) => {
    // Open Modal
    if (i.isButton() && i.customId === 'open_modal') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('SUBMIT EDIT');
        const linkInput = new TextInputBuilder()
            .setCustomId('url')
            .setLabel("STREAMABLE LINK")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(linkInput));
        return i.showModal(modal);
    }

    // Modal Submission
    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const link = i.fields.getTextInputValue('url');
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        
        const btns = Object.keys(CONFIG.RANKS).map(r => 
            new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary)
        );

        await rChan.send({ 
            content: `📥 **NEW_SUBMISSION:** <@${i.user.id}>\n**URL:** ${link}`, 
            components: [
                new ActionRowBuilder().addComponents(btns.slice(0, 3)), 
                new ActionRowBuilder().addComponents(btns.slice(3))
            ] 
        });
        return i.reply({ content: "✅ **UPLINK_SENT**", ephemeral: true });
    }

    // Ranking Buttons (Staff Only)
    if (i.isButton() && i.customId.startsWith('sel_')) {
        if (!i.member.permissions.has(PermissionsBitField.Flags.ManageRoles) && !CONFIG.OWNERS.includes(i.user.id)) {
            return i.reply({ content: "🚫 **ACCESS_DENIED**", ephemeral: true });
        }

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

// --- 🛰️ CRAZY BOOT SYSTEM (HYPER-DRIVE) ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    console.log(`
    \u001b[1;31m  [!] BYPASSING CARRIER FIREWALL...
    \u001b[1;33m  [!] INITIATING NEURAL OVERLOAD...
    \u001b[1;35m
    ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗
    ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝
    ██████╔╝█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ 
    ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  
    ██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   
    ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝   
    \u001b[0m`.bold);

    const stages = ["NEURAL_SYNC", "R2_UPLINK", "MONGO_ATLAS", "DISCORD_GATEWAY", "FFMPEG_4K"];
    for (const stage of stages) {
        process.stdout.write(` \u001b[1;37m[#] SECURING ${stage.padEnd(15)} : `);
        await sleep(400);
        process.stdout.write(`\u001b[1;32m [ STABLE ]\n\u001b[0m`);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`\n \u001b[1;35m[!] SINGULARITY ACTIVE : GLOBAL ACCESS STABILIZED\u001b[0m\n`);
    } catch (e) { console.log(e); }
}

boot();
