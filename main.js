require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, AttachmentBuilder, EmbedBuilder 
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const colors = require('colors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

// --- ⚙️ CONFIGURATION (RESTORED) ---
const CONFIG = {
    MAIN_GUILD: "1488203882130837704",    
    REVIEW_GUILD: "1488868987805892730",  
    REVIEW_CHAN: "1489069664414859326",   
    ADMIN_KEY: process.env.ADMIN_KEY || "OMEGA_SECURE_123",
    PURGE_DELAY: 15000,
    RANKS: {
        "SSS": { id: "1488208025859788860", elo: 100 },
        "SS+": { id: "1488208185633280041", elo: 75 },
        "SS":  { id: "1488208281930432602", elo: 50 },
        "S+":  { id: "1488208494170738793", elo: 40 },
        "S":   { id: "1488208584142753863", elo: 25 },
        "A":   { id: "1488208696759685190", elo: 10 }
    }
};

// --- 🗄️ DATABASE ---
const User = mongoose.model('User', new mongoose.Schema({
    discordId: String,
    username: String,
    rank: { type: String, default: "None" },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    elo: { type: Number, default: 0 },
    submissions: [{ rank: String, date: Date, eloGained: Number }],
    premiumCode: { type: String, default: null },
    hasUsedFreeRender: { type: Boolean, default: false }
}));

let feed = [];
const client = new Client({ intents: [3276799], partials: [Partials.Channel, Partials.GuildMember] });
const app = express(); app.use(express.json());

// --- 🛡️ KERNEL MODULES ---
const Kernel = {
    logFeed: (type, msg) => {
        feed.unshift({ type, msg, time: Date.now() });
        if (feed.length > 20) feed.pop();
        console.log(`[${type}]`.magenta.bold + ` > `.white + `${msg}`.cyan);
    },
    autoPurge: (msgs) => {
        setTimeout(() => msgs.forEach(m => m?.deletable && m.delete().catch(() => {})), CONFIG.PURGE_DELAY);
    },
    getCmd: (str) => ['quality', 'submit', 'rankcard', 'serverstats'].find(c => str.toLowerCase().includes(c))
};

// --- 🚀 MESSAGE LISTENER ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || m.guildId !== CONFIG.MAIN_GUILD) return;

    const u = await User.findOneAndUpdate(
        { discordId: m.author.id }, 
        { username: m.author.username, $inc: { xp: 10 } }, 
        { upsert: true, new: true }
    );

    const cmd = m.content.startsWith('!') ? Kernel.getCmd(m.content.slice(1)) : null;
    if (!cmd) return;

    if (cmd === 'quality') {
        if (!u.premiumCode && (u.level < 20 || u.hasUsedFreeRender)) return m.reply("⚠️ **SYSTEM_LOCK:** Level 20 or Premium Required.");
        const att = m.attachments.first();
        if (!att?.contentType?.startsWith('video')) return m.reply("🚫 **INVALID_STREAM:** Re-upload video file.");

        const statusEmbed = new EmbedBuilder()
            .setColor(0xFF00FF)
            .setTitle('🧬 NEURAL_RENDER_V6')
            .setDescription('`[▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒]` **INITIALIZING_4K_CORES**')
            .setTimestamp();
        
        const status = await m.reply({ embeds: [statusEmbed] });
        const out = `./out_${m.id}.mp4`;

        ffmpeg(att.url).outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 16", "-preset ultrafast"])
            .on('end', async () => {
                const doneEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('✅ EXPORT_STABLE').setDescription('Data packets delivered to DMs.');
                await m.author.send({ content: "📦 **ARCHITECT_OVERDRIVE_EXPORT**", files: [out] }).catch(() => {});
                status.edit({ embeds: [doneEmbed] });
                Kernel.logFeed("RENDER", `${m.author.username} | 4K_SUCCESS`);
                if (!u.premiumCode) { u.hasUsedFreeRender = true; await u.save(); }
                if (fs.existsSync(out)) fs.unlinkSync(out);
                Kernel.autoPurge([m, status]);
            }).save(out);
    } else {
        let response;
        if (cmd === "rankcard") {
            response = await m.reply(`\`\`\`ansi\n\u001b[1;35m[ ARCHITECT_ID: ${m.author.username} ]\u001b[0m\n\u001b[1;36mRANK:\u001b[0m \u001b[1;37m${u.rank}\u001b[0m\n\u001b[1;36mELO:\u001b[0m \u001b[1;32m${u.elo}\u001b[0m\n\`\`\``);
        }
        if (cmd === "submit") {
            const subPortal = new EmbedBuilder()
                .setColor(0x00FFFF)
                .setTitle('⚡ HIGH_TEMPO_UPLINK')
                .setDescription('Secure portal for rank-defining intel.');
            response = await m.reply({ 
                embeds: [subPortal], 
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub').setLabel('OPEN_PORTAL').setStyle(ButtonStyle.Danger))] 
            });
        }
        if (response) Kernel.autoPurge([m, response]);
    }
});

// --- ⚡ INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    const [action, target, uid] = i.customId.split('_');

    if (i.customId === 'sub') {
        const modal = new ModalBuilder().setCustomId('mod_sub').setTitle('🚨 RECON_DATA_TRANSMISSION');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('link').setLabel('VIDEO_URL').setStyle(1).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('notes').setLabel('ADDITIONAL_INTEL').setStyle(2).setRequired(false))
        );
        return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'mod_sub') {
        const url = i.fields.getTextInputValue('link');
        const notes = i.fields.getTextInputValue('notes') || "No notes provided.";
        const chan = client.guilds.cache.get(CONFIG.REVIEW_GUILD)?.channels.cache.get(CONFIG.REVIEW_CHAN);
        
        const reviewCard = new EmbedBuilder()
            .setColor(0xFF00FF)
            .setAuthor({ name: `INBOUND: ${i.user.username}`, iconURL: i.user.displayAvatarURL() })
            .setTitle('📥 RECON_DATA_UPLINK')
            .addFields(
                { name: '👤 OPERATIVE', value: `${i.user}`, inline: true },
                { name: '🔗 LINK', value: url },
                { name: '📝 NOTES', value: `\`\`\`${notes}\`\`\`` }
            ).setTimestamp();

        const r1 = new ActionRowBuilder().addComponents(Object.keys(CONFIG.RANKS).slice(0,3).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary)));
        const r2 = new ActionRowBuilder().addComponents(Object.keys(CONFIG.RANKS).slice(3).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary)));
        
        await chan.send({ embeds: [reviewCard], components: [r1, r2] });
        return i.reply({ content: "📡 **UPLINK_SUCCESS:** Your intel is being scrutinized.", ephemeral: true });
    }

    if (action === 'sel') {
        const rData = CONFIG.RANKS[target];
        const member = await client.guilds.cache.get(CONFIG.MAIN_GUILD)?.members.fetch(uid).catch(() => null);
        const updatedUser = await User.findOneAndUpdate({ discordId: uid }, { rank: target, $inc: { elo: rData.elo }, $push: { submissions: { rank: target, date: new Date(), eloGained: rData.elo } } }, { new: true });
        
        if (member) {
            await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
            await member.roles.add(rData.id).catch(() => {});
            const promoEmbed = new EmbedBuilder().setColor(0x00FF00).setTitle('🔱 RANK_UP_BROADCAST').setDescription(`### **${member.user.username}** has ascended to **${target}**!`).addFields({ name: '📊 TOTAL_ELO', value: `\`${updatedUser.elo}\``, inline: true });
            member.send({ embeds: [promoEmbed] }).catch(() => {});
            Kernel.logFeed("RANK", `OPERATIVE ${member.user.username} ASCENDED TO ${target}`);
        }
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`msg_ask_${uid}`).setLabel('✍️ DISPATCH FEEDBACK').setStyle(ButtonStyle.Success));
        await i.update({ content: `✅ **LEVEL_SYNC:** <@${uid}> set to **${target}**.`, embeds: [], components: [row] });
    }

    if (action === 'msg') {
        const modal = new ModalBuilder().setCustomId(`mod_msg_${uid}`).setTitle('OPERATIVE_FEEDBACK_UPLINK');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('txt').setLabel('ENTER MESSAGE').setStyle(2).setRequired(true)));
        await i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId.startsWith('mod_msg_')) {
        const user = await client.users.fetch(uid).catch(() => null);
        if (user) await user.send(`📝 **STAFF_FEEDBACK:** ${i.fields.getTextInputValue('txt')}`).catch(() => {});
        return i.reply({ content: "✅ Feedback Dispatched.", ephemeral: true });
    }
});

// --- 🛰️ THE HYPER-DRIVE BOOT SEQUENCE ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    console.log(`
    \u001b[1;35m  █████╗ ██████╗  ██████╗██╗  ██╗██╗████████╗███████╗ ██████╗████████╗
    \u001b[1;35m ██╔══██╗██╔══██╗██╔════╝██║  ██║██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝
    \u001b[1;36m ███████║██████╔╝██║     ███████║██║   ██║   █████╗  ██║        ██║   
    \u001b[1;36m ██╔══██║██╔══██╗██║     ██╔══██║██║   ██║   ██╔══╝  ██║        ██║   
    \u001b[1;34m ██║  ██║██║  ██║╚██████╗██║  ██║██║   ██║   ███████╗╚██████╗   ██║   
    \u001b[1;34m ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝ ╚═════╝   ╚═╝   \u001b[0m
    `.bold);

    console.log(` \u001b[1;37m[ \u001b[1;32mSYSTEM_VERSION: 6.0.0-VELOCITY \u001b[1;37m]`.bold);
    console.log(` \u001b[1;37m[ \u001b[1;36mKERNEL_STATUS: ENCRYPTED \u001b[1;37m]`.bold);
    console.log(` ------------------------------------------------------------------- \n`);

    const diagnostics = [
        { label: "NEURAL_LINK", target: "STABLE" },
        { label: "ELO_ROUTER", target: "ACTIVE" },
        { label: "FFMPEG_CORE", target: "READY" },
        { label: "MONGODB_ATLAS", target: "SYNCED" },
        { label: "DISCORD_GATEWAY", target: "AUTHENTICATED" }
    ];

    for (const diag of diagnostics) {
        let dots = "";
        for (let i = 0; i < 5; i++) {
            dots += ".";
            process.stdout.write(`\r \u001b[1;37mRUNNING ${diag.label}${dots.padEnd(5)}`);
            await sleep(100);
        }
        process.stdout.write(` \u001b[1;32m[ ${diag.target} ]\n\u001b[0m`);
        await sleep(50);
    }

    console.log(`\n \u001b[1;35m>>> INITIALIZING_HYPER_DRIVE... \u001b[0m`);

    try {
        await mongoose.connect(process.env.MONGO_URI);
        process.stdout.write(` \u001b[1;34m- DB_UPLINK:\u001b[0m \u001b[1;32mSUCCESS\n\u001b[0m`);
        
        app.listen(process.env.PORT || 3000);
        process.stdout.write(` \u001b[1;34m- API_GATEWAY:\u001b[0m \u001b[1;32mPORT_${process.env.PORT || 3000}\n\u001b[0m`);

        client.once('ready', () => {
            console.log(`\n \u001b[1;36m[!] BROADCASTING SIGNAL: ${client.user.tag}\u001b[0m`);
            console.log(` \u001b[1;32m[!] TERMINAL VELOCITY IS LIVE.\u001b[0m\n`);
            client.user.setActivity(`V6_TERMINAL`, { type: 3 });
        });

        await client.login(process.env.DISCORD_TOKEN);
    } catch (e) {
        console.log(`\n \u001b[1;31m[!] CRITICAL_FAILURE: ${e.message.toUpperCase()}\u001b[0m`);
        process.exit(1);
    }
}

boot();
