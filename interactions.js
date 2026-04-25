'use strict';
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionFlagsBits, ChannelType, Colors
} = require('discord.js');

const {
    CONFIG, db, log, getUser, updateUser, getRankFromElo, calcElo, applyRank,
    bjGames, drawCard, handTotal, recordBet, ObjectId,
    startGiveaway, modLog, assignAutoRoleToAll, client,
} = require('./main');

// =============================================================
// LEADERBOARD BUILDER (paginated)
// =============================================================
async function buildLeaderboard(page) {
    const pageSize = 10;
    const skip = (page - 1) * pageSize;
    const total = await db.collection('users').countDocuments({ elo: { $gt: 0 } });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const top = await db.collection('users').find({ elo: { $gt: 0 } }).sort({ elo: -1 }).skip(skip).limit(pageSize).toArray();
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((u, i) => {
        const pos = skip + i + 1;
        return `${medals[pos - 1] || `**${pos}.**`} <@${u.userId}> — ELO: **${u.elo}** | ${u.rank}`;
    });
    const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('🏆 ELO Leaderboard')
        .setDescription(lines.join('\n') || 'No players yet.')
        .setFooter({ text: `Page ${page}/${totalPages} — ${total} players` });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`lb_${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId(`lb_${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
    );
    return { embed, row, totalPages };
}

// =============================================================
// MODULE EXPORT
// =============================================================
module.exports = function (client) {
    client.on('interactionCreate', async interaction => {
        try {
            // ── BLACKJACK BUTTONS ──
            if (interaction.isButton() && (interaction.customId.startsWith('bj_hit_') || interaction.customId.startsWith('bj_stand_') || interaction.customId.startsWith('bj_double_'))) {
                const userId = interaction.customId.split('_').pop();
                if (interaction.user.id !== userId) return interaction.reply({ content: 'Not your game.', ephemeral: true });
                const game = bjGames.get(userId);
                if (!game) return interaction.reply({ content: 'No active game.', ephemeral: true });
                const userData = await getUser(userId);
                const type = interaction.customId.split('_')[1];

                if (type === 'hit') {
                    game.playerHand.push(drawCard());
                    const total = handTotal(game.playerHand);
                    if (total > 21) {
                        bjGames.delete(userId);
                        await updateUser(userId, { balance: Math.max(0, userData.balance - game.bet) });
                        await recordBet(userId, 'blackjack', game.bet, 'bust', -game.bet);
                        return interaction.update({ content: `💥 Bust at **${total}** — Lost **${game.bet}**`, embeds: [], components: [] });
                    }
                    const embed = new EmbedBuilder().setColor(0x1A1A2E).setTitle('🃏 Blackjack').addFields(
                        { name: 'Your Hand', value: `${game.playerHand.join(' ')} (${total})`, inline: true },
                        { name: 'Dealer', value: `${game.dealerHand[0]} [hidden]`, inline: true },
                        { name: 'Bet', value: `${game.bet.toLocaleString()} coins`, inline: true }
                    );
                    return interaction.update({ embeds: [embed] });
                }

                if (type === 'stand') {
                    bjGames.delete(userId);
                    let dt = handTotal(game.dealerHand);
                    while (dt < 17) { game.dealerHand.push(drawCard()); dt = handTotal(game.dealerHand); }
                    const pt = handTotal(game.playerHand);
                    const won = dt > 21 || pt > dt, push = pt === dt;
                    const change = push ? 0 : won ? game.bet : -game.bet;
                    await updateUser(userId, { balance: Math.max(0, userData.balance + change) });
                    await recordBet(userId, 'blackjack', game.bet, push ? 'push' : won ? 'win' : 'loss', change);
                    return interaction.update({
                        content: `Dealer: **${dt}** | You: **${pt}** — ${push ? 'Tie!' : won ? `WON +${game.bet}` : `LOST -${game.bet}`}`,
                        embeds: [], components: []
                    });
                }

                if (type === 'double') {
                    if (userData.balance < game.bet * 2) return interaction.reply({ content: 'Not enough balance to double.', ephemeral: true });
                    game.playerHand.push(drawCard());
                    const pt = handTotal(game.playerHand);
                    bjGames.delete(userId);
                    let dt = handTotal(game.dealerHand);
                    while (dt < 17) { game.dealerHand.push(drawCard()); dt = handTotal(game.dealerHand); }
                    const won = dt > 21 || (pt <= 21 && pt > dt), push = pt === dt || (pt > 21 && dt > 21);
                    const change = push ? 0 : won ? game.bet * 2 : -(game.bet * 2);
                    await updateUser(userId, { balance: Math.max(0, userData.balance + change) });
                    await recordBet(userId, 'blackjack', game.bet * 2, push ? 'push' : won ? 'win' : 'loss', change);
                    return interaction.update({
                        content: `Double! Dealer: **${dt}** | You: **${pt}** — ${push ? 'Tie!' : won ? `WON +${game.bet * 2}` : `LOST -${game.bet * 2}`}`,
                        embeds: [], components: []
                    });
                }
            }

            // ── VERIFY ──
            if (interaction.isButton() && interaction.customId === 'verify_user') {
                const vRole = interaction.guild.roles.cache.find(r => ['verified', 'member'].includes(r.name.toLowerCase()));
                if (vRole) {
                    await interaction.member.roles.add(vRole).catch(() => {});
                    return interaction.reply({ content: '✅ Verified! Welcome.', ephemeral: true });
                }
                return interaction.reply({ content: '❌ Verification role not found.', ephemeral: true });
            }

            // ── TICKET OPEN ──
            if (interaction.isButton() && interaction.customId === 'open_ticket') {
                const name = `ticket-${interaction.user.username.toLowerCase().slice(0, 10)}-${Math.floor(Math.random() * 999)}`;
                const existing = interaction.guild.channels.cache.find(c => c.name === name);
                if (existing) return interaction.reply({ content: `You already have: ${existing}`, ephemeral: true });
                const ticketCh = await interaction.guild.channels.create({
                    name, type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ]
                });
                const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Support Ticket').setDescription(`Hello <@${interaction.user.id}>! Staff will assist shortly.`);
                const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger));
                await ticketCh.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });
                return interaction.reply({ content: `Ticket: ${ticketCh}`, ephemeral: true });
            }

            // ── TICKET CLOSE ──
            if (interaction.isButton() && interaction.customId === 'close_ticket') {
                await interaction.reply({ content: 'Closing in 5s...', ephemeral: true });
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
                return;
            }

            // ── GIVEAWAY ENTER ──
            if (interaction.isButton() && interaction.customId.startsWith('gw_enter_')) {
                const gwId = interaction.customId.replace('gw_enter_', '');
                try {
                    await container.resolve('giveawayEngine').enter(gwId, interaction.user.id);
                    return interaction.reply({ content: `🎁 Entered the giveaway!`, ephemeral: true });
                } catch (e) { return interaction.reply({ content: e.message, ephemeral: true }); }
            }

            // ── RATE ──
            if (interaction.isButton() && interaction.customId.startsWith('rate_')) {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages))
                    return interaction.reply({ content: 'Staff only.', ephemeral: true });
                const parts = interaction.customId.split('_');
                const rating = parts.pop();
                const subId = parts.slice(1).join('_');
                let sub;
                try { sub = await db.collection('submissions').findOne({ _id: new ObjectId(subId) }); }
                catch (e) { sub = await db.collection('submissions').findOne({ _id: subId }); }
                if (!sub || sub.reviewed) return interaction.reply({ content: 'Already reviewed or not found.', ephemeral: true });
                const td = await getUser(sub.userId);
                const eloGain = calcElo(rating, td.elo, td.streak || 0, td.peakElo || td.elo);
                const newElo = td.elo + eloGain;
                const newRank = getRankFromElo(newElo).name;
                const ranked = newRank !== td.rank;
                await updateUser(sub.userId, {
                    elo: newElo, rank: newRank, streak: (td.streak || 0) + 1,
                    peakElo: Math.max(newElo, td.peakElo || 0),
                    submissions: (td.submissions || 0) + 1
                });
                await db.collection('submissions').updateOne({ _id: sub._id }, {
                    $set: { rating, reviewed: true, reviewedAt: new Date(), reviewedBy: interaction.user.id }
                });
                const guild = interaction.guild;
                if (guild) {
                    const member = await guild.members.fetch(sub.userId).catch(() => null);
                    if (member) await applyRank(guild, member, newElo);
                }
                let msg = `⭐ Rated **${rating}** — +${eloGain} ELO to <@${sub.userId}>. Rank: ${newRank}`;
                if (ranked) msg += ' 🎉 **RANK UP!**';
                return interaction.reply({ content: msg, ephemeral: true });
            }

            // ── LEADERBOARD PAGINATION ──
            if (interaction.isButton() && interaction.customId.startsWith('lb_')) {
                const page = parseInt(interaction.customId.split('_')[1]);
                if (page < 1) return interaction.reply({ content: 'First page.', ephemeral: true });
                const lb = await buildLeaderboard(page);
                return interaction.update({ embeds: [lb.embed], components: [lb.row] });
            }

            // ── MODAL: SUBMIT ──
            if (interaction.isModalSubmit() && interaction.customId === 'submit_modal') {
                const url = interaction.fields.getTextInputValue('clip_url');
                const desc = interaction.fields.getTextInputValue('clip_desc') || 'No description';
                const ins = await db.collection('submissions').insertOne({
                    userId: interaction.user.id, url, description: desc,
                    reviewed: false, submittedAt: new Date(), guildId: interaction.guild.id
                });
                const reviewCh = client.channels.cache.get(CONFIG.reviewChannelId);
                if (reviewCh) {
                    const embed = new EmbedBuilder().setColor(0xFF6B6B).setTitle('📨 New Submission').addFields(
                        { name: 'User', value: `<@${interaction.user.id}>` },
                        { name: 'URL', value: url },
                        { name: 'Description', value: desc }
                    );
                    const row = new ActionRowBuilder().addComponents(
                        ['A', 'S', 'SS', 'SSS'].map(r => new ButtonBuilder().setCustomId(`rate_${ins.insertedId}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary))
                    );
                    await reviewCh.send({ embeds: [embed], components: [row] });
                }
                return interaction.reply({ content: '✅ Submitted for review!', ephemeral: true });
            }

            // ── SLASH COMMANDS ──
            if (interaction.isChatInputCommand()) {
                const userData = await getUser(interaction.user.id);
                const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
                const isOwner = CONFIG.ownerIds.includes(interaction.user.id);

                if (interaction.commandName === 'profile') {
                    const ro = getRankFromElo(userData.elo);
                    const embed = new EmbedBuilder().setColor(ro.color).setTitle(`👤 Profile — ${interaction.user.username}`)
                        .setThumbnail(interaction.user.displayAvatarURL())
                        .addFields(
                            { name: 'Rank', value: ro.name, inline: true },
                            { name: 'ELO', value: String(userData.elo), inline: true },
                            { name: 'Peak ELO', value: String(userData.peakElo || userData.elo), inline: true },
                            { name: 'Level', value: String(userData.level), inline: true },
                            { name: 'Balance', value: `${userData.balance.toLocaleString()} 🪙`, inline: true },
                            { name: 'Premium', value: userData.premium ? '✅' : '❌', inline: true }
                        );
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                if (interaction.commandName === 'submit') {
                    const modal = new ModalBuilder().setCustomId('submit_modal').setTitle('Submit a Clip');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('clip_url').setLabel('Clip URL').setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('clip_desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false))
                    );
                    return interaction.showModal(modal);
                }

                if (interaction.commandName === 'leaderboard') {
                    const page = interaction.options.getInteger('page') || 1;
                    const lb = await buildLeaderboard(page);
                    return interaction.reply({ embeds: [lb.embed], components: [lb.row] });
                }

                if (interaction.commandName === 'review') {
                    if (!isStaff) return interaction.reply({ content: 'Staff only.', ephemeral: true });
                    const pending = await db.collection('submissions').find({ reviewed: false }).sort({ submittedAt: 1 }).limit(1).toArray();
                    if (!pending.length) return interaction.reply({ content: '✨ No pending submissions!', ephemeral: true });
                    const sub = pending[0];
                    const embed = new EmbedBuilder().setColor(0xFF6B6B).setTitle('📝 Review Submission').addFields(
                        { name: 'By', value: `<@${sub.userId}>` },
                        { name: 'URL', value: sub.url },
                        { name: 'Description', value: sub.description || 'None' }
                    );
                    const row = new ActionRowBuilder().addComponents(
                        ['A', 'S', 'SS', 'SSS'].map(r => new ButtonBuilder().setCustomId(`rate_${sub._id}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary))
                    );
                    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
                }

                if (interaction.commandName === 'ticket_setup') {
                    if (!isStaff) return interaction.reply({ content: 'Staff only.', ephemeral: true });
                    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Support Tickets').setDescription('Click below to open a private ticket.');
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary));
                    await interaction.channel.send({ embeds: [embed], components: [row] });
                    return interaction.reply({ content: 'Panel sent!', ephemeral: true });
                }

                if (interaction.commandName === 'verify_panel') {
                    if (!isStaff) return interaction.reply({ content: 'Staff only.', ephemeral: true });
                    const embed = new EmbedBuilder().setColor(0x22c55e).setTitle('✅ Verification').setDescription('Click to verify.');
                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_user').setLabel('Verify').setStyle(ButtonStyle.Success));
                    await interaction.channel.send({ embeds: [embed], components: [row] });
                    return interaction.reply({ content: 'Panel sent!', ephemeral: true });
                }

                if (interaction.commandName === 'lockdown_all') {
                    if (!isStaff) return interaction.reply({ content: 'Staff only.', ephemeral: true });
                    await interaction.deferReply({ ephemeral: true });
                    let locked = 0;
                    for (const ch of interaction.guild.channels.cache.values()) {
                        if (ch.isTextBased()) {
                            await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }).catch(() => {});
                            locked++;
                        }
                    }
                    await modLog(interaction.guild, 'LOCKDOWN ALL', interaction.user, { tag: 'Server', id: interaction.guild.id });
                    return interaction.editReply(`🔒 **${locked}** channels locked.`);
                }

                if (interaction.commandName === 'unlockdown_all') {
                    if (!isStaff) return interaction.reply({ content: 'Staff only.', ephemeral: true });
                    await interaction.deferReply({ ephemeral: true });
                    let unlocked = 0;
                    for (const ch of interaction.guild.channels.cache.values()) {
                        if (ch.isTextBased()) {
                            await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: true }).catch(() => {});
                            unlocked++;
                        }
                    }
                    await modLog(interaction.guild, 'UNLOCK ALL', interaction.user, { tag: 'Server', id: interaction.guild.id });
                    return interaction.editReply(`🔓 **${unlocked}** channels unlocked.`);
                }

                if (interaction.commandName === 'giveaway') {
                    if (!isStaff) return interaction.reply({ content: 'Staff only.', ephemeral: true });
                    const prize = interaction.options.getString('prize');
                    const winners = interaction.options.getInteger('winners');
                    const mins = interaction.options.getInteger('minutes');
                    await startGiveaway(interaction.channel, prize, winners, mins * 60000, interaction.user.id);
                    return interaction.reply({ content: '🎉 Giveaway started!', ephemeral: true });
                }

                if (interaction.commandName === 'suggestion') {
                    const text = interaction.options.getString('text');
                    const embed = new EmbedBuilder().setColor(0xFFFF00).setTitle('💡 Suggestion').setDescription(text)
                        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() });
                    const msg = await interaction.channel.send({ embeds: [embed] });
                    await msg.react('👍').catch(() => {});
                    await msg.react('👎').catch(() => {});
                    return interaction.reply({ content: 'Submitted!', ephemeral: true });
                }

                if (interaction.commandName === 'shop') {
                    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🛒 Shop').setDescription('Coming soon! Check back later.');
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                if (interaction.commandName === 'sync_roles') {
                    if (!isOwner) return interaction.reply({ content: '👑 Owner only.', ephemeral: true });
                    await interaction.deferReply({ ephemeral: true });
                    const result = await assignAutoRoleToAll(interaction.guild);
                    return interaction.editReply(`✅ Assigned: **${result.assigned}**, Skipped: **${result.skipped}**, Failed: **${result.failed}**`);
                }
            }
        } catch (err) {
            log('ERROR', `Interaction error: ${err.message}`);
            try {
                const msg = { content: '❌ An error occurred.', ephemeral: true };
                if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
                else await interaction.reply(msg);
            } catch (e) {}
        }
    });
};
