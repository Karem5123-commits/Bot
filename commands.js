/**
 * ARCHITECT V23 | OMNI_KERNEL
 * Integrated: Automation, Economy, Music, Tickets, & Security
 */

const { 
    PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, ChannelType, StringSelectMenuBuilder 
} = require('discord.js');

module.exports = {
    STAFF_ROLES: [
        "1491554076935192637", // Admin
        "1491542435312959529", // Owner
        "1491552861358788608"  // Co-Owner
    ],

    definitions: [
        // --- [01] MODERATION & SECURITY ---
        { name: 'tempban', description: 'Ban temporarily', options: [{ name: 'user', type: 6, required: true }, { name: 'time', type: 3, required: true }] },
        { name: 'lockdown_all', description: 'Lock every channel' },
        { name: 'unlockdown_all', description: 'Restore server access' },
        { name: 'alt_check', description: 'Scan for recent alt accounts' },
        { name: 'verify_panel', description: 'Send verification button' },
        
        // --- [02] UTILITY & SYSTEMS ---
        { name: 'ticket_setup', description: 'Send Ticket Panel' },
        { name: 'starboard_setup', description: 'Config starboard' },
        { name: 'backup_create', description: 'Snapshot server state' },
        { name: 'suggestion', description: 'Submit a suggestion', options: [{ name: 'text', type: 3, required: true }] },
        
        // --- [03] ECONOMY & LEVELING ---
        { name: 'balance', description: 'Check wallet', options: [{ name: 'user', type: 6 }] },
        { name: 'daily', description: 'Claim daily credits' },
        { name: 'shop', description: 'View economy shop' },
        { name: 'rank', description: 'View level/XP' },
        
        // --- [04] MUSIC ---
        { name: 'play', description: 'Play audio', options: [{ name: 'query', type: 3, required: true }] },
        { name: 'skip', description: 'Skip current track' },
        { name: 'queue', description: 'View music queue' },

        // --- [05] TOOLS ---
        { name: 'snipe', description: 'Recover last deleted message' },
        { name: 'embed_build', description: 'Launch Custom Embed Creator' },
        { name: 'giveaway', description: 'Start a giveaway', options: [{ name: 'prize', type: 3, required: true }, { name: 'winners', type: 4, required: true }] },
        { name: 'sticky', description: 'Stick message to bottom', options: [{ name: 'message', type: 3, required: true }] }
    ],

    handle: async (i) => {
        const { commandName, options, guild, channel, member, user } = i;
        const hasStaff = member.roles.cache.some(r => module.exports.STAFF_ROLES.includes(r.id));

        switch (commandName) {
            // --- 🛡️ SECURITY & VERIFICATION ---
            case 'verify_panel':
                if (!hasStaff) return i.reply({ content: "❌ Unauthorized.", ephemeral: true });
                const vEmbed = new EmbedBuilder()
                    .setTitle("🛡️ VERIFICATION REQUIRED")
                    .setDescription("Click the button below to gain access to the server.")
                    .setColor(0x00FF00);
                const vRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('verify_user').setLabel('Verify').setStyle(ButtonStyle.Success)
                );
                return i.reply({ embeds: [vEmbed], components: [vRow] });

            case 'lockdown_all':
                if (!hasStaff) return i.reply({ content: "❌ Unauthorized.", ephemeral: true });
                await i.deferReply();
                guild.channels.cache.forEach(ch => {
                    if (ch.type === ChannelType.GuildText) ch.permissionOverwrites.edit(guild.id, { SendMessages: false });
                });
                return i.editReply("🚨 **GLOBAL_LOCKDOWN_ACTIVE**");

            // --- 🎫 TICKET SYSTEM ---
            case 'ticket_setup':
                if (!hasStaff) return i.reply({ content: "❌ Unauthorized.", ephemeral: true });
                const tEmbed = new EmbedBuilder()
                    .setTitle("📩 SUPPORT TICKETS")
                    .setDescription("Need help? Click below to open a private ticket.")
                    .setColor(0x5865F2);
                const tRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('📩')
                );
                return i.reply({ embeds: [tEmbed], components: [tRow] });

            // --- 💰 ECONOMY & LEVELING ---
            case 'balance':
                // Logic: Fetch from MODLOG_DB / ECONOMY_DB (placeholder logic)
                const target = options.getUser('user') || user;
                return i.reply({ content: `💳 **${target.username}'s Balance:** $1,250`, ephemeral: true });

            case 'rank':
                return i.reply({ content: `📊 **XP:** 450 | **Level:** 5`, ephemeral: true });

            // --- 🎵 MUSIC SYSTEM (STUB) ---
            case 'play':
                return i.reply({ content: `🎵 **Searching for:** \`${options.getString('query')}\`...`, ephemeral: true });

            // --- 🛠️ TOOLING ---
            case 'snipe':
                // NOTE: Requires a global 'snipes' Map in your main bot file
                return i.reply({ content: "🕵️ **LAST_MESSAGE_SNIPED:** [Redacted Data]", ephemeral: true });

            case 'giveaway':
                if (!hasStaff) return i.reply({ content: "❌ Unauthorized.", ephemeral: true });
                const prize = options.getString('prize');
                const gEmbed = new EmbedBuilder()
                    .setTitle("🎉 GIVEAWAY STARTED")
                    .setDescription(`**Prize:** ${prize}\n**Winners:** ${options.getInteger('winners')}\n**Hosted By:** ${user}`)
                    .setColor(0xFFD700);
                return i.reply({ embeds: [gEmbed] });

            case 'suggestion':
                const sText = options.getString('text');
                const sEmbed = new EmbedBuilder()
                    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
                    .setDescription(`**Suggestion:** ${sText}`)
                    .setColor(0xFFFF00)
                    .setFooter({ text: "Vote using the reactions below!" });
                const reply = await i.reply({ embeds: [sEmbed], fetchReply: true });
                await reply.react('✅');
                await reply.react('❌');
                return;
        }
    }
};
