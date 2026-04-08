/**
 * TERMINAL V6: ARCHITECT HYPER-DRIVE [MAX_OUTPUT]
 * Status: STABLE | Logic: UNIFIED | UI: CYBERPUNK
 */

require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, EmbedBuilder 
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const colors = require('colors');

let Commands = require('./commands.js');

// [01] CONFIGURATION
const SETTINGS = {
    OWNERS: ["1399094217846030346", "1347959266539081768"],
    ADMIN_PASS: "angieloveschicken",
    PORT: process.env.PORT || 3000
};

// [02] DATABASE MODELS
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

// [03] STATE & TELEMETRY
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

// [04] MAX-OUTPUT RENDER ENGINE
const RenderEngine = {
    queue: [],
    busy: false,
    async add(message, url, user, statusMsg) {
        this.queue.push({ message, url, user, statusMsg });
        this.process();
    },
    async process() {
        if (this.busy || !this.queue.length) return;
        this.busy = true;
        const job = this.queue.shift();
        const out = path.join(__dirname, `temp_${job.message.id}.mp4`);

        const progressEmbed = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setTitle('💠 RENDERING_V6_ACTIVE')
            .setDescription('`[▓▓▓▓▓▓░░░░░░░░░] 45%` - **ALLOCATING_4K_CORES**')
            .setFooter({ text: 'High-Priority Processing...' });

        await job.statusMsg.edit({ content: '', embeds: [progressEmbed] }).catch(() => {});

        ffmpeg(job.url)
            .outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 18", "-preset superfast"])
            .on('end', async () => {
                const finishEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🟢 RENDER_SUCCESS').setDescription('Data delivered to Secure DMs.');
                await job.message.author.send({ content: "📦 **ARCHITECT_EXPORT_COMPLETE**", files: [out] }).catch(() => {});
                await job.statusMsg.edit({ embeds: [finishEmbed] }).catch(() => {});
                if (fs.existsSync(out)) fs.unlinkSync(out);
                this.busy = false;
                this.process();
            })
            .on('error', (e) => {
                State.log("ERROR", `Render Failed: ${e.message}`);
                this.busy = false;
                this.process();
            })
            .save(out);
    }
};

const client = new Client({ intents: [3276799], partials: [Partials.Channel, Partials.GuildMember] });
const app = express();
const server = http.createServer(app);
State.io = new Server(server);

// [06] HOT-RELOAD MESSAGE LISTENER
client.on('messageCreate', async (m) => {
    if (m.author.bot || !m.content.startsWith('!')) return;
    try {
        delete require.cache[require.resolve('./commands.js')];
        Commands = require('./commands.js');
        await Commands.handle(m, client, State, RenderEngine, User);
    } catch (e) { State.log("CMD_ERR", e.message); }
});

// [07] ULTIMATE INTERACTION LISTENER (FIXED BROADCAST)
client.on('interactionCreate', async (i) => {
    if (i.isButton() && i.customId === 'submit_content') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('🚀 ARCHITECT_UPLOADER');
        const linkInput = new TextInputBuilder().setCustomId('link').setLabel("REPLAY/VIDEO LINK").setStyle(TextInputStyle.Short).setRequired(true);
        const descInput = new TextInputBuilder().setCustomId('desc').setLabel("INTEL/NOTES").setStyle(TextInputStyle.Paragraph).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(linkInput), new ActionRowBuilder().addComponents(descInput));
        await i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const link = i.fields.getTextInputValue('link');
        const desc = i.fields.getTextInputValue('desc') || "No Intel Provided.";
        
        const card = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
            .setTitle('📥 INBOUND_DATA_STREAM')
            .addFields(
                { name: '👤 OPERATIVE', value: `${i.user}`, inline: true },
                { name: '🔗 TARGET_URL', value: link },
                { name: '📝 INTEL', value: `\`\`\`${desc}\`\`\`` },
                { name: '📊 STATUS', value: '`🟡 PENDING_VERIFICATION`', inline: true }
            )
            .setFooter({ text: `SRC_ID: ${i.user.id}` }).setTimestamp();

        try {
            // STEP 1: Force send to the channel first
            await i.channel.send({ embeds: [card] });
            
            // STEP 2: Reply to the user to close the modal
            const ack = await i.reply({ content: `📡 **DATA_STREAM_SYNCED**`, fetchReply: true });
            
            // STEP 3: Auto-delete the user notification
            setTimeout(() => ack.delete().catch(() => {}), 10000);
            
            State.log("SUBMIT", `${i.user.username} synced data to channel.`);
        } catch (err) {
            console.error("❌ BROADCAST FAILED:".red, err.message);
        }
    }
});

// [08] THE ICONIC HYPER-DRIVE BOOT
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
        { id: "API_GATEWAY", op: () => server.listen(SETTINGS.PORT) },
        { id: "SYNC_CACHE", op: async () => {
            const s = await GlobalSettings.findOne() || await GlobalSettings.create({});
            State.cmdCache = s.toggles;
        }},
        { id: "D_JS_LINK", op: () => client.login(process.env.DISCORD_TOKEN) }
    ];

    for (const task of tasks) {
        process.stdout.write(` ⚙️  ESTABLISHING ${task.id.padEnd(12)}... `);
        try { await task.op(); process.stdout.write(`${"STABLE".green.bold}\n`); await sleep(150); } 
        catch (e) { process.stdout.write(`${"FAILED".red.bold}\n`); process.exit(1); }
    }
    State.log("SYSTEM", "Architect Core V6.0.0 Online.");
}
boot();
