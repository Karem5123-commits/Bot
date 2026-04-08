/**
 * TERMINAL V6: ARCHITECT HYPER-DRIVE
 * Final Build: Instant Panels + Zero-Footprint Logic
 */

require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle // Added for Panel
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

// Import the external command module
let Commands = require('./commands.js');

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
    SETTINGS: SETTINGS,
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

// ==========================================
// [06] MESSAGE LISTENER (HOT-RELOAD)
// ==========================================
client.on('messageCreate', async (m) => {
    if (m.author.bot || !m.content.startsWith('!')) return;

    try {
        delete require.cache[require.resolve('./commands.js')];
        Commands = require('./commands.js');
    } catch (e) {
        return console.error("Failed to hot-reload commands.js:", e);
    }

    await Commands.handle(m, client, State, RenderEngine, User);
});

// ==========================================
// [07] INTERACTION LISTENER (FIXED SUBMISSION)
// ==========================================
client.on('interactionCreate', async (i) => {
    // 1. OPEN PANEL INSTANTLY (skip reply)
    if (i.isButton() && i.customId === 'submit_content') {
        const modal = new ModalBuilder()
            .setCustomId('submission_modal')
            .setTitle('Content Submission Portal');

        const linkInput = new TextInputBuilder()
            .setCustomId('content_link')
            .setLabel("Paste your link here")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://...')
            .setRequired(true);

        const descInput = new TextInputBuilder()
            .setCustomId('content_desc')
            .setLabel("Short Description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(linkInput),
            new ActionRowBuilder().addComponents(descInput)
        );

        await i.showModal(modal);
    }

    // 2. HANDLE SUBMISSION + 15s AUTO-DELETE
    if (i.isModalSubmit() && i.customId === 'submission_modal') {
        const link = i.fields.getTextInputValue('content_link');
        
        // Public confirmation so we can delete it later
        const confirmation = await i.reply({ 
            content: `✅ **SUBMISSION_RECEIVED:** Thank you, ${i.user.username}. This message will vanish in 15s.`, 
            fetchReply: true 
        });

        // 15-Second Auto-Delete
        setTimeout(() => {
            confirmation.delete().catch(() => {});
        }, 15000);

        State.log("SUBMISSION", `${i.user.username} submitted a link via Panel.`);
    }
});

// ==========================================
// [08] THE HYPER-DRIVE BOOT SYSTEM
// ==========================================
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    console.log(`
    ██████╗ ███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗     
    ██╔══██╗██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║     
    ██████╔╝█████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║     
    ██╔══██╗██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║     
    ██████╔╝███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗
    ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝`.cyan.bold);

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
            process.exit(1);
        }
    }
    
    State.log("SYSTEM", "Architect V6 Sync-Engine Online.");
}

boot();
