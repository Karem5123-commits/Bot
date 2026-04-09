// NODE_OPTIONS="--enable-source-maps=false"
require('dotenv').config();
require('colors');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { nanoid } = require('nanoid');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const https = require('https');
const PQueue = require('p-queue').default;
const fs = require('fs').promises;
const { createWriteStream } = require('fs');

// --- 💎 SYSTEM CONSTANTS ---
const CONFIG = Object.freeze({
    ID: process.env.CLIENT_ID,
    GUILD: "1491541282156449794",
    REVIEW: "1489069664414859326",
    MAX_SIZE: 50 * 1024 * 1024, // 50MB
    MAX_DUR: 60,        
});

const RANK_DATA = [
    { n: "Z",  id: "1491573028931244204", e: 150, c: 0xFFFFFF },
    { n: "SS", id: "1491572938888056904", e: 100, c: 0xFF0000 },
    { n: "S+", id: "1491572855400304823", e: 80,  c: 0xFFD700 },
    { n: "S",  id: "1491572750584774747", e: 60,  c: 0xFFA500 },
    { n: "A",  id: "1491572617591652394", e: 40,  c: 0x00FF00 },
    { n: "B",  id: "1491572503221375196", e: 25,  c: 0x0000FF },
    { n: "C",  id: "1491572406790262994", e: 10,  c: 0x808080 }
];

const RANK_IDS_SET = new Set(RANK_DATA.map(r => r.id));
const RANK_MAP = Object.fromEntries(RANK_DATA.map((r, i) => [r.n, i]));

// --- 🚀 SINGLETONS ---
const axiosAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });
const jobQueue = new PQueue({ concurrency: 1 }); // Reduced to 1 to prevent CPU thrashing during FFmpeg
const activeJobs = new Set();
const interactionCache = new Set();

const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY },
});

// --- 📊 MODELS ---
const userSchema = new mongoose.Schema({
    discordId: { type: String, index: true, unique: true },
    rank: String, 
    elo: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const QualityCode = mongoose.model('QualityCode', new mongoose.Schema({
    code: { type: String, index: true },
    used: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: '7d' }
}));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] 
});

// --- ⚡ UTILITIES ---
async function probeVideo(url) {
    const tempPath = `./probe_${nanoid(5)}.mp4`;
    const response = await axios({
        url, method: 'GET', responseType: 'stream',
        httpsAgent: axiosAgent, timeout: 10000
    });

    return new Promise((resolve, reject) => {
        const writer = createWriteStream(tempPath);
        let downloaded = 0;
        
        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            writer.write(chunk);
            if (downloaded > 2 * 1024 * 1024) response.data.destroy(); // Buffer 2MB
        });

        response.data.on('close', async () => {
            writer.end();
            const ff = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tempPath]);
            let out = '';
            ff.stdout.on('data', d => out += d);
            ff.on('close', async () => {
                await fs.unlink(tempPath).catch(() => {});
                const dur = parseFloat(out);
                if (isNaN(dur) || dur <= 0) return reject(new Error("Invalid metadata."));
                if (dur > CONFIG.MAX_DUR) return reject(new Error(`Video too long (${dur.toFixed(1)}s).`));
                resolve(true);
            });
        });

        response.data.on('error', reject);
    });
}

// --- 🧠 MASTER ENGINE ---
async function handleQuality(i) {
    const codeIn = i.fields.getTextInputValue('code').trim().toUpperCase();
    const rawUrl = i.fields.getTextInputValue('url').trim();

    if (!rawUrl.startsWith('http')) return i.reply({ content: "❌ Invalid URL.", ephemeral: true });
    if (activeJobs.has(i.user.id)) return i.reply({ content: "⚠️ You already have a job running.", ephemeral: true });

    await i.deferReply({ ephemeral: true });

    try {
        const qCode = await QualityCode.findOne({ code: codeIn, used: false });
        if (!qCode) return i.editReply("❌ Invalid or expired Key.");

        activeJobs.add(i.user.id);
        await probeVideo(rawUrl);

        jobQueue.add(async () => {
            const fileId = nanoid(10);
            const uploadStream = new PassThrough();
            
            const ffmpeg = spawn('ffmpeg', [
                '-i', rawUrl,
                '-vf', 'hqdn3d=1.5:1.5:6:6,unsharp=3:3:0.5:3:3:0.0,scale=1280:-2',
                '-c:v', 'libx264', '-crf', '22', '-preset', 'faster',
                '-c:a', 'aac', '-b:a', '128k', '-f', 'mp4', 'pipe:1'
            ]);

            const uploadPromise = s3.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET,
                Key: `final_${fileId}.mp4`,
                Body: uploadStream,
                ContentType: 'video/mp4'
            }));

            ffmpeg.stdout.pipe(uploadStream);

            try {
                await Promise.all([
                    uploadPromise,
                    new Promise((res, rej) => {
                        ffmpeg.on('close', code => code === 0 ? res() : rej(new Error(`FFmpeg Failed [${code}]`)));
                        ffmpeg.on('error', rej);
                    })
                ]);

                await QualityCode.updateOne({ _id: qCode._id }, { used: true });
                await i.editReply(`✅ **Enhanced:** ${process.env.BASE_URL}/final_${fileId}.mp4`);
            } catch (err) {
                console.error(err);
                await i.editReply(`❌ **Processing Error:** ${err.message}`);
            } finally {
                activeJobs.delete(i.user.id);
                if (!ffmpeg.killed) ffmpeg.kill();
            }
        });

    } catch (err) {
        activeJobs.delete(i.user.id);
        await i.editReply(`❌ **Pre-flight Error:** ${err.message}`);
    }
}

// --- 🎖️ RANKING ---
async function handleRanking(i) {
    const parts = i.customId.split('_'); // rank_TYPE_UID
    const type = parts[1];
    const uid = parts[2];
    const rankInfo = RANK_DATA[RANK_MAP[type]];

    await i.deferUpdate();
    
    await User.findOneAndUpdate(
        { discordId: uid }, 
        { $inc: { elo: rankInfo.e }, $set: { rank: type } }, 
        { upsert: true }
    );

    const guild = i.guild;
    try {
        const member = await guild.members.fetch(uid);
        const rolesToRemove = member.roles.cache.filter(r => RANK_IDS_SET.has(r.id) && r.id !== rankInfo.id);
        if (rolesToRemove.size) await member.roles.remove(rolesToRemove);
        await member.roles.add(rankInfo.id);
    } catch (e) {
        console.log(`Could not update roles for ${uid}: member likely left.`);
    }
}

// --- 🛰️ EVENTS ---
client.on('interactionCreate', async (i) => {
    try {
        if (i.isChatInputCommand()) {
            if (i.commandName === 'profile') {
                const u = await User.findOne({ discordId: i.user.id }).lean();
                const color = RANK_DATA[RANK_MAP[u?.rank]]?.c || 0x00FFFF;
                const embed = new EmbedBuilder()
                    .setTitle(`${i.user.username}'s Stats`)
                    .setColor(color)
                    .addFields(
                        { name: 'ELO', value: `${u?.elo || 0}`, inline: true },
                        { name: 'RANK', value: u?.rank || 'Unranked', inline: true }
                    );
                return i.reply({ embeds: [embed], ephemeral: true });
            }

            if (i.commandName === 'quality') {
                const m = new ModalBuilder().setCustomId('q_modal').setTitle('💠 NEURAL LINK');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel("ACCESS KEY").setStyle(TextInputStyle.Short)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("DIRECT VIDEO URL").setStyle(TextInputStyle.Short))
                );
                return i.showModal(m);
            }
        }

        if (i.isModalSubmit() && i.customId === 'q_modal') return handleQuality(i);
        if (i.isButton() && i.customId.startsWith('rank_')) return handleRanking(i);

    } catch (err) {
        console.error("Interaction Error:", err);
    }
});

client.once('ready', () => {
    console.log(`[SYSTEM] Logged in as ${client.user.tag}`.cyan);
});

// --- 🏁 BOOT ---
async function boot() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`[DB] Connected to MongoDB`.green);

        await client.login(process.env.DISCORD_TOKEN);

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationGuildCommands(CONFIG.ID, CONFIG.GUILD), {
            body: [
                { name: 'quality', description: 'Enhance video quality using AI filters' },
                { name: 'profile', description: 'View your ELO and Rank' }
            ]
        });
    } catch (err) {
        console.error("Boot failure:", err);
        process.exit(1);
    }
}

boot();
