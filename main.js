require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, 
    TextInputBuilder, TextInputStyle, AttachmentBuilder 
} = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');
const colors = require('colors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

// ================= [ ⚙️ CONFIGURATION HUB ] =================
const CONFIG = {
    MAIN_GUILD: "1488203882130837704",    
    REVIEW_GUILD: "1488868987805892730",  
    REVIEW_CHAN: "1489069664414859326",   
    RANKS: {
        "SSS": { id: "1488208025859788860", elo: 100 },
        "SS+": { id: "1488208185633280041", elo: 75 },
        "SS":  { id: "1488208281930432602", elo: 50 },
        "S+":  { id: "1488208494170738793", elo: 40 },
        "S":   { id: "1488208584142753863", elo: 25 },
        "A":   { id: "1488208696759685190", elo: 10 }
    }
};

// ================= [ 🗄️ DATABASE SCHEMA ] =================
const User = mongoose.model('User', new mongoose.Schema({
    discordId: String,
    rank: { type: String, default: "None" },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    elo: { type: Number, default: 0 }, // NEW: ELO TRACKING
    premiumCode: { type: String, default: null },
    hasUsedFreeRender: { type: Boolean, default: false }
}));

const client = new Client({ 
    intents: [3276799], 
    partials: [Partials.Channel, Partials.GuildMember] 
});

// ================= [ 🛡️ CORE KERNEL SYSTEM ] =================
const Kernel = {
    // Advanced Boot Sequence
    boot: async () => {
        console.clear();
        process.stdout.write(colors.magenta.bold("\n  🤖 OMEGA AI CORE v16.0 | ELO ENGINE ENABLED\n\n"));
        const steps = ["MONGO_DB", "MAIN_LINK", "REVIEW_LINK", "ELO_MODULE"];
        for (const s of steps) {
            process.stdout.write(`  ⚙️ Loading ${s.padEnd(15)} `);
            for(let i=0; i<=100; i+=25) {
                const bar = "▰".repeat(i/5).magenta + "▱".repeat(20-(i/5)).gray;
                process.stdout.write(`\r  ⚙️ Loading ${s.padEnd(15)} ${bar} ${i}%`);
                await new Promise(r => setTimeout(r, 80));
            }
            process.stdout.write(colors.green(" [OK]\n"));
        }
        console.log(colors.cyan.bold("\n  🎉 SYSTEMS STABILIZED & ONLINE\n"));
    },

    // Fuzzy Search Auto-Correct
    resolve: (input) => {
        const cmdList = ['quality', 'qualitu', 'submit', 'rankcard', 'serverstats'];
        let best = null; let min = 2;
        cmdList.forEach(c => {
            let dist = Kernel.lev(input, c);
            if (dist < min) { min = dist; best = c; }
        });
        return best;
    },

    lev: (a, b) => {
        const m = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i++) m[0][i] = i;
        for (let j = 0; j <= b.length; j++) m[j][0] = j;
        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const sub = a[i - 1] === b[j - 1] ? 0 : 1;
                m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + sub);
            }
        }
        return m[b.length][a.length];
    }
};

// ================= [ 🚀 MAIN COMMAND HANDLER ] =================

client.on("messageCreate", async (m) => {
    if (m.author.bot || m.guildId !== CONFIG.MAIN_GUILD) return;

    // XP Progression
    const user = await User.findOneAndUpdate({ discordId: m.author.id }, { $inc: { xp: 5 } }, { upsert: true, new: true });
    if (user.xp >= user.level * 500) {
        user.level++; await user.save();
        m.reply(`🧠 **LEVEL_UP:** AI Core reached **Level ${user.level}**!`);
    }

    if (!m.content.startsWith('!')) return;
    const cmd = Kernel.resolve(m.content.slice(1).split(' ')[0].toLowerCase());
    if (!cmd) return;

    switch(cmd) {
        case "quality":
        case "qualitu":
            if (!user.premiumCode && (user.level < 20 || user.hasUsedFreeRender)) 
                return m.reply("❌ **DENIED:** Reach Level 20 or Boost for 4K Rendering.");
            
            const file = m.attachments.first();
            if (!file?.contentType?.startsWith('video')) return m.reply("⚠️ Upload a video.");
            
            const status = await m.reply("⚙️ **UPSCALE:** Processing 4K Lanczos...");
            const inP = `./in_${m.id}.mp4`, outP = `./out_${m.id}.mp4`;
            
            try {
                fs.writeFileSync(inP, Buffer.from(await (await fetch(file.url)).arrayBuffer()));
                ffmpeg(inP)
                    .outputOptions(["-vf scale=3840:2160", "-c:v libx264", "-crf 18", "-preset superfast"])
                    .on('end', async () => {
                        await m.author.send({ content: "✅ **4K_RENDER_READY.**", files: [new AttachmentBuilder(outP)] }).catch(()=>{});
                        status.edit("🟢 **DONE.** Check DMs.");
                        if (!user.premiumCode) { user.hasUsedFreeRender = true; await user.save(); }
                        [inP, outP].forEach(p => fs.existsSync(p) && fs.unlinkSync(p));
                    })
                    .on('error', () => { status.edit("❌ **FAILURE.**"); if(fs.existsSync(inP)) fs.unlinkSync(inP); })
                    .save(outP);
            } catch(e) { status.edit("❌ **ERROR.**"); }
            break;

        case "rankcard":
            m.reply(`\`\`\`ansi\n\u001b[1;35m🤖 IDENTITY: ${m.author.username}\u001b[0m\n\u001b[1;30m----------------------------\u001b[0m\nRANK  :: ${user.rank}\nELO   :: \u001b[1;32m${user.elo}\u001b[0m\nLEVEL :: ${user.level}\nXP    :: ${user.xp}\n\u001b[1;30m----------------------------\u001b[0m\n\`\`\``);
            break;

        case "submit":
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub').setLabel('⟁ UPLOAD DATA').setStyle(ButtonStyle.Danger));
            m.reply({ content: "🧠 **SYSTEM:** Initializing submission gateway...", components: [row] });
            break;

        case "serverstats":
            m.reply(`\`\`\`ansi\n\u001b[1;36m🛰️ CORE_STATS\u001b[0m\nPING   :: ${client.ws.ping}ms\nSTATUS :: OPTIMIZED\n\`\`\``);
            break;
    }
});

// ================= [ ⚡ INTERACTION HANDLER ] =================

client.on('interactionCreate', async (i) => {
    // 1. Submit Modal Trigger
    if (i.isButton() && i.customId === 'sub') {
        const modal = new ModalBuilder().setCustomId('m').setTitle('҂ DATA_INPUT');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('u').setLabel('LINK').setStyle(1).setRequired(true)));
        return await i.showModal(modal);
    }

    // 2. Transmit to Review Guild
    if (i.isModalSubmit() && i.customId === 'm') {
        const url = i.fields.getTextInputValue('u');
        const chan = client.guilds.cache.get(CONFIG.REVIEW_GUILD)?.channels.cache.get(CONFIG.REVIEW_CHAN);
        if (!chan) return i.reply({ content: "❌ Review channel offline.", ephemeral: true });

        const r1 = new ActionRowBuilder().addComponents(Object.keys(CONFIG.RANKS).slice(0,3).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary)));
        const r2 = new ActionRowBuilder().addComponents(Object.keys(CONFIG.RANKS).slice(3).map(r => new ButtonBuilder().setCustomId(`sel_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Primary)));
        
        await chan.send({ content: `🧠 **NEW SUBMISSION:** <@${i.user.id}>\nDATA: ${url}`, components: [r1, r2] });
        await i.reply({ content: "✅ **SYNCED.** Staff are reviewing.", ephemeral: true });
    }

    // 3. Staff Logic (Role + ELO Award)
    if (i.isButton() && i.customId.startsWith('sel_')) {
        const [ , rankName, uid] = i.customId.split('_');
        const rankData = CONFIG.RANKS[rankName];
        const mainGuild = client.guilds.cache.get(CONFIG.MAIN_GUILD);
        const member = await mainGuild?.members.fetch(uid).catch(() => null);

        // Update Database (Rank + Add ELO)
        const updatedUser = await User.findOneAndUpdate(
            { discordId: uid }, 
            { rank: rankName, $inc: { elo: rankData.elo } }, 
            { upsert: true, new: true }
        );

        // Update Roles in Main Server
        if (member) {
            const roleIds = Object.values(CONFIG.RANKS).map(r => r.id);
            await member.roles.remove(roleIds).catch(() => {});
            await member.roles.add(rankData.id).catch(() => {});
            member.send(`✅ **RANK_UP:** Assigned **${rankName}**. You earned **+${rankData.elo} ELO**!`).catch(()=>{});
        }

        await i.update({ content: `✅ **LOCKED:** <@${uid}> set to **${rankName}** (+${rankData.elo} ELO). Total: **${updatedUser.elo}**`, components: [] });
    }
});

// ================= [ 🛰️ BOOT SEQUENCE ] =================
async function boot() {
    await Kernel.boot();
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const app = express(); app.get('/', (r, s) => s.send('ACTIVE')); app.listen(process.env.PORT || 3000);
        client.once('ready', () => client.user.setActivity(`ELO SYNC | v16`, { type: 3 }));
        await client.login(process.env.DISCORD_TOKEN);
    } catch (e) { console.log(e); }
}

boot();
