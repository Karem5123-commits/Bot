const { PermissionFlagsBits } = require('discord.js');

/**
 * ARCHITECT V6 COMMAND MODULE (SWAPPED HIERARCHY)
 * Real-time Sync Enabled | Role-ID Specific
 */
const Commands = {
    // Verified Server Role IDs
    ROLES: {
        MOD: "1488205041885122581",    // HIGH TIER: Softban, Nuke, ELO Management
        ADMIN: "1488205040811245740",  // MID TIER: Ban, Kick, Channel Locks
        HELPER: "1488207431753531485"  // LOW TIER: Purge, Timeout, Warn
    },

    handle: async (m, client, State, RenderEngine, User) => {
        const args = m.content.slice(1).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        const isOwner = State.SETTINGS.OWNERS.includes(m.author.id);

        // --- Permission Hierarchy Calculation ---
        const isMod = m.member.roles.cache.has(Commands.ROLES.MOD) || isOwner;
        const isAdmin = m.member.roles.cache.has(Commands.ROLES.ADMIN) || isMod;
        const isHelper = m.member.roles.cache.has(Commands.ROLES.HELPER) || isAdmin;

        // Dashboard Toggle Check
        if (State.cmdCache.get(cmd) === false && !isOwner) {
            return m.reply("🔒 **MODULE_LOCKED:** Admin override active.");
        }

        switch (cmd) {
            // ==========================================
            // [TIER: HELPER] - Low Level Authority
            // ==========================================
            case "purge":
            case "timeout":
            case "warn":
            case "whois": {
                if (!isHelper) return; 
                
                if (cmd === "purge") {
                    const amt = parseInt(args[0]) || 1;
                    await m.channel.bulkDelete(Math.min(amt, 100), true);
                }
                if (cmd === "timeout") {
                    const target = m.mentions.members.first();
                    if (target) await target.timeout(3600000, "Helper-level action.");
                }
                if (cmd === "warn") {
                    const target = m.mentions.users.first();
                    if (target) m.reply(`⚠️ **${target.username}**, you have been warned.`);
                }
                
                State.log("MOD", `${cmd.toUpperCase()} executed by Helper: ${m.author.username}`);
                break;
            }

            // ==========================================
            // [TIER: ADMIN] - Mid Level Authority
            // ==========================================
            case "kick":
            case "ban":
            case "lock":
            case "unlock":
            case "slowmode": {
                if (!isAdmin) return m.reply("🚫 **LEVEL_REQUIRED: ADMIN (MID)**");
                
                const target = m.mentions.members.first();
                if (cmd === "ban" && target) await target.ban();
                if (cmd === "kick" && target) await target.kick();
                if (cmd === "lock") await m.channel.permissionOverwrites.edit(m.guild.id, { SendMessages: false });
                if (cmd === "unlock") await m.channel.permissionOverwrites.edit(m.guild.id, { SendMessages: true });
                if (cmd === "slowmode") await m.channel.setRateLimitPerUser(parseInt(args[0]) || 0);
                
                State.log("MOD", `${cmd.toUpperCase()} executed by Admin: ${m.author.username}`);
                break;
            }

            // ==========================================
            // [TIER: MODERATOR] - Critical Authority
            // ==========================================
            case "softban":
            case "nuke":
            case "setrank":
            case "addelo":
            case "remelo": {
                if (!isMod) return m.reply("🚫 **LEVEL_REQUIRED: MODERATOR (HIGH)**");
                
                if (cmd === "softban") {
                    const target = m.mentions.members.first();
                    if (target) {
                        await target.ban({ deleteMessageSeconds: 604800 });
                        await m.guild.members.unban(target.id);
                    }
                }
                if (cmd === "nuke") {
                    const pos = m.channel.position;
                    const newCh = await m.channel.clone();
                    await m.channel.delete();
                    await newCh.setPosition(pos);
                }
                
                State.log("MOD", `⚠️ CRITICAL: ${cmd.toUpperCase()} by Moderator: ${m.author.username}`);
                break;
            }

            // ==========================================
            // [SYSTEM] - Owner & Maintenance
            // ==========================================
            case "reload": {
                if (!isOwner) return;
                delete require.cache[require.resolve('./commands.js')];
                m.reply("♻️ **SYNC_COMPLETE:** Hierarchy & Logic updated via Hot-Reload.");
                break;
            }
        }
    }
};

module.exports = Commands;
