require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, EmbedBuilder, PermissionsBitField, ChannelType 
} = require('discord.js');
const mongoose = require('mongoose');
const colors = require('colors');

// --- ⚙️ MASTER CONFIG ---
const CONFIG = {
    MAIN_GUILD: process.env.GUILD_ID,
    REVIEW_CHAN: process.env.REVIEW_CHANNEL_ID,
    LOG_CHAN: process.env.LOG_CHANNEL_ID,
    OWNERS: process.env.OWNER_IDS?.split(',') || [],
    ADMIN_PASS: process.env.ADMIN_KEY,
    RANKS: {
        "SSS": { id: "1488208025859788860", elo: 100, color: '#FFD700' },
        "SS+": { id: "1488208185633280041", elo: 75, color: '#FFFF00' },
        "SS":  { id: "1488208281930432602", elo: 50, color: '#00FF00' },
        "S+":  { id: "1488208494170738793", elo: 40, color: '#00FFFF' },
        "S":   { id: "1488208584142753863", elo: 25, color: '#FF4500' },
        "A":   { id: "1488208696759685190", elo: 10, color: '#FF00FF' }
    }
};

// Database Schema
const userSchema = new mongoose.Schema({
    discordId: String,
    username: String,
    rank: { type: String, default: "None" },
    xp: { type: Number, default: 0 },
    elo: { type: Number, default: 0 },
    isShadowBanned: { type: Boolean, default: false },
    premiumCode: { type: String, default: null },
    lastCommand: { type: Date, default: 0 }
});
const User = mongoose.model('User', userSchema);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers
    ], 
    partials: [Partials.Channel, Partials.GuildMember] 
});

// --- 🚀 MESSAGE COMMANDS ---
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

    // NEW FEATURE: !build (Professional Server Setup)
    if (cmd === 'build') {
        if (!m.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return m.reply("🚫 **ADMIN_ACCESS_REQUIRED**");
        }

        await m.reply("🏗️ **INITIATING_WORLD_CLASS_CONSTRUCTION...**");

        const guild = m.guild;

        // 1. Create Tier Roles (Syncing with your CONFIG.RANKS)
        for (const [name, data] of Object.entries(CONFIG.RANKS)) {
            const existingRole = guild.roles.cache.get(data.id);
            if (!existingRole) {
                await guild.roles.create({
                    name: name,
                    color: data.color,
                    hoist: true,
                    reason: 'Server Build Initialization'
                });
            }
        }

        // 2. Create Aesthetic Categories and Channels
        const categories = [
            { 
                name: "⌄ INFO", 
                channels: ["📜﹕rules", "📢﹕announcements", "🆙﹕levels"] 
            },
            { 
                name: "⌄ CHAT", 
                channels: ["💬﹕general", "📸﹕media", "✨﹕rank-your-edits"] 
            },
            { 
                name: "⌄ MATERIALS", 
                channels: ["✂️﹕cutouts", "🎁﹕packs", "📱﹕xml-qrs"] 
            }
        ];

        for (const cat of categories) {
            const createdCat = await guild.channels.create({
                name: cat.name,
                type: ChannelType.GuildCategory,
            });

            for (const chan of cat.channels) {
                await guild.channels.create({
                    name: chan,
                    type: ChannelType.GuildText,
                    parent: createdCat.id
                });
            }
        }

        return m.channel.send("✅ **NEURAL_MAP_COMPLETE: Server Architecture Deployed.**");
    }

    // !submit - Submission Panel
    if (cmd === 'submit') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_modal')
                .setLabel('OPEN SUBMISSION PANEL')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📥')
        );
        return m.channel.send({ 
            content: `### ⚡ OPERATIVE_UPLINK\n<@${m.author.id}>, initialize your submission dossier below.`, 
            components: [row] 
        });
    }

    // !code, !profile (Keeping your existing logic)
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

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const link = i.fields.getTextInputValue('url');
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        
        const btns = Object.keys(CONFIG.RANKS).map(r => 
            new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary)
        );

        if (rChan) {
            await rChan.send({ 
                content: `📥 **NEW_SUBMISSION:** <@${i.user.id}>\n**URL:** ${link}`, 
                components: [
                    new ActionRowBuilder().addComponents(btns.slice(0, 3)), 
                    new ActionRowBuilder().addComponents(btns.slice(3))
                ] 
            });
        }
        return i.reply({ content: "✅ **UPLINK_SENT**", ephemeral: true });
    }

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
            const role = i.guild.roles.cache.get(rankData.id);
            if (role) await member.roles.add(role);
        }
        return i.update({ content: `✅ **RANKED:** <@${uid}> to **${rank}**`, components: [] });
    }
});

// --- 🛰️ BOOT SYSTEM ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    console.log(`\u001b[1;31m  [!] BYPASSING CARRIER FIREWALL...\n\u001b[1;32m  [!] OPERATIVE SYSTEM READY\u001b[0m`);

    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`\n \u001b[1;35m[!] SINGULARITY ACTIVE\u001b[0m\n`);
    } catch (e) { console.log(e); }
}

boot();
