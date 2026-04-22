'use strict';
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const fsSync = require('fs');
const fs = require('fs').promises;
const {
  CONFIG, db, getUser, updateUser, getRankFromElo,
  addToJackpot, getJackpot, resetJackpot,
  snipeCache, bjGames, spinSlots, slotsResult, drawCard, handTotal,
  recordBet, processVideo, autoDelete, HELP, modLog, log,
} = require('./main');

module.exports = async function handleCommand(message, cmd, args) {
  const userId = message.author.id;
  const userData = await getUser(userId);
  const rankObj = getRankFromElo(userData.elo);

  if (cmd === 'help') {
    const target = args[0]?.toLowerCase();
    if (target && HELP[target]) {
      const h = HELP[target];
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`!${target}`)
        .addFields(
          { name: 'Description', value: h.desc },
          { name: 'Usage', value: `\`${h.usage}\`` }
        );
      return autoDelete(await message.reply({ embeds: [embed] }), 30);
    }
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🤖 GOD MODE BOT — Commands')
      .addFields(
        { name: '💰 Economy', value: '`!balance` `!daily` `!history` `!stats`' },
        { name: '🎰 Gambling', value: '`!coinflip` `!slots` `!roulette` `!blackjack` `!dice` `!spin` `!allin` `!jackpot`' },
        { name: '🏆 Rank', value: '`!rankcard` `!submit` `!quality`' },
        { name: '🔧 Utility', value: '`!snipe`' },
        { name: '🛡️ Mod', value: '`!kick` `!ban` `!mute` `!unmute` `!warn` `!clear` `!lock` `!unlock` `!slowmode`' },
        { name: '👑 Owner', value: '`!code`' },
        { name: '⚡ Slash', value: '`/submit` `/profile` `/review` `/leaderboard` `/ticket_setup` `/verify_panel` `/giveaway` `/suggestion` `/shop`' }
      );
    return autoDelete(await message.reply({ embeds: [embed] }), 30);
  }

  if (cmd === 'balance') {
    const embed = new EmbedBuilder().setColor(0x00FF7F).setTitle('💰 Balance')
      .setDescription(`${message.author} has **${userData.balance.toLocaleString()} coins**.`);
    return autoDelete(await message.reply({ embeds: [embed] }));
  }

  if (cmd === 'stats') {
    const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(`📊 ${message.author.username}'s Stats`)
      .addFields(
        { name: 'Total Wagered', value: (userData.totalWagered || 0).toLocaleString(), inline: true },
        { name: 'Total Won', value: (userData.totalWon || 0).toLocaleString(), inline: true },
        { name: 'Win Rate', value: userData.totalWagered ? `${((userData.totalWon / userData.totalWagered) * 100).toFixed(1)}%` : '0%', inline: true },
        { name: 'Submissions', value: String(userData.submissions || 0), inline: true },
        { name: 'Level', value: String(userData.level), inline: true },
        { name: 'Rank', value: rankObj.name, inline: true }
      );
    return autoDelete(await message.reply({ embeds: [embed] }), 30);
  }

  if (cmd === 'daily') {
    const last = userData.dailyLast ? new Date(userData.dailyLast).getTime() : 0;
    const rem = 86400000 - (Date.now() - last);
    if (rem > 0) {
      const h = Math.floor(rem/3600000), m = Math.floor((rem%3600000)/60000);
      return autoDelete(await message.reply(`⏰ Daily resets in **${h}h ${m}m**.`));
    }
    const reward = userData.premium ? 500 : 200;
    await updateUser(userId, { balance: userData.balance + reward, dailyLast: new Date() });
    return autoDelete(await message.reply(`✅ Claimed **${reward} coins**! Balance: **${(userData.balance + reward).toLocaleString()}**.`));
  }

  if (cmd === 'history') {
    const history = userData.betHistory || [];
    if (!history.length) return autoDelete(await message.reply('No bet history yet.'));
    const lines = [...history].reverse().map((b, i) =>
      `**${i+1}.** \`!${b.cmd}\` — Bet **${b.bet}** → ${b.change >= 0 ? '+' : ''}${b.change} (${b.result})`
    ).join('\n');
    const embed = new EmbedBuilder().setColor(0x7289DA).setTitle('📜 Bet History').setDescription(lines);
    return autoDelete(await message.reply({ embeds: [embed] }), 20);
  }

  if (cmd === 'snipe') {
    const snipe = snipeCache.get(message.channelId);
    if (!snipe) return autoDelete(await message.reply('Nothing to snipe.'));
    const embed = new EmbedBuilder().setColor(0xFF6B6B).setTitle('🎯 Sniped Message')
      .setDescription(snipe.content)
      .setFooter({ text: `Sent by ${snipe.author} — ${new Date(snipe.at).toLocaleTimeString()}` });
    return autoDelete(await message.reply({ embeds: [embed] }), 20);
  }

  if (cmd === 'coinflip') {
    const bet = parseInt(args[0]);
    const side = args[1]?.toLowerCase();
    if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet.'));
    if (!['heads','tails'].includes(side)) return autoDelete(await message.reply('Choose `heads` or `tails`.'));
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === side;
    const change = won ? bet : -bet;
    await updateUser(userId, { balance: userData.balance + change });
    await addToJackpot(bet);
    await recordBet(userId, 'coinflip', bet, result, change);
    return autoDelete(await message.reply(`🪙 **${result.toUpperCase()}** — ${won ? `Won +${bet}` : `Lost -${bet}`} coins.`));
  }

  if (cmd === 'bet' || cmd === 'dice') {
    const bet = parseInt(args[0]);
    if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet.'));
    const roll = Math.floor(Math.random() * 6) + 1;
    const won = roll >= 4;
    const change = won ? bet : -bet;
    await updateUser(userId, { balance: userData.balance + change });
    await addToJackpot(bet);
    await recordBet(userId, cmd, bet, `rolled ${roll}`, change);
    return autoDelete(await message.reply(`🎲 Rolled **${roll}** — ${won ? `Won +${bet}` : `Lost -${bet}`} coins.`));
  }

  if (cmd === 'slots') {
    const bet = parseInt(args[0]);
    if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet.'));
    const reels = spinSlots();
    const sr = slotsResult(reels);
    const gain = Math.floor(bet * sr.mult) - bet;
    const newBal = Math.max(0, userData.balance + gain);
    if (reels[0]==='💎' && reels[1]==='💎' && reels[2]==='💎') {
      const pool = await getJackpot();
      await updateUser(userId, { balance: newBal + pool });
      await resetJackpot();
      await recordBet(userId, 'slots', bet, 'jackpot', gain + pool);
      return autoDelete(await message.reply(`**[ ${reels.join(' ')} ]**\n💎 JACKPOT! +${gain + pool} coins!`));
    }
    await updateUser(userId, { balance: newBal });
    await addToJackpot(bet);
    await recordBet(userId, 'slots', bet, reels.join('|'), gain);
    return autoDelete(await message.reply(`**[ ${reels.join(' ')} ]**\n${sr.msg}\n${gain >= 0 ? '+' : ''}${gain} coins.`));
  }

  if (cmd === 'roulette') {
    const bet = parseInt(args[0]);
    const choice = args[1]?.toLowerCase();
    if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet.'));
    if (!['red','black','green'].includes(choice)) return autoDelete(await message.reply('Choose red/black/green.'));
    const roll = Math.floor(Math.random() * 38);
    const result = roll === 0 ? 'green' : roll % 2 === 0 ? 'red' : 'black';
    const mult = result === 'green' ? 14 : 2;
    const won = result === choice;
    const change = won ? bet * (mult - 1) : -bet;
    await updateUser(userId, { balance: Math.max(0, userData.balance + change) });
    await addToJackpot(bet);
    await recordBet(userId, 'roulette', bet, result, change);
    return autoDelete(await message.reply(`🎡 **${result.toUpperCase()} (${roll})** — ${won ? `Won +${bet*(mult-1)}` : `Lost -${bet}`} coins.`));
  }

  if (cmd === 'blackjack') {
    const bet = parseInt(args[0]);
    if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet.'));
    const ph = [drawCard(), drawCard()], dh = [drawCard(), drawCard()];
    bjGames.set(userId, { bet, playerHand: ph, dealerHand: dh });
    const embed = new EmbedBuilder().setColor(0x1A1A2E).setTitle('🃏 Blackjack')
      .addFields(
        { name: 'Your Hand', value: `${ph.join(' ')} (${handTotal(ph)})` },
        { name: 'Dealer', value: `${dh[0]} [hidden]` }
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary)
    );
    await addToJackpot(bet);
    return autoDelete(await message.reply({ embeds: [embed], components: [row] }), 60);
  }

  if (cmd === 'allin') {
    const bet = userData.balance;
    if (bet <= 0) return autoDelete(await message.reply('You have no coins!'));
    const won = Math.random() > 0.5;
    const change = won ? bet : -bet;
    await updateUser(userId, { balance: Math.max(0, userData.balance + change) });
    await addToJackpot(bet);
    await recordBet(userId, 'allin', bet, won ? 'won' : 'lost', change);
    return autoDelete(await message.reply(`💰 ALL IN — **${won ? `WON! +${bet}` : `LOST! -${bet}`} coins!**`));
  }

  if (cmd === 'spin') {
    const bet = parseInt(args[0]);
    if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet.'));
    const mult = [0,0,0.5,1,1.5,2,3,5][Math.floor(Math.random()*8)];
    const change = Math.floor(bet*mult) - bet;
    await updateUser(userId, { balance: Math.max(0, userData.balance + change) });
    await addToJackpot(bet);
    await recordBet(userId, 'spin', bet, `${mult}x`, change);
    return autoDelete(await message.reply(`🎡 **${mult}x** — ${change >= 0 ? '+' : ''}${change} coins.`));
  }

  if (cmd === 'jackpot') {
    const pool = await getJackpot();
    const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('💎 Jackpot Pool')
      .setDescription(`**${pool.toLocaleString()} coins** in the pool.\n5% of every bet feeds it.`);
    return autoDelete(await message.reply({ embeds: [embed] }));
  }

  if (cmd === 'rankcard') {
    const embed = new EmbedBuilder().setColor(rankObj.color).setTitle(`${message.author.username} — Rank Card`)
      .setThumbnail(message.author.displayAvatarURL())
      .addFields(
        { name: 'Rank', value: rankObj.name, inline: true },
        { name: 'ELO', value: String(userData.elo), inline: true },
        { name: 'Peak ELO', value: String(userData.peakElo || userData.elo), inline: true },
        { name: 'Streak', value: String(userData.streak || 0), inline: true },
        { name: 'Level', value: String(userData.level), inline: true },
        { name: 'XP', value: `${userData.xp}/${userData.level*100}`, inline: true },
        { name: 'Clips', value: String(userData.submissions), inline: true },
        { name: 'Premium', value: userData.premium ? '✅' : '❌', inline: true },
        { name: 'Balance', value: `${userData.balance.toLocaleString()} 🪙`, inline: true }
      );
    return autoDelete(await message.reply({ embeds: [embed] }), 30);
  }

  if (cmd === 'submit') return autoDelete(await message.reply('Use `/submit` to open the form!'));

  if (cmd === 'quality') {
    const limit = userData.premium ? Infinity : 1;
    if ((userData.qualityUses || 0) >= limit)
      return autoDelete(await message.reply('⛔ Free limit reached. Boost for unlimited.'));
    const url = args[0];
    if (!url) return autoDelete(await message.reply('Usage: `!quality <url>`'));
    await updateUser(userId, { qualityUses: (userData.qualityUses || 0) + 1 });
    autoDelete(await message.reply('⚙️ Processing... check DMs.'));
    try {
      const outFile = await processVideo(url);
      const stats = fsSync.statSync(outFile);
      if (stats.size > 25 * 1024 * 1024) {
        await message.author.send('Video too large for Discord.').catch(() => {});
      } else {
        await message.author.send({ content: '✅ Your upscaled video!', files: [outFile] }).catch(() => {});
      }
      await fs.unlink(outFile).catch(() => {});
    } catch (err) {
      await message.author.send(`❌ Failed: ${err.message}`).catch(() => {});
    }
    return;
  }

  if (cmd === 'code') {
    if (!CONFIG.ownerIds.includes(userId)) return autoDelete(await message.reply('👑 Owner only.'));
    const code = 'PREM-' + Math.random().toString(36).slice(2,10).toUpperCase();
    await db.collection('codes').insertOne({ code, used: false, createdAt: new Date() });
    await message.author.send(`🔑 New Code: \`${code}\``).catch(() => {});
    return autoDelete(await message.reply('Code sent to DMs.'));
  }

  // MODERATION
  if (['kick','ban','mute','unmute','warn','clear','lock','unlock','slowmode'].includes(cmd)) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return autoDelete(await message.reply('❌ No permission.'));
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(' ') || 'No reason';

    if (cmd === 'kick') {
      if (!target) return autoDelete(await message.reply('Mention a user.'));
      await target.kick(reason);
      await modLog(message.guild, 'KICK', message.author, target, reason);
      return autoDelete(await message.reply(`👢 Kicked **${target.user.tag}**`));
    }
    if (cmd === 'ban') {
      if (!target) return autoDelete(await message.reply('Mention a user.'));
      await target.ban({ reason });
      await modLog(message.guild, 'BAN', message.author, target, reason);
      return autoDelete(await message.reply(`🔨 Banned **${target.user.tag}**`));
    }
    if (cmd === 'mute') {
      if (!target) return autoDelete(await message.reply('Mention a user.'));
      await target.timeout(600000, reason);
      await modLog(message.guild, 'MUTE', message.author, target, reason);
      return autoDelete(await message.reply(`🔇 Muted **${target.user.tag}** for 10min`));
    }
    if (cmd === 'unmute') {
      if (!target) return autoDelete(await message.reply('Mention a user.'));
      await target.timeout(null);
      await modLog(message.guild, 'UNMUTE', message.author, target);
      return autoDelete(await message.reply(`🔊 Unmuted **${target.user.tag}**`));
    }
    if (cmd === 'warn') {
      if (!target) return autoDelete(await message.reply('Mention a user.'));
      const td = await getUser(target.id);
      const warns = [...(td.warns || []), { reason, by: userId, date: new Date() }];
      await updateUser(target.id, { warns });
      await modLog(message.guild, 'WARN', message.author, target, reason);
      return autoDelete(await message.reply(`⚠️ Warned **${target.user.tag}** (${warns.length} total)`));
    }
    if (cmd === 'clear') {
      const amount = Math.min(parseInt(args[0]) || 10, 100);
      const deleted = await message.channel.bulkDelete(amount, true);
      await modLog(message.guild, `CLEAR ${deleted.size}`, message.author, { tag: `#${message.channel.name}`, id: message.channel.id });
      return autoDelete(await message.reply(`🧹 Deleted **${deleted.size}** messages.`));
    }
    if (cmd === 'lock') {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      await modLog(message.guild, 'LOCK', message.author, { tag: `#${message.channel.name}`, id: message.channel.id });
      return autoDelete(await message.reply('🔒 Channel locked.'));
    }
    if (cmd === 'unlock') {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
      await modLog(message.guild, 'UNLOCK', message.author, { tag: `#${message.channel.name}`, id: message.channel.id });
      return autoDelete(await message.reply('🔓 Channel unlocked.'));
    }
    if (cmd === 'slowmode') {
      const secs = Math.min(parseInt(args[0]) || 5, 21600);
      await message.channel.setRateLimitPerUser(secs);
      await modLog(message.guild, `SLOWMODE ${secs}s`, message.author, { tag: `#${message.channel.name}`, id: message.channel.id });
      return autoDelete(await message.reply(`⏱️ Slowmode: **${secs}s**.`));
    }
  }
};
