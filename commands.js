'use strict';
// =============================================================
// COMMANDS v8 — INFINITY EDITION
// All prefix commands with registry middleware, full validation,
// gambling engine, daily streaks, cinematic video, moderation suite
// =============================================================

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, Colors
} = require('discord.js');

const {
    CONFIG, getUser, updateUser, addBalance, getRankFromElo,
    addToJackpot, getJackpot, resetJackpot,
    snipeCache, bjGames, spinSlots, slotsResult,
    drawCard, handTotal, recordBet, ObjectId,
    processVideo, autoDelete, HELP, ALL_COMMANDS,
    modLog, log, trackEvent, RANKS, SecurityManager,
} = require('./main');

function xpNeeded(level) { return Math.floor(100 * Math.pow(1.15, level)); }

function parseBet(arg, balance) {
    if (!arg) return { bet: 0, error: `Specify a bet amount. Min: **${CONFIG.minBet}**, Max: **${CONFIG.maxBet.toLocaleString()}**` };
    const raw = arg.toLowerCase().trim();
    let amount;
    if (raw === 'all' || raw === 'max') amount = Math.min(balance, CONFIG.maxBet);
    else if (raw === 'half') amount = Math.floor(balance / 2);
    else amount = parseInt(raw);
    if (isNaN(amount) || amount <= 0) return { bet: 0, error: 'Bet must be a positive number (or `all` / `half`).' };
    if (amount < CONFIG.minBet) return { bet: 0, error: `Minimum bet is **${CONFIG.minBet} coins**.` };
    if (amount > CONFIG.maxBet) return { bet: 0, error: `Maximum bet is **${CONFIG.maxBet.toLocaleString()} coins**.` };
    if (amount > balance) return { bet: 0, error: `You only have **${balance.toLocaleString()} coins**.` };
    return { bet: amount, error: null };
}

function buildResultEmbed(title, color, lines) {
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(Array.isArray(lines) ? lines.join('\n') : lines).setTimestamp();
}

module.exports = function defineCommands(registry) {
    // HELP
    registry.register({
        name: 'help', aliases: ['h', 'commands'],
        desc: 'Show all commands and usage',
        usage: '!help [command]',
        execute: async (ctx) => {
            const target = ctx.args[0]?.toLowerCase();
            if (target && HELP[target]) {
                const h = HELP[target];
                const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`!${target}`).setDescription(h.desc)
                    .addFields({ name: 'Usage', value: `\`${h.usage}\`` }).setFooter({ text: 'GOD MODE BOT v8' });
                return autoDelete(await ctx.message.reply({ embeds: [embed] }), 30);
            }
            if (target && !HELP[target]) return autoDelete(await ctx.message.reply(`No help entry for \`${target}\`.`), 10);
            const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('GOD MODE BOT v8 — Commands')
                .setDescription('Use `!help <command>` for details.')
                .addFields(
                    { name: 'Economy', value: '`!balance` `!daily` `!history` `!stats` `!leaderboard` `!pay`' },
                    { name: 'Gambling', value: '`!coinflip` `!slots` `!roulette` `!blackjack` `!dice` `!allin` `!jackpot`' },
                    { name: 'Rank & Clips', value: '`!rankcard` `!submit` `!quality` `!leaderboard`' },
                    { name: 'Utility', value: '`!snipe` `!whois` `!serverinfo`' },
                    { name: 'Moderation', value: '`!kick` `!ban` `!softban` `!tempban` `!mute` `!unmute` `!warn` `!warns` `!clear` `!lock` `!unlock` `!slowmode` `!announce`' },
                    { name: 'Owner', value: '`!code`' },
                    { name: 'Slash', value: '`/submit` `/profile` `/leaderboard` `/review` `/ticket_setup` `/verify_panel` `/giveaway` `/suggestion` `/lockdown_all` `/unlockdown_all`' }
                ).setFooter({ text: `${ALL_COMMANDS.length} commands | Prefix: !` });
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 45);
        }
    });

    // BALANCE
    registry.register({
        name: 'balance', aliases: ['bal', 'coins'],
        desc: 'Check your coin balance',
        usage: '!balance [@user]',
        execute: async (ctx) => {
            const targetUser = ctx.message.mentions.users.first() || ctx.message.author;
            const data = targetUser.id === ctx.message.author.id ? await getUser(targetUser.id) : await getUser(targetUser.id);
            const embed = new EmbedBuilder().setColor(0x00FF7F).setTitle('Wallet').setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: 'Balance', value: `**${data.balance.toLocaleString()} coins**`, inline: true },
                    { name: 'Level', value: `**${data.level}**`, inline: true },
                    { name: 'Rank', value: `**${getRankFromElo(data.elo).name}**`, inline: true }
                ).setFooter({ text: targetUser.username });
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 20);
        }
    });

    // STATS
    registry.register({
        name: 'stats', aliases: ['statistics'],
        desc: 'View your gambling and account statistics',
        usage: '!stats',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const wagered = u.totalWagered || 0, won = u.totalWon || 0, lost = u.totalLost || 0;
            const winRate = wagered > 0 ? ((won / wagered) * 100).toFixed(1) : '0.0';
            const net = won - lost;
            const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(`Stats — ${ctx.message.author.username}`)
                .setThumbnail(ctx.message.author.displayAvatarURL())
                .addFields(
                    { name: 'Total Wagered', value: wagered.toLocaleString(), inline: true },
                    { name: 'Total Won', value: won.toLocaleString(), inline: true },
                    { name: 'Total Lost', value: lost.toLocaleString(), inline: true },
                    { name: 'Win Rate', value: `${winRate}%`, inline: true },
                    { name: 'Net P/L', value: `${net >= 0 ? '+' : ''}${net.toLocaleString()}`, inline: true },
                    { name: 'Daily Streak', value: `${u.dailyStreak || 0} days`, inline: true },
                    { name: 'Submissions', value: String(u.submissions || 0), inline: true },
                    { name: 'Level', value: String(u.level), inline: true },
                    { name: 'Rank', value: getRankFromElo(u.elo).name, inline: true },
                    { name: 'Wins / Losses', value: `${u.wins || 0} / ${u.losses || 0}`, inline: true },
                    { name: 'Premium', value: u.premium ? 'Active' : 'No', inline: true },
                    { name: 'Joined', value: u.createdAt ? `<t:${Math.floor(new Date(u.createdAt).getTime() / 1000)}:R>` : 'Unknown', inline: true }
                ).setTimestamp();
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 30);
        }
    });

    // DAILY
    registry.register({
        name: 'daily', aliases: ['claim'],
        desc: 'Claim daily coins with streak bonuses',
        usage: '!daily',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const last = u.dailyLast ? new Date(u.dailyLast).getTime() : 0;
            const elapsed = Date.now() - last;
            const cd = 86400000;
            if (elapsed < cd) {
                const rem = cd - elapsed;
                const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000), s = Math.floor((rem % 60000) / 1000);
                return autoDelete(await ctx.message.reply(`Daily resets in **${h}h ${m}m ${s}s**.`), 10);
            }
            const isStreak = elapsed < 48 * 3600000 && last > 0;
            const newStreak = isStreak ? (u.dailyStreak || 0) + 1 : 1;
            const streakBonus = Math.min(newStreak - 1, 30) * CONFIG.dailyStreakBonus;
            const baseReward = u.premium ? CONFIG.dailyAmount * 2 : CONFIG.dailyAmount;
            const reward = baseReward + streakBonus;
            await updateUser(ctx.message.author.id, { balance: u.balance + reward, dailyLast: new Date(), dailyStreak: newStreak });
            await trackEvent('daily_claim', { userId: ctx.message.author.id, reward, streak: newStreak });
            const lines = [
                `**+${reward.toLocaleString()} coins** claimed!`,
                `Base: **${baseReward}** ${u.premium ? '(2x Premium bonus)' : ''}`,
                streakBonus > 0 ? `Streak Bonus: **+${streakBonus}** (Day ${newStreak})` : `Day **${newStreak}** streak started!`,
                `New Balance: **${(u.balance + reward).toLocaleString()} coins**`
            ].filter(Boolean);
            const embed = buildResultEmbed('Daily Reward', 0x00FF7F, lines);
            if (newStreak >= 7) embed.setFooter({ text: `${newStreak}-day streak! Keep it up!` });
            if (newStreak >= 30) embed.setFooter({ text: '30+ day streak! Legendary dedication!' });
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 20);
        }
    });

    // HISTORY
    registry.register({
        name: 'history', aliases: ['bets'],
        desc: 'View your recent gambling history',
        usage: '!history',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const history = u.betHistory || [];
            if (!history.length) return autoDelete(await ctx.message.reply('No bet history yet. Start gambling!'), 10);
            const lines = [...history].reverse().slice(0, 20).map((b, i) => {
                const sign = b.change >= 0 ? '+' : '';
                const color = b.change >= 0 ? '(W)' : '(L)';
                return `\`${String(i + 1).padStart(2, '0')}\` **!${b.cmd}** — bet **${b.bet}** → ${sign}${b.change} ${color}`;
            });
            const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(`Bet History — ${ctx.message.author.username}`)
                .setDescription(lines.join('\n')).setFooter({ text: `Last ${Math.min(history.length, 20)} of ${history.length} bets` });
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 30);
        }
    });

    // PAY
    registry.register({
        name: 'pay', aliases: ['transfer'],
        desc: 'Transfer coins to another user',
        usage: '!pay @user <amount>',
        execute: async (ctx) => {
            const target = ctx.message.mentions.members.first();
            const amount = parseInt(ctx.args[1]);
            if (!target || isNaN(amount) || amount <= 0) return autoDelete(await ctx.message.reply('Usage: `!pay @user <amount>`'));
            const u = await getUser(ctx.message.author.id);
            if (u.balance < amount) return autoDelete(await ctx.message.reply('Insufficient balance.'));
            await updateUser(ctx.message.author.id, { balance: u.balance - amount });
            const tu = await getUser(target.id);
            await updateUser(target.id, { balance: tu.balance + amount });
            await trackEvent('pay', { from: ctx.message.author.id, to: target.id, amount });
            return autoDelete(await ctx.message.reply(`Transferred **${amount.toLocaleString()} coins** to ${target.user.tag}.`));
        }
    });

    // LEADERBOARD
    registry.register({
        name: 'leaderboard', aliases: ['lb', 'top'],
        desc: 'Show top players by ELO, balance, or level',
        usage: '!leaderboard [elo|balance|level]',
        execute: async (ctx) => {
            const validSorts = { balance: 'balance', elo: 'elo', level: 'level' };
            const sortKey = validSorts[ctx.args[0]?.toLowerCase()] || 'elo';
            const top = await container.resolve('userService').topBy(sortKey, 10);
            if (!top.length) return autoDelete(await ctx.message.reply('No data yet!'), 10);
            const medals = ['1.', '2.', '3.'];
            const lines = top.map((u, i) => {
                const prefix = medals[i] || `${i + 1}.`;
                const val = sortKey === 'balance' ? `${u.balance.toLocaleString()} coins` : sortKey === 'elo' ? `${u.elo} ELO (${u.rank})` : `Level ${u.level}`;
                return `**${prefix}** <@${u.userId}> — ${val}`;
            });
            const embed = new EmbedBuilder().setColor(0xFFD700).setTitle(`Leaderboard — Top ${top.length} by ${sortKey.toUpperCase()}`)
                .setDescription(lines.join('\n')).setFooter({ text: 'Use !leaderboard balance | elo | level' });
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 45);
        }
    });

    // SNIPE
    registry.register({
        name: 'snipe', aliases: ['lastmsg'],
        desc: 'Recover the last deleted message',
        usage: '!snipe',
        execute: async (ctx) => {
            const snipe = snipeCache.get(ctx.message.channelId);
            if (!snipe) return autoDelete(await ctx.message.reply('Nothing to snipe in this channel.'), 5);
            const age = Math.floor((Date.now() - new Date(snipe.at).getTime()) / 1000);
            const embed = new EmbedBuilder().setColor(0xFF6B6B).setTitle('Sniped Message')
                .setDescription(snipe.content.slice(0, 4096)).setThumbnail(snipe.avatarURL)
                .setFooter({ text: `${snipe.author} — ${age}s ago` }).setTimestamp(new Date(snipe.at));
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 25);
        }
    });

    // COINFLIP
    registry.register({
        name: 'coinflip', aliases: ['cf', 'flip'],
        desc: 'Flip a coin against the bot',
        usage: '!coinflip <amount> <heads|tails>',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const { bet, error } = parseBet(ctx.args[0], u.balance);
            if (error) return autoDelete(await ctx.message.reply(`Usage: \`!coinflip <amount> <heads|tails>\` — ${error}`), 10);
            const side = ctx.args[1]?.toLowerCase();
            if (!['heads', 'tails'].includes(side)) return autoDelete(await ctx.message.reply('Choose `heads` or `tails`. Usage: `!coinflip 100 heads`'), 10);
            const result = Math.random() < 0.5 ? 'heads' : 'tails';
            const won = result === side;
            const change = won ? bet : -bet;
            const newBal = Math.max(0, u.balance + change);
            await updateUser(ctx.message.author.id, { balance: newBal, wins: u.wins + (won ? 1 : 0), losses: u.losses + (won ? 0 : 1) });
            await addToJackpot(bet);
            await recordBet(ctx.message.author.id, 'coinflip', bet, result, change);
            const embed = buildResultEmbed(won ? 'Coin Flip — WIN!' : 'Coin Flip — LOSS', won ? 0x00FF7F : 0xFF4444, [
                `Flipped: **${result.toUpperCase()}** | Your call: **${side.toUpperCase()}**`,
                won ? `Won **+${bet.toLocaleString()} coins**!` : `Lost **-${bet.toLocaleString()} coins**.`,
                `Balance: **${newBal.toLocaleString()} coins**`
            ]);
            return autoDelete(await ctx.message.reply({ embeds: [embed] }));
        }
    });

    // DICE / BET
    registry.register({
        name: 'dice', aliases: ['bet'],
        desc: 'Roll a die, win on 4+',
        usage: '!dice <amount>',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const { bet, error } = parseBet(ctx.args[0], u.balance);
            if (error) return autoDelete(await ctx.message.reply(`Usage: \`!${ctx.cmd} <amount>\` — ${error}`), 10);
            const roll = Math.floor(Math.random() * 6) + 1;
            const won = roll >= 4;
            const change = won ? bet : -bet;
            const newBal = Math.max(0, u.balance + change);
            await updateUser(ctx.message.author.id, { balance: newBal, wins: u.wins + (won ? 1 : 0), losses: u.losses + (won ? 0 : 1) });
            await addToJackpot(bet);
            await recordBet(ctx.message.author.id, 'dice', bet, `rolled ${roll}`, change);
            const embed = buildResultEmbed(won ? 'Dice Roll — WIN!' : 'Dice Roll — LOSS', won ? 0x00FF7F : 0xFF4444, [
                `Rolled **${roll}** — need 4+ to win`,
                won ? `Won **+${bet.toLocaleString()} coins**!` : `Lost **-${bet.toLocaleString()} coins**.`,
                `Balance: **${newBal.toLocaleString()} coins**`
            ]);
            return autoDelete(await ctx.message.reply({ embeds: [embed] }));
        }
    });

    // SLOTS
    registry.register({
        name: 'slots', aliases: ['slot'],
        desc: 'Spin the slot machine',
        usage: '!slots <amount>',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const { bet, error } = parseBet(ctx.args[0], u.balance);
            if (error) return autoDelete(await ctx.message.reply(`Usage: \`!slots <amount>\` — ${error}`), 10);
            const reels = spinSlots();
            const sr = slotsResult(reels);
            const gain = Math.floor(bet * sr.mult) - bet;
            const isJackpot = sr.mult === 10;
            let newBal = Math.max(0, u.balance + gain);
            if (isJackpot) {
                const pool = await getJackpot();
                newBal += pool;
                await resetJackpot();
                await updateUser(ctx.message.author.id, { balance: newBal, wins: u.wins + 1 });
                await recordBet(ctx.message.author.id, 'slots', bet, 'jackpot', gain + pool);
                const embed = buildResultEmbed('SLOTS — JACKPOT!', 0xFFD700, [
                    `[ ${reels.join('  ')} ]`, `**TRIPLE DIAMONDS — JACKPOT!**`,
                    `Slot win: **+${gain.toLocaleString()}** | Jackpot: **+${pool.toLocaleString()}**`,
                    `Total: **+${(gain + pool).toLocaleString()} coins**`, `Balance: **${newBal.toLocaleString()} coins**`
                ]);
                return autoDelete(await ctx.message.reply({ embeds: [embed] }), 60);
            }
            await updateUser(ctx.message.author.id, { balance: newBal, wins: u.wins + (gain >= 0 ? 1 : 0), losses: u.losses + (gain < 0 ? 1 : 0) });
            await addToJackpot(bet);
            await recordBet(ctx.message.author.id, 'slots', bet, reels.join('|'), gain);
            const embed = buildResultEmbed(gain >= 0 ? 'Slots — WIN!' : 'Slots — LOSS', gain >= 0 ? 0x00FF7F : 0xFF4444, [
                `[ ${reels.join('  ')} ]`, `**${sr.msg}** (${sr.mult}x)`,
                gain >= 0 ? `Won **+${gain.toLocaleString()} coins**!` : `Lost **-${Math.abs(gain).toLocaleString()} coins**.`,
                `Balance: **${newBal.toLocaleString()} coins**`
            ]);
            return autoDelete(await ctx.message.reply({ embeds: [embed] }));
        }
    });

    // ROULETTE
    registry.register({
        name: 'roulette', aliases: ['roul'],
        desc: 'Bet on red, black, or green',
        usage: '!roulette <amount> <red|black|green>',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const { bet, error } = parseBet(ctx.args[0], u.balance);
            if (error) return autoDelete(await ctx.message.reply(`Usage: \`!roulette <amount> <red|black|green>\` — ${error}`), 10);
            const choice = ctx.args[1]?.toLowerCase();
            if (!['red', 'black', 'green'].includes(choice)) return autoDelete(await ctx.message.reply('Choose `red`, `black`, or `green`. Green pays 14x!'), 10);
            const roll = Math.floor(Math.random() * 38);
            const result = roll <= 1 ? 'green' : roll % 2 === 0 ? 'red' : 'black';
            const MULT = { green: 14, red: 2, black: 2 };
            const won = result === choice;
            const change = won ? bet * (MULT[result] - 1) : -bet;
            const newBal = Math.max(0, u.balance + change);
            await updateUser(ctx.message.author.id, { balance: newBal, wins: u.wins + (won ? 1 : 0), losses: u.losses + (won ? 0 : 1) });
            await addToJackpot(bet);
            await recordBet(ctx.message.author.id, 'roulette', bet, result, change);
            const COLORS = { red: 0xFF4444, black: 0x2C2F33, green: 0x00FF7F };
            const embed = buildResultEmbed(won ? 'Roulette — WIN!' : 'Roulette — LOSS', COLORS[result], [
                `Ball landed on **${result.toUpperCase()}** (slot ${roll}) | You bet: **${choice.toUpperCase()}**`,
                won ? `Won **+${Math.abs(change).toLocaleString()} coins**! (${MULT[result]}x)` : `Lost **-${bet.toLocaleString()} coins**.`,
                `Balance: **${newBal.toLocaleString()} coins**`
            ]);
            return autoDelete(await ctx.message.reply({ embeds: [embed] }));
        }
    });

    // BLACKJACK
    registry.register({
        name: 'blackjack', aliases: ['bj'],
        desc: 'Play blackjack against the dealer',
        usage: '!blackjack <amount>',
        execute: async (ctx) => {
            const userId = ctx.message.author.id;
            if (bjGames.has(userId)) return autoDelete(await ctx.message.reply('You already have an active blackjack game!'), 10);
            const u = await getUser(userId);
            const { bet, error } = parseBet(ctx.args[0], u.balance);
            if (error) return autoDelete(await ctx.message.reply(`Usage: \`!blackjack <amount>\` — ${error}`), 10);
            const ph = [drawCard(), drawCard()];
            const dh = [drawCard(), drawCard()];
            const pt = handTotal(ph);
            bjGames.set(userId, { bet, playerHand: ph, dealerHand: dh, messageId: null });
            if (pt === 21) {
                const winAmt = Math.floor(bet * 1.5);
                await updateUser(userId, { balance: u.balance + winAmt, wins: u.wins + 1 });
                await recordBet(userId, 'blackjack', bet, 'natural blackjack', winAmt);
                bjGames.delete(userId);
                return autoDelete(await ctx.message.reply({ embeds: [buildResultEmbed('Blackjack — NATURAL!', 0xFFD700, [
                    `Your Hand: **${ph.join(' ')}** (21)`, `**BLACKJACK! Natural 21!**`,
                    `Won **+${winAmt.toLocaleString()} coins**!`, `Balance: **${(u.balance + winAmt).toLocaleString()} coins**`
                ])] }), 30);
            }
            const embed = new EmbedBuilder().setColor(0x1A1A2E).setTitle('Blackjack — Your Turn')
                .addFields(
                    { name: 'Your Hand', value: `${ph.join(' ')} **(${pt})**`, inline: true },
                    { name: 'Dealer', value: `${dh[0]} **[hidden]**`, inline: true },
                    { name: 'Bet', value: `${bet.toLocaleString()} coins`, inline: true }
                ).setFooter({ text: 'Hit to draw, Stand to hold, Double to double-down' });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bj_hit_${userId}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`bj_stand_${userId}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`bj_double_${userId}`).setLabel(`Double (${(bet * 2).toLocaleString()})`).setStyle(ButtonStyle.Danger).setDisabled(u.balance < bet * 2)
            );
            await addToJackpot(bet);
            const sent = await ctx.message.reply({ embeds: [embed], components: [row] });
            const game = bjGames.get(userId);
            if (game) { game.messageId = sent.id; bjGames.set(userId, game); }
            autoDelete(sent, 120);
        }
    });

    // ALLIN
    registry.register({
        name: 'allin', aliases: ['maxbet'],
        desc: 'Go all-in on a 50/50 chance',
        usage: '!allin',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            if (u.balance <= 0) return autoDelete(await ctx.message.reply('You have no coins to go all-in with!'), 10);
            const bet = u.balance;
            const won = Math.random() > 0.5;
            const change = won ? bet : -bet;
            const newBal = Math.max(0, u.balance + change);
            await updateUser(ctx.message.author.id, { balance: newBal, wins: u.wins + (won ? 1 : 0), losses: u.losses + (won ? 0 : 1) });
            await addToJackpot(Math.floor(bet * 0.02));
            await recordBet(ctx.message.author.id, 'allin', bet, won ? 'won' : 'lost', change);
            const embed = buildResultEmbed(won ? 'ALL IN — YOU WIN!' : 'ALL IN — WIPED OUT!', won ? 0xFFD700 : 0xFF0000, [
                `You went all-in with **${bet.toLocaleString()} coins**`,
                won ? `**DOUBLED UP! +${bet.toLocaleString()} coins!**` : `**BUST! Lost everything!**`,
                `Balance: **${newBal.toLocaleString()} coins**`,
                !won ? `Use \`!daily\` to claim your daily reward and get back on your feet.` : ''
            ].filter(Boolean));
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 20);
        }
    });

    // JACKPOT
    registry.register({
        name: 'jackpot', aliases: ['pool'],
        desc: 'View the current jackpot pool',
        usage: '!jackpot',
        execute: async (ctx) => {
            const pool = await getJackpot();
            return autoDelete(await ctx.message.reply(`🎰 Current jackpot pool: **${pool.toLocaleString()} coins**`));
        }
    });

    // RANKCARD
    registry.register({
        name: 'rankcard', aliases: ['rank', 'profile'],
        desc: 'View your rank, ELO, level, XP',
        usage: '!rankcard',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const r = getRankFromElo(u.elo);
            const embed = new EmbedBuilder().setColor(r.color).setTitle(ctx.message.author.username)
                .setThumbnail(ctx.message.author.displayAvatarURL())
                .addFields(
                    { name: 'Rank', value: `${r.name}`, inline: true },
                    { name: 'ELO', value: `${u.elo}`, inline: true },
                    { name: 'Peak ELO', value: `${u.peakElo}`, inline: true },
                    { name: 'Level / XP', value: `Lv ${u.level} | ${u.xp}/${xpNeeded(u.level)}XP`, inline: true },
                    { name: 'Balance', value: `${u.balance.toLocaleString()}`, inline: true },
                    { name: 'Clips', value: `${u.submissions}`, inline: true },
                    { name: 'Streak', value: `${u.streak || 0}`, inline: true }
                );
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 35);
        }
    });

    // QUALITY
    registry.register({
        name: 'quality', aliases: ['upscale', 'enhance', 'render'],
        desc: 'Cinematic video restoration. Presets: restore, cinematic, ai_ready',
        usage: '!quality <url> [preset]',
        execute: async (ctx) => {
            const u = await getUser(ctx.message.author.id);
            const limit = u.premium ? Infinity : 2;
            if (u.qualityUses >= limit) return autoDelete(await ctx.message.reply('Free limit reached. Premium = unlimited.'));
            const url = ctx.args[0];
            const preset = ctx.args[1] || 'restore';
            if (!url || !SecurityManager.validateVideoUrl(url)) return autoDelete(await ctx.message.reply('Usage: `!quality <url> [restore|cinematic|ai_ready]`'));
            await updateUser(ctx.message.author.id, { qualityUses: u.qualityUses + 1 });
            const processingMsg = await ctx.message.reply('🎬 **Cinematic Restoration started**... This may take a moment.');
            try {
                const result = await processVideo(url, { preset, targetWidth: 1920 });
                await ctx.message.author.send({
                    content: `✅ **Restoration complete!**\nPreset: \`${preset}\` | Time: ${result.duration}ms`,
                    files: [result.filePath]
                }).catch(() => {});
                await processingMsg.edit({ content: `Done! Check your DMs. (${result.duration}ms)` });
                await fs.unlink(result.filePath).catch(() => {});
            } catch (err) { await processingMsg.edit({ content: `❌ Failed: ${err.message}` }); }
        }
    });

    // SUBMIT
    registry.register({
        name: 'submit', aliases: ['clip'],
        desc: 'Submit a clip for staff review',
        usage: '!submit <video_url> [description]',
        execute: async (ctx) => {
            const url = ctx.args[0];
            if (!url || !SecurityManager.validateVideoUrl(url)) return autoDelete(await ctx.message.reply('Usage: `!submit <video_url>`'));
            const cfg = await container.resolve('guildConfig').get(ctx.message.guild.id);
            const reviewCh = ctx.message.guild.channels.cache.get(cfg.reviewChannelId || CONFIG.reviewChannelId);
            if (!reviewCh) return autoDelete(await ctx.message.reply('Review channel not configured.'));
            const ins = await container.resolve('mongo').collection('submissions').insertOne({
                userId: ctx.message.author.id, url, description: ctx.args.slice(1).join(' ') || 'Text command submission',
                reviewed: false, submittedAt: new Date(), guildId: ctx.message.guild.id
            });
            const embed = new EmbedBuilder().setColor(Colors.Gold).setTitle('New Clip Submission')
                .setDescription(`**URL:** ${url}\n**User:** ${ctx.message.author.tag}`)
                .setFooter({ text: `ID: ${ins.insertedId}` });
            const row = new ActionRowBuilder().addComponents(
                ['A', 'S', 'SS', 'SSS'].map(r => new ButtonBuilder().setCustomId(`rate_${ins.insertedId}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary))
            );
            await reviewCh.send({ embeds: [embed], components: [row] });
            await container.resolve('userService').increment(ctx.message.author.id, 'submissions', 1);
            return autoDelete(await ctx.message.reply('Submission received and sent to review panel.'));
        }
    });

    // WHOIS
    registry.register({
        name: 'whois', aliases: ['userinfo'],
        desc: 'Show detailed user information',
        usage: '!whois @user',
        execute: async (ctx) => {
            const target = ctx.message.mentions.members.first() || ctx.message.member;
            const u = await getUser(target.id);
            const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(target.user.tag)
                .setThumbnail(target.user.displayAvatarURL())
                .addFields(
                    { name: 'ID', value: target.id, inline: true },
                    { name: 'Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Account Created', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'ELO / Rank', value: `${u.elo} (${u.rank})`, inline: true },
                    { name: 'Level', value: `${u.level}`, inline: true },
                    { name: 'Balance', value: `${u.balance.toLocaleString()}`, inline: true },
                    { name: 'Warns', value: `${(u.warns || []).length}`, inline: true }
                );
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 25);
        }
    });

    // SERVERINFO
    registry.register({
        name: 'serverinfo', aliases: ['guild', 'si'],
        desc: 'Show server statistics',
        usage: '!serverinfo',
        execute: async (ctx) => {
            const g = ctx.message.guild;
            const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(g.name).setThumbnail(g.iconURL())
                .addFields(
                    { name: 'Members', value: `${g.memberCount}`, inline: true },
                    { name: 'Channels', value: `${g.channels.cache.size}`, inline: true },
                    { name: 'Roles', value: `${g.roles.cache.size}`, inline: true },
                    { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
                    { name: 'Boosts', value: `${g.premiumSubscriptionCount || 0} (Tier ${g.premiumTier})`, inline: true }
                );
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 25);
        }
    });

    // MODERATION
    const modCmd = (name, desc, usage, executeFn, perm = PermissionFlagsBits.ManageMessages) => registry.register({
        name, desc, usage, mod: true, permission: perm, execute: executeFn
    });

    modCmd('kick', 'Kick a member', '!kick @user [reason]', async (ctx) => {
        const t = ctx.message.mentions.members.first(); const r = ctx.args.slice(1).join(' ') || 'No reason';
        if (!t) return autoDelete(await ctx.message.reply('Mention a user.'));
        await t.kick(r); await modLog(ctx.message.guild, 'KICK', ctx.message.author, t.user, r);
        return autoDelete(await ctx.message.reply(`Kicked ${t.user.tag}.`));
    });

    modCmd('ban', 'Ban a member', '!ban @user [reason]', async (ctx) => {
        const t = ctx.message.mentions.members.first(); const r = ctx.args.slice(1).join(' ') || 'No reason';
        if (!t) return autoDelete(await ctx.message.reply('Mention a user.'));
        await t.ban({ reason: r }); await modLog(ctx.message.guild, 'BAN', ctx.message.author, t.user, r);
        return autoDelete(await ctx.message.reply(`Banned ${t.user.tag}.`));
    }, PermissionFlagsBits.BanMembers);

    modCmd('softban', 'Softban (ban + unban after 1h)', '!softban @user [reason]', async (ctx) => {
        const t = ctx.message.mentions.members.first(); const r = ctx.args.slice(1).join(' ') || 'No reason';
        if (!t) return autoDelete(await ctx.message.reply('Mention a user.'));
        await container.resolve('modSuite').softban(ctx.message.guild, t, ctx.message.author, r);
        return autoDelete(await ctx.message.reply(`Softbanned ${t.user.tag} (1h).`));
    }, PermissionFlagsBits.BanMembers);

    modCmd('tempban', 'Tempban a member', '!tempban @user <minutes> [reason]', async (ctx) => {
        const t = ctx.message.mentions.members.first(); const mins = parseInt(ctx.args[1]) || 60; const r = ctx.args.slice(2).join(' ') || 'No reason';
        if (!t) return autoDelete(await ctx.message.reply('Usage: `!tempban @user <minutes> [reason]`'));
        await container.resolve('modSuite').tempban(ctx.message.guild, t, ctx.message.author, r, mins * 60000);
        return autoDelete(await ctx.message.reply(`Tempbanned ${t.user.tag} for ${mins}m.`));
    }, PermissionFlagsBits.BanMembers);

    modCmd('mute', 'Timeout a member for 10 minutes', '!mute @user [reason]', async (ctx) => {
        const t = ctx.message.mentions.members.first(); const r = ctx.args.slice(1).join(' ') || 'No reason';
        if (!t) return autoDelete(await ctx.message.reply('Mention a user.'));
        await t.timeout(600000, r); await modLog(ctx.message.guild, 'MUTE', ctx.message.author, t.user, r);
        return autoDelete(await ctx.message.reply(`Muted ${t.user.tag} for 10m.`));
    });

    modCmd('unmute', 'Remove timeout', '!unmute @user', async (ctx) => {
        const t = ctx.message.mentions.members.first();
        if (!t) return autoDelete(await ctx.message.reply('Mention a user.'));
        await t.timeout(null); await modLog(ctx.message.guild, 'UNMUTE', ctx.message.author, t.user, 'Timeout removed');
        return autoDelete(await ctx.message.reply(`Unmuted ${t.user.tag}.`));
    });

    modCmd('warn', 'Warn a member', '!warn @user [reason]', async (ctx) => {
        const t = ctx.message.mentions.members.first(); const r = ctx.args.slice(1).join(' ') || 'No reason';
        if (!t) return autoDelete(await ctx.message.reply('Mention a user.'));
        await container.resolve('modSuite').warn(ctx.message.guild, t.id, ctx.message.author.id, r);
        return autoDelete(await ctx.message.reply(`Warned ${t.user.tag}: ${r}`));
    });

    modCmd('warns', 'View a member\'s warnings', '!warns @user', async (ctx) => {
        const t = ctx.message.mentions.members.first() || ctx.message.member;
        const cases = await container.resolve('modSuite').getCases(ctx.message.guild.id, t.id, 10);
        const warns = cases.filter(c => c.action === 'WARN');
        if (!warns.length) return autoDelete(await ctx.message.reply(`${t.user.tag} has no warnings.`));
        const embed = new EmbedBuilder().setColor(0xFFAA00).setTitle(`Warnings for ${t.user.tag}`)
            .setDescription(warns.map((w, i) => `**#${i + 1}** ${w.reason} — <t:${Math.floor(new Date(w.createdAt).getTime() / 1000)}:R>`).join('\n'));
        return autoDelete(await ctx.message.reply({ embeds: [embed] }), 20);
    });

    modCmd('clear', 'Bulk delete messages', '!clear <1-100>', async (ctx) => {
        const amount = Math.min(parseInt(ctx.args[0]) || 10, CONFIG.maxBulkDelete);
        const deleted = await ctx.message.channel.bulkDelete(amount, true);
        await container.resolve('modSuite').createCase(ctx.message.guild.id, 'CLEAR', ctx.message.author.id, 'channel', `Deleted ${deleted.size} messages`, null, { channelId: ctx.message.channel.id });
        return autoDelete(await ctx.message.reply(`Cleared **${deleted.size}** messages.`));
    });

    modCmd('lock', 'Lock the current channel', '!lock', async (ctx) => {
        await ctx.message.channel.permissionOverwrites.edit(ctx.message.guild.roles.everyone, { SendMessages: false });
        await container.resolve('modSuite').createCase(ctx.message.guild.id, 'LOCK', ctx.message.author.id, 'channel', 'Channel locked', null, { channelId: ctx.message.channel.id });
        return autoDelete(await ctx.message.reply('Channel locked.'));
    });

    modCmd('unlock', 'Unlock the current channel', '!unlock', async (ctx) => {
        await ctx.message.channel.permissionOverwrites.edit(ctx.message.guild.roles.everyone, { SendMessages: true });
        return autoDelete(await ctx.message.reply('Channel unlocked.'));
    });

    modCmd('slowmode', 'Set channel slowmode', '!slowmode <seconds>', async (ctx) => {
        const s = Math.min(parseInt(ctx.args[0]) || 5, 21600);
        await ctx.message.channel.setRateLimitPerUser(s);
        return autoDelete(await ctx.message.reply(`Slowmode set to **${s}s**.`));
    });

    modCmd('announce', 'Send an embed announcement', '!announce <message>', async (ctx) => {
        const text = ctx.args.join(' ');
        if (!text) return autoDelete(await ctx.message.reply('Provide announcement text.'));
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📢 Announcement').setDescription(text).setTimestamp();
        return ctx.message.channel.send({ embeds: [embed] }); // no auto-delete
    }, PermissionFlagsBits.ManageMessages);

    // OWNER
    registry.register({
        name: 'code', aliases: ['premiumcode'],
        desc: 'Generate a premium activation code',
        usage: '!code',
        ownerOnly: true,
        execute: async (ctx) => {
            const code = crypto.randomBytes(6).toString('hex').toUpperCase();
            await container.resolve('mongo').collection('codes').insertOne({ code, type: 'premium', used: false, createdAt: new Date(), generatedBy: ctx.message.author.id });
            return autoDelete(await ctx.message.reply(`Premium code: \`${code}\``));
        }
    });

    // CONFIG
    registry.register({
        name: 'config', aliases: ['settings'],
        desc: 'View or edit guild configuration',
        usage: '!config',
        mod: true,
        execute: async (ctx) => {
            const cfg = await container.resolve('guildConfig').get(ctx.message.guild.id);
            const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Guild Configuration')
                .addFields(
                    { name: 'Prefix', value: cfg.prefix, inline: true },
                    { name: 'Log Channel', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'None', inline: true },
                    { name: 'Review Channel', value: cfg.reviewChannelId ? `<#${cfg.reviewChannelId}>` : 'None', inline: true },
                    { name: 'Anti-Invite', value: cfg.antiInvite ? 'ON' : 'OFF', inline: true },
                    { name: 'Anti-Spam', value: cfg.antiSpam ? 'ON' : 'OFF', inline: true },
                    { name: 'XP Multiplier', value: `${cfg.xpMultiplier}x`, inline: true }
                );
            return autoDelete(await ctx.message.reply({ embeds: [embed] }), 25);
        }
    });
};
