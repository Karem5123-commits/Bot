// NODE_OPTIONS="--enable-source-maps=false"
require('dotenv').config();
require('colors');
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, REST, Routes, EmbedBuilder, Options, 
    PermissionFlagsBits 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { nanoid } = require('nanoid'), mongoose = require('mongoose'), { spawn } = require('child_process');
const { PassThrough, pipeline } = require('stream'), { promisify } = require('util');
const axios = require('axios'), https = require('https'), cluster = require('cluster'), os = require('os');
const express = require('express'), app = express();

const OWNERS = new Set(["1407316453060907069", "1347959266539081768", "1414624634284019932"]);
const CONFIG = Object.freeze({
    ID: process.env.CLIENT_ID,
    GUILD: "1488868987805892730", 
    REVIEW: "1489069664414859326", 
    BASE: process.env.BASE_URL
});

const RANK_DATA = [
    { n: "SS", id: "1491572938888056904", e: 100, c: 0xFF0000, v: 1 },
    { n: "S+", id: "1491572855400304823", e: 80,  c: 0xFFD700, v: 2 },
    { n: "S",  id: "1491572750584774747", e: 60,  c: 0xFFA500, v: 3 },
    { n: "A",  id: "1491572617591652394", e: 40,  c: 0x00FF00, v: 4 },
    { n: "B",  id: "1491572503221375196", e: 25,  c: 0x0000FF, v: 5 },
    { n: "C",  id: "1491572406790262994", e: 10,  c: 0x808080, v: 6 }
];

const RANK_IDS = RANK_DATA.map(r => r.id);
const RANK_MAP = new Map(RANK_DATA.map(r => [r.n, r]));
const processingCache = new Set(); // Anti-Sniping Cache

const User = mongoose.model('U', new mongoose.Schema({ 
    i: { type: String, index: true, unique: true }, 
    r: String, v: Number, e: { type: Number, default: 0 } 
}, { versionKey: false }));

const QualityCode = mongoose.model('Q', new mongoose.Schema({ 
    c: { type: String, index: true }, u: { type: Boolean, default: false }, o: String 
}, { versionKey: false }));

if (cluster.isPrimary) {
    (async () => {
        console.clear();
        console.log(`\n${"═".repeat(45).gray}\n` + ` VOIDLESS CORE // POWERHOUSE V3 `.magenta.bold + `\n${"═".repeat(45).gray}`);

        await mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 20 });
        
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

        try {
            await rest.put(Routes.applicationGuildCommands(CONFIG.ID, CONFIG.GUILD), { body: manifest });
            console.log(`[SYNC] Omni-Registry Updated.`.cyan);
        } catch (e) { console.error(`[SYNC_ERR] Fail.`.red); }

        app.get('/', (req, res) => res.sendStatus(200));
        app.listen(process.env.PORT || 3000);

        for (let i = 0; i < os.cpus().length; i++) cluster.fork();
        cluster.on('exit', () => cluster.fork());
    })();
} else {
    const client = new Client({ intents: 32767, makeCache: Options.cacheWithLimits({ MessageManager: 10, PresenceManager: 0 }) });
    const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY } });
    const queue = new (require('p-queue').default)({ concurrency: 1 });
    const agent = new https.Agent({ keepAlive: true });

    client.on('interactionCreate', async i => {
        try {
            if (i.isChatInputCommand()) {
                if (i.commandName === 'leaderboard') {
                    const top = await User.find().sort({ e: -1 }).limit(10).select('i e r').lean();
                    const list = top.map((u, idx) => `**#${idx + 1}** <@${u.i}> • \`${u.e} ELO\` • [${u.r || '?'}]`).join('\n');
                    return i.reply({ embeds: [new EmbedBuilder().setTitle('🏆 TOP SENTINEL EDITORS').setColor(0xFFD700).setDescription(list || "No data.") ]});
                }
                if (i.commandName === 'nuke') {
                    const p = i.channel.position; const n = await i.channel.clone();
                    await i.channel.delete(); return n.setPosition(p).then(c => c.send("☢️ **CHANNEL_RESTORED**"));
                }
                if (i.commandName === 'clear') {
                    await i.channel.bulkDelete(Math.min(i.options.getInteger('amt'), 100));
                    return i.reply({ content: '🧹', ephemeral: true });
                }
                if (i.commandName === 'code') {
                    if (!OWNERS.has(i.user.id)) return i.reply({ content: '❌', ephemeral: true });
                    const c = nanoid(7).toUpperCase();
                    await QualityCode.create({ c, o: i.user.id });
                    return i.reply({ content: `🎫 \`${c}\``, ephemeral: true });
                }
                if (i.commandName === 'profile') {
                    const u = await User.findOne({ i: i.user.id }).lean();
                    return i.reply({ embeds: [new EmbedBuilder().setColor(0x00FFFF).setTitle(i.user.username).addFields({ name: 'ELO', value: `${u?.e || 0}`, inline: true }, { name: 'RANK', value: u?.r || 'N/A', inline: true })], ephemeral: true });
                }
                if (i.commandName === 'submit') {
                    return i.showModal(new ModalBuilder().setCustomId('s_m').setTitle('🚀').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('LINK').setStyle(1))));
                }
                if (i.commandName === 'quality') {
                    return i.showModal(new ModalBuilder().setCustomId('q_m').setTitle('💠').addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c').setLabel('CODE').setStyle(1)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('VIDEO').setStyle(1))
                    ));
                }
            }

            // --- ANTI-SNIPE RANKING ---
            if (i.isButton() && i.customId.startsWith('rk_')) {
                const [, r, uid] = i.customId.split('_');
                if (processingCache.has(uid)) return i.reply({ content: "⚠️ Being processed.", ephemeral: true });
                
                processingCache.add(uid);
                const d = RANK_MAP.get(r);
                await i.deferUpdate();
                
                await User.findOneAndUpdate({ i: uid }, { $inc: { e: d.e }, $set: { r: r, v: d.v } }, { upsert: true });
                const m = await i.guild.members.fetch(uid).catch(() => null);
                if (m) { await m.roles.remove(RANK_IDS).catch(() => {}); await m.roles.add(d.id).catch(() => {}); }
                
                await i.editReply({ content: null, embeds: [new EmbedBuilder().setDescription(`✅ **GRADED:** <@${uid}> → **${r}**`).setColor(d.c)], components: [] });
                setTimeout(() => processingCache.delete(uid), 3000);
            }

            if (i.isModalSubmit()) {
                if (i.customId === 's_m') {
                    const u = i.fields.getTextInputValue('u');
                    const row = new ActionRowBuilder().addComponents(RANK_DATA.map(r => new ButtonBuilder().setCustomId(`rk_${r.n}_${i.user.id}`).setLabel(r.n).setStyle(ButtonStyle.Secondary)));
                    const ch = await client.channels.fetch(CONFIG.REVIEW);
                    const msg = await ch.send({ content: `🔔 @everyone | <@${i.user.id}>\n🔗 ${u}`, components: [row] });
                    await msg.startThread({ name: `Review_${i.user.username}` });
                    return i.reply({ content: '📡 Synced.', ephemeral: true });
                }
                if (i.customId === 'q_m') {
                    const k = i.fields.getTextInputValue('c').toUpperCase(), url = i.fields.getTextInputValue('u');
                    await i.deferReply({ ephemeral: true });
                    const qc = await QualityCode.findOne({ c: k, u: false }).lean();
                    if (!qc) return i.editReply('❌');

                    queue.add(async () => {
                        let ff; try {
                            const res = await axios({ url, responseType: 'stream', timeout: 15000, httpsAgent: agent });
                            const pt = new PassThrough({ highWaterMark: 1024 * 512 });
                            const key = `v_${nanoid(10)}.mp4`;
                            ff = spawn('ffmpeg', ['-i', 'pipe:0', '-vf', 'hqdn3d=1:1:4:4,unsharp=3:3:0.5:3:3:0,scale=1280:-2', '-c:v', 'libx264', '-crf', '19', '-preset', 'superfast', '-movflags', '+faststart', '-f', 'mp4', 'pipe:1']);
                            const up = s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: pt, ContentType: 'video/mp4' }));
                            await Promise.all([promisify(pipeline)(res.data, ff.stdin), promisify(pipeline)(ff.stdout, pt), up]);
                            await i.editReply(`✅ ${CONFIG.BASE}/${key}`); 
                            await QualityCode.updateOne({ _id: qc._id }, { u: true });
                        } catch (e) { if(ff) ff.kill(); i.editReply('❌'); }
                    });
                }
            }
        } catch (err) { console.error(`[ERR]`.red); }
    });

    client.on('guildMemberUpdate', async (o, n) => {
        if (!o.premiumSince && n.premiumSince) {
            const c = nanoid(7).toUpperCase();
            await QualityCode.create({ c, o: "BOOST" });
            try { await n.send(`💎 Booster Code: \`${c}\``); } catch(e){}
        }
    });

    mongoose.connect(process.env.MONGO_URI).then(() => client.login(process.env.DISCORD_TOKEN));
}
