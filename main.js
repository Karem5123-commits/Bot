require('dotenv').config();
require('colors');
const { 
    Client, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, REST, Routes, EmbedBuilder 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { nanoid } = require('nanoid'), mongoose = require('mongoose'), { spawn } = require('child_process');
const { PassThrough, pipeline } = require('stream'), { promisify } = require('util');
const axios = require('axios'), https = require('https'), express = require('express');

const app = express();
const log = (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

// --- ⚙️ CONFIG SYNC ---
const OWNERS = new Set((process.env.OWNER_IDS || "").split(",").map(id => id.trim()));
const CONFIG = {
    ID: process.env.CLIENT_ID,
    GUILD: process.env.GUILD_ID, 
    REVIEW: process.env.REVIEW_CHANNEL_ID, 
    BASE: process.env.BASE_URL
};

const RANK_DATA = [
    { n: "SS", id: "1491572938888056904", e: 100, c: 0xFF0000 },
    { n: "S+", id: "1491572855400304823", e: 80,  c: 0xFFD700 },
    { n: "S",  id: "1491572750584774747", e: 60,  c: 0xFFA500 },
    { n: "A",  id: "1491572617591652394", e: 40,  c: 0x00FF00 },
    { n: "B",  id: "1491572503221375196", e: 25,  c: 0x0000FF },
    { n: "C",  id: "1491572406790262994", e: 10,  c: 0x808080 }
];

const RANK_IDS = RANK_DATA.map(r => r.id);
const RANK_MAP = new Map(RANK_DATA.map(r => [r.n, r]));

// --- 📉 DATABASE ---
const User = mongoose.model('U', new mongoose.Schema({ i: String, r: String, e: { type: Number, default: 0 } }));
const QualityCode = mongoose.model('Q', new mongoose.Schema({ c: String, u: { type: Boolean, default: false } }));

const client = new Client({ intents: 32767 });
const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY } });
const queue = new (require('p-queue').default)({ concurrency: 1 });

// --- 🚀 POWERHOUSE LOGIC ---
client.on('interactionCreate', async i => {
    try {
        if (i.isChatInputCommand()) {
            if (i.commandName === 'submit') {
                const m = new ModalBuilder().setCustomId('s_m').setTitle('🚀 Submit Edit');
                m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('VIDEO LINK').setStyle(1).setRequired(true)));
                return i.showModal(m);
            }
            if (i.commandName === 'code') {
                if (!OWNERS.has(i.user.id)) return i.reply({ content: '❌ Forbidden.', ephemeral: true });
                const c = nanoid(7).toUpperCase();
                await QualityCode.create({ c });
                return i.reply({ content: `🎫 Key: \`${c}\``, ephemeral: true });
            }
            if (i.commandName === 'leaderboard') {
                const top = await User.find().sort({ e: -1 }).limit(10).lean();
                const desc = top.map((u, x) => `**#${x+1}** <@${u.i}> • \`${u.e} ELO\``).join('\n') || "No data.";
                return i.reply({ embeds: [new EmbedBuilder().setTitle('🏆 TOP EDITORS').setDescription(desc).setColor(0x5865F2)] });
            }
            if (i.commandName === 'quality') {
                const m = new ModalBuilder().setCustomId('q_m').setTitle('💠 AI Upscale');
                m.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c').setLabel('CODE').setStyle(1).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('VIDEO URL').setStyle(1).setRequired(true))
                );
                return i.showModal(m);
            }
        }

        if (i.isModalSubmit()) {
            await i.deferReply({ ephemeral: true }); // Acknowledge instantly

            if (i.customId === 's_m') {
                const url = i.fields.getTextInputValue('u');
                const ch = await client.channels.fetch(CONFIG.REVIEW).catch(() => null);
                if (!ch) return i.editReply("❌ Config Error: REVIEW_CHANNEL_ID is invalid.");

                const row = new ActionRowBuilder().addComponents(RANK_DATA.map(r => new ButtonBuilder().setCustomId(`rk_${r.n}_${i.user.id}`).setLabel(r.n).setStyle(ButtonStyle.Secondary)));
                const msg = await ch.send({ content: `📥 **New Submission** from <@${i.user.id}>\n🔗 ${url}`, components: [row] });
                await msg.startThread({ name: `Review: ${i.user.username}` }).catch(() => null);
                return i.editReply("✅ Submission sent to staff.");
            }

            if (i.customId === 'q_m') {
                const k = i.fields.getTextInputValue('c').toUpperCase();
                const url = i.fields.getTextInputValue('u');
                const qc = await QualityCode.findOne({ c: k, u: false });

                if (!qc) return i.editReply("❌ Invalid or used code.");

                queue.add(async () => {
                    let ff; try {
                        log(`Processing video for ${i.user.tag}...`);
                        const res = await axios({ url, responseType: 'stream', timeout: 20000 });
                        const pt = new PassThrough({ highWaterMark: 1024 * 512 });
                        const key = `v_${nanoid(10)}.mp4`;
                        
                        ff = spawn('ffmpeg', ['-i', 'pipe:0', '-vf', 'hqdn3d=1.5:1.5:4:4,unsharp=3:3:0.5:3:3:0,scale=1280:-2', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-f', 'mp4', 'pipe:1']);
                        
                        const up = s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: pt, ContentType: 'video/mp4' }));
                        await Promise.all([promisify(pipeline)(res.data, ff.stdin), promisify(pipeline)(ff.stdout, pt), up]);
                        
                        await i.editReply(`✅ **Enhanced:** ${CONFIG.BASE}/${key}`);
                        await QualityCode.updateOne({ _id: qc._id }, { u: true });
                    } catch (e) { if(ff) ff.kill(); i.editReply("❌ Engine Error. Is FFmpeg installed on Railway?"); }
                });
            }
        }

        if (i.isButton() && i.customId.startsWith('rk_')) {
            const [, r, uid] = i.customId.split('_');
            await i.deferUpdate();
            const d = RANK_MAP.get(r);
            await User.findOneAndUpdate({ i: uid }, { $inc: { e: d.e }, $set: { r: r } }, { upsert: true });
            const m = await i.guild.members.fetch(uid).catch(() => null);
            if (m) { await m.roles.remove(RANK_IDS).catch(() => {}); await m.roles.add(d.id).catch(() => {}); }
            await i.editReply({ embeds: [new EmbedBuilder().setDescription(`✅ <@${uid}> graded **${r}**`).setColor(d.c)], components: [] });
        }
    } catch (err) { log(`Error: ${err.message}`); }
});

// --- 🛠️ BOOTSTRAP ---
(async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        log("Connected to Database.");
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationGuildCommands(CONFIG.ID, CONFIG.GUILD), { body: [
            { name: 'submit', description: '🚀 Submit edit' },
            { name: 'code', description: '🎫 Owner only' },
            { name: 'quality', description: '💠 Upscale' },
            { name: 'leaderboard', description: '🏆 Top Editors' }
        ]});
        log("Commands Synced.");
        app.get('/', (req, res) => res.send('OK'));
        app.listen(process.env.PORT || 3000);
        client.login(process.env.DISCORD_TOKEN);
    } catch (e) { log(`Fatal Boot: ${e.message}`); }
})();

client.on('ready', () => log(`System Online: ${client.user.tag}`));
