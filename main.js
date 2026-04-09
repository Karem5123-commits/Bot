// NODE_OPTIONS="--enable-source-maps=false"
require('dotenv').config();
require('colors');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, REST, Routes, EmbedBuilder, Options 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { nanoid } = require('nanoid'), mongoose = require('mongoose'), { spawn } = require('child_process');
const { PassThrough, pipeline } = require('stream'), { promisify } = require('util');
const axios = require('axios'), https = require('https'), cluster = require('cluster'), os = require('os');
const express = require('express'), app = express();

// --- ⚙️ OMNI-CONFIG ---
const OWNERS = new Set((process.env.OWNER_IDS || "").split(",").map(id => id.trim()));
const CONFIG = Object.freeze({
    ID: process.env.CLIENT_ID,
    GUILD: process.env.GUILD_ID, 
    REVIEW: process.env.REVIEW_CHANNEL_ID, 
    BASE: process.env.BASE_URL
});

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
const processingCache = new Set();

const User = mongoose.model('U', new mongoose.Schema({ i: { type: String, index: true }, r: String, e: { type: Number, default: 0 } }, { versionKey: false }));
const QualityCode = mongoose.model('Q', new mongoose.Schema({ c: { type: String, index: true }, u: { type: Boolean, default: false } }, { versionKey: false }));

if (cluster.isPrimary) {
    (async () => {
        console.log(`\n${"═".repeat(45).gray}\n` + ` VOIDLESS MASTER CORE V5 `.magenta.bold + `\n${"═".repeat(45).gray}`);
        try {
            await mongoose.connect(process.env.MONGO_URI);
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            const manifest = [
                { name: 'submit', description: '🚀 Submit edit for review' },
                { name: 'code', description: '🎫 [OWNER] Generate key' },
                { name: 'quality', description: '💠 AI Enhancement' },
                { name: 'profile', description: '📊 Check stats' },
                { name: 'leaderboard', description: '🏆 View top editors' },
                { name: 'nuke', description: '☢️ [STAFF] Reset', default_member_permissions: "16" },
                { name: 'clear', description: '🧹 [STAFF] Purge', options: [{ name: 'amt', type: 4, description: 'Amt', required: true }], default_member_permissions: "8192" }
            ];
            await rest.put(Routes.applicationGuildCommands(CONFIG.ID, CONFIG.GUILD), { body: manifest });
            console.log("✅ Commands Synced & DB Connected.".green);
            
            app.get('/', (req, res) => res.sendStatus(200));
            app.listen(process.env.PORT || 3000);
            
            cluster.fork();
            cluster.on('exit', () => setTimeout(() => cluster.fork(), 5000));
        } catch (e) { console.log(`❌ BOOT ERROR: ${e.message}`.red); }
    })();
} else {
    const client = new Client({ intents: 32767 });
    const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY } });
    const queue = new (require('p-queue').default)({ concurrency: 1 });

    client.on('ready', () => console.log(`🚀 WORKER ONLINE: ${client.user.tag}`.green));

    client.on('interactionCreate', async i => {
        try {
            if (i.isChatInputCommand()) {
                if (i.commandName === 'code') {
                    if (!OWNERS.has(i.user.id)) return i.reply({ content: '❌ Owner restricted.', ephemeral: true });
                    const c = nanoid(7).toUpperCase();
                    await QualityCode.create({ c });
                    return i.reply({ content: `🎫 Key: \`${c}\``, ephemeral: true });
                }
                if (i.commandName === 'submit') {
                    return i.showModal(new ModalBuilder().setCustomId('s_m').setTitle('🚀 Submit').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('VIDEO LINK').setStyle(1))));
                }
                if (i.commandName === 'quality') {
                    return i.showModal(new ModalBuilder().setCustomId('q_m').setTitle('💠 Upscale').addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c').setLabel('CODE').setStyle(1)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('VIDEO URL').setStyle(1))
                    ));
                }
                if (i.commandName === 'profile') {
                    const u = await User.findOne({ i: i.user.id }).lean();
                    return i.reply({ embeds: [new EmbedBuilder().setTitle(i.user.username).addFields({ name: 'ELO', value: `${u?.e || 0}`, inline: true }, { name: 'RANK', value: u?.r || 'N/A', inline: true })], ephemeral: true });
                }
                if (i.commandName === 'leaderboard') {
                    const top = await User.find().sort({ e: -1 }).limit(10).lean();
                    const list = top.map((u, idx) => `**#${idx+1}** <@${u.i}> • \`${u.e} ELO\``).join('\n');
                    return i.reply({ embeds: [new EmbedBuilder().setTitle('🏆 LEADERBOARD').setDescription(list || "No data.")] });
                }
                if (i.commandName === 'nuke') {
                    const p = i.channel.position; const n = await i.channel.clone();
                    await i.channel.delete(); return n.setPosition(p).then(c => c.send("☢️ **NUKE_SUCCESS**"));
                }
                if (i.commandName === 'clear') {
                    await i.channel.bulkDelete(Math.min(i.options.getInteger('amt'), 100));
                    return i.reply({ content: '🧹', ephemeral: true });
                }
            }

            if (i.isModalSubmit()) {
                await i.deferReply({ ephemeral: true });
                if (i.customId === 's_m') {
                    const url = i.fields.getTextInputValue('u');
                    const ch = await client.channels.fetch(CONFIG.REVIEW).catch(() => null);
                    if (!ch) return i.editReply("❌ Review channel missing.");
                    const row = new ActionRowBuilder().addComponents(RANK_DATA.map(r => new ButtonBuilder().setCustomId(`rk_${r.n}_${i.user.id}`).setLabel(r.n).setStyle(ButtonStyle.Secondary)));
                    await ch.send({ content: `📥 <@${i.user.id}>\n🔗 ${url}`, components: [row] });
                    return i.editReply("✅ Synced.");
                }
                if (i.customId === 'q_m') {
                    const k = i.fields.getTextInputValue('c').toUpperCase(), url = i.fields.getTextInputValue('u');
                    const qc = await QualityCode.findOne({ c: k, u: false });
                    if (!qc) return i.editReply('❌ Invalid code.');
                    queue.add(async () => {
                        let ff; try {
                            const res = await axios({ url, responseType: 'stream', timeout: 15000 });
                            const pt = new PassThrough({ highWaterMark: 1024 * 512 });
                            const key = `v_${nanoid(10)}.mp4`;
                            ff = spawn('ffmpeg', ['-i', 'pipe:0', '-vf', 'hqdn3d=1:1:4:4,unsharp=3:3:0.5:3:3:0,scale=1280:-2', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-f', 'mp4', 'pipe:1']);
                            const up = s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: pt, ContentType: 'video/mp4' }));
                            await Promise.all([promisify(pipeline)(res.data, ff.stdin), promisify(pipeline)(ff.stdout, pt), up]);
                            await i.editReply(`✅ **Enhanced:** ${CONFIG.BASE}/${key}`); 
                            await QualityCode.updateOne({ _id: qc._id }, { u: true });
                        } catch (e) { if(ff) ff.kill(); i.editReply('❌ Engine Failed. Check FFmpeg on Railway.'); }
                    });
                }
            }

            if (i.isButton() && i.customId.startsWith('rk_')) {
                const [, r, uid] = i.customId.split('_');
                if (processingCache.has(uid)) return;
                processingCache.add(uid);
                await i.deferUpdate();
                const d = RANK_MAP.get(r);
                await User.findOneAndUpdate({ i: uid }, { $inc: { e: d.e }, $set: { r: r } }, { upsert: true });
                const m = await i.guild.members.fetch(uid).catch(() => null);
                if (m) { await m.roles.remove(RANK_IDS).catch(() => {}); await m.roles.add(d.id).catch(() => {}); }
                await i.editReply({ embeds: [new EmbedBuilder().setDescription(`✅ <@${uid}> → **${r}**`).setColor(d.c)], components: [] });
                setTimeout(() => processingCache.delete(uid), 3000);
            }
        } catch (err) { console.log(`[ERR] ${err.message}`); }
    });

    mongoose.connect(process.env.MONGO_URI).then(() => client.login(process.env.DISCORD_TOKEN));
}
