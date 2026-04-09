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
const axios = require('axios');
const https = require('https');
const PQueue = require('p-queue').default;
const fs = require('fs').promises;

// --- 💎 CONFIGURATION ---
const CONFIG = Object.freeze({
    ID: process.env.CLIENT_ID,
    GUILD: "1491541282156449794",
    REVIEW: "1489069664414859326",
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
const jobQueue = new PQueue({ concurrency: 1 });
const activeJobs = new Set();
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
    used: { type: Boolean, default: false }
}));

const client = new Client({ intents: [32767] });

// --- 🧠 LOGIC HANDLERS ---

async function handleQuality(i) {
    const codeIn = i.fields.getTextInputValue('code').trim().toUpperCase();
    const rawUrl = i.fields.getTextInputValue('url').trim();
    
    await i.deferReply({ ephemeral: true });
    const qCode = await QualityCode.findOne({ code: codeIn, used: false });
    if (!qCode) return i.editReply("❌ Invalid Key.");

    activeJobs.add(i.user.id);
    jobQueue.add(async () => {
        const fileId = nanoid(10);
        const uploadStream = new PassThrough();
        const ffmpeg = spawn('ffmpeg', [
            '-i', rawUrl,
            '-vf', 'hqdn3d=1.5:1.5:6:6,unsharp=3:3:0.5:3:3:0.0,scale=1280:-2',
            '-c:v', 'libx264', '-crf', '20', '-preset', 'faster', '-f', 'mp4', 'pipe:1'
        ]);

        const upload = s3.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: `final_${fileId}.mp4`,
            Body: uploadStream,
            ContentType: 'video/mp4'
        }));

        ffmpeg.stdout.pipe(uploadStream);
        try {
            await Promise.all([upload, new Promise((res, rej) => {
                ffmpeg.on('close', c => c === 0 ? res() : rej());
            })]);
            await QualityCode.updateOne({ _id: qCode._id }, { used: true });
            await i.editReply(`✅ **Success:** ${process.env.BASE_URL}/final_${fileId}.mp4`);
        } catch (e) {
            await i.editReply("❌ Transmutation Failed.");
        } finally {
            activeJobs.delete(i.user.id);
        }
    });
}

async function handleRanking(i) {
    const [ , type, uid] = i.customId.split('_');
    const data = RANK_DATA[RANK_MAP[type]];
    await i.deferUpdate();
    
    await User.findOneAndUpdate({ discordId: uid }, { $inc: { elo: data.e }, $set: { rank: type } }, { upsert: true });
    const member = await i.guild.members.fetch(uid).catch(() => null);
    if (member) {
        await member.roles.remove([...RANK_IDS_SET]);
        await member.roles.add(data.id);
    }
}

// --- 🛰️ INTERACTION ROUTER ---
client.on('interactionCreate', async (i) => {
    if (i.isChatInputCommand()) {
        if (i.commandName === 'profile') {
            const u = await User.findOne({ discordId: i.user.id });
            const color = RANK_DATA[RANK_MAP[u?.rank]]?.c || 0x00FFFF;
            const embed = new EmbedBuilder().setTitle(i.user.username).setColor(color)
                .addFields({ name: 'ELO', value: `${u?.elo || 0}`, inline: true }, { name: 'RANK', value: u?.rank || 'None', inline: true });
            return i.reply({ embeds: [embed], ephemeral: true });
        }

        if (i.commandName === 'quality') {
            const m = new ModalBuilder().setCustomId('q_modal').setTitle('💠 NEURAL LINK');
            m.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel("KEY").setStyle(1)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("URL").setStyle(1))
            );
            return i.showModal(m);
        }

        if (i.commandName === 'submit') {
            const m = new ModalBuilder().setCustomId('s_modal').setTitle('🚀 TRANSMIT');
            m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("EDIT LINK").setStyle(1)));
            return i.showModal(m);
        }
    }

    if (i.isModalSubmit()) {
        if (i.customId === 'q_modal') return handleQuality(i);
        if (i.customId === 's_modal') {
            const reviewChan = await client.channels.fetch(CONFIG.REVIEW);
            const url = i.fields.getTextInputValue('url');
            const row = new ActionRowBuilder().addComponents(
                RANK_DATA.slice(0, 5).map(r => new ButtonBuilder().setCustomId(`rank_${r.n}_${i.user.id}`).setLabel(r.n).setStyle(ButtonStyle.Secondary))
            );
            await reviewChan.send({ content: `📥 **New Submission:** ${i.user.tag}\n🔗 ${url}`, components: [row] });
            return i.reply({ content: "📡 Data Transmitted.", ephemeral: true });
        }
    }

    if (i.isButton() && i.customId.startsWith('rank_')) return handleRanking(i);
});

// --- 🛰️ BOOT ---
async function boot() {
    await mongoose.connect(process.env.MONGO_URI);
    await client.login(process.env.DISCORD_TOKEN);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    // Explicitly registering all 3 commands
    await rest.put(Routes.applicationGuildCommands(CONFIG.ID, CONFIG.GUILD), {
        body: [
            { name: 'quality', description: 'Enhance video' },
            { name: 'submit',  description: 'Submit edit for review' },
            { name: 'profile', description: 'View stats' }
        ]
    });
    console.log(">>> SINGULARITY ONLINE <<<".green);
}

boot();
