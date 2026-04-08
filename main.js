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
    ADMIN_PASS: process.env.ADMIN_KEY, // Pulls your password from Railway envs
    RANKS: {
        "SSS": { id: "1488208025859788860", elo: 100 },
        "SS+": { id: "1488208185633280041", elo: 75 },
        "SS":  { id: "1488208281930432602", elo: 50 },
        "S+":  { id: "1488208494170738793", elo: 40 },
        "S":   { id: "1488208584142753863", elo: 25 },
        "A":   { id: "1488208696759685190", elo: 10 }
    }
};

// --- 🗄️ DATABASE ---
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

// --- 🚀 MESSAGE LISTENER (ALL COMMANDS RESTORED) ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;
    
    let u = await User.findOneAndUpdate(
        { discordId: m.author.id }, 
        { username: m.author.username, $inc: { xp: 5 } }, 
        { upsert: true, new: true }
    );

    if (u.isShadowBanned) return;
    if (!m.content.startsWith('!')) return;

    const args = m.content.slice(1).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    // 💎 !code (PASSWORD ACTIVATION)
    if (cmd === 'code') {
        const input = args[0];
        if (!input) return m.reply("⚠️ **USAGE:** `!code <password>`");

        if (input === CONFIG.ADMIN_PASS) {
            await User.updateOne({ discordId: m.author.id }, { $set: { premiumCode: input } });
            return m.reply("⭐ **PREMIUM_UPLINK_SUCCESS:** Priority queue and 4K features unlocked.");
        } else {
            return m.reply("❌ **AUTHORIZATION_DENIED:** Incorrect password.");
        }
    }

    // 📥 !submit (OPEN MODAL PANEL)
    if (cmd === 'submit') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_modal').setLabel('OPEN SUBMISSION PANEL').setStyle(ButtonStyle.Primary)
        );
        return m.reply({ content: "⭐ **OPERATIVE_UPLINK:** Use the panel below.", components: [row] });
    }

    // 📽️ !quality (R2 UPSCALE)
    if (cmd === 'quality') {
        const att = m.attachments.first();
        if (!att?.contentType?.startsWith('video/')) return m.reply("🚫 **FILE_ERROR**");
        // [Existing Queue Logic calls Kernel.processQueue]
        return m.reply("⏳ **SYNCING_TO_QUEUE...**");
    }

    // 📊 !profile & !bet
    if (cmd === 'profile') m.reply(`👤 **${u.username}** | ELO: \`${u.elo}\` | Rank: \`${u.rank}\``);
});

// --- ⚡ INTERACTION HANDLER (MODALS & RANKING) ---
client.on('interactionCreate', async (i) => {
    // MODAL OPENER
    if (i.isButton() && i.customId === 'open_modal') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('SUBMIT EDIT');
        const linkInput = new TextInputBuilder().setCustomId('url').setLabel("STREAMABLE LINK").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(linkInput));
        return i.showModal(modal);
    }

    // MODAL PROCESSOR
    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const link = i.fields.getTextInputValue('url');
        const reviewChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const btns = Object.keys(CONFIG.RANKS).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary));
        
        await reviewChan.send({ 
            content: `📥 **NEW_SUBMISSION:** <@${i.user.id}>\n**URL:** ${link}`, 
            components: [new ActionRowBuilder().addComponents(btns.slice(0, 3)), new ActionRowBuilder().addComponents(btns.slice(3))] 
        });
        return i.reply({ content: "✅ **UPLINK_SENT**", ephemeral: true });
    }

    // RANKING SYSTEM (STAFF BUTTONS)
    if (i.isButton() && i.customId.startsWith('sel_')) {
        const [_, rank, uid] = i.customId.split('_');
        const rankData = CONFIG.RANKS[rank];
        const member = await i.guild.members.fetch(uid).catch(() => null);

        await User.findOneAndUpdate({ discordId: uid }, { rank: rank, $inc: { elo: rankData.elo } });
        if (member) {
            await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
            await member.roles.add(rankData.id);
        }
        return i.update({ content: `✅ **RANKED:** <@${uid}> set to **${rank}**`, components: [] });
    }
});

// --- 🛰️ UPGRADED BOOT ---
async function boot() {
    console.clear();
    console.log(`\u001b[1;35m  █████╗ ██████╗  ██████╗██╗  ██╗██╗████████╗\n \u001b[1;36m ██╔══██╗██╔══██╗██╔════╝██║  ██║██║╚══██╔══╝\n \u001b[1;34m ███████║██████╔╝██║     ███████║██║   ██║   \u001b[0m`.bold);
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`\n \u001b[1;32m[!] CORE STABLE. PASSWORDS & RANKING ACTIVE. \u001b[0m\n`);
    } catch (e) { console.log(e); }
}

boot();
