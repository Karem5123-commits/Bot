require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const colors = require('colors');

// --- ⚙️ MASTER CONFIG (SYNCED TO YOUR RAILWAY ENVS) ---
const CONFIG = {
    MAIN_GUILD: process.env.GUILD_ID,
    REVIEW_GUILD: process.env.REVIEW_GUILD,
    REVIEW_CHAN: process.env.REVIEW_CHANNEL_ID,
    LOG_CHAN: process.env.LOG_CHANNEL_ID,
    OWNERS: process.env.OWNER_IDS?.split(',') || [],
    R2_BUCKET: process.env.R2_BUCKET,
    BASE_URL: process.env.BASE_URL,
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
    premiumCode: { type: String, default: null },
    isShadowBanned: { type: Boolean, default: false },
    flags: { type: Number, default: 0 },
    lastSeen: { type: Date, default: Date.now },
    lastCommand: { type: Date, default: 0 }
}));

// --- 🛡️ THE KERNEL ---
let renderQueue = [];
let isRendering = false;

const Kernel = {
    log: (type, msg) => console.log(`[${type}]`.magenta.bold + ` > `.white + `${msg}`.cyan),
    
    // Security check for command spam
    checkSpam: async (u, m) => {
        if (CONFIG.OWNERS.includes(m.author.id)) return false;
        const now = Date.now();
        if (now - u.lastCommand < 2000) return true;
        u.lastCommand = now;
        await u.save();
        return false;
    },

    processQueue: async () => {
        if (isRendering || renderQueue.length === 0) return;
        isRendering = true;
        const job = renderQueue.shift();
        const fileName = `export_${Date.now()}.mp4`;
        const localPath = `./${fileName}`;

        ffmpeg(job.att.url)
            .outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 16", "-preset ultrafast"])
            .on('end', async () => {
                try {
                    await r2.send(new PutObjectCommand({ Bucket: CONFIG.R2_BUCKET, Key: fileName, Body: fs.readFileSync(localPath), ContentType: 'video/mp4' }));
                    const url = `${CONFIG.BASE_URL}/${fileName}`;
                    await job.m.author.send({ content: `✅ **RENDER_READY:** ${url}` });
                    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                } catch (e) { Kernel.log("R2_ERR", e.message); }
                isRendering = false; Kernel.processQueue();
            }).save(localPath);
    }
};

// --- 🚀 DISCORD ENGINE ---
const client = new Client({ intents: [3276799], partials: [Partials.Channel, Partials.GuildMember] });

client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;
    let u = await User.findOneAndUpdate({ discordId: m.author.id }, { username: m.author.username }, { upsert: true, new: true });
    
    if (u.isShadowBanned) return;
    if (!m.content.startsWith('!')) return;
    if (await Kernel.checkSpam(u, m)) return;

    const args = m.content.slice(1).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    // --- 📥 ORIGINAL !submit ---
    if (cmd === 'submit') {
        const att = m.attachments.first();
        if (!att) return m.reply("🚫 **ATTACH_FILE**");
        const reviewChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const row = new ActionRowBuilder().addComponents(
            Object.keys(CONFIG.RANKS).map(rank => new ButtonBuilder().setCustomId(`sel_${rank}_${m.author.id}`).setLabel(rank).setStyle(ButtonStyle.Secondary))
        );
        await reviewChan.send({ content: `📥 **SUBMISSION:** ${m.author.tag}`, files: [att.url], components: [row] });
        return m.reply("✅ **SENT**");
    }

    // --- 📽️ ORIGINAL !quality (NOW WITH R2) ---
    if (cmd === 'quality') {
        const att = m.attachments.first();
        if (!att) return m.reply("🚫 **NO_FILE**");
        const status = await m.reply("⏳ **QUEUED**");
        renderQueue.push({ m, att, fileSize: att.size, isPremium: !!u.premiumCode, statusMsg: status });
        Kernel.processQueue();
    }

    // --- 💎 ORIGINAL !code ---
    if (cmd === 'code') {
        if (args[0] === process.env.ADMIN_KEY) {
            await User.updateOne({ discordId: m.author.id }, { premiumCode: args[0] });
            return m.reply("⭐ **PREMIUM_ACTIVE**");
        }
    }

    // --- 📊 NEW META CMDS ---
    if (cmd === 'profile') m.reply(`👤 **${u.username}** | ELO: \`${u.elo}\` | Rank: \`${u.rank}\``);
    if (cmd === 'bet') {
        const amt = parseInt(args[0]);
        if (isNaN(amt) || u.elo < amt) return m.reply("❌ **NO_ELO**");
        const win = Math.random() > 0.55;
        await User.updateOne({ discordId: m.author.id }, { $inc: { elo: win ? amt : -amt } });
        m.reply(win ? `✅ +${amt}` : `💀 -${amt}`);
    }
});

// --- ⚡ YOUR ORIGINAL RANKING SYSTEM (TOUCH-PROOF) ---
client.on('interactionCreate', async (i) => {
    if (!i.isButton()) return;
    const [action, rank, uid] = i.customId.split('_');
    if (action === 'sel') {
        const reward = CONFIG.RANKS[rank].elo;
        await User.findOneAndUpdate({ discordId: uid }, { rank: rank, $inc: { elo: reward } });
        await i.update({ content: `✅ **${rank}** applied (+${reward} ELO)`, components: [] });
        const log = client.channels.cache.get(CONFIG.LOG_CHAN);
        if (log) log.send(`🛡️ **RANKUP:** <@${uid}> set to **${rank}** by ${i.user.tag}`);
    }
});

// --- 🛰️ UPGRADED BOOT ---
async function boot() {
    console.clear();
    console.log(`\u001b[1;35m  █████╗ ██████╗  ██████╗██╗  ██╗██╗████████╗\n \u001b[1;36m ██╔══██╗██╔══██╗██╔════╝██║  ██║██║╚══██╔══╝\n \u001b[1;34m ███████║██████╔╝██║     ███████║██║   ██║   \u001b[0m`.bold);
    
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`\n \u001b[1;32m[!] CORE STABLE. RANKING SYSTEM SECURED. \u001b[0m\n`);
    } catch (e) { console.log(e); }
}
boot();
