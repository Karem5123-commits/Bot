require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes 
} = require('discord.js');
const mongoose = require('mongoose');
const crypto = require('crypto');

// --- ⚙️ CORE CONFIGURATION ---
const CONFIG = {
    CLIENT_ID: "1479871879496994943",
    MAIN_GUILD: "1491541282156449794",
    REVIEW_CHAN: "1489069664414859326",
    STAFF_ROLES: ["1491554076935192637", "1491542435312959529", "1491552861358788608"],
    OWNERS: ["1347959266539081768", "1407316453060907069"],
    FOOTER: "💠 ARCHITECT NEURAL LINK // V.6.1.0",
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
    lastSubmit: { type: Number, default: 0 },
    totalSubmits: { type: Number, default: 0 }
}));

const QualityCode = mongoose.model('QualityCode', new mongoose.Schema({
    code: { type: String, unique: true },
    used: { type: Boolean, default: false },
    redeemedBy: { type: String, default: null }
}));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] 
});

// --- 🎭 ROLE PERSISTENCE ---
client.on('guildMemberAdd', async (member) => {
    try {
        const u = await User.findOne({ discordId: member.id });
        if (u && u.rank !== "None" && CONFIG.RANKS[u.rank]) {
            await member.roles.add(CONFIG.RANKS[u.rank].id);
        }
    } catch (e) { console.error("[!] Persistence Error:", e); }
});

// --- ⚡ THE INTERACTION ENGINE ---
client.on('interactionCreate', async (i) => {
    
    // ==========================================
    // 1. SLASH COMMANDS
    // ==========================================
    if (i.isChatInputCommand()) {
        const { commandName } = i;

        if (commandName === 'submit') {
            const modal = new ModalBuilder().setCustomId('sub_modal').setTitle('⚡ UPLINK: TRANSMIT DATA');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('url').setLabel("EDIT URL (STREAMABLE/YOUTUBE)").setStyle(TextInputStyle.Short).setRequired(true)
                )
            );
            return i.showModal(modal); 
        }

        if (commandName === 'profile') {
            await i.deferReply();
            let u = await User.findOne({ discordId: i.user.id }) || await User.create({ discordId: i.user.id, username: i.user.username });
            const embed = new EmbedBuilder()
                .setTitle(`[ 💠 DOSSIER : ${u.username.toUpperCase()} ]`)
                .setColor(CONFIG.RANKS[u.rank]?.color || '#2b2d31')
                .addFields(
                    { name: '🎖️ CURRENT RANK', value: `**${u.rank}**`, inline: true },
                    { name: '🔥 TOTAL ELO', value: `\`${u.elo}\``, inline: true },
                    { name: '📤 SUBMISSIONS', value: `\`${u.totalSubmits}\``, inline: true }
                )
                .setThumbnail(i.user.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: CONFIG.FOOTER }).setTimestamp();
            return i.editReply({ embeds: [embed] });
        }

        if (commandName === 'leaderboard') {
            await i.deferReply();
            const topUsers = await User.find({ elo: { $gt: 0 } }).sort({ elo: -1 }).limit(10);
            if (!topUsers.length) return i.editReply("❌ No operatives ranked yet.");

            let board = topUsers.map((u, index) => {
                let badge = index === 0 ? "👑" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🔹";
                return `${badge} **${u.username}** — Rank: \`${u.rank}\` | ELO: \`${u.elo}\``;
            }).join('\n\n');

            const embed = new EmbedBuilder()
                .setTitle(`[ 🌐 GLOBAL RANKINGS ]`)
                .setDescription(board)
                .setColor('#00FFCC')
                .setFooter({ text: CONFIG.FOOTER }).setTimestamp();
            return i.editReply({ embeds: [embed] });
        }

        if (commandName === 'redeem') {
            await i.deferReply({ ephemeral: true });
            const codeInput = i.options.getString('code').toUpperCase();
            const qCode = await QualityCode.findOne({ code: codeInput });

            if (!qCode) return i.editReply("❌ **INVALID CODE:** Sequence not found.");
            if (qCode.used) return i.editReply("⚠️ **EXPIRED:** This code has already been claimed.");

            qCode.used = true;
            qCode.redeemedBy = i.user.username;
            await qCode.save();

            let u = await User.findOne({ discordId: i.user.id }) || await User.create({ discordId: i.user.id, username: i.user.username });
            u.elo += 50; 
            await u.save();

            return i.editReply(`✅ **CODE REDEEMED!** Sequence accepted. \`+50 ELO\` added to your dossier.`);
        }

        if (commandName === 'code') {
            if (!CONFIG.OWNERS.includes(i.user.id)) return i.reply({ content: "❌ OVERRIDE DENIED.", ephemeral: true });
            const code = crypto.randomBytes(3).toString('hex').toUpperCase();
            await QualityCode.create({ code });
            return i.reply({ content: `🎫 **NEW QUALITY CODE:** \`${code}\`\n*(Grants +50 ELO to whoever redeems it)*`, ephemeral: true });
        }

        if (commandName === 'stats') {
            if (!CONFIG.OWNERS.includes(i.user.id)) return i.reply({ content: "❌ OVERRIDE DENIED.", ephemeral: true });
            await i.deferReply({ ephemeral: true });
            const userCount = await User.countDocuments();
            const codesUsed = await QualityCode.countDocuments({ used: true });
            return i.editReply(`### 📈 SYSTEM METRICS\n* **Registered Operatives:** \`${userCount}\`\n* **Redeemed Codes:** \`${codesUsed}\``);
        }

        if (commandName === 'embed') {
            if (!i.member.roles.cache.some(r => CONFIG.STAFF_ROLES.includes(r.id))) return i.reply({ content: "🚫 UNAUTHORIZED", ephemeral: true });
            const e = new EmbedBuilder().setDescription(i.options.getString('message')).setColor(i.options.getString('color') || '#00FFCC').setFooter({ text: CONFIG.FOOTER });
            return i.reply({ embeds: [e] });
        }
    }

    // ==========================================
    // 2. MODAL SUBMISSIONS (The Uplink)
    // ==========================================
    if (i.isModalSubmit() && i.customId === 'sub_modal') {
        await i.deferReply({ ephemeral: true }); 
        try {
            let u = await User.findOne({ discordId: i.user.id });
            if (!u) u = await User.create({ discordId: i.user.id, username: i.user.username });
            
            if (Date.now() - u.lastSubmit < 300000) return i.editReply("⏳ **OVERHEATING:** Uplink is on cooldown. Wait 5 minutes.");

            u.lastSubmit = Date.now();
            u.totalSubmits += 1;
            await u.save();

            const rChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);
            const btns = Object.keys(CONFIG.RANKS).map(r => 
                new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary)
            );
            
            // ⚡ Added @everyone ping here
            const msg = await rChan.send({ 
                content: `@everyone\n📥 **NEW UPLINK DETECTED:** <@${i.user.id}>\n🔗 ${i.fields.getTextInputValue('url')}`, 
                components: [
                    new ActionRowBuilder().addComponents(btns.slice(0, 4)), 
                    new ActionRowBuilder().addComponents(btns.slice(4))
                ] 
            });

            await msg.startThread({ name: `🔍 Review: ${i.user.username}` }).catch(() => {});
            return i.editReply("✅ **TRANSMISSION SUCCESSFUL:** Your data is being analyzed by the Architects.");
        } catch (err) {
            console.error("Modal Error:", err);
            return i.editReply("❌ **DATABASE FAILURE:** Transmission corrupted.");
        }
    }

    // ==========================================
    // 3. RANK BUTTON CLICKS (Staff Grading)
    // ==========================================
    if (i.isButton() && i.customId.startsWith('rank_')) {
        await i.deferUpdate(); 

        try {
            const [_, type, uid] = i.customId.split('_');
            
            // ⚡ FIX: Fetch the MAIN server first, then find the user there!
            const mainGuild = await client.guilds.fetch(CONFIG.MAIN_GUILD).catch(() => null);
            if (!mainGuild) return await i.followUp({ content: "❌ **ERROR:** Could not connect to the Main Server.", ephemeral: true });

            // Fetch the member from the MAIN server, not the review server
            const member = await mainGuild.members.fetch(uid).catch(() => null);
            
            if (!member) {
                return await i.followUp({ content: "❌ **TARGET_NOT_FOUND:** Cannot assign role. User left the main server.", ephemeral: true });
            }

            const u = await User.findOne({ discordId: uid });
            if (!u) return await i.followUp({ content: "❌ **DATABASE ERROR:** User profile not found.", ephemeral: true });

            const oldRank = u.rank;
            u.rank = type; 
            u.elo += CONFIG.RANKS[type].elo;
            await u.save();

            // ⚡ Role management (Happens in the MAIN server)
            try {
                await member.roles.remove(Object.values(CONFIG.RANKS).map(r => r.id));
                await member.roles.add(CONFIG.RANKS[type].id);
            } catch (roleErr) {
                console.error("Role Error:", roleErr);
                return await i.followUp({ 
                    content: "⚠️ **PERMISSION ERROR:** I updated their database profile, but I can't give them the role in the Main Server! Make sure my Bot Role is dragged higher than the rank roles.", 
                    ephemeral: true 
                });
            }

            // Update message
            await i.editReply({ content: `✅ **GRADED:** <@${uid}> has been assigned **Rank ${type}** by <@${i.user.id}>.`, components: [] });

            // Announcements & DMs (Happens in the MAIN server)
            if (oldRank !== type) {
                const announce = mainGuild.channels.cache.find(c => c.name === 'announcements');
                if (announce) {
                    announce.send({ 
                        embeds: [new EmbedBuilder()
                            .setTitle('🚀 RANK PROMOTION')
                            .setDescription(`<@${uid}> has ascended to **RANK ${type}**!`)
                            .setColor(CONFIG.RANKS[type].color)
                            .setFooter({ text: CONFIG.FOOTER })] 
                    }).catch(()=>{});
                }

                member.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('💠 ARCHITECT SYSTEM UPDATE')
                        .setDescription(`Your recent uplink has been analyzed.\nYou have been promoted to **Rank ${type}**.\n\n` +
                                        `*Total ELO: ${u.elo}*\nKeep up the excellent work.`)
                        .setColor(CONFIG.RANKS[type].color)]
                }).catch(() => console.log("User has DMs disabled."));
            }

        } catch (err) {
            console.error("Button Click Error:", err);
            await i.followUp({ content: "❌ **SYSTEM FAILURE:** An error occurred while grading.", ephemeral: true });
        }
    }
});

// --- 🛰️ THE BOOT SEQUENCE ---
async function boot() {
    console.clear();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    console.log(`\u001b[1;36m [!] BYPASSING FIREWALL...\u001b[1;33m\n [!] INITIATING NEURAL OVERLOAD...\u001b[1;35m\n ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗\n ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝\n ██████╔╝█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ \n ██╔══██╗██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  \n ██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   \n ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝\u001b[0m`);

    const stages = ["MONGO_ATLAS", "DISCORD_GATEWAY", "SYNC_GUILD_CMD"];
    for (const stage of stages) {
        process.stdout.write(` \u001b[1;37m[#] SECURING ${stage.padEnd(16)} : `);
        await sleep(250);
        process.stdout.write(`\u001b[1;32m [ STABLE ]\n\u001b[0m`);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        await client.login(process.env.DISCORD_TOKEN);
        
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        const slash = [
            { name: 'submit', description: 'Initialize edit uplink' },
            { name: 'profile', description: 'View your dossier' },
            { name: 'leaderboard', description: 'View top operatives' },
            { 
                name: 'redeem', 
                description: 'Redeem a Quality Code',
                options: [{ name: 'code', description: 'Enter code', type: 3, required: true }]
            },
            { name: 'code', description: 'Owner: Generate quality code' },
            { name: 'stats', description: 'Owner: View system metrics' },
            { 
                name: 'embed', 
                description: 'Staff: Send embed', 
                options: [
                    { name: 'message', description: 'Embed content', type: 3, required: true },
                    { name: 'color', description: 'Hex color (e.g. #00ff00)', type: 3, required: false }
                ] 
            }
        ];
        
        await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.MAIN_GUILD), { body: slash });
        console.log(`\n \u001b[1;35m[!] SINGULARITY ACTIVE : SYSTEM ONLINE\u001b[0m\n`);
    } catch (e) { console.error(e); }
}

boot();
