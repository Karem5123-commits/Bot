require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, EmbedBuilder 
} = require('discord.js');
const mongoose = require('mongoose');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const CONFIG = {
    MAIN_GUILD: process.env.GUILD_ID,
    REVIEW_CHAN: process.env.REVIEW_CHANNEL_ID,
    LOG_CHAN: process.env.LOG_CHANNEL_ID,
    RANKS: {
        "SSS": { id: "1488208025859788860", elo: 100 },
        "SS+": { id: "1488208185633280041", elo: 75 },
        "SS":  { id: "1488208281930432602", elo: 50 },
        "S+":  { id: "1488208494170738793", elo: 40 },
        "S":   { id: "1488208584142753863", elo: 25 },
        "A":   { id: "1488208696759685190", elo: 10 }
    }
};

const User = mongoose.model('User', new mongoose.Schema({
    discordId: String,
    username: String,
    rank: { type: String, default: "None" },
    elo: { type: Number, default: 0 }
}));

const client = new Client({ 
    intents: [3276799], 
    partials: [Partials.Channel, Partials.GuildMember] 
});

// --- 🚀 MESSAGE COMMANDS ---
client.on("messageCreate", async (m) => {
    if (m.author.bot || !m.guild) return;

    // !submit opens the Modal (The "Panel")
    if (m.content.startsWith('!submit')) {
        const modal = new ModalBuilder()
            .setCustomId('submit_modal')
            .setTitle('OPERATIVE SUBMISSION');

        const linkInput = new TextInputBuilder()
            .setCustomId('streamable_link')
            .setLabel("PASTE YOUR STREAMABLE LINK")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("https://streamable.com/...")
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(linkInput);
        modal.addComponents(firstActionRow);

        await m.channel.send({ content: "⚠️ **SUBMISSION_UPLINK:** Check your prompt." }); // Discord requires an interaction or a specific trigger to open Modals usually via buttons. 
        // Note: Modals can only be opened via INTERACTION (Buttons/Slash). 
        // I will add a button to trigger the Modal to keep it safe.
        
        const triggerBtn = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('open_submit')
                .setLabel('OPEN SUBMISSION PANEL')
                .setStyle(ButtonStyle.Primary)
        );

        return m.reply({ content: "Click below to open the link panel:", components: [triggerBtn] });
    }
});

// --- ⚡ INTERACTION HANDLER (MODALS & BUTTONS) ---
client.on('interactionCreate', async (i) => {
    
    // 1. Open the Modal when "OPEN SUBMISSION PANEL" is clicked
    if (i.isButton() && i.customId === 'open_submit') {
        const modal = new ModalBuilder()
            .setCustomId('submission_panel')
            .setTitle('Operative Submission');

        const linkInput = new TextInputBuilder()
            .setCustomId('link_value')
            .setLabel("STREAMABLE LINK")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(linkInput));
        return i.showModal(modal);
    }

    // 2. Handle the Modal Data (Send to Review Channel)
    if (i.isModalSubmit() && i.customId === 'submission_panel') {
        const link = i.fields.getTextInputValue('link_value');
        const reviewChan = client.channels.cache.get(CONFIG.REVIEW_CHAN);

        const buttons = Object.keys(CONFIG.RANKS).map(r => 
            new ButtonBuilder().setCustomId(`rank_${r}_${i.user.id}`).setLabel(r).setStyle(ButtonStyle.Secondary)
        );

        const rows = [
            new ActionRowBuilder().addComponents(buttons.slice(0, 3)),
            new ActionRowBuilder().addComponents(buttons.slice(3))
        ];

        await reviewChan.send({ 
            content: `📥 **NEW_SUBMISSION** from <@${i.user.id}>\n**Link:** ${link}`, 
            components: rows 
        });

        return i.reply({ content: "✅ **UPLINK_SUCCESS:** Staff are reviewing your link.", ephemeral: true });
    }

    // 3. Handle the Ranking Buttons (The Staff Part)
    if (i.isButton() && i.customId.startsWith('rank_')) {
        const [_, rankName, targetId] = i.customId.split('_');
        const guild = client.guilds.cache.get(CONFIG.MAIN_GUILD);
        const member = await guild.members.fetch(targetId).catch(() => null);

        if (!member) return i.reply({ content: "❌ User not found.", ephemeral: true });

        const rankData = CONFIG.RANKS[rankName];
        await User.findOneAndUpdate({ discordId: targetId }, { rank: rankName, $inc: { elo: rankData.elo } }, { upsert: true });

        // Update Roles
        const allRankIds = Object.values(CONFIG.RANKS).map(r => r.id);
        await member.roles.remove(allRankIds).catch(() => {});
        await member.roles.add(rankData.id).catch(() => {});

        await i.update({ content: `✅ **SUCCESS:** <@${targetId}> is now **${rankName}**.`, components: [] });
    }
});

mongoose.connect(process.env.MONGO_URI).then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
