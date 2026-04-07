require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, AttachmentBuilder 
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const colors = require('colors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

// --- ⚙️ CONFIGURATION ---
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
    },
    autoPurge: (msgs) => {
        setTimeout(() => msgs.forEach(m => m?.deletable && m.delete().catch(() => {})), CONFIG.PURGE_DELAY);
    },
    getCmd: (str) => ['quality', 'submit', 'rankcard', 'serverstats'].find(c => str.toLowerCase().includes(c))
};

// --- 🌐 API ROUTES ---
app.get('/api/status', (req, res) => res.json({ online: client.isReady(), ping: client.ws.ping }));
app.get('/api/dashboard', async (req, res) => {
    const stats = await User.aggregate([{ $group: { _id: null, users: { $sum: 1 }, elo: { $sum: "$elo" } } }]);
    res.json({ users: stats[0]?.users || 0, totalElo: stats[0]?.elo || 0, liveFeed: feed });
});
app.get('/api/leaderboard', async (req, res) => {
    const top = await User.find().sort({ elo: -1 }).limit(50);
    res.json(top.map((u, i) => ({ pos: i+1, name: u.username, elo: u.elo, rank: u.rank })));
});

// --- 🚀 BOT CORE ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || m.guildId !== CONFIG.MAIN_GUILD) return;

    const u = await User.findOneAndUpdate(
        { discordId: m.author.id }, 
        { username: m.author.username, $inc: { xp: 5 } }, 
        { upsert: true, new: true }
    );

    const cmd = m.content.startsWith('!') ? Kernel.getCmd(m.content.slice(1)) : null;
    if (!cmd) return;

    if (cmd === 'quality') {
        if (!u.premiumCode && (u.level < 20 || u.hasUsedFreeRender)) return m.reply("❌ Level 20 or Boost required.");
        const att = m.attachments.first();
        if (!att?.contentType?.startsWith('video')) return m.reply("⚠️ Attach a video file.");

        const status = await m.reply("⚙️ **UPSCALE_INIT...**");
        const out = `./out_${m.id}.mp4`;

        ffmpeg(att.url).outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 18", "-preset superfast"])
            .on('end', async () => {
                await m.author.send({ content: "✅ 4K Render Complete", files: [out] }).catch(() => {});
                status.edit("🟢 Done. Check DMs.");
                Kernel.logFeed("RENDER", `${m.author.username} finished upscale.`);
                if (!u.premiumCode) { u.hasUsedFreeRender = true; await u.save(); }
                if (fs.existsSync(out)) fs.unlinkSync(out);
                Kernel.autoPurge([m, status]);
            }).save(out);
    } else {
        let response;
        if (cmd === "rankcard") response = await m.reply(`\`\`\`ansi\n\u001b[1;35m🤖 IDENTITY: ${m.author.username}\u001b[0m\nRANK: ${u.rank} | ELO: ${u.elo}\n\`\`\``);
        if (cmd === "submit") response = await m.reply({ 
            content: "🧠 **Awaiting payload...**", 
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub').setLabel('UPLOAD').setStyle(ButtonStyle.Danger))] 
        });
        if (response) Kernel.autoPurge([m, response]);
    }
});

// --- ⚡ INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    const [action, target, uid] = i.customId.split('_');

    if (i.customId === 'sub') {
        const modal = new ModalBuilder().setCustomId('mod_sub').setTitle('DATA UPLOAD');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('link').setLabel('VIDEO LINK').setStyle(1).setRequired(true)));
        return i.showModal(modal);
    }

    if (i.isModalSubmit()) {
        if (i.customId === 'mod_sub') {
            const url = i.fields.getTextInputValue('link');
            const chan = client.guilds.cache.get(CONFIG.REVIEW_GUILD)?.channels.cache.get(CONFIG.REVIEW_CHAN);
            const r1 = new ActionRowBuilder().addComponents(Object.keys(CONFIG.RANKS).slice(0,3).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary)));
            const r2 = new ActionRowBuilder().addComponents(Object.keys(CONFIG.RANKS).slice(3).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary)));
            await chan.send({ content: `🧠 **SUBMISSION:** <@${i.user.id}>\n${url}`, components: [r1, r2] });
            return i.reply({ content: "✅ Transmitted.", ephemeral: true });
        }
        if (i.customId.startsWith('mod_msg_')) {
            const user = await client.users.fetch(uid).catch(() => null);
            if (user) await user.send(`📝 **STAFF FEEDBACK:** ${i.fields.getTextInputValue('txt')}`).catch(() => {});
            return i.reply({ content: "✅ Feedback Sent.", ephemeral: true });
        }
    }

    if (action === 'sel') {
        const rData = CONFIG.RANKS[target];
        const member = await client.guilds.cache.get(CONFIG.MAIN_GUILD)?.members.fetch(uid).catch(() => null);
        await User.findOneAndUpdate({ discordId: uid }, { rank: target, $inc: { elo: rData.elo }, $push: { submissions: { rank: target, date: new Date(), eloGained: rData.elo } } });
        
        if (member) {
            await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
            await member.roles.add(rData.id).catch(() => {});
            member.send(`✅ **RANKED:** You are now **${target}** (+${rData.elo} ELO).`).catch(() => {});
        }
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`msg_ask_${uid}`).setLabel('✍️ ADD FEEDBACK').setStyle(ButtonStyle.Success));
        await i.update({ content: `✅ Ranked <@${uid}> to **${target}**.`, components: [row] });
    }

    if (action === 'msg') {
        const modal = new ModalBuilder().setCustomId(`mod_msg_${uid}`).setTitle('FEEDBACK');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('txt').setLabel('MESSAGE').setStyle(2).setRequired(true)));
        await i.showModal(modal);
    }
});

// --- 🛰️ BOOT ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const step = async (n) => {
        process.stdout.write(`⚙️ ${n.padEnd(30)} `);
        for (let i = 0; i <= 100; i += 25) {
            process.stdout.write(`\r⚙️ ${n.padEnd(30)} [${"▰".repeat(i/5).magenta}${"▱".repeat(20-i/5).gray}] ${i}%`);
            await sleep(60);
        }
        console.log(" ✅".green);
    };

    console.log(`\n${"████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗ ██╗".magenta}\n${"╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗██║".magenta}\n${"   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║██║".magenta}\n${"   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║██║".magenta}\n${"   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║███████╗".magenta}\n${"   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝".magenta}\n\n${"🧠 >>> TERMINAL ACTIVATED <<<".cyan}\n`);
    
    await step("Kernel Engine"); await step("Database Link"); await step("API Core"); await step("Discord Gateway");

    try {
        await mongoose.connect(process.env.MONGO_URI);
        app.listen(process.env.PORT || 3000);
        client.once('ready', () => {
            console.log(`\n${"🟢 >>> LINK ESTABLISHED <<<".cyan}\n🤖 ${client.user.tag}\n`);
            client.user.setActivity(`TERMINAL v21`, { type: 3 });
        });
        await client.login(process.env.DISCORD_TOKEN);
    } catch (e) { console.log("❌ CRITICAL ERROR: ".red + e.message); }
}

boot();
