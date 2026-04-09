/**
 * ARCHITECT V6 | SLASH_MOD_HUB
 * Role Lock: Admin, Owner, Co-Owner Only
 */

const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    // [01] STAFF CONFIGURATION
    STAFF_ROLES: [
        "1491554076935192637", // Admin
        "1491542435312959529", // Owner
        "1491552861358788608"  // Co-Owner
    ],

    // [02] COMMAND DEFINITIONS (Sync this array in your main.js boot)
    definitions: [
        { 
            name: 'ban', description: 'Ban a member', 
            default_member_permissions: "0", // Hidden for non-admins
            options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3 }] 
        },
        { name: 'kick', description: 'Kick a member', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }] },
        { name: 'mute', description: 'Timeout a member', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }, { name: 'minutes', type: 4, required: true }] },
        { name: 'unmute', description: 'Remove timeout', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }] },
        { name: 'purge', description: 'Bulk delete messages', default_member_permissions: "0", options: [{ name: 'amount', type: 4, required: true }] },
        { name: 'nuke', description: 'Delete and recreate channel', default_member_permissions: "0" },
        { name: 'lock', description: 'Lock channel', default_member_permissions: "0" },
        { name: 'unlock', description: 'Unlock channel', default_member_permissions: "0" },
        { name: 'slowmode', description: 'Set channel slowmode', default_member_permissions: "0", options: [{ name: 'seconds', type: 4, required: true }] },
        { name: 'warn', description: 'Send a formal warning', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }, { name: 'reason', type: 3 }] },
        { name: 'nick', description: 'Change user nickname', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }, { name: 'name', type: 3, required: true }] },
        { name: 'vmute', description: 'VC Mute', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }] },
        { name: 'vdeaf', description: 'VC Deafen', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }] },
        { name: 'vkick', description: 'Kick from VC', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }] },
        { name: 'role_add', description: 'Add role to user', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }, { name: 'role', type: 8, required: true }] },
        { name: 'role_remove', description: 'Remove role', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }, { name: 'role', type: 8, required: true }] },
        { name: 'strip', description: 'Remove all roles', default_member_permissions: "0", options: [{ name: 'user', type: 6, required: true }] },
        { name: 'hide', description: 'Hide channel from @everyone', default_member_permissions: "0" },
        { name: 'show', description: 'Show channel to @everyone', default_member_permissions: "0" },
        // ... (Patterns continue for all 50+ commands)
    ],

    // [03] EXECUTION LOGIC
    handle: async (i) => {
        // Hard Clearance Check
        const hasClearance = i.member.roles.cache.some(r => module.exports.STAFF_ROLES.includes(r.id));
        if (!hasClearance) return i.reply({ content: "🚫 **LEVEL_REQUIRED: STAFF**", ephemeral: true });

        const { commandName, options, channel, guild } = i;

        switch (commandName) {
            case 'ban':
                const bTarget = options.getMember('user');
                await bTarget.ban({ reason: options.getString('reason') || "Architect Extraction" });
                return i.reply({ content: `⚔️ **BANNED:** ${bTarget.user.tag}`, ephemeral: true });

            case 'purge':
                const amount = options.getInteger('amount');
                await channel.bulkDelete(Math.min(amount, 100), true);
                return i.reply({ content: `🧹 **PURGED:** ${amount} messages.`, ephemeral: true });

            case 'nuke':
                const pos = channel.position;
                const newChan = await channel.clone();
                await channel.delete();
                await newChan.setPosition(pos);
                return newChan.send("☢️ **CHANNEL_REGENERATED**");

            case 'lock':
                await channel.permissionOverwrites.edit(guild.id, { SendMessages: false });
                return i.reply({ content: "🔒 **SECURED**", ephemeral: true });

            case 'mute':
                const mTarget = options.getMember('user');
                const mins = options.getInteger('minutes');
                await mTarget.timeout(mins * 60000);
                return i.reply({ content: `⏳ **MUTED:** ${mTarget.user.tag} for ${mins}m`, ephemeral: true });

            case 'slowmode':
                await channel.setRateLimitPerUser(options.getInteger('seconds'));
                return i.reply({ content: "🐌 **SLOWMODE_UPDATED**", ephemeral: true });

            case 'warn':
                const wUser = options.getUser('user');
                const reason = options.getString('reason') || "No reason.";
                try {
                    await wUser.send(`⚠️ **WARN:** ${guild.name} | Reason: ${reason}`);
                    return i.reply({ content: `📑 **WARNED:** ${wUser.tag}`, ephemeral: true });
                } catch { return i.reply({ content: "❌ **DM_BLOCKED**", ephemeral: true }); }

            case 'vkick':
                const vTarget = options.getMember('user');
                await vTarget.voice.disconnect();
                return i.reply({ content: "🎤 **VC_EXTRACTED**", ephemeral: true });

            // (Add cases for the remaining commands following this pattern)
        }
    }
};
