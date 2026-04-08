require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, EmbedBuilder, PermissionsBitField, ChannelType 
} = require('discord.js');
const mongoose = require('mongoose');
const colors = require('colors');

// --- ⚙️ MASTER CONFIG ---
const CONFIG = {
    MAIN_GUILD: "1491541282156449794",
    REVIEW_GUILD: "1488868987805892730",
    REVIEW_CHAN: "1489069664414859326",
    OWNERS: ["1347959266539081768", "1407316453060907069"],
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
    discordId: { type: String, required: true, unique: true },
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0 }
}));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers], 
    partials: [Partials.Channel, Partials.GuildMember] 
});

// --- 🧹 AUTO-DELETE FUNCTION ---
const purge = (msg, time = 10000) => {
    setTimeout(() => {
        msg.delete().catch(() => {});
    }, time);
};

// --- 🚀 MESSAGE COMMANDS ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;
    if (!m.content.startsWith('!')) return;

    const args = m.content.slice(1).trim().split(/ +/g);
    const cmd = args.shift().toLowerCase();

    // Delete the user's command immediately or after 10s
    purge(m);

    if (cmd === 'leaderboard' || cmd === 'lb') {
        const topUsers = await User.find().sort({ elo: -1 }).limit(10);
        let desc = topUsers.map((u, i) => `**${i+1}.** ${u.username} ┃ \`${u.rank}\` ┃ \`${u.elo} ELO\``).join('\n');
        const reply = await m.channel.send({ embeds: [new EmbedBuilder().setTitle("🏆 GLOBAL LEADERBOARD").setColor("#00FFCC").setDescription(desc || "No data.")] });
        return purge(reply);
    }

    if (cmd === 'submit') {
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_modal').setLabel('SUBMIT EDIT').setStyle(ButtonStyle.Primary).setEmoji('📥'));
        const reply = await m.channel.send({ content: `### ⚡ OPERATIVE_UPLINK\n<@${m.author.id}>, initialize dossier.`, components: [row] });
        return purge(reply);
    }

    if (cmd === 'rankcard' || cmd === 'profile') {
        let u = await User.findOne({ discordId: m.author.id });
        if (!u) u = await User.create({ discordId: m.author.id, username: m.author.username });
        const embed = new EmbedBuilder().setTitle(`DATALINK: ${u.username}`).setColor(CONFIG.RANKS[u.rank]?.color || '#FFFFFF').addFields({ name: 'RANK', value: `\`${u.rank}\``, inline: true }, { name: 'ELO', value: `\`${u.elo}\``, inline: true });
        const reply = await m.reply({ embeds: [embed] });
        return purge(reply);
    }
});

// --- ⚡ INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    if (i.isButton() && i.customId === 'open_modal') {
        const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('SUBMIT EDIT');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel("LINK").setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(modal);
    }

    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
        const btns = Object.keys(CONFIG.RANKS).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary));
        if (rChan) await rChan.send({ content: `📥 **NEW:** <@${i.user.id}>\n**URL:** ${i.fields.getTextInputValue('url')}`, components: [new ActionRowBuilder().addComponents(btns.slice(0, 3)), new ActionRowBuilder().addComponents(btns.slice(3))] });
        return i.reply({ content: "✅ **SENT**", ephemeral: true });
    }

    if (i.isButton() && i.customId.startsWith('sel_')) {
        const [_, rank, uid] = i.customId.split('_');
        const mainGuild = client.guilds.cache.get(CONFIG.MAIN_GUILD);
        const member = await mainGuild?.members.fetch(uid).catch(() => null);
        if (!member) return i.reply({ content: "❌ USER_NOT_FOUND", ephemeral: true });

        await User.findOneAndUpdate({ discordId: uid }, { rank: rank, $inc: { elo: CONFIG.RANKS[rank].elo } }, { upsert: true });
        const role = mainGuild.roles.cache.get(CONFIG.RANKS[rank].id);
        if (role) {
            await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
            await member.roles.add(role);
        }
        return i.update({ content: `✅ **RANKED:** <@${uid}> to **${rank}**`, components: [] });
    }
});

// --- 🛰️ COOL BOOT SYSTEM ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    console.log(`\u001b[1;31m  [!] BYPASSING CARRIER FIREWALL...\n\u001b[1;33m  [!] INITIATING NEURAL OVERLOAD...\n\u001b[1;35m    ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗\n    ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝\n    ██████╔╝█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ \n    ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  \n    ██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   \n    ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝\u001b[0m`);
    const stages = ["NEURAL_SYNC", "R2_UPLINK", "MONGO_ATLAS", "DISCORD_GATEWAY"];
    for (const stage of stages) {
        process.stdout.write(` \u001b[1;37m[#] SECURING ${stage.padEnd(15)} : `);
        await sleep(400);
        process.stdout.write(`\u001b[1;32m [ STABLE ]\n\u001b[0m`);
    }
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        console.log(`\n \u001b[1;35m[!] SINGULARITY ACTIVE\u001b[0m\n`);
    } catch (e) { console.log(`\n\u001b[1;31m[!] BOOT_FAILURE: ${e.message}\u001b[0m`); }
}
boot();
