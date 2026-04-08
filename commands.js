const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    ROLES: {
        MOD: "1488205041885122581",    
        ADMIN: "1488205040811245740",  
        HELPER: "1488207431753531485"  
    },

    handle: async (m, client, State, RenderEngine, User) => {
        const args = m.content.slice(1).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        const isOwner = State.SETTINGS.OWNERS.includes(m.author.id);

        if (m.deletable) await m.delete().catch(() => {});

        const isMod = m.member.roles.cache.has(module.exports.ROLES.MOD) || isOwner;
        const isAdmin = m.member.roles.cache.has(module.exports.ROLES.ADMIN) || isMod;
        const isHelper = m.member.roles.cache.has(module.exports.ROLES.HELPER) || isAdmin;

        const notify = async (title, desc, color = 0x00FFFF) => {
            const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
            const res = await m.channel.send({ embeds: [embed] });
            setTimeout(() => res.delete().catch(() => {}), 6000);
        };

        switch (cmd) {
            case "submit":
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('submit_content').setLabel('🚀 INITIALIZE UPLOAD').setStyle(ButtonStyle.Primary)
                );
                const subEmbed = new EmbedBuilder()
                    .setColor(0x00FFFF)
                    .setTitle('💠 ARCHITECT_PORTAL')
                    .setDescription('Click below to begin the secure data transmission.');
                await m.channel.send({ embeds: [subEmbed], components: [row] });
                break;

            case "ban":
                if (!isAdmin) return;
                const target = m.mentions.members.first();
                if (target) {
                    await target.ban();
                    await notify('⚔️ TARGET_EXTRACTED', `${target.user.tag} has been permanently banned.`, 0xFF0000);
                    State.log("MOD", `BAN: ${target.user.tag}`);
                }
                break;

            case "quality":
                const u = await User.findOne({ discordId: m.author.id });
                if (!u?.premiumCode && !isAdmin) return notify('🔒 ACCESS_DENIED', 'Premium status required.');
                const file = m.attachments.first();
                if (!file) return notify('⚠️ ERROR', 'Attach a video file.');
                
                const statusEmbed = new EmbedBuilder().setColor(0xFFFF00).setTitle('🛰️ UPLINK_ESTABLISHED').setDescription('Video moved to Render Queue...');
                const status = await m.channel.send({ embeds: [statusEmbed] });
                RenderEngine.add(m, file.url, m.author, status);
                break;
                
            case "purge":
                if (!isHelper) return;
                const amt = parseInt(args[0]) || 5;
                await m.channel.bulkDelete(amt, true);
                await notify('🧹 CLEANUP_COMPLETE', `Purged ${amt} messages.`);
                break;
        }
    }
};
