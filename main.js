require('dotenv').config();
require('colors');
const { 
    Client, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, REST, Routes, EmbedBuilder, Options, PermissionFlagsBits 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { nanoid: n } = require('nanoid'), m = require('mongoose'), { spawn } = require('child_process');
const { PassThrough, pipeline } = require('stream'), { promisify } = require('util');
const a = require('axios'), http = require('https'), cluster = require('cluster'), os = require('os'), app = require('express')();

// --- ⚙️ CONFIGURATION ---
const CONFIG = Object.freeze({
    ID: process.env.CLIENT_ID,
    GUILD: "1488868987805892730", 
    REVIEW: "1489069664414859326",
    BASE: process.env.BASE_URL
});

const RM = ["Z", "SS", "S+", "S", "A", "B", "C"];
const R = Object.freeze({ 
    Z: { e: 150, i: "1491573028931244204", v: 0 }, SS: { e: 100, i: "1491572938888056904", v: 1 }, 
    "S+": { e: 80, i: "1491572855400304823", v: 2 }, S: { e: 60, i: "1491572750584774747", v: 3 }, 
    A: { e: 40, i: "1491572617591652394", v: 4 }, B: { e: 25, i: "1491572503221375196", v: 5 }, 
    C: { e: 10, i: "1491572406790262994", v: 6 }
});
const R_IDS = new Set(Object.values(R).map(x => x.i));

// --- 📉 VOID-COMPRESSION DATABASE ---
const U = m.model('U', new m.Schema({ i: { type: String, index: 1 }, r: Number, e: { type: Number, default: 0 } }, { versionKey: false }));
const Q = m.model('Q', new m.Schema({ c: { type: String, index: 1 }, u: { type: Boolean, default: false } }, { versionKey: false }));

// --- 🛰️ FEATURE REGISTRY (REPAIRED) ---
const definitions = [
    { name: 'quality', description: '💠 AI Media Enhancement' },
    { name: 'submit', description: '🚀 Submit edit for Ranking' },
    { name: 'profile', description: '📊 View your ELO & Rank' },
    { name: 'nuke', description: '☢️ [STAFF] Reset a channel', default_member_permissions: PermissionFlagsBits.ManageChannels.toString() },
    { 
        name: 'clear', 
        description: '🧹 [STAFF] Purge messages', 
        options: [{ name: 'amt', type: 4, description: 'Amount of messages to delete', required: true }], 
        default_member_permissions: PermissionFlagsBits.ManageMessages.toString() 
    },
    { 
        name: 'ban', 
        description: '🔨 [STAFF] Exile member', 
        options: [
            { name: 'user', type: 6, description: 'The target to ban', required: true },
            { name: 'reason', type: 3, description: 'Reason for the ban', required: false }
        ], 
        default_member_permissions: PermissionFlagsBits.BanMembers.toString() 
    },
    {
        name: 'tempban',
        description: '⏲️ [STAFF] Ban temporarily',
        options: [
            { name: 'user', type: 6, description: 'The target to ban', required: true },
            { name: 'time', type: 3, description: 'Duration (e.g. 1h, 1d)', required: true }
        ],
        default_member_permissions: PermissionFlagsBits.BanMembers.toString()
    },
    { name: 'lockdown_all', description: '🔒 [STAFF] Lock every channel', default_member_permissions: PermissionFlagsBits.Administrator.toString() }
];

// --- 🛠️ BOOT ENGINE ---
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const stamp = () => `[${new Date().toLocaleTimeString()}]`.gray;
async function step(label, action) {
    process.stdout.write(`${stamp()} ${label} `);
    try { await action(); process.stdout.write(`✓\n`.green); } 
    catch (err) { process.stdout.write(`✗\n`.red); console.error(err); throw err; }
}
async function progress(label, duration = 800) {
    process.stdout.write(`   ↳ ${label} `);
    const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
    const start = Date.now(); let i = 0;
    while (Date.now() - start < duration) {
        process.stdout.write(`\r   ↳ ${label} ${frames[i++ % frames.length].magenta}`);
        await sleep(80);
    }
    process.stdout.write(`\r   ↳ ${label} ✓\n`.cyan);
}

// --- 🚀 CLUSTER ARCHITECTURE ---
if (cluster.isPrimary) {
    (async () => {
        console.clear();
        console.log(`\n${"═".repeat(58).gray}\n` + ` VOIDLESS.EXE // THE SINGULARITY`.magenta.bold + `\n${"═".repeat(58).gray}`);

        await step("🧠 NEURAL DB", async () => {
            await progress("Syncing Cluster", 500);
            await m.connect(process.env.MONGO_URI, { maxPoolSize: 20 });
        });

        await step("🛰️ OMNI-SYNC", async () => {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            await progress("Injecting Fixed Definitions", 700);
            await rest.put(Routes.applicationGuildCommands(CONFIG.ID, CONFIG.GUILD), { body: definitions });
        });

        await step("🌐 VOID-DASH", async () => {
            app.get('/', (req, res) => res.send('<body style="background:#000;color:#0ff;font-family:monospace"><h1>VOIDLESS_CORE_ACTIVE</h1></body>'));
            app.listen(process.env.PORT || 3000);
            await progress("Igniting Socket", 300);
        });

        console.log(`\n${stamp()} ` + `CORE LOADED. ENGAGING MULTI-CPU WORKERS...`.green.bold);
        for (let i = 0; i < os.cpus().length; i++) cluster.fork();
        cluster.on('exit', () => cluster.fork());
    })();

} else {
    // --- 🧬 WORKER LOGIC ---
    const c = new Client({ 
        intents: 32767, 
        makeCache: Options.cacheWithLimits({ MessageManager: 0, PresenceManager: 0, ThreadManager: 0, VoiceStateManager: 0 }) 
    });
    const q = new (require('p-queue').default)({ concurrency: 1 });
    const S = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY } });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 50 });

    const v = async url => {
        const res = await a({ url, responseType: 'stream', timeout: 8000, httpsAgent: agent });
        const tmp = `./${n(4)}.mp4`, w = require('fs').createWriteStream(tmp);
        return new Promise((ok, err) => {
            let b = 0; res.data.on('data', chunk => { if ((b += chunk.length) > 2e6) { w.end(); res.data.destroy(); } });
            res.data.pipe(w); 
            w.on('finish', () => {
                const f = spawn('ffprobe', ['-v', '0', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]);
                let o = ''; f.stdout.on('data', k => o += k);
                f.on('close', () => { require('fs').unlink(tmp, ()=>{}); parseFloat(o) <= 60 ? ok(res) : err(); });
            });
        });
    };

    c.on('interactionCreate', async i => {
        if (i.isChatInputCommand()) {
            if (i.commandName === 'profile') {
                const u = await U.findOne({ i: i.user.id }).lean();
                return i.reply({ embeds: [new EmbedBuilder().setColor(0xFF00FF).setTitle(i.user.username).addFields({ name: 'ELO', value: `${u?.e || 0}`, inline: 1 }, { name: 'RANK', value: RM[u?.r] || 'N/A', inline: 1 })], ephemeral: 1 });
            }
            if (i.commandName === 'quality') return i.showModal(new ModalBuilder().setCustomId('q').setTitle('💠').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c').setLabel('K').setStyle(1)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('U').setStyle(1))));
            if (i.commandName === 'submit') return i.showModal(new ModalBuilder().setCustomId('s').setTitle('🚀').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('L').setStyle(1))));
            
            if (i.commandName === 'nuke') {
                const pos = i.channel.position; const newCh = await i.channel.clone();
                await i.channel.delete(); await newCh.setPosition(pos);
                return newCh.send("☢️ **CHANNEL_RESTORED_BY_VOIDLESS**");
            }
            if (i.commandName === 'clear') {
                const amt = i.options.getInteger('amt'); await i.channel.bulkDelete(amt > 100 ? 100 : amt);
                return i.reply({ content: `🧹 Purged ${amt} messages.`, ephemeral: 1 });
            }
            if (i.commandName === 'ban') {
                const target = i.options.getUser('user'); const reason = i.options.getString('reason') || 'Voidless Exile';
                await i.guild.members.ban(target, { reason });
                return i.reply({ content: `🔨 **${target.tag}** was cast into the void.`, ephemeral: 1 });
            }
        }

        if (i.isModalSubmit()) {
            if (i.customId === 's') {
                const u = i.fields.getTextInputValue('u'), r = new ActionRowBuilder().addComponents(RM.slice(0, 5).map(k => new ButtonBuilder().setCustomId(`rk_${k}_${i.user.id}`).setLabel(k).setStyle(ButtonStyle.Secondary)));
                const ch = await i.client.channels.fetch(CONFIG.REVIEW);
                await ch.send({ content: `📥 **Target Submission:** ${i.user.tag}\n${u}`, components: [r] });
                return i.reply({ content: '📡 Data synced.', ephemeral: 1 });
            }
            if (i.customId === 'q') {
                const k = i.fields.getTextInputValue('c').toUpperCase(), url = i.fields.getTextInputValue('u');
                await i.deferReply({ ephemeral: 1 });
                const qCode = await Q.findOne({ c: k, u: false }).lean();
                if (!qCode) return i.editReply('❌ Invalid Code');
                q.add(async () => {
                    let ff; try {
                        const res = await v(url), pt = new PassThrough({ highWaterMark: 8e6 });
                        ff = spawn('ffmpeg', ['-i', 'pipe:0', '-vf', 'hqdn3d=1:1:4:4,unsharp=3:3:0.5:3:3:0,scale=1280:-2', '-c:v', 'libx264', '-crf', '18', '-preset', 'superfast', '-tune', 'fastdecode', '-threads', '1', '-f', 'mp4', 'pipe:1']);
                        const up = S.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: `v_${n(12)}.mp4`, Body: pt, ContentType: 'video/mp4' }));
                        await Promise.all([promisify(pipeline)(res.data, ff.stdin), promisify(pipeline)(ff.stdout, pt), up]);
                        await i.editReply(`✅ ${CONFIG.BASE}`); await Q.updateOne({ _id: qCode._id }, { u: true });
                    } catch { ff?.kill('SIGKILL'); i.editReply('❌ Processing Error'); }
                });
            }
        }

        if (i.isButton() && i.customId.startsWith('rk_')) {
            const [, rk, uid] = i.customId.split('_'), d = R[rk];
            await i.deferUpdate();
            await U.findOneAndUpdate({ i: uid }, { $inc: { e: d.e }, $set: { r: d.v } }, { upsert: 1 });
            const member = await i.guild.members.fetch(uid).catch(() => {});
            if (member) {
                const toRemove = member.roles.cache.filter(role => R_IDS.has(role.id) && role.id !== d.i);
                if (toRemove.size > 0) await member.roles.remove(toRemove);
                await member.roles.add(d.i);
            }
        }
    });

    m.connect(process.env.MONGO_URI, { maxPoolSize: 10 }).then(() => c.login(process.env.DISCORD_TOKEN));
}
