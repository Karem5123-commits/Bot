const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const Commands = {
    ROLES: {
        MOD: "1488205041885122581",    
        ADMIN: "1488205040811245740",  
        HELPER: "1488207431753531485"  
    },

    handle: async (m, client, State, RenderEngine, User) => {
        const args = m.content.slice(1).trim().split(/ +/);
        const cmd = args.shift().toLowerCase();
        const isOwner = State.SETTINGS.OWNERS.includes(m.author.id);

        // --- 1. AUTO-DELETE TRIGGER ---
        // This removes the "!command" message immediately
        if (m.deletable) await m.delete().catch(() => {});

        const isMod = m.member.roles.cache.has(Commands.ROLES.MOD) || isOwner;
        const isAdmin = m.member.roles.cache.has(Commands.ROLES.ADMIN) || isMod;
        const isHelper = m.member.roles.cache.has(Commands.ROLES.HELPER) || isAdmin;

        if (State.cmdCache.get(cmd) === false && !isOwner) {
            const msg = await m.channel.send("🔒 **MODULE_LOCKED**");
            return setTimeout(() => msg.delete().catch(() => {}), 3000);
        }

        // --- 2. RESPONSE SELF-DESTRUCT HELPER ---
        const replyAndFade = async (content, timer = 5000) => {
            const res = await m.channel.send(content);
            setTimeout(() => res.delete().catch(() => {}), timer);
        };

        switch (cmd) {
            // [PUBLIC]
            case "submit": {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('submit_content').setLabel('📤 SUBMIT CONTENT').setStyle(ButtonStyle.Primary)
                );
                await m.channel.send({ content: "💠 **ARCHITECT_PORTAL**", components: [row] });
                break;
            }

            // [HELPER]
            case "purge": {
                if (!isHelper) return;
                const amt = parseInt(args[0]) || 1;
                await m.channel.bulkDelete(Math.min(amt, 100), true);
                State.log("MOD", `PURGE: ${amt} by ${m.author.username}`);
                break;
            }

            case "timeout": {
                if (!isHelper) return;
                const target = m.mentions.members.first();
                if (!target) return;
                await target.timeout(3600000, "Helper Action");
                await replyAndFade(`🤐 **${target.user.username}** silenced for 1hr.`);
                break;
            }

            // [ADMIN]
            case "ban":
            case "kick": {
                if (!isAdmin) return;
                const target = m.mentions.members.first();
                if (!target) return;
                if (cmd === "ban") await target.ban(); else await target.kick();
                State.log("MOD", `${cmd.toUpperCase()}: ${target.user.tag}`);
                await replyAndFade(`✅ **${target.user.tag}** removed.`);
                break;
            }

            // [MODERATOR]
            case "nuke": {
                if (!isMod) return;
                const pos = m.channel.position;
                const newCh = await m.channel.clone();
                await m.channel.delete();
                await newCh.setPosition(pos);
                break;
            }

            // [MEDIA]
            case "quality": {
                const userData = await User.findOne({ discordId: m.author.id });
                const isPremium = userData?.premiumCode || userData?.elo >= 1000;
                if (!isPremium && !isAdmin) return replyAndFade("🔒 **PREMIUM_REQUIRED**");

                const attachment = m.attachments.first();
                if (!attachment || !attachment.contentType.startsWith('video')) return replyAndFade("⚠️ **ATTACH_VIDEO**");

                const status = await m.channel.send("🛰️ **SYNCING_WITH_ENGINE...**");
                RenderEngine.add(m, attachment.url, m.author, status);
                break;
            }

            // [SYSTEM]
            case "reload": {
                if (!isOwner) return;
                delete require.cache[require.resolve('./commands.js')];
                await replyAndFade("♻️ **SYSTEM_RELOADED**", 2000);
                break;
            }
        }
    }
};

module.exports = Commands;
