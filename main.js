/**
 * TERMINAL V6: ARCHITECT HYPER-DRIVE
 * Final Integration: Diagnostic Boot + Render Queue + WebSocket Dashboard
 */

require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionFlagsBits 
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const colors = require('colors');
const { execSync } = require('child_process');
const os = require('os');

// ==========================================
// [01] CONFIGURATION
// ==========================================
const SETTINGS = {
    OWNERS: ["1399094217846030346", "1347959266539081768"],
    ADMIN_PASS: "angieloveschicken",
    PORT: process.env.PORT || 3000
};

// ==========================================
// [02] DATABASE MODELS
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
    discordId: { type: String, index: true, unique: true },
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0, index: -1 },
    hasUsedFreeRender: { type: Boolean, default: false },
    premiumCode: { type: String, default: null }
}));

const GlobalSettings = mongoose.model('Settings', new mongoose.Schema({
    toggles: { type: Map, of: Boolean, default: {} }
}));

// ==========================================
// [03] SYSTEM STATE & TELEMETRY
// ==========================================
const State = {
    feed: [],
    cmdCache: new Map(),
    io: null,
    log(type, msg) {
        const entry = { type, msg, time: Date.now() };
        this.feed.unshift(entry);
        if (this.feed.length > 25) this.feed.pop();
        if (this.io) this.io.emit('telemetry', entry);
        console.log(`[${type}]`.cyan + ` ${msg}`);
    }
};

// ==========================================
// [04] APEX RENDER ENGINE
// ==========================================
const RenderEngine = {
    queue: [],
    busy: false,
    async add(message, url, user, statusMsg) {
        this.queue.push({ message, url, user, statusMsg });
        State.log("QUEUE", `Position #${this.queue.length} for ${user.username}`);
        if (State.io) State.io.emit('queue_size', this.queue.length);
        this.process();
    },
    async process() {
        if (this.busy || !this.queue.length) return;
        this.busy = true;
        const job = this.queue.shift();
        const out = path.join(__dirname, `temp_${job.message.id}.mp4`);
        if (State.io) State.io.emit('queue_size', this.queue.length);

        job.statusMsg.edit("💠 **ENGINE_RUNNING: 4K_OVERDRIVE**");

        ffmpeg(job.url)
            .outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 18", "-preset superfast"])
            .on('error', (err) => {
                State.log("ERROR", `Render failed: ${err.message}`);
                job.statusMsg.edit("❌ **SYSTEM_ERROR:** Sequence aborted.");
                this.cleanup(out);
            })
            .on('end', async () => {
                await job.message.author.send({ content: "✅ **4K_RENDER_COMPLETE**", files: [out] }).catch(() => {});
                job.statusMsg.edit("🟢 **SUCCESS:** Check DMs.");
                State.log("SUCCESS", `Render delivered to ${job.user.username}`);
                if (!job.user.premiumCode) {
                    job.user.hasUsedFreeRender = true;
                    await job.user.save();
                }
                this.cleanup(out);
            }).save(out);
    },
    cleanup(file) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        this.busy = false;
        this.process();
    }
};

// ==========================================
// [05] NETWORKING & DISCORD SETUP
// ==========================================
const client = new Client({ intents: [3276799], partials: [Partials.Channel, Partials.GuildMember] });
const app = express();
const server = http.createServer(app);
State.io = new Server(server);

app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

app.get('/api/init', async (req, res) => {
    const stats = await User.aggregate([{ $group: { _id: null, users: { $sum: 1 }, elo: { $sum: "$elo" } } }]);
    res.json({ users: stats[0]?.users || 0, elo: stats[0]?.elo || 0, feed: State.feed, toggles: Object.fromEntries(State.cmdCache) });
});

app.post('/api/admin/toggle', async (req, res) => {
    if (req.body.password !== SETTINGS.ADMIN_PASS) return res.status(403).send("DENIED");
    const s = await GlobalSettings.findOne();
    s.toggles.set(req.body.command, req.body.state);
    await s.save();
    State.cmdCache = s.toggles;
    State.io.emit('sync_toggles', Object.fromEntries(State.cmdCache));
    res.json({ success: true });
});

client.on('messageCreate', async (m) => {
    if (m.author.bot || !m.content.startsWith('!')) return;
    const args = m.content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    if (State.cmdCache.get(cmd) === false && !SETTINGS.OWNERS.includes(m.author.id)) return m.reply("🔒 **LOCKED**");

    if (cmd === "quality") {
        const u = await User.findOneAndUpdate({ discordId: m.author.id }, { username: m.author.username }, { upsert: true, new: true });
        if (!u.premiumCode && (u.level < 20 || u.hasUsedFreeRender)) return m.reply("❌ Level 20+ Required.");
        const video = m.attachments.first();
        if (!video?.contentType?.startsWith('video')) return m.reply("⚠️ Attach a video.");
        RenderEngine.add(m, video.url, u, await m.reply("🛰️ **ANALYZING...**"));
    }
    if (cmd === "rankcard") {
        const data = await User.findOne({ discordId: m.author.id });
        m.reply(`\`\`\`ansi\n\u001b[1;36m[USER]:\u001b[0m ${m.author.username}\n\u001b[1;35m[ELO]:\u001b[0m ${data?.elo || 0}\`\`\``);
    }
});

// ==========================================
// [06] THE HYPER-DRIVE BOOT SYSTEM
// ==========================================
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    // Hardware Diagnostic
    const totalRAM = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const cpuModel = os.cpus()[0].model.split('@')[0].trim();

    console.log(`
    ██████╗ ███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗     
    ██╔══██╗██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║     
    ██████╔╝█████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║     
    ██╔══██╗██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║     
    ██████╔╝███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗
    ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝`.cyan.bold);

    console.log(`\n ${" SYSTEM DIAGNOSTIC ".bgCyan.black.bold} `);
    console.log(` 🛰️  HOST: ${os.hostname().yellow} | 🧠  CORE: ${cpuModel.dim} | 📟  MEM: ${totalRAM}GB`);
    console.log("-".repeat(65).dim);

    // Environmental Checks
    const check = (n, c) => {
        process.stdout.write(` > CHECKING ${n.padEnd(20)} `);
        const res = c();
        console.log(` [ ${res ? "PASSED".green.bold : "FAILED".red.bold} ]`);
        return res;
    };

    if (!check("ENVIRONMENT_VARS", () => process.env.DISCORD_TOKEN && process.env.MONGO_URI)) process.exit(1);
    check("FFMPEG_BINARY", () => { try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; } catch(e) { return false; } });

    console.log("-".repeat(65).dim);
    console.log(`\n ${" INITIALIZING NEURAL LINK ".bgMagenta.white.bold} `);

    const tasks = [
        { id: "DB_SYNC", op: () => mongoose.connect(process.env.MONGO_URI) },
        { id: "WEB_CORE", op: () => server.listen(SETTINGS.PORT) },
        { id: "CACHE_INT", op: async () => {
            const s = await GlobalSettings.findOne() || await GlobalSettings.create({});
            State.cmdCache = s.toggles;
        }},
        { id: "DISCORD_API", op: () => client.login(process.env.DISCORD_TOKEN) }
    ];

    for (const task of tasks) {
        process.stdout.write(` ⚙️  ESTABLISHING ${task.id.padEnd(12)}... `);
        try {
            await task.op();
            process.stdout.write(`${"STABLE".green.bold}\n`);
            await sleep(150);
        } catch (e) {
            process.stdout.write(`${"CRASHED".red.bold}\n`);
            console.log(`   └─ Error: ${e.message}`.red.dim);
            process.exit(1);
        }
    }

    console.log("\n" + "=".repeat(65).cyan);
    console.log(` ${" SYSTEM STATUS: OPTIMAL ".bgGreen.black.bold} `);
    console.log(` 👤 IDENTITY: ${client.user.tag.cyan} | 🌐 PORT: ${SETTINGS.PORT}`);
    console.log("=".repeat(65).cyan + "\n");
    
    State.log("SYSTEM", "Architect V6 Integrated Hyper-Drive Online.");
}

boot();
