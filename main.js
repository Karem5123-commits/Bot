require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const colors = require('colors');

// --- ⚙️ MASTER CONFIGURATION (SYNCED TO RAILWAY) ---
const CONFIG = {
    MAIN_GUILD: process.env.GUILD_ID,
    REVIEW_GUILD: process.env.REVIEW_GUILD,
    REVIEW_CHAN: process.env.REVIEW_CHANNEL_ID,
    LOG_CHAN: process.env.LOG_CHANNEL_ID,
    OWNERS: process.env.OWNER_IDS?.split(',') || [],
    R2_BUCKET: process.env.R2_BUCKET,
    BASE_URL: process.env.BASE_URL,
    DOUBLE_ELO: false,   
    GLITCH_EVENT: false,
    RANKS: {
        "SSS": { id: "1488208025859788860", elo: 100 },
        "SS+": { id: "1488208185633280041", elo: 75 },
        "SS":  { id: "1488208281930432602", elo: 50 },
        "S+":  { id: "1488208494170738793", elo: 40 },
        "S":   { id: "1488208584142753863", elo: 25 },
        "A":   { id: "1488208696759685190", elo: 10 }
    }
};

// --- 🌐 R2 CLOUD STORAGE ---
const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY }
});

// --- 🗄️ MASTER DATABASE ---
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
    lastCommand: { type: Date, default: 0 },
    signatures: [{ tags: [String], motionProfile: String }]
}));

// --- 🛡️ THE KERNEL (SECURITY, QUEUE, NEURAL) ---
let renderQueue = [];
let isRendering = false;

const Kernel = {
    log: (type, msg) => console.log(`[${type}]`.magenta.bold + ` > `.white + `${msg}`.cyan),

    checkSpam: async (u, m) => {
        if (CONFIG.OWNERS.includes(m.author.id)) return false;
        const now = Date.now();
        if (now - u.lastCommand < 2500) { // 2.5s Rate Limit
            u.flags += 1;
            if (u.flags >= 10) u.isShadowBanned = true;
            await u.save();
            return true;
        }
        u.lastCommand = now;
        await u.save();
        return false;
    },

    uploadR2: async (path, name) => {
        await r2.send(new PutObjectCommand({ Bucket: CONFIG.R2_BUCKET, Key: name, Body: fs.readFileSync(path), ContentType: 'video/mp4' }));
        return `${CONFIG.BASE_URL}/${name}`;
    },

    processQueue: async () => {
        if (isRendering || renderQueue.length === 0) return;
        isRendering = true;
        
        renderQueue.sort((a, b) => (b.isPremium - a.isPremium) || (a.fileSize - b.fileSize));
        const job = renderQueue.shift();
        const fileName = `sig_${Date.now()}.mp4`;
        const localPath = `./${fileName}`;

        ffmpeg(job.att.url)
            .outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 16", "-preset ultrafast"])
            .on('end', async () => {
                try {
                    const url = await Kernel.uploadR2(localPath, fileName);
                    const embed = new EmbedBuilder().setColor(0x00FFFF).setTitle('💎 NEURAL_EXPORT_STABLE').setDescription(`**Uplink Complete.**\n🔗 [Download/View Render](${url})`);
                    await job.m.author.send({ embeds: [embed] });
                    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                } catch (e) { Kernel.log("CLOUD_ERR", e.message); }
                isRendering = false; Kernel.processQueue();
            }).save(localPath);
    }
};

// --- 🚀 DISCORD ENGINE ---
const client = new Client({ intents: [3276799], partials: [Partials.Channel, Partials.GuildMember] });

client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;
    let u = await User.findOneAndUpdate({ discordId: m.author.id }, { username: m.author.username, lastSeen: Date.now() }, { upsert: true, new: true });
    
    if (u.isShadowBanned) return;
    if (!m.content.startsWith('!')) return;
    if (await Kernel.checkSpam(u, m)) return;

    const args = m.content.slice(1).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    if (cmd === 'quality') {
        const att = m.attachments.first();
        if (!att?.contentType?.startsWith('video/')) return m.reply("🚫 **INVALID_DATA_STREAM**");
        const status = await m.reply(`⏳ **SYNCING_TO_R2_ADAPTIVE_QUEUE...**`);
        renderQueue.push({ m, att, fileSize: att.size, isPremium: !!u.premiumCode, statusMsg: status });
        Kernel.processQueue();
    }

    if (cmd === 'bet') {
        const amt = Math.floor(parseInt(args[0]));
        if (isNaN(amt) || u.elo < amt) return m.reply("❌ **INSUFFICIENT_ELO**");
        const win = Math.random() > 0.55;
        await User.updateOne({ discordId: m.author.id }, { $inc: { elo: win ? amt : -amt } });
        m.reply(win ? `✅ **WIN:** +${amt} ELO` : `💀 **LOSS:** -${amt} ELO`);
    }

    if (cmd === 'profile') {
        const embed = new EmbedBuilder().setColor(0x00FFFF).setTitle(`👤 OPERATIVE: ${m.author.username}`).addFields({ name: '📊 DATA', value: `Rank: **${u.rank}**\nELO: \`${u.elo}\`\nFlags: \`${u.flags}\`` });
        m.reply({ embeds: [embed] });
    }
});

// --- 🛰️ UPGRADED SINGULARITY BOOT SYSTEM ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    console.log(`
    \u001b[1;35m  █████╗ ██████╗  ██████╗██╗  ██╗██╗████████╗███████╗ ██████╗████████╗
    \u001b[1;35m ██╔══██╗██╔══██╗██╔════╝██║  ██║██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝
    \u001b[1;36m ███████║██████╔╝██║     ███████║██║   ██║   █████╗  ██║        ██║   
    \u001b[1;36m ██╔══██║██╔══██╗██║     ██╔══██║██║   ██║   ██╔══╝  ██║        ██║   
    \u001b[1;34m ██║  ██║██║  ██║╚██████╗██║  ██║██║   ██║   ███████╗╚██████╗   ██║   
    \u001b[1;34m ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝ ╚═════╝   ╚═╝   \u001b[0m
    `.bold);

    const stages = [
        { name: "NEURAL_KERNEL", info: "Checking logic gates..." },
        { name: "CLOUDFLARE_R2", info: "Establishing bucket uplink..." },
        { name: "MONGODB_ATLAS", info: "Syncing operative database..." },
        { name: "DISCORD_API", info: "Connecting to gateway..." }
    ];

    for (const stage of stages) {
        process.stdout.write(` \u001b[1;37m[🔧] ${stage.name.padEnd(15)} : ${stage.info}`);
        await sleep(600);
        process.stdout.write(` \u001b[1;32m[ ONLINE ]\n\u001b[0m`);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`\n \u001b[1;35m[!] SINGULARITY_V6_ACTIVE : SYSTEM_STABLE\u001b[0m\n`);
    } catch (e) {
        console.log(`\n \u001b[1;31m[!] CRITICAL_FAILURE: ${e.message}\u001b[0m`);
    }
}

boot();
