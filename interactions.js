'use strict';
// =============================================================
// FILE: interactionHandler.js
// ADVANCED INTERACTION ROUTER + COMPONENT VALIDATION + ERROR BOUNDARIES
// =============================================================
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits, ChannelType, ComponentType
} = require('discord.js');
const { CONFIG, db, log, getUser, updateUser, getRankFromElo, calcElo, applyRank, bjGames, drawCard, handTotal, recordBet, ObjectId, startGiveaway, modLog, assignAutoRoleToAll, client, Container, CacheManager, RateLimiter } = require('./main');

const interactionRouter = {
  async handle(interaction) {
    try {
      const userId = interaction.user.id;
      const guild = interaction.guild;
      const isStaff = interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages) || false;
      const isOwner = CONFIG.ownerIds.includes(userId);
      
      // --- BLACKJACK ENGINE ---
      if (interaction.componentType === ComponentType.Button && ['bj_hit','bj_stand','bj_double'].some(id => interaction.customId.startsWith(id))) {
        const game = bjGames.get(userId);
        if (!game) return interaction.reply({ content: '❌ No active blackjack session.', ephemeral: true });
        if (game.userId !== userId) return interaction.reply({ content: '🔒 This is not your game.', ephemeral: true });
        
        const userData = await getUser(userId);
        const action = interaction.customId.split('_')[1];
        
        if (action === 'double') {
          if (userData.balance < game.bet * 2) return interaction.reply({ content: '💸 Insufficient balance for double down.', ephemeral: true });
          game.bet *= 2;
          game.playerHand.push(drawCard());
          const pt = handTotal(game.playerHand);
          if (pt > 21) return this._resolveBJ(interaction, game, userData, -game.bet, 'bust_double');
          return this._renderBJ(interaction, game, 'Stand or double again.');
        }
        
        if (action === 'hit') {
          game.playerHand.push(drawCard());
          const pt = handTotal(game.playerHand);
          if (pt > 21) return this._resolveBJ(interaction, game, userData, -game.bet, 'bust');
          if (pt === 21) return this._resolveBJ(interaction, game, userData, game.bet * 1.5, 'natural');
          return this._renderBJ(interaction, game);
        }
        
        if (action === 'stand') {
          bjGames.delete(userId);
          let dt = handTotal(game.dealerHand);
          while (dt < 17) { game.dealerHand.push(drawCard()); dt = handTotal(game.dealerHand); }
          const pt = handTotal(game.playerHand);
          const won = dt > 21 || pt > dt;
          const push = pt === dt;
          const change = push ? 0 : won ? game.bet : -game.bet;
          await updateUser(userId, { balance: Math.max(0, userData.balance + change) });
          await recordBet(userId, 'blackjack', game.bet, push ? 'push' : won ? 'win' : 'loss', change);
          
          const resultMsg = push ? '🤝 Push!' : won ? `🎉 WIN +${game.bet}` : `💥 LOSS -${game.bet}`;
          return interaction.update({
            embeds: [new EmbedBuilder().setColor(won ? 0x00FF7F : 0xFF4444).setTitle('Blackjack Result')
              .addFields({ name: 'Dealer', value: game.dealerHand.join(' ') + ` (${dt})` }, { name: 'You', value: game.playerHand.join(' ') + ` (${pt})` })],
            content: `Dealer: **${dt}** | You: **${pt}** — ${resultMsg}`,
            components: []
          });
        }
      }
      
      // --- VERIFY & TICKET ---
      if (interaction.customId === 'verify_user') {
        const vRole = guild.roles.cache.find(r => ['verified','member','guest'].some(n => r.name.toLowerCase().includes(n)));
        if (!vRole) return interaction.reply({ content: '⚠️ Verification role misconfigured. Contact staff.', ephemeral: true });
        await interaction.member.roles.add(vRole).catch(() => {});
        return interaction.reply({ content: '✅ Identity verified. Welcome to the server.', ephemeral: true });
      }
      
      if (interaction.customId === 'open_ticket') {
        const existing = guild.channels.cache.find(c => c.name.startsWith('ticket-') && c.permissionOverwrites.cache.has(userId));
        if (existing) return interaction.reply({ content: `🎫 You already have an open ticket: ${existing}`, ephemeral: true });
        
        const ch = await guild.channels.create({
          name: `ticket-${interaction.user.username.slice(0,10).toLowerCase()}-${Math.floor(Math.random()*9999)}`,
          type: ChannelType.GuildText,
          reason: 'User ticket',
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] } // staff override via role later
          ]
        });
        await ch.permissionOverwrites.create(guild.roles.cache.find(r => r.name === 'Staff') || guild.roles.everyone, { ViewChannel: true, SendMessages: true });
        
        await ch.send({
          embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Support Ticket').setDescription(`Hello <@${userId}>. A staff member will assist shortly.\n\n*Ticket will auto-archive if inactive for 48h.*`)],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Close & Archive').setStyle(ButtonStyle.Secondary))]
        });
        return interaction.reply({ content: `📥 Ticket opened: ${ch}`, ephemeral: true });
      }
      
      if (interaction.customId === 'close_ticket') {
        await interaction.reply({ content: '📝 Archiving ticket in 5s...', ephemeral: true });
        setTimeout(() => interaction.channel?.setPermissionOverwrites([{id: userId, deny: ['SendMessages']}]).catch(() => {}), 5000);
        setTimeout(() => interaction.channel?.send('✅ Ticket archived. Reactivate via admin if needed.').catch(() => {}), 5500);
        return;
      }
      
      // --- GIVEAWAY ---
      if (interaction.customId.startsWith('gw_enter_')) {
        const gwId = interaction.customId.replace('gw_enter_', '');
        const gw = await db.collection('giveaways').findOne({ _id: new ObjectId(gwId) });
        if (!gw || gw.ended) return interaction.reply({ content: '🏁 Giveaway already ended.', ephemeral: true });
        if (gw.entries.includes(userId)) return interaction.reply({ content: '🎟️ Already entered.', ephemeral: true });
        await db.collection('giveaways').updateOne({ _id: gw._id }, { $push: { entries: userId } });
        return interaction.reply({ content: `🎉 Entered for **${gw.prize}**! Good luck.`, ephemeral: true });
      }
      
      // --- REVIEW BUTTONS ---
      if (interaction.customId.startsWith('rate_')) {
        if (!isStaff) return interaction.reply({ content: '🔒 Staff only.', ephemeral: true });
        const parts = interaction.customId.split('_');
        const rating = parts.pop();
        const subId = parts.slice(1).join('_');
        
        let sub;
        try { sub = await db.collection('submissions').findOne({ _id: new ObjectId(subId) }); } catch { sub = null; }
        if (!sub || sub.reviewed) return interaction.reply({ content: '⚠️ Submission not found or already processed.', ephemeral: true });
        
        const td = await getUser(sub.userId);
        const eloGain = calcElo(rating, td.elo, td.streak || 0, td.peakElo || 0);
        const newElo = td.elo + eloGain;
        const newRank = getRankFromElo(newElo).name;
        const rankedUp = newRank !== td.rank;
        
        await updateUser(sub.userId, {
          elo: newElo, rank: newRank, streak: (td.streak || 0) + 1,
          peakElo: Math.max(newElo, td.peakElo || 0), submissions: (td.submissions || 0) + 1,
        });
        await db.collection('submissions').updateOne({ _id: sub._id }, {
          $set: { rating, reviewed: true, reviewedAt: new Date(), reviewedBy: userId }
        });
        
        if (guild) {
          const member = await guild.members.fetch(sub.userId).catch(() => null);
          if (member) await applyRank(guild, member, newElo);
        }
        
        const msg = `⭐ Rated **${rating}** → **+${eloGain} ELO** to <@${sub.userId}>. Rank: ${newRank}`;
        return interaction.reply({ content: rankedUp ? `${msg} 🚀 **RANK UP!**` : msg, ephemeral: true });
      }
      
      // --- SLASH COMMANDS ---
      if (interaction.isChatInputCommand()) {
        const cmd = interaction.commandName;
        const userData = await getUser(userId);
        const isStaffLocal = interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages);
        const isOwnerLocal = CONFIG.ownerIds.includes(userId);
        
        switch (cmd) {
          case 'profile': {
            const target = interaction.options.getUser('target') || interaction.user;
            const tData = await getUser(target.id);
            const ro = getRankFromElo(tData.elo);
            const embed = new EmbedBuilder().setColor(ro.color)
              .setTitle(`👤 ${target.globalName || target.username}`)
              .setThumbnail(target.displayAvatarURL({ size: 256 }))
              .addFields(
                { name: 'Rank', value: `${ro.name}`, inline: true },
                { name: 'ELO', value: `${tData.elo.toLocaleString()}`, inline: true },
                { name: 'Peak ELO', value: `${(tData.peakElo || tData.elo).toLocaleString()}`, inline: true },
                { name: 'Level', value: `Lv ${tData.level}`, inline: true },
                { name: 'Balance', value: `${tData.balance.toLocaleString()} 🪙`, inline: true },
                { name: 'Win Rate', value: `${tData.wins ? ((tData.wins / (tData.wins + tData.losses)) * 100).toFixed(1) : 0}%`, inline: true }
              )
              .setFooter({ text: target.id });
            return interaction.reply({ embeds: [embed], ephemeral: true });
          }
          case 'submit': {
            const url = interaction.options.getString('url');
            const preset = interaction.options.getString('preset') || 'fast';
            const desc = interaction.options.getString('description') || 'No description provided.';
            
            if (!url.match(/^https?:\/\//)) return interaction.reply({ content: '❌ Invalid URL. Must start with http/https.', ephemeral: true });
            
            const ins = await db.collection('submissions').insertOne({
              userId, url, description: desc, preset, reviewed: false, submittedAt: new Date(), guildId: guild.id
            });
            
            const reviewCh = guild.channels.cache.get(CONFIG.reviewChannelId);
            if (reviewCh) {
              const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('📨 New Clip Submission')
                .addFields({ name: 'Submitter', value: `<@${userId}>` }, { name: 'URL', value: `[Click Here](${url})` }, { name: 'Preset', value: preset });
              const row = new ActionRowBuilder().addComponents(['A','S','SS','SSS'].map(r =>
                new ButtonBuilder().setCustomId(`rate_${ins.insertedId}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary)
              ));
              await reviewCh.send({ embeds: [embed], components: [row] });
            }
            return interaction.reply({ content: '✅ Clip queued for cinematic processing & review!', ephemeral: true });
          }
          case 'leaderboard': {
            const type = interaction.options.getString('type') || 'elo';
            const page = interaction.options.getInteger('page') || 1;
            const limit = 10;
            const skip = (page - 1) * limit;
            
            const sort = type === 'balance' ? 'balance' : type === 'winrate' ? 'wins' : 'elo';
            const total = await db.collection('users').countDocuments({ [sort]: { $gt: 0 } });
            const totalPages = Math.max(1, Math.ceil(total / limit));
            
            const top = await db.collection('users').find({ [sort]: { $gt: 0 } })
              .sort({ [sort]: -1, elo: -1 }).skip(skip).limit(limit).toArray();
            
            const medals = ['🥇','🥈','🥉'];
            const lines = top.map((u, i) => {
              const pos = skip + i + 1;
              const val = type === 'balance' ? `${u.balance.toLocaleString()} 🪙` : type === 'winrate' ? `${u.wins || 0}W / ${u.losses || 0}L` : `${u.elo} ELO (${u.rank})`;
              return `${medals[i] || `**${pos}.**`} <@${u.userId}> — ${val}`;
            });
            
            const embed = new EmbedBuilder().setColor(0xFFD700).setTitle(`🏆 ${type.toUpperCase()} Leaderboard`)
              .setDescription(lines.join('\n') || 'No data yet.')
              .setFooter({ text: `Page ${page}/${totalPages} — ${total} players` });
            
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`lb_${type}_${page-1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
              new ButtonBuilder().setCustomId(`lb_${type}_${page+1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
            );
            return interaction.reply({ embeds: [embed], components: [row] });
          }
          case 'review': {
            if (!isStaffLocal) return interaction.reply({ content: '🔒 Staff only.', ephemeral: true });
            const pending = await db.collection('submissions').find({ reviewed: false }).sort({ submittedAt: 1 }).limit(1).toArray();
            if (!pending.length) return interaction.reply({ content: '✨ Queue empty! Great job.', ephemeral: true });
            const sub = pending[0];
            const embed = new EmbedBuilder().setColor(0xFF6B6B).setTitle('📝 Review Submission')
              .addFields({ name: 'By', value: `<@${sub.userId}>` }, { name: 'URL', value: `[Open](${sub.url})` }, { name: 'Description', value: sub.description || 'N/A' });
            const row = new ActionRowBuilder().addComponents(['A','S','SS','SSS'].map(r =>
              new ButtonBuilder().setCustomId(`rate_${sub._id}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary)
            ));
            return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
          }
          case 'ticket_setup': {
            if (!isStaffLocal) return interaction.reply({ content: '🔒 Staff only.', ephemeral: true });
            const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Support Center').setDescription('Click to open a private, staff-assisted ticket.');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary).setEmoji('📥'));
            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '📤 Panel deployed.', ephemeral: true });
          }
          case 'verify_panel': {
            if (!isStaffLocal) return interaction.reply({ content: '🔒 Staff only.', ephemeral: true });
            const embed = new EmbedBuilder().setColor(0x22c55e).setTitle('✅ Identity Verification').setDescription('Click to complete verification and unlock server features.');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_user').setLabel('Verify Now').setStyle(ButtonStyle.Success).setEmoji('✅'));
            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '📤 Panel deployed.', ephemeral: true });
          }
          case 'lockdown_all': {
            if (!isStaffLocal) return interaction.reply({ content: '🔒 Staff only.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            let locked = 0;
            for (const ch of guild.channels.cache.values()) {
              if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice) {
                await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, Connect: false }).catch(() => {});
                locked++;
              }
            }
            await modLog(guild, 'LOCKDOWN ALL', userId, { tag: 'Server', id: guild.id });
            return interaction.editReply(`🔒 **${locked}** channels locked. Emergency protocol active.`);
          }
          case 'unlockdown_all': {
            if (!isStaffLocal) return interaction.reply({ content: '🔒 Staff only.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            let unlocked = 0;
            for (const ch of guild.channels.cache.values()) {
              if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice) {
                await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true, Connect: true }).catch(() => {});
                unlocked++;
              }
            }
            await modLog(guild, 'UNLOCK ALL', userId, { tag: 'Server', id: guild.id });
            return interaction.editReply(`🔓 **${unlocked}** channels restored.`);
          }
          case 'giveaway': {
            if (!isStaffLocal) return interaction.reply({ content: '🔒 Staff only.', ephemeral: true });
            const prize = interaction.options.getString('prize');
            const winners = interaction.options.getInteger('winners');
            const mins = interaction.options.getInteger('minutes');
            await startGiveaway(interaction.channel, prize, winners, mins * 60000, userId);
            return interaction.reply({ content: '🎉 Giveaway launched! Entries open.', ephemeral: true });
          }
          case 'suggestion': {
            const text = interaction.options.getString('text');
            const embed = new EmbedBuilder().setColor(0xFFFF00).setTitle('💡 Community Suggestion').setDescription(text).setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() });
            const msg = await interaction.channel.send({ embeds: [embed] });
            await msg.react('✅').catch(() => {});
            await msg.react('❌').catch(() => {});
            return interaction.reply({ content: '📝 Submitted to public feedback.', ephemeral: true });
          }
          case 'shop': {
            const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🛒 Premium Marketplace')
              .setDescription(`**Balance:** ${userData.balance.toLocaleString()} 🪙\n\nUse \`!redeem <code>\` or contact staff.`);
            return interaction.reply({ embeds: [embed], ephemeral: true });
          }
          case 'sync_roles': {
            if (!isOwnerLocal) return interaction.reply({ content: '👑 Owner only.', ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const result = await assignAutoRoleToAll(guild);
            return interaction.editReply(`✅ Sync complete: **${result.assigned}** assigned, **${result.skipped}** skipped, **
