require('dotenv').config();
require('colors'); // Essential for the crazy boot visuals
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes 
} = require('discord.js');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const mongoose = require('mongoose');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// --- ☁️ CLOUDFLARE R2 SYSTEM ---
const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
    },
});

// --- ⚙️ CORE ARCHITECTURE ---
const CONFIG = {
    CLIENT_ID: process.env.CLIENT_ID || "1479871879496994943",
    MAIN_GUILD: "1491541282156449794",
    REVIEW_CHAN: "1489069664414859326",
    STAFF_ROLES: ["1491554076935192637", "1491542435312959529", "1491552861358788608"],
    OWNERS: ["1347959266539081768", "1407316453060907069"],
    FOOTER: "💠 ARCHITECT NEURAL LINK // V.11.0.0",
    RANKS: {
        "Z":   { id: "1491573028931244204", elo: 150, color: '#FFFFFF' },
        "SS":  { id: "1491572938888056904", elo: 100, color: '#FF0000' },
        "S+":  { id: "1491572855400304823", elo: 80, color: '#FFD700' },
        "S":   { id: "1491572750584774747", elo: 60, color: '#FFA500' },
        "A":   { id: "1491572617591652394", elo: 40, color: '#00FF00' },
        "B":   { id: "1491572503221375196", elo: 25, color: '#0000FF' },
        "C":   { id: "1491572406790262994", elo: 10, color: '#808080' }
    }
};

// --- 📊 NEURAL DATABASE ---
const User = mongoose.model('User', new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0 },
    lastSubmit: { type: Number, default: 0 }
}));

const QualityCode = mongoose.model('QualityCode', new mongoose.Schema({
    code: { type: String, unique: true },
    used: { type: Boolean, default: false }
}));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

// --- 💎 BOOST SYSTEM (AUTO-GEN) ---
client.on('guildMemberUpdate', async (oldM, newM) => {
    if (newM.guild.id !== CONFIG.MAIN_GUILD) return;
    if (!oldM.premiumSince && newM.premiumSince) {
        const code = `UPLINK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        await QualityCode.create({ code });
        newM.send({ embeds: [new EmbedBuilder().setTitle("💠 NEURAL ACCESS GRANTED").setDescription(`Transmission received. Your Quality Method Code:\n\`${code}\`\n\nUse \`/quality\` to upscale.`).setColor("#FF73FA")] }).catch(() => {});
    }
});

// --- ⚡ INTERACTION ENGINE ---
client.on('interactionCreate', async (i) => {
    if (i.isChatInputCommand()) {
        if (i.commandName === 'quality') {
            const modal = new ModalBuilder().setCustomId('q_modal').setTitle('💠 AI QUALITY UPLINK');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel("SECRET CODE").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("VIDEO DIRECT URL").setPlaceholder("Link to mp4/mov").setStyle(TextInputStyle.Short).setRequired(true))
            );
            return i.showModal(modal);
        }
        if (i.commandName === 'submit') {
            const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('🚀 TRANSMIT EDIT');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("EDIT URL").setStyle(TextInputStyle.Short).setRequired(true)));
            return i.showModal(modal);
        }
        if (i.commandName === 'code' && CONFIG.OWNERS.includes(i.user.id)) {
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            await QualityCode.create({ code });
            return i.reply({ content: `🎫 **NEW CODE:** \`${code}\``, ephemeral: true });
        }
        if (i.commandName === 'profile') {
            const u = await User.findOne({ discordId: i.user.id }) || await User.create({ discordId: i.user.id, username: i.user.username });
            const e = new EmbedBuilder().setTitle(`👤 DOSSIER: ${u.username.toUpperCase()}`).addFields({ name: 'RANK', value: u.rank, inline: true }, { name: 'ELO', value: `\`${u.elo}\``, inline: true }).setColor('#00FFCC');
            return i.reply({ embeds: [e] });
        }
    }

    if (i.isModalSubmit() && i.customId === 'q_modal') {
        await i.deferReply({ ephemeral: true });
        const inputCode = i.fields.getTextInputValue('code').toUpperCase();
        const videoUrl = i.fields.getTextInputValue('url');
        const qCheck = await QualityCode.findOne({ code: inputCode, used: false });
        if (!qCheck) return i.editReply("❌ **ACCESS DENIED.**");

        await i.editReply("⏳ **STABILIZING NEURAL LINK...**");
        const id = crypto.randomBytes(3).toString('hex');
        const inPath = `./in_${id}.mp4`;
        const outPath = `./out_${id}.mp4`;

        try {
            const res = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
            const writer = fs.createWriteStream(inPath);
            res.data.pipe(writer);
            writer.on('finish', () => {
                // High-End Alternative to Topaz: Precise Lanczos + Unsharp Denoising
                const cmd = `ffmpeg -i ${inPath} -vf "hqdn3d=1.5:1.5:6:6,unsharp=5:5:1.0:5:5:0.0,scale=1920:-1:flags=lanczos" -c:v libx264 -crf 14 -pix_fmt yuv420p ${outPath}`;
                exec(cmd, async (err) => {
                    if (err) return i.editReply("❌ **PROCESS ERROR.**");
                    const fileStream = fs.createReadStream(outPath);
                    const fileName = `upscale_${id}.mp4`;
                    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileName, Body: fileStream, ContentType: "video/mp4" }));
                    const finalUrl = `${process.env.BASE_URL}/${fileName}`;
                    await i.editReply({ content: `✅ **ENHANCEMENT COMPLETE**\n[📥 Download High Quality](${finalUrl})` });
                    qCheck.used = true; await qCheck.save();
                    fs.unlinkSync(inPath); fs.unlinkSync(outPath);
                });
            });
        } catch (e) { i.editReply("❌ **DOWNLOAD FAILED.**"); }
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        await i.deferReply({ ephemeral: true });
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const btns = Object.keys(CONFIG.RANKS).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary));
        await rChan.send({ content: `@everyone\n📥 **NEW UPLINK:** <@${i.user.id}>\n🔗 ${i.fields.getTextInputValue('url')}`, components: [new ActionRowBuilder().addComponents(btns.slice(0, 4)), new ActionRowBuilder().addComponents(btns.slice(4))] });
        return i.editReply("✅ Transmitted.");
    }

    if (i.isButton() && i.customId.startsWith('rank_')) {
        await i.deferUpdate();
        const [_, type, uid] = i.customId.split('_');
        const mainGuild = await client.guilds.fetch(CONFIG.MAIN_GUILD);
        const member = await mainGuild.members.fetch(uid).catch(() => null);
        if (!member) return;
        const u = await User.findOne({ discordId: uid }) || await User.create({ discordId: uid });
        u.rank = type; u.elo += CONFIG.RANKS[type].elo; await u.save();
        await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(()=>{});
        await member.roles.add(CONFIG.RANKS[type].id);
        await i.editReply({ content: `✅ **GRADED:** <@${uid}> as **${type}**`, components: [] });
    }
});

// --- 🛰️ CRAZY BOOT SYSTEM ---
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function boot() {
    console.clear();
    console.log(`
 █████╗ ██████╗  ██████╗██╗  ██╗██╗████████╗███████╗ ██████╗████████╗
██╔══██╗██╔══██╗██╔════╝██║  ██║██║╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝
███████║██████╔╝██║     ███████║██║   ██║   █████╗  ██║        ██║   
██╔══██║██╔══██╗██║     ██╔══██║██║   ██║   ██╔══╝  ██║        ██║   
██║  ██║██║  ██║╚██████╗██║  ██║██║   ██║   ███████╗╚██████╗   ██║   
╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝ ╚═════╝   ╚═╝   
    `.cyan.bold);

    const logs = [
        " [!] BYPASSING FIREWALL...",
        " [!] INITIATING NEURAL OVERLOAD...",
        " [#] SECURING DISCORD_GATEWAY : [ STABLE ]",
        " [#] SECURING SYNC_GUILD_CMD  : [ STABLE ]",
        " [#] SECURING CLOUDFLARE_R2   : [ STABLE ]",
        " [#] SECURING FFMPEG_ENGINE   : [ STABLE ]",
    ];

    for (const log of logs) {
        await sleep(400);
        console.log(log.magenta.bold);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(" [✓] MONGO_DB SINGULARITY CONNECTED".green.bold);
    
    await client.login(process.env.DISCORD_TOKEN);
    console.log(" [✓] ARCHITECT CORE IS LIVE".green.bold);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const cmdList = [
        { name: 'submit', description: 'Submit an edit link for review' },
        { name: 'quality', description: 'Access the AI Quality Panel' },
        { name: 'profile', description: 'View your dossier and rank' },
        { name: 'code', description: 'Owner: Generate a method code' }
    ];
    
    await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.MAIN_GUILD), { body: cmdList });
    console.log("\n >>> SINGULARITY FULLY STABILIZED <<< ".rainbow.bold);
}

boot();
