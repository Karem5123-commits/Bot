const { PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

/**
 * ARCHITECT V6 COMMAND MODULE (AUTO-SYNC)
 */
const Commands = {
    // Role IDs (Replace these with your actual Server Role IDs)
    ROLES: {
        ADMIN: "YOUR_ADMIN_ROLE_ID",
        MOD: "YOUR_MOD_ROLE_ID",
        HELPER: "YOUR_HELPER_ROLE_ID"
    },

    handle: async (m, client, State, RenderEngine) => {
        const args = m.content.slice(1).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        const isOwner = State.SETTINGS.OWNERS.includes(m.author.id);

        // --- Permission Level Calculation ---
        const isAdmin = m.member.roles.cache.has(Commands.ROLES.ADMIN) || isOwner;
        const isMod = m.member.roles.cache.has(Commands.ROLES.MOD) || isAdmin;
        const isHelper = m.member.roles.cache.has(Commands.ROLES.HELPER) || isMod;

        // Dashboard Lock Check
        if (State.cmdCache.get(cmd) === false && !isOwner) {
            return m.reply("🔒 **MODULE_LOCKED:** Admin override active.");
        }

        switch (cmd) {
            // [TIER: HELPER]
            case "purge":
                if (!isHelper) return;
                const amt = parseInt(args[0]) || 1;
                await m.channel.bulkDelete(Math.min(amt, 100), true);
                State.log("MOD", `PURGE: ${amt} by ${m.author.username}`);
                break;

            case "timeout":
            case "warn":
                if (!isHelper) return;
                const targetWarn = m.mentions.members.first();
                if (!targetWarn) return m.reply("⚠️ Specify user.");
                if (cmd === "timeout") await targetWarn.timeout(3600000, "Helper Action");
                State.log("WARN", `${targetWarn.user.tag} flagged by ${m.author.username}`);
                m.reply(`✅ **Action Logged:** ${targetWarn.user.username}`);
                break;

            // [TIER: MOD]
            case "kick":
            case "ban":
                if (!isMod) return m.reply("🚫 **LEVEL_REQUIRED: MOD**");
                const targetMod = m.mentions.members.first();
                if (!targetMod) return;
                if (cmd === "kick") await targetMod.kick();
                else await targetMod.ban();
                State.log("MOD", `${cmd.toUpperCase()}: ${targetMod.user.tag}`);
                break;

            case "lock":
            case "unlock":
                if (!isMod) return;
                await m.channel.permissionOverwrites.edit(m.guild.id, { SendMessages: (cmd === "unlock") });
                m.reply(`Channel **${cmd.toUpperCase()}ED**.`);
                break;

            // [TIER: ADMIN]
            case "softban":
                if (!isAdmin) return m.reply("🚫 **LEVEL_REQUIRED: ADMIN**");
                const sbTarget = m.mentions.members.first();
                if (!sbTarget) return;
                await sbTarget.ban({ deleteMessageSeconds: 604800 });
                await m.guild.members.unban(sbTarget.id);
                State.log("MOD", `SOFTBAN: ${sbTarget.user.tag}`);
                break;

            case "nuke":
                if (!isAdmin) return;
                const pos = m.channel.position;
                const newCh = await m.channel.clone();
                await m.channel.delete();
                await newCh.setPosition(pos);
                break;

            // [SPECIAL: OWNER/QUALITY]
            case "quality":
                // Quality is restricted to Owner or Level 20 (handled in bot.js/logic)
                if (!isOwner && !isAdmin) return m.reply("🚫 **ACCESS_DENIED**");
                // Calling the engine...
                break;

            // [HOT RELOAD]
            case "reload":
                if (!isOwner) return;
                try {
                    delete require.cache[require.resolve('./commands.js')];
                    m.reply("♻️ **COMMANDS_RELOADED:** Real-time sync complete.");
                    State.log("SYSTEM", "Manual hot-reload triggered.");
                } catch (e) {
                    m.reply("❌ **RELOAD_ERROR**");
                }
                break;
        }
    }
};

module.exports = Commands;
