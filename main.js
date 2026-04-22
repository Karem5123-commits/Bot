'use strict';
// =============================================================
// GOD MODE BOT v4 - ULTRA EDITION (15x POWER)
// =============================================================

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, REST, Routes, PermissionFlagsBits,
  ChannelType, ActivityType,
} = require('discord.js');
const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');
const { exec } = require('child_process');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// =============================================================
// CONFIG
// =============================================================
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mongoUri: process.env.MONGO_URI,
  dbName: 'godbot',
  prefix: '!',
  reviewChannelId: process.env.REVIEW_CHANNEL_ID || '',
  logChannelId: '',
  ownerIds: (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  port: parseInt(process.env.PORT) || 3000,
  autoDeleteSeconds: 10,
  jackpotCut: 0.05,
  rankRoles: {},
  autoRoleId: '1491561811516981368', // Auto-assigned to everyone
  adminPassword: 'xeporisblack',
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
  disabledCommands: new Set(), // Runtime command toggles
};

// =============================================================
// LOGGER
// =============================================================
function log(level, ...rest) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const icons = { INFO: '💠', WARN: '⚠️', ERROR: '❌', SUCCESS: '✅', ADMIN: '🔐', API: '🌐' };
  const icon = icons[level] || level;
  const line = `[${ts}] [${icon}] ${rest.join(' ')}`;
  console.log(line);
  // Push to in-memory log buffer for dashboard
  logBuffer.push({ ts, level, message: rest.join(' ') });
  if (logBuffer.length > 500) logBuffer.shift();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const logBuffer = [];

// =============================================================
// BOOT SEQUENCE
// =============================================================
async function bootSequence() {
  console.clear();
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   GOD MODE BOT v4 — ULTRA EDITION (15x POWER)       ║');
  console.log('║   Economy • Gambling • Ranks • Admin Panel • API    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  const systems = [
    'DATABASE', 'CACHE LAYER', 'RATE LIMITER', 'RANK ENGINE',
    'ECONOMY', 'GAMBLING', 'TICKETS', 'VERIFICATION',
    'VIDEO PROCESSOR', 'ADMIN PANEL', 'API GATEWAY', 'WEBSOCKET',
    'COMMAND TOGGLES', 'AUTO-ROLE', 'ANALYTICS', 'DISCORD',
  ];
  for (const s of systems) { await sleep(60); console.log(`  [✓] ${s}`); }
  console.log('\n  🚀 ALL SYSTEMS ONLINE — POWER LEVEL: 9000+\n');
}

// =============================================================
// DATABASE
// =============================================================
let db, mongoClient;

async function connectDB() {
  mongoClient = new MongoClient(CONFIG.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const tryConnect = async (attempt = 1) => {
    try {
      await mongoClient.connect();
      db = mongoClient.db(CONFIG.dbName);
      await Promise.all([
        db.collection('users').createIndex({ userId: 1 }, { unique: true }),
        db.collection('users').createIndex({ elo: -1 }),
        db.collection('users').createIndex({ balance: -1 }),
        db.collection('submissions').createIndex({ reviewed: 1 }),
        db.collection('submissions').createIndex({ submittedAt: -1 }),
        db.collection('submissions').createIndex({ userId: 1 }),
        db.collection('giveaways').createIndex({ endsAt: 1 }),
        db.collection('giveaways').createIndex({ ended: 1 }),
        db.collection('analytics').createIndex({ timestamp: -1 }),
        db.collection('analytics').createIndex({ type: 1 }),
        db.collection('command_logs').createIndex({ timestamp: -1 }),
        db.collection('command_logs').createIndex({ userId: 1 }),
        db.collection('settings').createIndex({ key: 1 }, { unique: true }),
        db.collection('audit').createIndex({ timestamp: -1 }),
      ]);
      log('SUCCESS', 'MongoDB connected + all indexes ready');
      // Load disabled commands from DB
      const saved = await db.collection('settings').findOne({ key: 'disabled_commands' });
      if (saved?.value) CONFIG.disabledCommands = new Set(saved.value);
      log('INFO', `Loaded ${CONFIG.disabledCommands.size} disabled commands from DB`);
    } catch (err) {
      log('ERROR', `MongoDB attempt ${attempt}: ${err.message}`);
      if (attempt < 5) { await sleep(attempt * 2000); return tryConnect(attempt + 1); }
      throw new Error('MongoDB failed after 5 attempts');
    }
  };
  await tryConnect();
}

// =============================================================
// ANALYTICS TRACKER
// =============================================================
async function trackEvent(type, data = {}) {
  try {
    await db.collection('analytics').insertOne({
      type, data, timestamp: new Date(),
    });
  } catch (e) {}
}

async function logCommand(userId, command, args, success, guildId) {
  try {
    await db.collection('command_logs').insertOne({
      userId, command, args, success, guildId, timestamp: new Date(),
    });
  } catch (e) {}
}

// =============================================================
// CACHE
// =============================================================
const userCache = new Map();
const CACHE_TTL = 60000;

function getCached(userId) {
  const e = userCache.get(userId);
  if (!e) return null;
  if (Date.now() - e.cachedAt > CACHE_TTL) { userCache.delete(userId); return null; }
  return e.data;
}
function setCache(userId, data) { userCache.set(userId, { data, cachedAt: Date.now() }); }
function invalidateCache(userId) { userCache.delete(userId); }

async function getUser(userId) {
  const cached = getCached(userId);
  if (cached) return cached;
  try {
    let user = await db.collection('users').findOne({ userId });
    if (!user) {
      user = {
        userId, xp: 0, level: 1, elo: 1000, peakElo: 1000,
        rank: 'Bronze', streak: 0, wins: 0, losses: 0,
        balance: 1000, premium: false, dailyLast: null,
        submissions: 0, warns: [], qualityUses: 0, betHistory: [],
        totalWagered: 0, totalWon: 0, joinedAt: new Date(),
        inventory: [], achievements: [],
      };
      await db.collection('users').insertOne(user);
      await trackEvent('user_created', { userId });
    }
    setCache(userId, user);
    return user;
  } catch (err) { log('ERROR', `getUser ${userId}: ${err.message}`); throw err; }
}

async function updateUser(userId, update) {
  try {
    await db.collection('users').updateOne({ userId }, { $set: update }, { upsert: true });
    const cached = getCached(userId);
    if (cached) setCache(userId, { ...cached, ...update });
  } catch (err) { log('ERROR', `updateUser ${userId}: ${err.message}`); throw err; }
}

// =============================================================
// RANK SYSTEM
// =============================================================
const RANKS = [
  { name: 'Bronze',   elo: 0,    color: 0x8d6e63 },
  { name: 'Silver',   elo: 1200, color: 0xb0bec5 },
  { name: 'Gold',     elo: 1800, color: 0xf1c40f },
  { name: 'Platinum', elo: 2500, color: 0x00bcd4 },
  { name: 'Diamond',  elo: 3500, color: 0x3498db },
  { name: 'Master',   elo: 4800, color: 0x9b59b6 },
  { name: 'Legend',   elo: 6500, color: 0xe74c3c },
];

function getRankFromElo(elo) {
  let rank = RANKS[0];
  for (const r of RANKS) if (elo >= r.elo) rank = r;
  return rank;
}

function calcElo(rating, currentElo, streak) {
  const scoreMap = { A: 6, S: 7.5, SS: 9, SSS: 10 };
  const score = scoreMap[rating] || 6;
  let gain = (score - 5.5) * 50;
  if (streak >= 3) gain *= 1.5;
  if (currentElo > 3500) gain *= 0.7;
  return Math.round(gain);
}

const guildRankRoles = new Map();

async function applyRank(guild, member, elo) {
  const rankObj = getRankFromElo(elo);
  const roles = guildRankRoles.get(guild.id) || CONFIG.rankRoles;
  try {
    for (const key in roles) {
      if (member.roles.cache.has(roles[key])) {
        await member.roles.remove(roles[key]).catch(() => {});
      }
    }
    const newRoleId = roles[rankObj.name];
    if (newRoleId) await member.roles.add(newRoleId).catch(() => {});
  } catch (err) { log('WARN', `applyRank ${member.id}: ${err.message}`); }
  return rankObj.name;
}

// =============================================================
// AUTO-ROLE ASSIGNMENT
// =============================================================
async function assignAutoRoleToAll(guild) {
  try {
    const role = guild.roles.cache.get(CONFIG.autoRoleId);
    if (!role) {
      log('WARN', `Auto-role ${CONFIG.autoRoleId} not found in ${guild.name}`);
      return { assigned: 0, skipped: 0, failed: 0 };
    }
    const members = await guild.members.fetch();
    let assigned = 0, skipped = 0, failed = 0;
    for (const member of members.values()) {
      if (member.user.bot) { skipped++; continue; }
      if (member.roles.cache.has(role.id)) { skipped++; continue; }
      try {
        await member.roles.add(role);
        assigned++;
        await sleep(50); // Rate limit safety
      } catch (err) { failed++; }
    }
    log('SUCCESS', `Auto-role: assigned=${assigned}, skipped=${skipped}, failed=${failed}`);
    await trackEvent('auto_role_bulk', { guildId: guild.id, assigned, skipped, failed });
    return { assigned, skipped, failed };
  } catch (err) {
    log('ERROR', `assignAutoRoleToAll: ${err.message}`);
    return { assigned: 0, skipped: 0, failed: 0 };
  }
}

// Auto-assign to new members
async function assignAutoRoleOnJoin(member) {
  try {
    if (member.user.bot) return;
    const role = member.guild.roles.cache.get(CONFIG.autoRoleId);
    if (role) {
      await member.roles.add(role);
      log('INFO', `Auto-role assigned to ${member.user.tag}`);
      await trackEvent('auto_role_join', { userId: member.id, guildId: member.guild.id });
    }
  } catch (err) { log('WARN', `assignAutoRoleOnJoin: ${err.message}`); }
}

// =============================================================
// JACKPOT
// =============================================================
async function addToJackpot(amount) {
  const cut = Math.floor(amount * CONFIG.jackpotCut);
  if (cut <= 0) return;
  try { await db.collection('jackpot').updateOne({ id: 'main' }, { $inc: { pool: cut } }, { upsert: true }); }
  catch (e) {}
}
async function getJackpot() {
  try { const d = await db.collection('jackpot').findOne({ id: 'main' }); return d ? d.pool : 0; }
  catch (e) { return 0; }
}
async function resetJackpot() {
  try { await db.collection('jackpot').updateOne({ id: 'main' }, { $set: { pool: 0 } }, { upsert: true }); }
  catch (e) {}
}

// =============================================================
// RATE LIMITER
// =============================================================
const rateLimits = new Map();
const COOLDOWNS = {
  daily: 86400000, slots: 3000, roulette: 3000, coinflip: 2000,
  bet: 2000, dice: 2000, spin: 2000, blackjack: 5000,
  allin: 10000, jackpot: 5000, quality: 30000,
};
function checkRateLimit(userId, cmd) {
  const cd = COOLDOWNS[cmd];
  if (!cd) return null;
  const key = `${userId}:${cmd}`;
  const rem = cd - (Date.now() - (rateLimits.get(key) || 0));
  if (rem > 0) return rem;
  rateLimits.set(key, Date.now());
  return null;
}

// =============================================================
// SNIPE + GIVEAWAYS
// =============================================================
const snipeCache = new Map();
const giveawayTimers = new Map();

async function startGiveaway(channel, prize, winners, durationMs, hostedBy) {
  const endsAt = new Date(Date.now() + durationMs);
  const doc = await db.collection('giveaways').insertOne({
    channelId: channel.id, guildId: channel.guildId,
    prize, winners, endsAt, hostedBy, entries: [], ended: false, createdAt: new Date(),
  });
  const embed = new EmbedBuilder()
    .setColor(0xFFD700).setTitle('🎉 GIVEAWAY 🎉')
    .setDescription(
      `**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endsAt.getTime() / 1000)}:R>\n**Hosted by:** <@${hostedBy}>\n\nClick the button below to enter!`
    )
    .setFooter({ text: `Giveaway ID: ${doc.insertedId}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_enter_${doc.insertedId}`).setLabel('🎁 Enter').setStyle(ButtonStyle.Primary)
  );
  const msg = await channel.send({ embeds: [embed], components: [row] });
  const timer = setTimeout(() => endGiveaway(doc.insertedId.toString(), msg), durationMs);
  giveawayTimers.set(doc.insertedId.toString(), timer);
  return doc.insertedId;
}

async function endGiveaway(gwId, msg) {
  try {
    const gw = await db.collection('giveaways').findOne({ _id: new ObjectId(gwId) });
    if (!gw || gw.ended) return;
    await db.collection('giveaways').updateOne({ _id: gw._id }, { $set: { ended: true, endedAt: new Date() } });
    const entries = gw.entries || [];
    let winnersText = 'No entries.';
    let picked = [];
    if (entries.length > 0) {
      const shuffled = [...entries].sort(() => 0.5 - Math.random());
      picked = shuffled.slice(0, Math.min(gw.winners, entries.length));
      winnersText = picked.map(id => `<@${id}>`).join(', ');
      await db.collection('giveaways').updateOne({ _id: gw._id }, { $set: { winnerIds: picked } });
    }
    const embed = new EmbedBuilder().setColor(0xFF4444).setTitle('🎉 GIVEAWAY ENDED')
      .setDescription(`**Prize:** ${gw.prize}\n**Winners:** ${winnersText}`);
    if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    if (msg && entries.length > 0) {
      await msg.channel.send(`🎊 Congratulations ${winnersText}! You won **${gw.prize}**!`).catch(() => {});
    }
  } catch (err) { log('ERROR', `endGiveaway: ${err.message}`); }
}

// Resume active giveaways on boot
async function resumeGiveaways() {
  try {
    const active = await db.collection('giveaways').find({ ended: false }).toArray();
    let resumed = 0;
    for (const gw of active) {
      const rem = new Date(gw.endsAt).getTime() - Date.now();
      if (rem <= 0) {
        await endGiveaway(gw._id.toString(), null);
      } else {
        const ch = client.channels.cache.get(gw.channelId);
        if (ch) {
          const msg = await ch.messages.fetch({ limit: 20 }).catch(() => null);
          const gwMsg = msg?.find(m => m.embeds[0]?.footer?.text?.includes(gw._id.toString()));
          const timer = setTimeout(() => endGiveaway(gw._id.toString(), gwMsg), rem);
          giveawayTimers.set(gw._id.toString(), timer);
          resumed++;
        }
      }
    }
    log('SUCCESS', `Resumed ${resumed} active giveaways`);
  } catch (err) { log('ERROR', `resumeGiveaways: ${err.message}`); }
}

// =============================================================
// AUTO-DETECT
// =============================================================
function levenshtein(a, b) {
  const dp = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [];
    for (let j = 0; j <= b.length; j++) dp[i][j] = i === 0 ? j : j === 0 ? i : 0;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[a.length][b.length];
}
function fuzzyMatch(input, commands) {
  let best = null, bestScore = Infinity;
  for (const c of commands) {
    const s = levenshtein(input, c);
    if (s < bestScore) { bestScore = s; best = c; }
  }
  return bestScore <= 3 ? best : null;
}
function scoreFuzzyRole(roleName, target) {
  const a = roleName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = target.toLowerCase();
  if (a === b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  return levenshtein(a, b);
}

async function autoDetectRankRoles(guild) {
  const roles = {};
  for (const target of RANKS.map(r => r.name)) {
    let best = null, bestScore = Infinity;
    guild.roles.cache.forEach(role => {
      if (role.managed || role.name === '@everyone') return;
      const score = scoreFuzzyRole(role.name, target);
      if (score < bestScore) { bestScore = score; best = role; }
    });
    if (best && bestScore <= 3) {
      roles[target] = best.id;
      log('SUCCESS', `Role "${target}" -> "${best.name}"`);
    }
  }
  guildRankRoles.set(guild.id, roles);
  Object.assign(CONFIG.rankRoles, roles);
  return roles;
}

async function autoDetectChannels(guild) {
  const reviewPat = ['clip-review', 'review', 'submissions'];
  const logPat = ['mod-logs', 'modlogs', 'logs'];
  const findCh = pats => {
    for (const p of pats) {
      const ch = guild.channels.cache.find(c =>
        c.isTextBased() && c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(p.replace(/[^a-z0-9]/g, ''))
      );
      if (ch) return ch;
    }
    return null;
  };
  const rCh = findCh(reviewPat), lCh = findCh(logPat);
  if (rCh) { CONFIG.reviewChannelId = rCh.id; log('SUCCESS', `Review channel -> #${rCh.name}`); }
  if (lCh) { CONFIG.logChannelId = lCh.id; log('SUCCESS', `Log channel -> #${lCh.name}`); }
}

// =============================================================
// XP / LEVEL
// =============================================================
const XP_COOLDOWNS = new Map();
async function handleXP(message) {
  if (XP_COOLDOWNS.has(message.author.id)) return;
  XP_COOLDOWNS.set(message.author.id, true);
  setTimeout(() => XP_COOLDOWNS.delete(message.author.id), 60000);
  try {
    const ud = await getUser(message.author.id);
    const xpGain = Math.floor(Math.random() * 10) + 5;
    const newXP = ud.xp + xpGain;
    const needed = ud.level * 100;
    if (newXP >= needed) {
      const newLvl = ud.level + 1;
      await updateUser(message.author.id, { xp: newXP - needed, level: newLvl });
      const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('⬆️ LEVEL UP!')
        .setDescription(`${message.author} reached **Level ${newLvl}**!`);
      autoDelete(await message.channel.send({ embeds: [embed] }));
      await trackEvent('level_up', { userId: message.author.id, level: newLvl });
    } else { await updateUser(message.author.id, { xp: newXP }); }
  } catch (err) { log('WARN', `XP: ${err.message}`); }
}

// =============================================================
// MOD LOG
// =============================================================
async function modLog(guild, action, moderator, target, reason = 'No reason') {
  try {
    const ch = guild.channels.cache.get(CONFIG.logChannelId);
    const tTag = target?.tag || target?.user?.tag || 'N/A';
    const tId = target?.id || target?.user?.id || '?';
    await db.collection('audit').insertOne({
      action, moderatorId: moderator.id, moderatorTag: moderator.tag,
      targetTag: tTag, targetId: tId, reason, guildId: guild.id, timestamp: new Date(),
    });
    if (!ch) return;
    const embed = new EmbedBuilder().setColor(0xFF4444).setTitle(`🛡️ Mod: ${action}`)
      .addFields(
        { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true },
        { name: 'Target', value: `${tTag} (${tId})`, inline: true },
        { name: 'Reason', value: reason }
      ).setTimestamp();
    await ch.send({ embeds: [embed] });
  } catch (err) { log('WARN', `modLog: ${err.message}`); }
}

// =============================================================
// GAMBLING HELPERS
// =============================================================
function spinSlots() {
  const sym = ['cherry', 'lemon', 'diamond', 'seven', 'bell', 'star'];
  const disp = { cherry: '🍒', lemon: '🍋', diamond: '💎', seven: '7️⃣', bell: '🔔', star: '⭐' };
  return [0,1,2].map(() => disp[sym[Math.floor(Math.random() * sym.length)]]);
}
function slotsResult(r) {
  if (r[0]===r[1] && r[1]===r[2]) {
    return r[0]==='💎' ? { mult:10, msg:'💎 JACKPOT! Triple Diamonds!' }
      : r[0]==='7️⃣' ? { mult:7, msg:'7️⃣ LUCKY SEVENS!' }
      : { mult:3, msg:'Three of a kind!' };
  }
  if (r[0]===r[1] || r[1]===r[2]) return { mult:1.5, msg:'Two of a kind!' };
  return { mult:0, msg:'No match.' };
}
function cardVal(card) {
  const v = card.slice(0, -1);
  if (['J','Q','K'].includes(v)) return 10;
  if (v === 'A') return 11;
  return parseInt(v, 10);
}
function drawCard() {
  const vals = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suits = ['♠','♥','♦','♣'];
  return vals[Math.floor(Math.random()*vals.length)] + suits[Math.floor(Math.random()*suits.length)];
}
function handTotal(hand) {
  let total = 0;
  for (const c of hand) total += cardVal(c);
  let aces = hand.filter(c => c.charAt(0) === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}
const bjGames = new Map();

async function recordBet(userId, cmd, bet, result, change) {
  try {
    await db.collection('users').updateOne(
      { userId },
      {
        $push: { betHistory: { $each: [{ cmd, bet, result, change, at: new Date() }], $slice: -10 } },
        $inc: { totalWagered: bet, totalWon: change > 0 ? change : 0 }
      }
    );
    invalidateCache(userId);
    await trackEvent('bet', { userId, cmd, bet, change });
  } catch (e) {}
}

// =============================================================
// VIDEO PROCESSOR
// =============================================================
async function processVideo(url) {
  const tmpIn = path.join('/tmp', `in_${Date.now()}.mp4`);
  const tmpOut = path.join('/tmp', `out_${Date.now()}.mp4`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await fs.writeFile(tmpIn, Buffer.from(await response.arrayBuffer()));
  await new Promise((resolve, reject) => {
    exec(
      `ffmpeg -i ${tmpIn} -vf "scale=1920:-1:flags=lanczos,unsharp=5:5:1.0" -crf 18 -preset slow ${tmpOut}`,
      err => err ? reject(err) : resolve()
    );
  });
  await fs.unlink(tmpIn).catch(() => {});
  return tmpOut;
}

// =============================================================
// AUTO DELETE
// =============================================================
function autoDelete(msg, secs = CONFIG.autoDeleteSeconds) {
  if (msg?.deletable) setTimeout(() => msg.delete().catch(() => {}), secs * 1000);
}

// =============================================================
// HELP
// =============================================================
const HELP = {
  balance:{desc:'Check coin balance',usage:'!balance'},
  daily:{desc:'Claim daily coins',usage:'!daily'},
  history:{desc:'View last 10 bets',usage:'!history'},
  coinflip:{desc:'Flip a coin',usage:'!coinflip <amount> <heads|tails>'},
  bet:{desc:'Dice roll win on 4+',usage:'!bet <amount>'},
  dice:{desc:'Same as !bet',usage:'!dice <amount>'},
  slots:{desc:'Slot machine',usage:'!slots <amount>'},
  roulette:{desc:'Bet red/black/green',usage:'!roulette <amount> <color>'},
  blackjack:{desc:'vs dealer',usage:'!blackjack <amount>'},
  spin:{desc:'Prize wheel',usage:'!spin <amount>'},
  allin:{desc:'Bet everything',usage:'!allin'},
  jackpot:{desc:'View jackpot pool',usage:'!jackpot'},
  rankcard:{desc:'View rank card',usage:'!rankcard'},
  submit:{desc:'Submit clip',usage:'!submit'},
  quality:{desc:'Upscale video',usage:'!quality <url>'},
  code:{desc:'Generate code (Owner)',usage:'!code'},
  snipe:{desc:'Last deleted message',usage:'!snipe'},
  kick:{desc:'Kick member',usage:'!kick @user [reason]'},
  ban:{desc:'Ban member',usage:'!ban @user [reason]'},
  mute:{desc:'Timeout 10 min',usage:'!mute @user [reason]'},
  unmute:{desc:'Remove timeout',usage:'!unmute @user'},
  warn:{desc:'Warn member',usage:'!warn @user [reason]'},
  clear:{desc:'Bulk delete',usage:'!clear <1-100>'},
  lock:{desc:'Lock channel',usage:'!lock'},
  unlock:{desc:'Unlock channel',usage:'!unlock'},
  slowmode:{desc:'Set slowmode',usage:'!slowmode <seconds>'},
  stats:{desc:'Bot statistics',usage:'!stats'},
  help:{desc:'Show commands',usage:'!help [command]'},
};
const ALL_COMMANDS = Object.keys(HELP);

// =============================================================
// COMMAND TOGGLE SYSTEM
// =============================================================
function isCommandDisabled(cmd) {
  return CONFIG.disabledCommands.has(cmd);
}

async function setCommandEnabled(cmd, enabled) {
  if (enabled) CONFIG.disabledCommands.delete(cmd);
  else CONFIG.disabledCommands.add(cmd);
  await db.collection('settings').updateOne(
    { key: 'disabled_commands' },
    { $set: { value: Array.from(CONFIG.disabledCommands), updatedAt: new Date() } },
    { upsert: true }
  );
  log('ADMIN', `Command "${cmd}" ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

// =============================================================
// DISCORD CLIENT
// =============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember],
});

// Export everything for other modules
module.exports = {
  client, CONFIG, db, log, logBuffer,
  getUser, updateUser, invalidateCache, userCache,
  getRankFromElo, calcElo, applyRank, RANKS, guildRankRoles,
  addToJackpot, getJackpot, resetJackpot,
  snipeCache, giveawayTimers, startGiveaway, endGiveaway,
  bjGames, spinSlots, slotsResult, drawCard, handTotal, recordBet,
  processVideo, autoDelete, ObjectId,
  HELP, ALL_COMMANDS,
  isCommandDisabled, setCommandEnabled,
  modLog, trackEvent, logCommand,
  assignAutoRoleToAll, assignAutoRoleOnJoin,
  checkRateLimit, COOLDOWNS, rateLimits,
  connectDB, bootSequence, resumeGiveaways,
  autoDetectRankRoles, autoDetectChannels,
  handleXP, fuzzyMatch,
};

// =============================================================
// MESSAGE HANDLER
// =============================================================
client.on('messageCreate', async function (message) {
  if (message.author.bot) return;
  handleXP(message).catch(() => {});
  if (!message.content.startsWith(CONFIG.prefix)) return;

  const args = message.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
  let cmd = args.shift().toLowerCase();

  if (!ALL_COMMANDS.includes(cmd)) {
    const match = fuzzyMatch(cmd, ALL_COMMANDS);
    if (match) { autoDelete(await message.reply(`Did you mean \`!${match}\`?`)); cmd = match; }
    else { autoDelete(await message.reply('Unknown command. Use `!help`')); return; }
  }

  // CHECK IF COMMAND IS DISABLED
  if (isCommandDisabled(cmd) && !CONFIG.ownerIds.includes(message.author.id)) {
    autoDelete(await message.reply(`⛔ Command \`!${cmd}\` is currently disabled by an administrator.`));
    await logCommand(message.author.id, cmd, args, false, message.guild?.id);
    return;
  }

  const remaining = checkRateLimit(message.author.id, cmd);
  if (remaining !== null) {
    autoDelete(await message.reply(`⏱️ Slow down! Wait **${(remaining/1000).toFixed(1)}s**.`));
    return;
  }

  const handleCommand = require('./commands');
  try {
    await handleCommand(message, cmd, args);
    await logCommand(message.author.id, cmd, args, true, message.guild?.id);
  } catch (err) {
    log('ERROR', `Cmd ${cmd}: ${err.message}`);
    await logCommand(message.author.id, cmd, args, false, message.guild?.id);
    try { autoDelete(await message.reply('Something went wrong. Please try again.')); } catch (e) {}
  }
});

// =============================================================
// EVENT HANDLERS
// =============================================================
client.on('messageDelete', message => {
  if (!message.author || message.author.bot || !message.content) return;
  snipeCache.set(message.channelId, {
    content: message.content,
    author: message.author.tag,
    avatarURL: message.author.displayAvatarURL(),
    at: new Date(),
  });
});

client.on('guildMemberAdd', async member => {
  await assignAutoRoleOnJoin(member);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const wasBoosting = !!oldMember.premiumSince;
    const isBoosting = !!newMember.premiumSince;
    if (!wasBoosting && isBoosting) {
      const code = 'BOOST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      await db.collection('codes').insertOne({ code, userId: newMember.id, used: false, type: 'boost', createdAt: new Date() });
      await updateUser(newMember.id, { premium: true });
      await newMember.send(`🎉 Thanks for boosting! Your code: \`${code}\``).catch(() => {});
      await trackEvent('boost', { userId: newMember.id });
    }
    if (wasBoosting && !isBoosting) {
      await updateUser(newMember.id, { premium: false });
      await newMember.send('Your boost ended. Premium removed.').catch(() => {});
    }
  } catch (err) { log('ERROR', `guildMemberUpdate: ${err.message}`); }
});

// Load interaction handler
require('./interactions')(client);

// =============================================================
// SAFETY
// =============================================================
process.on('unhandledRejection', err => log('ERROR', `Unhandled: ${err?.message || err}`));
process.on('uncaughtException', err => log('ERROR', `Uncaught: ${err?.message || err}`));

// =============================================================
// LAUNCH
// =============================================================
const slashDefs = require('./slashDefs');

async function registerSlash() {
  try {
    const rest = new REST({ version: '10' }).setToken(CONFIG.token);
    await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: slashDefs });
    log('SUCCESS', `Registered ${slashDefs.length} slash commands`);
  } catch (err) { log('ERROR', `Slash: ${err.message}`); }
}

(async () => {
  try {
    await bootSequence();
    await connectDB();
    await registerSlash();

    // Start API server
    const startApiServer = require('./api');
    startApiServer();

    await client.login(CONFIG.token);

    client.once('ready', async () => {
      log('SUCCESS', `${client.user.tag} ONLINE — ${client.guilds.cache.size} guild(s)`);
      client.user.setActivity('GOD MODE | /help', { type: ActivityType.Playing });

      for (const guild of client.guilds.cache.values()) {
        try {
          await guild.roles.fetch();
          await guild.channels.fetch();
          await autoDetectRankRoles(guild);
          await autoDetectChannels(guild);
          // Auto-assign role to all existing members
          log('INFO', `Assigning auto-role to all in ${guild.name}...`);
          assignAutoRoleToAll(guild).catch(() => {});
        } catch (err) { log('ERROR', `Auto-detect ${guild.name}: ${err.message}`); }
      }
      await resumeGiveaways();
      log('SUCCESS', '🚀 BOT FULLY OPERATIONAL');
    });
  } catch (err) {
    log('ERROR', `FATAL: ${err.message}`);
    process.exit(1);
  }
})();
