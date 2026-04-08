require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, EmbedBuilder, PermissionsBitField, ChannelType 
} = require('discord.js');
const mongoose = require('mongoose');
const colors = require('colors');

// --- ⚙️ MASTER CONFIG (HARD-CODED) ---
const CONFIG = {
    MAIN_GUILD: "1491541282156449794",
    REVIEW_GUILD: "1488868987805892730",
    REVIEW_CHAN: "1489069664414859326",
    OWNERS: ["1347959266539081768", "1407316453060907069"],
    ADMIN_PASS: "OPERATIVE_2026",
    RANKS: {
        "SSS": { id: "1491551154348228712", elo: 100, color: '#FFD700' },
        "SS+": { id: "1491551155564839012", elo: 75, color: '#FFFF00' },
        "SS":  { id: "1491551156596375703", elo: 50, color: '#00FF00' },
        "S+":  { id: "1491551157649277003", elo: 40, color: '#00FFFF' },
        "S":   { id: "1491551158416703650", elo: 25, color: '#FF4500' },
        "A":   { id: "1491551159666737232", elo: 10, color: '#FF00FF' }
    }
};

const User = mongoose.model('User', new mongoose.Schema({
    discordId: String,
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0 }
}));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers], 
    partials: [Partials.Channel, Partials.GuildMember] 
});

// --- 🚀 MESSAGE COMMANDS ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;
    
    let u = await User.findOneAndUpdate(
        { discordId: m.author.id }, 
        { username: m.author.username }, 
        { upsert: true, new: true }
    );

    if (!m.content.startsWith('!')) return;
    const args = m.content.slice(1).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    // !leaderboard - TOP 10 PLAYERS
    if (cmd === 'leaderboard' || cmd === 'lb' || cmd === 'top') {
        const topUsers = await User.find().sort({ elo: -1 }).limit(10);
        let description = "";
        
        topUsers.forEach((user, index) => {
            description += `**${index + 1}.** ${user.username} ┃ \`${user.rank}\` ┃ \`${user.elo} ELO\`\n`;
        });

        const lbEmbed = new EmbedBuilder()
            .setTitle("🏆 GLOBAL ELITE LEADERBOARD")
            .setColor("#00FFCC")
            .setDescription(description || "No data synchronized yet.")
            .setFooter({ text: "OPERATIVE RANKING SYSTEM" });
            
        return m.channel.send({ embeds: [lbEmbed] });
    }

    if (cmd === 'submit') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_modal').setLabel('OPEN SUBMISSION PANEL').setStyle(ButtonStyle.Primary).setEmoji('📥')
        );
        return m.channel.send({ content: `### ⚡ OPERATIVE_UPLINK\n<@${m.author.id}>, initialize your submission dossier below.`, components: [row] });
    }

    if (cmd === 'rankcard' || cmd === 'profile' || cmd === 'rank') {
        const embed = new EmbedBuilder()
            .setTitle(`DATALINK: ${u.username}`)
            .setColor(CONFIG.RANKS[u.rank]?.color || '#FFFFFF')
            .addFields(
                { name: '┃ RANK', value: `\`${u.rank}\``, inline: true },
                { name: '┃ ELO', value: `\`${u.elo}\``, inline: true }
            )
            .setThumbnail(m.author.displayAvatarURL())
            .setFooter({ text: 'OPERATIVE SYSTEM v3.0' });
        
        return m.reply({ embeds: [embed] });
    }

    if (cmd === 'build' && (CONFIG.OWNERS.includes(m.author.id) || m.member.permissions.has(PermissionsBitField.Flags.Administrator))) {
        await m.reply("🏗️ **BUILD_SEQUENCE_READY: Architecting Server...**");
        const guild = m.guild;
        const categories = [
            { name: "— ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ —", channels: ["┃rules", "┃announcements", "┃roles"] },
            { name: "— ꜱᴏᴄɪᴀʟ —", channels: ["┃general", "┃media", "┃bot-commands"] },
            { name: "— ᴛɪᴇʀꜱ —", channels: ["┃sss-chat", "┃world-class"] }
        ];
        for (const cat of categories) {
            const createdCat = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory });
            for (const chan of cat.channels) {
                await guild.channels.create({ name: chan, type: ChannelType.GuildText, parent: createdCat.id });
            }
        }
        return m.channel.send("✅ **SERVER_ARCHITECTURE_STABLE**");
    }
});

// --- ⚡ INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    if (i.isButton() && i.customId === 'open_modal') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('SUBMIT EDIT');
        const linkInput = new TextInputBuilder().setCustomId('url').setLabel("STREAMABLE / TIKTOK LINK").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(linkInput));
        return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const link = i.fields.getTextInputValue('url');
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const btns = Object.keys(CONFIG.RANKS).map(r => 
            new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary)
        );
        if (rChan) {
            await rChan.send({ 
                content: `📥 **NEW_SUBMISSION:** <@${i.user.id}>\n**URL:** ${link}`, 
                components: [new ActionRowBuilder().addComponents(btns.slice(0, 3)), new ActionRowBuilder().addComponents(btns.slice(3))] 
            });
        }
        return i.reply({ content: "✅ **UPLINK_SENT**", ephemeral: true });
    }

    if (i.isButton() && i.customId.startsWith('sel_')) {
        const [_, rank, uid] = i.customId.split('_');
        const rankData = CONFIG.RANKS[rank];
        const mainGuild = client.guilds.cache.get(CONFIG.MAIN_GUILD);
        if (!mainGuild) return i.reply({ content: "❌ **MAIN_SERVER_OFFLINE**", ephemeral: true });
        const member = await mainGuild.members.fetch(uid).catch(() => null);
        if (!member) return i.reply({ content: "❌ **USER_NOT_IN_MAIN_SERVER**", ephemeral: true });

        try {
            await User.findOneAndUpdate({ discordId: uid }, { rank: rank, $inc: { elo: rankData.elo } });
            const role = mainGuild.roles.cache.get(rankData.id);
            if (role) {
                await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
                await member.roles.add(role);
            }
            return i.update({ content: `✅ **RANKED:** <@${uid}> to **${rank}** by <@${i.user.id}>`, components: [] });
        } catch (e) { return i.reply({ content: "⚠️ **PERMISSION_ERR: Move bot role to top!**", ephemeral: true }); }
    }
});

// --- 🛰️ COOL BOOT SYSTEM ---
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
    \u001b[0m`.bold);
    const stages = ["NEURAL_SYNC", "R2_UPLINK", "MONGO_ATLAS", "DISCORD_GATEWAY"];
    for (const stage of stages) {
        process.stdout.write(` \u001b[1;37m[#] SECURING ${stage.padEnd(15)} : `);
        await sleep(500);
        process.stdout.write(`\u001b[1;32m [ STABLE ]\n\u001b[0m`);
    }
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`\n \u001b[1;35m[!] SINGULARITY ACTIVE : GLOBAL ACCESS STABILIZED\u001b[0m\n`);
    } catch (e) { console.log(`\u001b[1;31m[!] BOOT_FAILURE: ${e.message}\u001b[0m`); }
}
boot();
