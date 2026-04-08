require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes, ChannelType 
} = require('discord.js');
const mongoose = require('mongoose');

// --- ⚙️ CONFIGURATION ---
const CONFIG = {
    CLIENT_ID: "1479871879496994943",
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

// --- 📊 DATABASE SCHEMA ---
const User = mongoose.model('User', new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0 },
    lastSubmit: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 }
}));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });

// --- 🧹 GHOST PURGE TOOL ---
const purge = (msg, time = 10000) => {
    if (!msg) return;
    setTimeout(() => msg.delete().catch(() => {}), time);
};

// --- 🛠️ SLASH COMMAND DEFINITIONS ---
const commands = [
    { name: 'submit', description: 'Initialize your edit uplink' },
    { name: 'profile', description: 'Access your operative dossier' },
    { name: 'leaderboard', description: 'View the elite top 10' }
];

// --- ⚡ INTERACTION HANDLER ---
client.on('interactionCreate', async (i) => {
    if (i.isChatInputCommand()) {
        const u = await User.findOne({ discordId: i.user.id }) || await User.create({ discordId: i.user.id, username: i.user.username });

        if (i.commandName === 'submit') {
            if (Date.now() - u.lastSubmit < 300000) return i.reply({ content: "⏳ **COOLDOWN:** Wait 5 mins.", ephemeral: true });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_modal').setLabel('START UPLINK').setStyle(ButtonStyle.Primary));
            return i.reply({ content: "### ⚡ OPERATIVE_UPLINK", components: [row], ephemeral: true });
        }

        if (i.commandName === 'profile') {
            const embed = new EmbedBuilder().setTitle(`DATALINK: ${u.username}`).setColor(CONFIG.RANKS[u.rank]?.color || '#FFFFFF')
                .addFields({ name: 'RANK', value: `\`${u.rank}\``, inline: true }, { name: 'ELO', value: `\`${u.elo}\``, inline: true });
            const res = await i.reply({ embeds: [embed], fetchReply: true });
            return purge(res);
        }

        if (i.commandName === 'leaderboard') {
            const top = await User.find().sort({ elo: -1 }).limit(10);
            const desc = top.map((u, idx) => `**${idx+1}.** ${u.username} ┃ \`${u.rank}\` ┃ \`${u.elo}\``).join('\n');
            const res = await i.reply({ embeds: [new EmbedBuilder().setTitle("🏆 LEADERBOARD").setDescription(desc || "No data.").setColor("#00FFCC")], fetchReply: true });
            return purge(res);
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
            components: [new ActionRowBuilder().addComponents(btns.slice(0, 3)), new ActionRowBuilder().addComponents(btns.slice(3))] 
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
        const rankOrder = ["None", "A", "S", "S+", "SS", "SS+", "SSS"];
        const oldIdx = rankOrder.indexOf(targetUser.rank);
        const newIdx = rankOrder.indexOf(type);

        let eloChange = CONFIG.RANKS[type].elo;
        if (newIdx > oldIdx) eloChange = Math.floor(eloChange * 1.5); 
        if (newIdx < oldIdx) eloChange = -Math.abs(eloChange); 
        if (targetUser.elo > 1000) eloChange = Math.floor(eloChange * 0.5); 

        await User.findOneAndUpdate({ discordId: uid }, { rank: type, $inc: { elo: eloChange } });
        
        const role = mainGuild.roles.cache.get(CONFIG.RANKS[type].id);
        if (role) {
            await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id)).catch(() => {});
            await member.roles.add(role);
        }

        await User.findOneAndUpdate({ discordId: i.user.id }, { $inc: { reviewCount: 1 } }, { upsert: true }); 
        return i.update({ content: `✅ **RANKED:** <@${uid}> → **${type}** (\`${eloChange > 0 ? '+' : ''}${eloChange} ELO\`)`, components: [] });
    }
});

// --- 🛰️ INSTANT SYNC BOOT SYSTEM ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    console.log(`\u001b[1;31m[!] BYPASSING FIREWALL...\n\u001b[1;33m[!] INITIATING NEURAL OVERLOAD...\n\u001b[1;35m\n    ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗\n    ██████╔╝███████╗██████╔╝██║      ██████╔╝╚████╔╝ \n    ██████╔╝███████╗██████╔╝███████╗╚██████╔╝   ██║   \n\u001b[0m`);
    
    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        // INSTANT GUILD SYNC (Forces update to your specific servers immediately)
        const guilds = [CONFIG.MAIN_GUILD, CONFIG.REVIEW_GUILD];
        for (const gId of guilds) {
            process.stdout.write(` [#] SYNCING GUILD ${gId.slice(-4)} : `);
            await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, gId), { body: commands });
            process.stdout.write(`\u001b[1;32m[ INSTANT ]\n\u001b[0m`);
        }

        console.log(`\n\u001b[1;35m[!] SINGULARITY ONLINE : SLASH COMMANDS SYNCED\u001b[0m\n`);
    } catch (e) { console.error(e); }
}
boot();
