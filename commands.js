'use strict';
// =============================================================
// COMMANDS v5 — ULTRA EDITION (100x POWER)
// All prefix commands with full validation + daily streaks
// =============================================================

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const fsSync = require('fs');
const fs     = require('fs').promises;
const crypto = require('crypto');
const {
  CONFIG, db,
  getUser, updateUser, addBalance, getRankFromElo,
  addToJackpot, getJackpot, resetJackpot,
  snipeCache, bjGames, spinSlots, slotsResult,
  drawCard, handTotal, recordBet,
  processVideo, autoDelete, HELP, ALL_COMMANDS,
  modLog, log, trackEvent, RANKS,
} = require('./main');

// =============================================================
// HELPERS
// =============================================================

/**
 * Parse and validate a bet amount from a string argument.
 * Returns { bet, error } — error is null when valid.
 */
function parseBet(arg, userBalance, min = CONFIG.minBet, max = CONFIG.maxBet) {
  if (!arg) return { bet: 0, error: `Specify a bet amount. Min: **${min}**, Max: **${max}**` };
  const raw = arg.toLowerCase().trim();
  let amount;
  if (raw === 'all' || raw === 'max') {
    amount = Math.min(userBalance, max);
  } else if (raw === 'half') {
    amount = Math.floor(userBalance / 2);
  } else {
    amount = parseInt(raw);
  }
  if (isNaN(amount) || amount <= 0)
    return { bet: 0, error: 'Bet must be a positive number (or `all` / `half`).' };
  if (amount < min)
    return { bet: 0, error: `Minimum bet is **${min} coins**.` };
  if (amount > max)
    return { bet: 0, error: `Maximum bet is **${max.toLocaleString()} coins**.` };
  if (amount > userBalance)
    return { bet: 0, error: `You only have **${userBalance.toLocaleString()} coins**.` };
  return { bet: amount, error: null };
}

/**
 * Build a coloured result embed for gambling commands.
 */
function buildResultEmbed(title, color, lines) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(Array.isArray(lines) ? lines.join('\n') : lines)
    .setTimestamp();
}

// XP needed for next level (exponential)
function xpNeeded(level) {
  return Math.floor(100 * Math.pow(1.15, level));
}

// =============================================================
// MAIN HANDLER
// =============================================================
module.exports = async function handleCommand(message, cmd, args) {
  const userId   = message.author.id;
  const userData = await getUser(userId);
  const rankObj  = getRankFromElo(userData.elo);

  // Bot-banned check (done here so all commands respect it)
  if (userData.botBanned && !CONFIG.ownerIds.includes(userId)) {
    return autoDelete(
      await message.reply('You are banned from using this bot.'),
      5
    );
  }

  // ─────────────────────────────────────────────
  // HELP
  // ─────────────────────────────────────────────
  if (cmd === 'help') {
    const target = args[0]?.toLowerCase();
    if (target && HELP[target]) {
      const h     = HELP[target];
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`!${target}`)
        .setDescription(h.desc)
        .addFields({ name: 'Usage', value: `\`${h.usage}\`` })
        .setFooter({ text: `GOD MODE BOT v5` });
      return autoDelete(await message.reply({ embeds: [embed] }), 30);
    }

    if (target && !HELP[target]) {
      return autoDelete(
        await message.reply(`No help entry for \`${target}\`. Try \`!help\` for a full list.`),
        10
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('GOD MODE BOT v5 — Command Reference')
      .setDescription('Use `!help <command>` for detailed info on any command.')
      .addFields(
        {
          name:   'Economy',
          value:  '`!balance` `!daily` `!history` `!stats` `!leaderboard`',
          inline: false,
        },
        {
          name:  'Gambling',
          value: '`!coinflip` `!slots` `!roulette` `!blackjack` `!dice` `!spin` `!allin` `!jackpot`',
          inline: false,
        },
        {
          name:   'Rank & Clips',
          value:  '`!rankcard` `!submit` `!quality`',
          inline: false,
        },
        {
          name:   'Utility',
          value:  '`!snipe` `!giveaway`',
          inline: false,
        },
        {
          name:   'Moderation',
          value:  '`!kick` `!ban` `!mute` `!unmute` `!warn` `!clear` `!lock` `!unlock` `!slowmode`',
          inline: false,
        },
        {
          name:   'Owner Only',
          value:  '`!code`',
          inline: false,
        },
        {
          name:   'Slash Commands',
          value:  '`/submit` `/rankcard` `/leaderboard` `/daily` `/stats` `/help`',
          inline: false,
        },
      )
      .setFooter({ text: `${ALL_COMMANDS.length} total commands  •  ${CONFIG.disabledCommands.size} disabled` })
      .setTimestamp();

    return autoDelete(await message.reply({ embeds: [embed] }), 45);
  }

  // ─────────────────────────────────────────────
  // BALANCE
  // ─────────────────────────────────────────────
  if (cmd === 'balance') {
    // Support !balance @user for others
    const targetUser = message.mentions.users.first() || message.author;
    const data       = targetUser.id === userId ? userData : await getUser(targetUser.id);

    const embed = new EmbedBuilder()
      .setColor(0x00FF7F)
      .setTitle('Wallet')
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: 'Balance',  value: `**${data.balance.toLocaleString()} coins**`, inline: true },
        { name: 'Level',    value: `**${data.level}**`,                          inline: true },
        { name: 'Rank',     value: `**${getRankFromElo(data.elo).name}**`,        inline: true },
      )
      .setFooter({ text: targetUser.username })
      .setTimestamp();

    return autoDelete(await message.reply({ embeds: [embed] }), 20);
  }

  // ─────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────
  if (cmd === 'stats') {
    const wagered  = userData.totalWagered || 0;
    const won      = userData.totalWon     || 0;
    const lost     = userData.totalLost    || 0;
    const winRate  = wagered > 0 ? ((won / wagered) * 100).toFixed(1) : '0.0';
    const netProfit = won - lost;

    const embed = new EmbedBuilder()
      .setColor(0x7289DA)
      .setTitle(`Stats — ${message.author.username}`)
      .setThumbnail(message.author.displayAvatarURL())
      .addFields(
        { name: 'Total Wagered',  value: wagered.toLocaleString(),           inline: true },
        { name: 'Total Won',      value: won.toLocaleString(),               inline: true },
        { name: 'Total Lost',     value: lost.toLocaleString(),              inline: true },
        { name: 'Win Rate',       value: `${winRate}%`,                      inline: true },
        { name: 'Net P/L',        value: `${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()}`, inline: true },
        { name: 'Daily Streak',   value: `${userData.dailyStreak || 0} days`, inline: true },
        { name: 'Submissions',    value: String(userData.submissions || 0),  inline: true },
        { name: 'Level',          value: String(userData.level),             inline: true },
        { name: 'Rank',           value: rankObj.name,                       inline: true },
        { name: 'Wins / Losses',  value: `${userData.wins || 0} / ${userData.losses || 0}`, inline: true },
        { name: 'Premium',        value: userData.premium ? 'Active' : 'No', inline: true },
        { name: 'Joined',         value: userData.joinedAt
          ? `<t:${Math.floor(new Date(userData.joinedAt).getTime() / 1000)}:R>`
          : 'Unknown',
          inline: true,
        },
      )
      .setTimestamp();

    return autoDelete(await message.reply({ embeds: [embed] }), 30);
  }

  // ─────────────────────────────────────────────
  // DAILY — with streak system
  // ─────────────────────────────────────────────
  if (cmd === 'daily') {
    const last    = userData.dailyLast ? new Date(userData.dailyLast).getTime() : 0;
    const elapsed = Date.now() - last;
    const cd      = 86_400_000; // 24h

    if (elapsed < cd) {
      const rem = cd - elapsed;
      const h   = Math.floor(rem / 3_600_000);
      const m   = Math.floor((rem % 3_600_000) / 60_000);
      const s   = Math.floor((rem % 60_000) / 1000);
      return autoDelete(
        await message.reply(`Daily resets in **${h}h ${m}m ${s}s**.`),
        10
      );
    }

    // Determine streak: if last claim was within 48h, streak continues
    const isStreak   = elapsed < 48 * 3_600_000 && last > 0;
    const newStreak  = isStreak ? (userData.dailyStreak || 0) + 1 : 1;
    const streakBonus = Math.min(newStreak - 1, 30) * (CONFIG.dailyStreakBonus || 100);
    const baseReward = userData.premium ? (CONFIG.dailyAmount || 500) * 2 : (CONFIG.dailyAmount || 500);
    const reward     = baseReward + streakBonus;

    await updateUser(userId, {
      balance:     userData.balance + reward,
      dailyLast:   new Date(),
      dailyStreak: newStreak,
    });
    await trackEvent('daily_claim', { userId, reward, streak: newStreak });

    const lines = [
      `**+${reward.toLocaleString()} coins** claimed!`,
      `Base: **${baseReward}** ${userData.premium ? '(2x Premium bonus)' : ''}`,
      streakBonus > 0 ? `Streak Bonus: **+${streakBonus}** (Day ${newStreak})` : `Day **${newStreak}** streak started!`,
      `New Balance: **${(userData.balance + reward).toLocaleString()} coins**`,
    ].filter(Boolean);

    const embed = buildResultEmbed('Daily Reward', 0x00FF7F, lines);
    if (newStreak >= 7)  embed.setFooter({ text: `${newStreak}-day streak! Keep it up!` });
    if (newStreak >= 30) embed.setFooter({ text: `30+ day streak! Legendary dedication!` });

    return autoDelete(await message.reply({ embeds: [embed] }), 20);
  }

  // ─────────────────────────────────────────────
  // HISTORY
  // ─────────────────────────────────────────────
  if (cmd === 'history') {
    const history = userData.betHistory || [];
    if (!history.length)
      return autoDelete(await message.reply('No bet history yet. Start gambling!'), 10);

    const lines = [...history].reverse().slice(0, 20).map((b, i) => {
      const sign   = b.change >= 0 ? '+' : '';
      const color  = b.change >= 0 ? '(W)' : '(L)';
      return `\`${String(i + 1).padStart(2, '0')}\` **!${b.cmd}** — bet **${b.bet}** → ${sign}${b.change} ${color}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x7289DA)
      .setTitle(`Bet History — ${message.author.username}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Last ${Math.min(history.length, 20)} of ${history.length} bets` })
      .setTimestamp();

    return autoDelete(await message.reply({ embeds: [embed] }), 30);
  }

  // ─────────────────────────────────────────────
  // LEADERBOARD
  // ─────────────────────────────────────────────
  if (cmd === 'leaderboard') {
    const validSorts = { balance: 'balance', elo: 'elo', level: 'level' };
    const sortKey    = validSorts[args[0]?.toLowerCase()] || 'elo';

    const top = await db.collection('users')
      .find({ [sortKey]: { $gt: 0 } })
      .sort({ [sortKey]: -1 })
      .limit(10)
      .toArray();

    if (!top.length)
      return autoDelete(await message.reply('No data yet!'), 10);

    const medals = ['1.', '2.', '3.'];
    const lines  = top.map((u, i) => {
      const prefix = medals[i] || `${i + 1}.`;
      const val    = sortKey === 'balance'
        ? `${u.balance.toLocaleString()} coins`
        : sortKey === 'elo'
        ? `${u.elo} ELO (${u.rank})`
        : `Level ${u.level}`;
      return `**${prefix}** <@${u.userId}> — ${val}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle(`Leaderboard — Top ${top.length} by ${sortKey.toUpperCase()}`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Use !leaderboard balance | elo | level` })
      .setTimestamp();

    return autoDelete(await message.reply({ embeds: [embed] }), 45);
  }

  // ─────────────────────────────────────────────
  // SNIPE
  // ─────────────────────────────────────────────
  if (cmd === 'snipe') {
    const snipe = snipeCache.get(message.channelId);
    if (!snipe)
      return autoDelete(await message.reply('Nothing to snipe in this channel.'), 5);

    const age   = Math.floor((Date.now() - new Date(snipe.at).getTime()) / 1000);
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('Sniped Message')
      .setDescription(snipe.content.slice(0, 4096))
      .setThumbnail(snipe.avatarURL)
      .setFooter({ text: `${snipe.author} — ${age}s ago` })
      .setTimestamp(new Date(snipe.at));

    return autoDelete(await message.reply({ embeds: [embed] }), 25);
  }

  // ─────────────────────────────────────────────
  // COINFLIP
  // ─────────────────────────────────────────────
  if (cmd === 'coinflip') {
    const { bet, error } = parseBet(args[0], userData.balance);
    if (error) return autoDelete(await message.reply(`Usage: \`!coinflip <amount> <heads|tails>\` — ${error}`), 10);

    const side = args[1]?.toLowerCase();
    if (!['heads', 'tails'].includes(side))
      return autoDelete(await message.reply('Choose `heads` or `tails`. Usage: `!coinflip 100 heads`'), 10);

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won    = result === side;
    const change = won ? bet : -bet;
    const newBal = userData.balance + change;

    await updateUser(userId, {
      balance: Math.max(0, newBal),
      wins:    userData.wins + (won ? 1 : 0),
      losses:  userData.losses + (won ? 0 : 1),
    });
    await addToJackpot(bet);
    await recordBet(userId, 'coinflip', bet, result, change);

    const embed = buildResultEmbed(
      won ? 'Coin Flip — WIN!' : 'Coin Flip — LOSS',
      won ? 0x00FF7F : 0xFF4444,
      [
        `Flipped: **${result.toUpperCase()}** | Your call: **${side.toUpperCase()}**`,
        won ? `Won **+${bet.toLocaleString()} coins**!` : `Lost **-${bet.toLocaleString()} coins**.`,
        `Balance: **${Math.max(0, newBal).toLocaleString()} coins**`,
      ]
    );

    return autoDelete(await message.reply({ embeds: [embed] }));
  }

  // ─────────────────────────────────────────────
  // BET / DICE
  // ─────────────────────────────────────────────
  if (cmd === 'bet' || cmd === 'dice') {
    const { bet, error } = parseBet(args[0], userData.balance);
    if (error) return autoDelete(await message.reply(`Usage: \`!${cmd} <amount>\` — ${error}`), 10);

    const roll   = Math.floor(Math.random() * 6) + 1;
    const won    = roll >= 4;
    const change = won ? bet : -bet;
    const newBal = Math.max(0, userData.balance + change);

    await updateUser(userId, {
      balance: newBal,
      wins:    userData.wins + (won ? 1 : 0),
      losses:  userData.losses + (won ? 0 : 1),
    });
    await addToJackpot(bet);
    await recordBet(userId, cmd, bet, `rolled ${roll}`, change);

    const DICE_FACES = { 1: '[1]', 2: '[2]', 3: '[3]', 4: '[4]', 5: '[5]', 6: '[6]' };
    const embed = buildResultEmbed(
      won ? 'Dice Roll — WIN!' : 'Dice Roll — LOSS',
      won ? 0x00FF7F : 0xFF4444,
      [
        `Rolled **${DICE_FACES[roll]}** — need 4+ to win`,
        won ? `Won **+${bet.toLocaleString()} coins**!` : `Lost **-${bet.toLocaleString()} coins**.`,
        `Balance: **${newBal.toLocaleString()} coins**`,
      ]
    );

    return autoDelete(await message.reply({ embeds: [embed] }));
  }

  // ─────────────────────────────────────────────
  // SLOTS
  // ─────────────────────────────────────────────
  if (cmd === 'slots') {
    const { bet, error } = parseBet(args[0], userData.balance);
    if (error) return autoDelete(await message.reply(`Usage: \`!slots <amount>\` — ${error}`), 10);

    const reels  = spinSlots();
    const sr     = slotsResult(reels);
    const gain   = Math.floor(bet * sr.mult) - bet;
    const isJackpot = sr.mult === 10; // triple diamonds

    let newBal = Math.max(0, userData.balance + gain);

    if (isJackpot) {
      const pool = await getJackpot();
      newBal += pool;
      await resetJackpot();
      await updateUser(userId, { balance: newBal, wins: userData.wins + 1 });
      await recordBet(userId, 'slots', bet, 'jackpot', gain + pool);

      const embed = buildResultEmbed(
        'SLOTS — JACKPOT!',
        0xFFD700,
        [
          `[ ${reels.join('  ')} ]`,
          `**TRIPLE DIAMONDS — JACKPOT!**`,
          `Slot win: **+${gain.toLocaleString()}** | Jackpot: **+${pool.toLocaleString()}**`,
          `Total: **+${(gain + pool).toLocaleString()} coins**`,
          `Balance: **${newBal.toLocaleString()} coins**`,
        ]
      );
      return autoDelete(await message.reply({ embeds: [embed] }), 60);
    }

    await updateUser(userId, {
      balance: newBal,
      wins:    userData.wins + (gain >= 0 ? 1 : 0),
      losses:  userData.losses + (gain < 0 ? 1 : 0),
    });
    await addToJackpot(bet);
    await recordBet(userId, 'slots', bet, reels.join('|'), gain);

    const embed = buildResultEmbed(
      gain >= 0 ? 'Slots — WIN!' : 'Slots — LOSS',
      gain >= 0 ? 0x00FF7F : 0xFF4444,
      [
        `[ ${reels.join('  ')} ]`,
        `**${sr.msg}** (${sr.mult}x)`,
        gain >= 0
          ? `Won **+${gain.toLocaleString()} coins**!`
          : `Lost **-${Math.abs(gain).toLocaleString()} coins**.`,
        `Balance: **${newBal.toLocaleString()} coins**`,
      ]
    );

    return autoDelete(await message.reply({ embeds: [embed] }));
  }

  // ─────────────────────────────────────────────
  // ROULETTE
  // ─────────────────────────────────────────────
  if (cmd === 'roulette') {
    const { bet, error } = parseBet(args[0], userData.balance);
    if (error) return autoDelete(await message.reply(`Usage: \`!roulette <amount> <red|black|green>\` — ${error}`), 10);

    const choice = args[1]?.toLowerCase();
    if (!['red', 'black', 'green'].includes(choice))
      return autoDelete(await message.reply('Choose `red`, `black`, or `green`. Green pays 14x!'), 10);

    // Standard roulette: 0 = green, even = red, odd = black
    const roll   = Math.floor(Math.random() * 38);  // 0–37 (0 and 00)
    const result = roll <= 1 ? 'green' : roll % 2 === 0 ? 'red' : 'black';
    const MULT   = { green: 14, red: 2, black: 2 };
    const won    = result === choice;
    const change = won ? bet * (MULT[result] - 1) : -bet;
    const newBal = Math.max(0, userData.balance + change);

    await updateUser(userId, {
      balance: newBal,
      wins:    userData.wins + (won ? 1 : 0),
      losses:  userData.losses + (won ? 0 : 1),
    });
    await addToJackpot(bet);
    await recordBet(userId, 'roulette', bet, result, change);

    const COLORS = { red: 0xFF4444, black: 0x2C2F33, green: 0x00FF7F };
    const embed  = buildResultEmbed(
      won ? 'Roulette — WIN!' : 'Roulette — LOSS',
      COLORS[result],
      [
        `Ball landed on **${result.toUpperCase()}** (slot ${roll}) | You bet: **${choice.toUpperCase()}**`,
        won
          ? `Won **+${Math.abs(change).toLocaleString()} coins**! (${MULT[result]}x)`
          : `Lost **-${bet.toLocaleString()} coins**.`,
        `Balance: **${newBal.toLocaleString()} coins**`,
      ]
    );

    return autoDelete(await message.reply({ embeds: [embed] }));
  }

  // ─────────────────────────────────────────────
  // BLACKJACK
  // ─────────────────────────────────────────────
  if (cmd === 'blackjack') {
    // Prevent double games
    if (bjGames.has(userId))
      return autoDelete(
        await message.reply('You already have an active blackjack game! Finish it first.'),
        10
      );

    const { bet, error } = parseBet(args[0], userData.balance);
    if (error) return autoDelete(await message.reply(`Usage: \`!blackjack <amount>\` — ${error}`), 10);

    const ph = [drawCard(), drawCard()];
    const dh = [drawCard(), drawCard()];
    const pt = handTotal(ph);

    bjGames.set(userId, { bet, playerHand: ph, dealerHand: dh, messageId: null });

    // Auto-win on natural blackjack (21 on first deal)
    if (pt === 21) {
      const winAmt = Math.floor(bet * 1.5);
      await updateUser(userId, {
        balance: userData.balance + winAmt,
        wins:    userData.wins + 1,
      });
      await recordBet(userId, 'blackjack', bet, 'natural blackjack', winAmt);
      bjGames.delete(userId);

      return autoDelete(await message.reply({
        embeds: [buildResultEmbed('Blackjack — NATURAL!', 0xFFD700, [
          `Your Hand: **${ph.join(' ')}** (21)`,
          `**BLACKJACK! Natural 21!**`,
          `Won **+${winAmt.toLocaleString()} coins**!`,
          `Balance: **${(userData.balance + winAmt).toLocaleString()} coins**`,
        ])],
      }), 30);
    }

    const embed = new EmbedBuilder()
      .setColor(0x1A1A2E)
      .setTitle('Blackjack — Your Turn')
      .addFields(
        { name: 'Your Hand',   value: `${ph.join(' ')} **(${pt})**`,      inline: true },
        { name: 'Dealer',      value: `${dh[0]} **[hidden]**`,           inline: true },
        { name: 'Bet',         value: `${bet.toLocaleString()} coins`,   inline: true },
      )
      .setFooter({ text: 'Hit to draw, Stand to hold, Double to double-down (if eligible)' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj_hit_${userId}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj_stand_${userId}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`bj_double_${userId}`)
        .setLabel(`Double (${(bet * 2).toLocaleString()})`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(userData.balance < bet * 2),
    );

    await addToJackpot(bet);
    const sent = await message.reply({ embeds: [embed], components: [row] });
    // Store message ID so interaction handler can validate ownership
    const game = bjGames.get(userId);
    if (game) { game.messageId = sent.id; bjGames.set(userId, game); }
    autoDelete(sent, 90);
    return;
  }

  // ─────────────────────────────────────────────
  // ALL-IN
  // ─────────────────────────────────────────────
  if (cmd === 'allin') {
    if (userData.balance <= 0)
      return autoDelete(await message.reply('You have no coins to go all-in with!'), 10);

    const bet  = userData.balance;
    const roll = Math.floor(Math.random() * 6) + 1; // 1-6, win on 3+ (50/50 with dice theatre)
    const won  = Math.random() > 0.5;
    const change = won ? bet : -bet;
    const newBal = Math.max(0, userData.balance + change);

    await updateUser(userId, {
      balance: newBal,
      wins:    userData.wins + (won ? 1 : 0),
      losses:  userData.losses + (won ? 0 : 1),
    });
    await addToJackpot(Math.floor(bet * 0.02)); // smaller jackpot cut since no fixed bet
    await recordBet(userId, 'allin', bet, won ? 'won' : 'lost', change);

    const embed = buildResultEmbed(
      won ? 'ALL IN — YOU WIN!' : 'ALL IN — WIPED OUT!',
      won ? 0xFFD700 : 0xFF0000,
      [
        `You went all-in with **${bet.toLocaleString()} coins**`,
        won
          ? `**DOUBLED UP! +${bet.toLocaleString()} coins!**`
          : `**BUST! Lost everything!**`,
        `Balance: **${newBal.toLocaleString()} coins**`,
        !won ? `Use \`!daily\` to claim your daily reward and get back on your feet.` : '',
      ].filter(Boolean)
    );

    return autoDelete(await message.reply({ embeds: [embed] }), 20);
  }

  // ─────────────────────────────────────────
