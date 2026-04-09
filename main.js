require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes 
} = require('discord.js');
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- ⚙️ CONFIGURATION ---
const CONFIG = {
    CLIENT_ID: "1479871879496994943",
    MAIN_GUILD: "1491541282156449794",
    REVIEW_CHAN: "1489069664414859326",
    STAFF_ROLES: ["1491554076935192637", "1491542435312959529", "1491552861358788608"],
    OWNERS: ["1347959266539081768", "1407316453060907069"],
    RANKS: {
        "Z":   { id: "1491573028931244204", elo: 150, color: '#FFFFFF' },
        "SS":  { id: "1491572938888056904", elo: 100, color: '#FF0000' },
        "S+":  { id: "1491572855400304823", elo: 80, color: '#FFD700' },
        "S":   { id: "1491572750584774747", elo: 60, color: '#FFA500' },
        "A":   { id: "1491572617591652394", elo: 40, color: '#00FF00' },
        "B":   { id: "1491572503221375196", elo: 25, color: '#0000FF' },
        "C":   { id: "1491572406790262994", elo: 10, color: '#808080' }
    }
};

// --- 📊 DATABASE SCHEMAS ---
const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0 },
    lastSubmit: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const QualityCode = mongoose.model('QualityCode', new mongoose.Schema({
    code: { type: String, unique: true },
    used: { type: Boolean, default: false }
}));

// --- ☁️ SERVICES ---
const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// --- 🎭 FEATURE: ROLE PERSISTENCE ---
client.on('guildMemberAdd', async (member) => {
    try {
        const u = await User.findOne({ discordId: member.id });
        if (u && u.rank !== "None") {
            const rId = CONFIG.RANKS[u.rank]?.id;
            if (rId) await member.roles.add(rId);
        }
    } catch (e) { console.error("Persistence Error:", e); }
});

// --- ⚡ INTERACTION ENGINE ---
client.on('interactionCreate', async (i) => {
    // [COMMANDS]
    if (i.isChatInputCommand()) {
        const { commandName } = i;

        if (commandName === 'submit') {
            await i.deferReply({ ephemeral: true }); // FIX: Stops "Not Responding"
            try {
                let u = await User.findOne({ discordId: i.user.id });
                if (!u) u = await User.create({ discordId: i.user.id, username: i.user.username });
                
                if (Date.now() - u.lastSubmit < 300000) return i.editReply("⏳ **COOLDOWN:** 5 minutes.");

                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_modal').setLabel('🚀 START UPLINK').setStyle(ButtonStyle.Primary));
                return i.editReply({ content: "### 💠 ARCHITECT_PORTAL\nReady for transmission.", components: [row] });
            } catch (e) { return i.editReply("❌ DB_ERROR"); }
        }

        if (commandName === 'profile') {
            const u = await User.findOne({ discordId: i.user.id }) || await User.create({ discordId: i.user.id, username: i.user.username });
            const e = new EmbedBuilder().setTitle(`DOSSIER: ${u.username}`).setColor(CONFIG.RANKS[u.rank]?.color || '#FFFFFF')
                .addFields({ name: 'RANK', value: `\`${u.rank}\``, inline: true }, { name: 'ELO', value: `\`${u.elo}\``, inline: true });
            return i.reply({ embeds: [e] });
        }

        if (commandName === 'embed') {
            if (!i.member.roles.cache.some(r => CONFIG.STAFF_ROLES.includes(r.id))) return i.reply({ content: "🚫 UNAUTHORIZED", ephemeral: true });
            const e = new EmbedBuilder().setDescription(i.options.getString('message')).setColor(i.options.getString('color') || '#00FFCC').setTimestamp();
            return i.reply({ embeds: [e] });
        }

        if (commandName === 'code') {
            if (!CONFIG.OWNERS.includes(i.user.id)) return i.reply({ content: "❌ OWNER_ONLY", ephemeral: true });
            const code = crypto.randomBytes(3).toString('hex').toUpperCase();
            await QualityCode.create({ code });
            return i.reply({ content: `🎫 **CODE:** \`${code}\``, ephemeral: true });
        }
    }

    // [BUTTONS & MODALS]
    if (i.isButton() && i.customId.startsWith('rank_')) {
        const [_, type, uid] = i.customId.split('_');
        const member = await i.guild.members.fetch(uid).catch(() => null);
        if (!member) return i.reply({ content: "❌ USER_LEFT", ephemeral: true });

        const u = await User.findOne({ discordId: uid });
        const oldRank = u.rank;
        u.rank = type; u.elo += CONFIG.RANKS[type].elo;
        await u.save();

        await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
        await member.roles.add(CONFIG.RANKS[type].id);

        if (oldRank !== type) {
            const announce = i.guild.channels.cache.find(c => c.name === 'announcements');
            if (announce) announce.send({ embeds: [new EmbedBuilder().setTitle('🚀 PROMOTION').setDescription(`<@${uid}> → **RANK ${type}**`).setColor(CONFIG.RANKS[type].color)] });
        }
        return i.update({ content: `✅ **RANKED:** <@${uid}>`, components: [] });
    }

    if (i.isButton() && i.customId === 'open_modal') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('SUBMIT DATA');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("URL").setStyle(TextInputStyle.Short).setRequired(true)));
        await i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const btns = Object.keys(CONFIG.RANKS).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary));
        const msg = await rChan.send({ 
            content: `📥 **SUBMISSION:** <@${i.user.id}>\n${i.fields.getTextInputValue('url')}`, 
            components: [new ActionRowBuilder().addComponents(btns.slice(0, 4)), new ActionRowBuilder().addComponents(btns.slice(4))] 
        });
        await msg.startThread({ name: `Review: ${i.user.username}` });
        await User.findOneAndUpdate({ discordId: i.user.id }, { lastSubmit: Date.now() });
        return i.reply({ content: "✅ **UPLINK_SUCCESS**", ephemeral: true });
    }
});

// --- 🛰️ THE CRAZY BOOT SYSTEM ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    console.log(`\u001b[1;31m [!] BYPASSING FIREWALL...\u001b[1;33m\n [!] INITIATING NEURAL OVERLOAD...\u001b[1;35m\n ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗\n ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝\n ██████╔╝█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ \n ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  \n ██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   \n ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝\u001b[0m`);

    const stages = ["MONGO_ATLAS", "DISCORD_GATEWAY", "SYNC_GUILD_CMD", "CLOUDFLARE_R2", "FFMPEG_ENGINE"];
    for (const stage of stages) {
        process.stdout.write(` \u001b[1;37m[#] SECURING ${stage.padEnd(16)} : `);
        await sleep(250);
        process.stdout.write(`\u001b[1;32m [ STABLE ]\n\u001b[0m`);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const slash = [
            { name: 'submit', description: 'Initialize edit uplink' },
            { name: 'profile', description: 'View profile' },
            { name: 'code', description: 'Generate quality code' },
            { name: 'embed', description: 'Staff embed', options: [{name:'message',type:3,required:true},{name:'color',type:3}] }
        ];
        await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.MAIN_GUILD), { body: slash });
        console.log(`\n \u001b[1;35m[!] SINGULARITY ACTIVE : Z-TIER ONLINE\u001b[0m\n`);
    } catch (e) { console.error(e); }
}
boot();
