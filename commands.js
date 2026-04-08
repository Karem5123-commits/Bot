/**
 * ARCHITECT V6 | COMMAND_LOGIC_HUB
 * Status: OPTIMIZED | UI: HIGH-TECH | Logic: WATERFALL
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    // [01] HIERARCHY CONFIGURATION
    ROLES: {
        MOD: "1488205041885122581",    
        ADMIN: "1488205040811245740",  
        HELPER: "1488207431753531485"  
    },

    handle: async (m, client, State, RenderEngine, User) => {
        const args = m.content.slice(1).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        const isOwner = State.SETTINGS.OWNERS.includes(m.author.id);

        // Instant Ghost Mode: Deletes the !trigger immediately
        if (m.deletable) await m.delete().catch(() => {});

        // [02] PERMISSION WATERFALL
        const isMod = m.member.roles.cache.has(module.exports.ROLES.MOD) || isOwner;
        const isAdmin = m.member.roles.cache.has(module.exports.ROLES.ADMIN) || isMod;
        const isHelper = m.member.roles.cache.has(module.exports.ROLES.HELPER) || isAdmin;

        // [03] UI NOTIFICATION SYSTEM (Auto-Deleting Embeds)
        const notify = async (title, desc, color = 0x00FFFF) => {
            const e = new EmbedBuilder()
                .setTitle(title)
                .setDescription(desc)
                .setColor(color)
                .setFooter({ text: 'ARCHITECT | SYSTEM_LOG' });
            
            const res = await m.channel.send({ embeds: [e] });
            setTimeout(() => res.delete().catch(() => {}), 8000);
        };

        // [04] COMMAND ROUTER
        switch (cmd) {
            
            case "submit":
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('submit_content')
                        .setLabel('🚀 INITIALIZE_UPLOAD')
                        .setStyle(ButtonStyle.Primary)
                );
                const portal = new EmbedBuilder()
                    .setColor(0x00FFFF)
                    .setTitle('💠 ARCHITECT_PORTAL_V6')
                    .setThumbnail(client.user.displayAvatarURL())
                    .setDescription('**SECURE DATA UPLINK DETECTED**\nClick the button below to initialize the submission panel.')
                    .addFields({ name: '🛰️ STATUS', value: '`READY_FOR_INPUT`' });
                
                await m.channel.send({ embeds: [portal], components: [row] });
                break;

            case "quality":
                const u = await User.findOne({ discordId: m.author.id });
                // Checks Premium status or Admin override
                if (!u?.premiumCode && !isAdmin) {
                    return notify('🔒 LOCKOUT', '`ERROR: PREMIUM_CREDENTIALS_REQUIRED`', 0xFF0000);
                }

                const file = m.attachments.first();
                if (!file) return notify('⚠️ ERROR', '`NO_MEDIA_DETECTED_IN_STREAM`');
                
                const sEmbed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('🛰️ UPLINK_ESTABLISHED')
                    .setDescription('**RECON_DATA_RECEIVED**\nMoving file to Render Queue for 4K processing...');
                
                const statusMsg = await m.channel.send({ embeds: [sEmbed] });
                RenderEngine.add(m, file.url, m.author, statusMsg);
                break;

            case "ban":
                if (!isAdmin) return notify('🚫 UNAUTHORIZED', '`LEVEL_ADMIN_REQUIRED`', 0xFF0000);
                const targetBan = m.mentions.members.first();
                if (targetBan) {
                    if (targetBan.roles.highest.position >= m.member.roles.highest.position && !isOwner) {
                        return notify('❌ ERROR', '`TARGET_PROTECTED_BY_HIERARCHY`');
                    }
                    await targetBan.ban();
                    await notify('⚔️ EXTRACTION_COMPLETE', `**${targetBan.user.tag}** has been removed from the server.`, 0xFF0000);
                    State.log("MOD", `BAN_EXECUTED: ${targetBan.user.tag}`);
                }
                break;

            case "purge":
                if (!isHelper) return notify('🚫 UNAUTHORIZED', '`LEVEL_HELPER_REQUIRED`', 0xFF0000);
                const count = parseInt(args[0]) || 5;
                if (count > 100) return notify('⚠️ WARNING', '`MAX_PURGE_LIMIT: 100`');
                
                await m.channel.bulkDelete(count, true);
                await notify('🧹 DATA_WIPE', `Successfully cleared **${count}** entries from current channel.`);
                break;

            case "nuke":
                if (!isMod) return notify('🚫 UNAUTHORIZED', '`LEVEL_MOD_REQUIRED`', 0xFF0000);
                const position = m.channel.position;
                const newChannel = await m.channel.clone();
                await m.channel.delete();
                await newChannel.setPosition(position);
                await newChannel.send({ 
                    embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('☢️ CHANNEL_REGENERATED').setDescription('All residual data cleared.')] 
                }).then(msg => setTimeout(() => msg.delete(), 10000));
                break;

            case "stats":
                const userData = await User.findOne({ discordId: m.author.id });
                const statsEmbed = new EmbedBuilder()
                    .setColor(0x00FFFF)
                    .setTitle(`📊 OPERATIVE_STATS: ${m.author.username}`)
                    .addFields(
                        { name: '⭐ ELO', value: `\`${userData?.elo || 0}\``, inline: true },
                        { name: '🛡️ RANK', value: `\`${userData?.rank || "NONE"}\``, inline: true },
                        { name: '💎 PREMIUM', value: userData?.premiumCode ? '`ACTIVE`' : '`INACTIVE`', inline: true }
                    );
                await m.channel.send({ embeds: [statsEmbed] });
                break;
        }
    }
};
