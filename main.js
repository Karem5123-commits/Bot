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
const fs = require('fs');

// --- 💎 SYSTEM CONSTANTS ---
const CONFIG = Object.freeze({
    ID: process.env.CLIENT_ID,
    GUILD: "1491541282156449794",
    REVIEW: "1489069664414859326",
    MAX_SIZE: 52428800, 
    MAX_DUR: 60,        
});

const RANK_DATA = Object.freeze([
    { n: "Z",  id: "1491573028931244204", e: 150, c: 0xFFFFFF },
    { n: "SS", id: "1491572938888056904", e: 100, c: 0xFF0000 },
    { n: "S+", id: "1491572855400304823", e: 80,  c: 0xFFD700 },
    { n: "S",  id: "1491572750584774747", e: 60,  c: 0xFFA500 },
    { n: "A",  id: "1491572617591652394", e: 40,  c: 0x00FF00 },
    { n: "B",  id: "1491572503221375196", e: 25,  c: 0x0000FF },
    { n: "C",  id: "1491572406790262994", e: 10,  c: 0x808080 }
]);

const RANK_IDS_SET = new Set(RANK_DATA.map(r => r.id));
const RANK_MAP = Object.freeze(Object.fromEntries(RANK_DATA.map((r, i) => [r.n, i])));

// --- 🚀 SINGLETONS ---
const axiosAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });
const jobQueue = new PQueue({ concurrency: 2 });
const activeJobs = new Set();
const interactionCache = new Set();
const failedMembers = new Set();
let MAIN_GUILD, REVIEW_CHAN;

const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY },
});

// --- 📊 MODELS ---
const User = mongoose.model('User', new mongoose.Schema({
    discordId: { type: String, index: true, unique: true },
    rank: String, elo: { type: Number, default: 0 }
}));

const QualityCode = mongoose.model('QualityCode', new mongoose.Schema({
    code: { type: String, index: true },
    used: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: '7d' }
}));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

// --- ⚡ PROBE UTILITY (HYBRID LOCAL BUFFER) ---
async function getValidatedStream(url, abortSignal) {
    const response = await axios({
        url, method: 'GET', responseType: 'stream',
        httpsAgent: axiosAgent, signal: abortSignal, timeout: 15000
    });

    const tempPath = `./probe_${nanoid(5)}.mp4`;
    const writer = fs.createWriteStream(tempPath);
    
    // Buffer first 2MB for robust ffprobe
    let buffered = 0;
    for await (const chunk of response.data) {
        writer.write(chunk);
        buffered += chunk.length;
        if (buffered > 2 * 1024 * 1024) break; 
    }
    writer.end();

    const duration = await new Promise((res) => {
        const ff = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tempPath]);
        let out = '';
        ff.stdout.on('data', d => out += d);
        ff.on('close', () => res(parseFloat(out) || 0));
    });

    fs.unlink(tempPath, () => {});
    if (duration > CONFIG.MAX_DUR) throw new Error(`Video exceeds ${CONFIG.MAX_DUR}s.`);
    if (duration === 0) throw new Error("Could not verify stream metadata.");

    return response;
}

// --- 🧠 MASTER ENGINE ---
async function handleQuality(i) {
    if (interactionCache.has(i.id)) return;
    interactionCache.add(i.id);
    setTimeout(() => interactionCache.delete(i.id), 10000);

    const codeIn = i.fields.getTextInputValue('code').trim().toUpperCase();
    const rawUrl = i.fields.getTextInputValue('url').trim();
    const normalizedUrl = rawUrl.split('?')[0];
    
    if (activeJobs.has(normalizedUrl)) return i.reply({ content: "⚠️ Transcription in progress.", ephemeral: true });
    if ((jobQueue.size + jobQueue.pending) > 20) return i.reply({ content: "❌ Neural Queue Capacity Reached.", ephemeral: true });

    await i.deferReply({ ephemeral: true });
    const qCode = await QualityCode.findOne({ code: codeIn, used: false }).lean();
    if (!qCode) return i.editReply("❌ Invalid Access Key.");

    activeJobs.add(normalizedUrl);

    jobQueue.add(async () => {
        const fileId = nanoid(10);
        const abortCtrl = new AbortController();
        
        let ffmpeg; 

        try {
            const response = await getValidatedStream(rawUrl, abortCtrl.signal);

            ffmpeg = spawn('ffmpeg', [
                '-i', 'pipe:0',
                '-vf', 'hqdn3d=1.5:1.5:6:6,unsharp=3:3:0.5:3:3:0.0,scale=1280:-2:flags=lanczos',
                '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-movflags', '+faststart+frag_keyframe+empty_moov',
                '-c:a', 'copy', '-map_metadata', '-1', '-threads', '2', '-f', 'mp4', 'pipe:1'
            ]);

            const hardTimeout = setTimeout(() => { if(ffmpeg) ffmpeg.kill('SIGKILL'); abortCtrl.abort(); }, 180000);

            const uploadStream = new PassThrough({ highWaterMark: 1 << 20 });
            ffmpeg.stdout._readableState.highWaterMark = 1 << 20;

            let bytesRead = 0;
            response.data.on('data', (chunk) => {
                bytesRead += chunk.length;
                if (bytesRead > CONFIG.MAX_SIZE) {
                    response.data.destroy();
                    if(ffmpeg) ffmpeg.kill('SIGKILL');
                    abortCtrl.abort();
                }
            });

            response.data.on('end', () => { if(ffmpeg) ffmpeg.stdin.end(); });
            ffmpeg.stdin.on('error', () => {}); 
            ffmpeg.stdout.on('error', () => {});

            const ffmpegExit = new Promise((res, rej) => {
                ffmpeg.on('close', code => code === 0 ? res() : rej(new Error(`Exit Code ${code}`)));
            });

            const upload = s3.send(new PutObjectCommand({
                Bucket: process.env.R2_BUCKET,
                Key: `final_${fileId}.mp4`,
                Body: uploadStream,
                ContentType: 'video/mp4',
            }));

            await Promise.all([
                pipeline(response.data, ffmpeg.stdin),
                pipeline(ffmpeg.stdout, uploadStream),
                upload,
                ffmpegExit
            ]);

            clearTimeout(hardTimeout);
            if (i.deferred || i.replied) {
                await i.editReply(`✅ **Transmutation Success:** ${process.env.BASE_URL}/final_${fileId}.mp4`);
                await QualityCode.updateOne({ _id: qCode._id }, { $set: { used: true } });
            }

        } catch (err) {
            if(ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL');
            const msg = err.name === 'AbortError' ? "Stream Limit Violation." : err.message;
            if (i.deferred || i.replied) await i.editReply(`❌ **Engine Error:** ${msg}`).catch(() => {});
        } finally {
            activeJobs.delete(normalizedUrl);
        }
    });
}

// --- 🎖️ RANKING ---
async function handleRanking(i) {
    const lastIdx = i.customId.lastIndexOf('_');
    const type = i.customId.substring(5, lastIdx);
    const uid = i.customId.substring(lastIdx + 1);
    const data = RANK_DATA[RANK_MAP[type]];
    if (!data) return;

    await i.deferUpdate();
    await User.findOneAndUpdate({ discordId: uid }, { $inc: { elo: data.e }, $set: { rank: type } }, { upsert: true });

    if (failedMembers.has(uid)) return;
    const guild = i.guild || MAIN_GUILD;
    const member = guild.members.cache.get(uid) || await guild.members.fetch(uid).catch(() => { failedMembers.add(uid); return null; });
    
    if (member) {
        const toRemove = member.roles.cache.filter(r => RANK_IDS_SET.has(r.id) && r.id !== data.id);
        if (toRemove.size > 0) await member.roles.remove(toRemove).catch(() => {});
        if (!member.roles.cache.has(data.id)) await member.roles.add(data.id).catch(() => {});
    }
}

// --- 🛰️ BOOT & GUARDS ---
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
jobQueue.on('error', () => {});

client.once('ready', async () => {
    MAIN_GUILD = client.guilds.cache.get(CONFIG.GUILD);
    if (MAIN_GUILD) REVIEW_CHAN = await MAIN_GUILD.channels.fetch(CONFIG.REVIEW).catch(() => null);
    console.log(` >>> SINGULARITY V22: FINAL SENTINEL ONLINE <<< `.green.bold);
});

client.on('interactionCreate', async (i) => {
    if (i.isChatInputCommand()) {
        if (i.commandName === 'profile') {
            const u = await User.findOne({ discordId: i.user.id }).lean();
            const color = RANK_DATA[RANK_MAP[u?.rank]]?.c || 0x00FFFF;
            return i.reply({ embeds: [new EmbedBuilder().setTitle(i.user.username).setColor(color).addFields({name:'ELO', value:`${u?.elo || 0}`, inline:true}, {name:'RANK', value:u?.rank || 'None', inline:true})], ephemeral: true });
        }
        if (i.commandName === 'quality') {
            const m = new ModalBuilder().setCustomId('q_modal').setTitle('💠 NEURAL LINK');
            m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel("KEY").setStyle(1)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("URL").setStyle(1)));
            return i.showModal(m);
        }
        if (i.commandName === 'submit') {
            const m = new ModalBuilder().setCustomId('s_modal').setTitle('🚀 TRANSMIT');
            m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("LINK").setStyle(1)));
            return i.showModal(m);
        }
    }
    if (i.isModalSubmit()) {
        if (i.customId === 'q_modal') return handleQuality(i);
        if (i.customId === 's_modal') {
            const url = i.fields.getTextInputValue('url');
            if (!REVIEW_CHAN) return i.reply({ content: "Review Offline.", ephemeral: true });
            const row = new ActionRowBuilder().addComponents(RANK_DATA.slice(0, 5).map(r => new ButtonBuilder().setCustomId(`rank_${r.n}_${i.user.id}`).setLabel(r.n).setStyle(ButtonStyle.Secondary)));
            await REVIEW_CHAN.send({ content: `📥 **Submission:** ${i.user.tag}\n🔗 ${url}`, components: [row] });
            return i.reply({ content: "📡 Data Transmitted.", ephemeral: true });
        }
    }
    if (i.isButton() && i.customId.startsWith('rank_')) return handleRanking(i);
});

async function boot() {
    await mongoose.connect(process.env.MONGO_URI, { writeConcern: { w: 1 } });
    await client.login(process.env.DISCORD_TOKEN);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CONFIG.ID, CONFIG.GUILD), { body: [{name:'quality', description:'AI Enhancer'}, {name:'submit', description:'Submit edit'}, {name:'profile', description:'View stats'}] });
}

process.on('SIGINT', async () => { await mongoose.disconnect(); client.destroy(); process.exit(0); });
boot();
