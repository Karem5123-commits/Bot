/**
 * TERMINAL V6: ARCHITECT HYPER-DRIVE [EXTREME UPGRADE]
 */

require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder 
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

const SETTINGS = {
    OWNERS: ["1399094217846030346", "1347959266539081768"],
    ADMIN_PASS: "angieloveschicken",
    PORT: process.env.PORT || 3000
};

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

        // UPGRADED: Dynamic Render Status
        const renderEmbed = new EmbedBuilder()
            .setColor(0xFFA500)
            .setTitle('⚙️ RENDERING_IN_PROGRESS')
            .setDescription('`[▓▓▓▓░░░░░░░░░░░] 25%` - **UPSSCALE_INIT**')
            .setFooter({ text: `Target: 4K 2160p | libx264` });

        await job.statusMsg.edit({ content: '', embeds: [renderEmbed] });

        ffmpeg(job.url)
            .outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 18", "-preset superfast"])
            .on('end', async () => {
                const successEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('🟢 RENDER_STABLE')
                    .setDescription('File has been dispatched to your DMs.');
                
                await job.message.author.send({ content: "📦 **YOUR_4K_RECON_DATA**", files: [out] }).catch(() => {});
                await job.statusMsg.edit({ embeds: [successEmbed] });
                
                if (fs.existsSync(out)) fs.unlinkSync(out);
                this.busy = false;
                this.process();
            }).save(out);
    }
};

const client = new Client({ intents: [3276799], partials: [Partials.Channel, Partials.GuildMember] });
const app = express();
const server = http.createServer(app);
State.io = new Server(server);

client.on('messageCreate', async (m) => {
    if (m.author.bot || !m.content.startsWith('!')) return;
    try {
        delete require.cache[require.resolve('./commands.js')];
        Commands = require('./commands.js');
    } catch (e) { return console.error(e); }
    await Commands.handle(m, client, State, RenderEngine, User);
});

// UPGRADED: Ultra-Submission Interaction
client.on('interactionCreate', async (i) => {
    if (i.isButton() && i.customId === 'submit_content') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('🚀 SECURE_UPLOADER_V6');
        const linkInput = new TextInputBuilder()
            .setCustomId('link').setLabel("REPLAY / CONTENT LINK").setStyle(TextInputStyle.Short).setRequired(true);
        const descInput = new TextInputBuilder()
            .setCustomId('desc').setLabel("INTEL / NOTES").setStyle(TextInputStyle.Paragraph).setRequired(false);
        
        modal.addComponents(new ActionRowBuilder().addComponents(linkInput), new ActionRowBuilder().addComponents(descInput));
        await i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const link = i.fields.getTextInputValue('link');
        const desc = i.fields.getTextInputValue('desc') || "No notes.";
        
        const embed = new EmbedBuilder()
            .setColor(0x00FFFF)
            .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
            .setTitle('📥 NEW_RECON_RECEIVED')
            .addFields(
                { name: '🔗 TARGET_LINK', value: `[Click to View](${link})` },
                { name: '📝 INTEL', value: `\`\`\`${desc}\`\`\`` },
                { name: '📊 STATUS', value: '`PENDING_VERIFICATION`', inline: true }
            )
            .setFooter({ text: `ARCHITECT_NETWORK | ID: ${i.user.id}` })
            .setTimestamp();

        await i.channel.send({ embeds: [embed] });
        const res = await i.reply({ content: `📡 **DATA_SYNC_SUCCESSFUL**`, fetchReply: true });
        setTimeout(() => res.delete().catch(() => {}), 10000);
    }
});

async function boot() {
    console.clear();
    console.log(`
    ██████╗ ███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗     
    ██╔══██╗██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║     
    ██████╔╝█████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║     
    ██╔══██╗██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║     
    ██████╔╝███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗
    ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝`.cyan.bold);

    const tasks = [
        { id: "DB_CLUSTER", op: () => mongoose.connect(process.env.MONGO_URI) },
        { id: "API_GATEWAY", op: () => server.listen(SETTINGS.PORT) },
        { id: "SYNC_CACHE", op: async () => {
            const s = await GlobalSettings.findOne() || await GlobalSettings.create({});
            State.cmdCache = s.toggles;
        }},
        { id: "DISCORD_LINK", op: () => client.login(process.env.DISCORD_TOKEN) }
    ];

    for (const task of tasks) {
        process.stdout.write(` ⚙️  INITIALIZING ${task.id.padEnd(12)}... `);
        try { await task.op(); process.stdout.write(`${"ONLINE".green.bold}\n`); await new Promise(r => setTimeout(r, 150)); } 
        catch (e) { process.stdout.write(`${"FAILED".red.bold}\n`); process.exit(1); }
    }
    State.log("SYSTEM", "Architect V6 Core: Fully Stabilized.");
}
boot();
