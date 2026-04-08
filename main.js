require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes 
} = require('discord.js');
const mongoose = require('mongoose');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- ⚙️ CONFIGURATION ---
const CONFIG = {
    CLIENT_ID: "1479871879496994943",
    MAIN_GUILD: "1491541282156449794",
    REVIEW_GUILD: "1488868987805892730",
    REVIEW_CHAN: "1489069664414859326",
    OWNERS: ["1347959266539081768", "1407316453060907069"],
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

// --- 📊 DATABASE SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0 },
    lastSubmit: { type: Number, default: 0 }
}));

const QualityCode = mongoose.model('QualityCode', new mongoose.Schema({
    code: { type: String, unique: true },
    used: { type: Boolean, default: false },
    generatedBy: String
}));

const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences
    ] 
});

// --- 🛠️ COMMANDS ---
const commands = [
    { name: 'submit', description: 'Initialize your edit uplink' },
    { name: 'profile', description: 'Access your operative dossier' },
    { name: 'leaderboard', description: 'View the elite top 10' },
    { name: 'code', description: 'Owner Only: Generate a Quality Code' },
    { name: 'quality', description: 'Upscale a video using a valid code' }
];

// --- 🛰️ BOOST DETECTION ---
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!oldMember.premiumSince && newMember.premiumSince) {
        const code = `BOOST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        await QualityCode.create({ code: code, generatedBy: "SYSTEM_BOOST" });
        try {
            await newMember.send(`💎 **THANK YOU FOR BOOSTING!**\nYour exclusive Quality Code is: \`${code}\`\nUse it with \`/quality\`.`);
        } catch (e) { console.log("Could not DM booster."); }
    }
});

// --- ⚡ INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    if (i.isChatInputCommand()) {
        const { commandName } = i;

        if (commandName === 'code') {
            if (!CONFIG.OWNERS.includes(i.user.id)) return i.reply({ content: "❌ Unauthorized.", ephemeral: true });
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            await QualityCode.create({ code, generatedBy: i.user.id });
            return i.reply({ content: `🎫 **NEW CODE GENERATED:** \`${code}\``, ephemeral: true });
        }

        if (commandName === 'quality') {
            const modal = new ModalBuilder().setCustomId('quality_modal').setTitle('QUALITY UPLINK');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('code_input').setLabel("PASTE CODE").setStyle(TextInputStyle.Short).setRequired(true)
                ), 
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('video_url').setLabel("VIDEO LINK (Discord/Direct)").setStyle(TextInputStyle.Short).setRequired(true)
                )
            );
            return i.showModal(modal);
        }

        if (commandName === 'profile') {
            const u = await User.findOne({ discordId: i.user.id }) || await User.create({ discordId: i.user.id, username: i.user.username });
            const embed = new EmbedBuilder().setTitle(`DATA: ${u.username}`).setColor(CONFIG.RANKS[u.rank]?.color || '#FFFFFF')
                .addFields({ name: 'RANK', value: `\`${u.rank}\``, inline: true }, { name: 'ELO', value: `\`${u.elo}\``, inline: true });
            return i.reply({ embeds: [embed] });
        }
        
        if (commandName === 'leaderboard') {
            const top = await User.find().sort({ elo: -1 }).limit(10);
            const desc = top.map((u, idx) => `**${idx+1}.** ${u.username} ┃ \`${u.rank}\` ┃ \`${u.elo}\``).join('\n');
            return i.reply({ embeds: [new EmbedBuilder().setTitle("🏆 LEADERBOARD").setDescription(desc || "No data.").setColor("#00FFCC")] });
        }

        if (commandName === 'submit') {
            const u = await User.findOne({ discordId: i.user.id }) || await User.create({ discordId: i.user.id, username: i.user.username });
            if (Date.now() - u.lastSubmit < 300000) return i.reply({ content: "⏳ **COOLDOWN:** Wait 5 mins.", ephemeral: true });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_modal').setLabel('START UPLINK').setStyle(ButtonStyle.Primary));
            return i.reply({ content: "### ⚡ OPERATIVE_UPLINK", components: [row], ephemeral: true });
        }
    }

    if (i.isModalSubmit() && i.customId === 'quality_modal') {
        await i.deferReply({ ephemeral: true });
        const codeVal = i.fields.getTextInputValue('code_input');
        const videoUrl = i.fields.getTextInputValue('video_url');

        const validCode = await QualityCode.findOne({ code: codeVal, used: false });
        if (!validCode) return i.editReply("❌ Invalid or used code.");

        await i.editReply("⚙️ **PROCESSING:** Downloading and upscaling video... This may take a few minutes.");
        
        try {
            const inputPath = path.join(__dirname, `in_${i.user.id}.mp4`);
            const outputPath = path.join(__dirname, `out_${i.user.id}.mp4`);
            
            const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
            const writer = fs.createWriteStream(inputPath);
            response.data.pipe(writer);
            await new Promise((resolve) => writer.on('finish', resolve));

            ffmpeg(inputPath)
                .outputOptions([
                    '-vf', 'scale=3840:2160:flags=lanczos,unsharp=5:5:1.0:5:5:0.0',
                    '-c:v libx264',
                    '-crf 18',
                    '-preset slow',
                    '-pix_fmt yuv420p'
                ])
                .on('end', async () => {
                    const fileBuffer = fs.readFileSync(outputPath);
                    const fileName = `upscale_${Date.now()}.mp4`;
                    
                    await s3.send(new PutObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: fileName,
                        Body: fileBuffer,
                        ContentType: "video/mp4"
                    }));

                    validCode.used = true;
                    await validCode.save();

                    const downloadUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;
                    await i.editReply(`✅ **UPSCALE COMPLETE:** [Download Here](${downloadUrl})`);
                    
                    fs.unlinkSync(inputPath);
                    fs.unlinkSync(outputPath);
                })
                .on('error', (err) => {
                    console.error(err);
                    i.editReply("❌ Upscale failed. File might be too large for Railway memory.");
                })
                .save(outputPath);

        } catch (e) {
            i.editReply(`❌ Error: ${e.message}`);
        }
    }

    if (i.isButton() && i.customId === 'open_modal') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('SUBMIT EDIT');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("URL").setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const btns = Object.keys(CONFIG.RANKS).map(r => new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary));
        
        const msg = await rChan.send({ 
            content: `📥 **NEW SUBMISSION:** <@${i.user.id}>\n${i.fields.getTextInputValue('url')}`, 
            components: [new ActionRowBuilder().addComponents(btns.slice(0, 4)), new ActionRowBuilder().addComponents(btns.slice(4))] 
        });
        await msg.startThread({ name: `Feedback: ${i.user.username}` }); 
        await User.findOneAndUpdate({ discordId: i.user.id }, { lastSubmit: Date.now() });
        return i.reply({ content: "✅ **SENT**", ephemeral: true });
    }

    if (i.isButton() && i.customId.startsWith('rank_')) {
        const [_, type, uid] = i.customId.split('_');
        const mainGuild = client.guilds.cache.get(CONFIG.MAIN_GUILD);
        const member = await mainGuild?.members.fetch(uid).catch(() => null);
        if (!member) return i.reply({ content: "❌ USER_GONE", ephemeral: true });

        const targetUser = await User.findOne({ discordId: uid });
        const rankOrder = ["None", "C", "B", "A", "S", "S+", "SS", "Z"];
        const oldIdx = rankOrder.indexOf(targetUser.rank);
        const newIdx = rankOrder.indexOf(type);

        let eloChange = CONFIG.RANKS[type].elo;
        if (newIdx > oldIdx) eloChange = Math.floor(eloChange * 1.5); 
        if (newIdx < oldIdx) eloChange = -Math.abs(eloChange); 

        await User.findOneAndUpdate({ discordId: uid }, { rank: type, $inc: { elo: eloChange } });
        
        const role = mainGuild.roles.cache.get(CONFIG.RANKS[type].id);
        if (role) {
            const allRankIds = Object.values(CONFIG.RANKS).map(r => r.id);
            await member.roles.remove(allRankIds).catch(() => {});
            await member.roles.add(role);
        }
        return i.update({ content: `✅ **RANKED:** <@${uid}> → **${type}**`, components: [] });
    }
});

// --- 🛰️ THE CRAZY BOOT SYSTEM ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    console.log(`
    \u001b[1;31m  [!] BYPASSING CARRIER FIREWALL...
    \u001b[1;33m  [!] INITIATING NEURAL OVERLOAD...
    \u001b[1;35m
    ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗
    ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝
    ██████╔╝█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ 
    ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  
    ██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   
    ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝   
    \u001b[0m`);

    const stages = [
        "MONGO_ATLAS", 
        "DISCORD_GATEWAY", 
        "WIPE_GLOBAL_CMD", 
        "SYNC_GUILD_CMD", 
        "CLOUDFLARE_R2", 
        "FFMPEG_ENGINE"
    ];

    for (const stage of stages) {
        process.stdout.write(` \u001b[1;37m[#] SECURING ${stage.padEnd(16)} : `);
        await sleep(350); // Cinematic pause
        process.stdout.write(`\u001b[1;32m [ STABLE ]\n\u001b[0m`);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        // Wipe old global duplicate commands
        await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: [] });
        
        // Sync new Guild commands instantly
        const guilds = [CONFIG.MAIN_GUILD, CONFIG.REVIEW_GUILD];
        for (const gId of guilds) {
            await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, gId), { body: commands });
        }

        console.log(`\n \u001b[1;35m[!] SINGULARITY ACTIVE : Z-TIER ONLINE\u001b[0m\n`);
    } catch (e) { 
        console.log(`\n\u001b[1;31m[!] BOOT_FAILURE: ${e.message}\u001b[0m`); 
    }
}

boot();
