'use strict';
// =============================================================
// GOD MODE BOT v5 — ULTRA EDITION (100x POWER)
// Economy • Gambling • Ranks • Admin Panel • API • Submissions
// =============================================================

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, REST, Routes, PermissionFlagsBits,
  ChannelType, ActivityType, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ComponentType,
} = require('discord.js');
const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

// =============================================================
// CONFIG
// =============================================================
const CONFIG = {
  token:           process.env.DISCORD_TOKEN,
  clientId:        process.env.CLIENT_ID,
  mongoUri:        process.env.MONGO_URI,
  dbName:          'godbot',
  prefix:          '!',
  reviewChannelId: process.env.REVIEW_CHANNEL_ID || '',
  logChannelId:    '',
  ownerIds:        (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  port:            parseInt(process.env.PORT) || 3000,
  autoDeleteSeconds: 10,
  jackpotCut:      0.05,
  rankRoles:       {},
  autoRoleId:      '1491561811516981368',
  adminPassword:   process.env.ADMIN_PASSWORD || 'xeporisblack',
  jwtSecret:       process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
  disabledCommands: new Set(),
  maxBet:          50000,
  minBet:          10,
  dailyAmount:     500,
  dailyStreakBonus: 100,
};

// =============================================================
// LOGGER — Enhanced with file output
// =============================================================
const logBuffer = [];

function log(level, ...rest) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const icons = {
    INFO: '[INFO]', WARN: '[WARN]', ERROR: '[ERR ]',
    SUCCESS: '[OK  ]', ADMIN: '[ADMN]', API: '[API ]',
  };
  const icon = icons[level] || `[${level}]`;
  const line = `[${ts}] ${icon} ${rest.join(' ')}`;
  console.log(line);
  logBuffer.push({ ts, level, message: rest.join(' ') });
  if (logBuffer.length > 1000) logBuffer.shift();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// =============================================================
// BOOT SEQUENCE
// =============================================================
async function bootSequence() {
  console.clear();
  const banner = [
    '╔══════════════════════════════════════════════════════════╗',
    '║   GOD MODE BOT v5  —  ULTRA EDITION  (100x POWER)       ║',
    '║   Economy  Gambling  Ranks  Admin Panel  API  Submit     ║',
    '╚══════════════════════════════════════════════════════════╝',
  ];
  banner.forEach(l => console.log(l));

  const systems = [
    'DATABASE ENGINE',    'CACHE LAYER',       'RATE LIMITER',
    'RANK ENGINE',        'ELO CALCULATOR',    'ECONOMY SYSTEM',
    'GAMBLING ENGINE',    'TICKET SYSTEM',     'VERIFICATION',
    'VIDEO PROCESSOR',    'ADMIN PANEL',       'API GATEWAY',
    'WEBSOCKET SERVER',   'COMMAND TOGGLES',   'AUTO-ROLE ENGINE',
    'ANALYTICS TRACKER',  'SLASH PURGE',       'SUBMIT SYSTEM',
    'GIVEAWAY ENGINE',    'AUDIT LOGGER',      'DISCORD GATEWAY',
  ];

  for (const s of systems) {
    await sleep(40);
    console.log(`  [v] ${s}`);
  }
  console.log('\n  >> ALL SYSTEMS ONLINE — POWER LEVEL: 100x\n');
}

// =============================================================
// DATABASE
// =============================================================
let db, mongoClient;

async function connectDB() {
  mongoClient = new MongoClient(CONFIG.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 10000,
    maxPoolSize: 20,
  });

  const tryConnect = async (attempt = 1) => {
    try {
      await mongoClient.connect();
      db = mongoClient.db(CONFIG.dbName);

      // Create all indexes in parallel
      await Promise.all([
        db.collection('users').createIndex({ userId: 1 }, { unique: true }),
        db.collection('users').createIndex({ elo: -1 }),
        db.collection('users').createIndex({ balance: -1 }),
        db.collection('users').createIndex({ level: -1 }),
        db.collection('submissions').createIndex({ reviewed: 1 }),
        db.collection('submissions').createIndex({ submittedAt: -1 }),
        db.collection('submissions').createIndex({ userId: 1 }),
        db.collection('submissions').createIndex({ status: 1 }),
        db.collection('giveaways').createIndex({ endsAt: 1 }),
        db.collection('giveaways').createIndex({ ended: 1 }),
        db.collection('analytics').createIndex({ timestamp: -1 }),
        db.collection('analytics').createIndex({ type: 1 }),
        db.collection('command_logs').createIndex({ timestamp: -1 }),
        db.collection('command_logs').createIndex({ userId: 1 }),
        db.collection('settings').createIndex({ key: 1 }, { unique: true }),
        db.collection('audit').createIndex({ timestamp: -1 }),
        db.collection('audit').createIndex({ guildId: 1 }),
        db.collection('tickets').createIndex({ channelId: 1 }, { unique: true }),
        db.collection('tickets').createIndex({ userId: 1 }),
        db.collection('warnings').createIndex({ userId: 1 }),
        db.collection('warnings').createIndex({ guildId: 1 }),
      ]);

      log('SUCCESS', 'MongoDB connected — all indexes ready');

      // Load persisted settings
      const [disabledCmds, savedConfig] = await Promise.all([
        db.collection('settings').findOne({ key: 'disabled_commands' }),
        db.collection('settings').findOne({ key: 'bot_config' }),
      ]);

      if (disabledCmds?.value) {
        CONFIG.disabledCommands = new Set(disabledCmds.value);
        log('INFO', `Loaded ${CONFIG.disabledCommands.size} disabled commands`);
      }
      if (savedConfig?.value) {
        Object.assign(CONFIG, savedConfig.value);
        log('INFO', 'Loaded persisted bot config');
      }
    } catch (err) {
      log('ERROR', `MongoDB attempt ${attempt}: ${err.message}`);
      if (attempt < 5) { await sleep(attempt * 2000); return tryConnect(attempt + 1); }
      throw new Error('MongoDB failed after 5 attempts — check MONGO_URI');
    }
  };

  await tryConnect();
}

// =============================================================
// ANALYTICS
// =============================================================
async function trackEvent(type, data = {}) {
  try {
    await db.collection('analytics').insertOne({ type, data, timestamp: new Date() });
  } catch { /* non-critical */ }
}

async function logCommand(userId, command, args, success, guildId) {
  try {
    await db.collection('command_logs').insertOne({
      userId, command, args: args.slice(0, 10), success, guildId, timestamp: new Date(),
    });
  } catch { /* non-critical */ }
}

// =============================================================
// CACHE LAYER
// =============================================================
const userCache  = new Map();
const CACHE_TTL  = 60_000;
const guildCache = new Map();

function getCached(userId) {
  const e = userCache.get(userId);
  if (!e) return null;
  if (Date.now() - e.cachedAt > CACHE_TTL) { userCache.delete(userId); return null; }
  return e.data;
}
function setCache(userId, data)    { userCache.set(userId, { data, cachedAt: Date.now() }); }
function invalidateCache(userId)   { userCache.delete(userId); }

// =============================================================
// USER MANAGEMENT
// =============================================================
const DEFAULT_USER = () => ({
  xp: 0, level: 1, elo: 1000, peakElo: 1000,
  rank: 'Bronze', streak: 0, wins: 0, losses: 0,
  balance: 1000, premium: false, dailyLast: null, dailyStreak: 0,
  submissions: 0, warns: [], qualityUses: 0, betHistory: [],
  totalWagered: 0, totalWon: 0, totalLost: 0,
  joinedAt: new Date(), inventory: [], achievements: [],
  lastSeen: new Date(),
});

async function getUser(userId) {
  const cached = getCached(userId);
  if (cached) return cached;
  try {
    let user = await db.collection('users').findOne({ userId });
    if (!user) {
      user = { userId, ...DEFAULT_USER() };
      await db.collection('users').insertOne(user);
      await trackEvent('user_created', { userId });
    }
    setCache(userId, user);
    return user;
  } catch (err) {
    log('ERROR', `getUser ${userId}: ${err.message}`);
    throw err;
  }
}

async function updateUser(userId, update) {
  try {
    const ts = { lastSeen: new Date() };
    await db.collection('users').updateOne(
      { userId },
      { $set: { ...update, ...ts } },
      { upsert: true }
    );
    const cached = getCached(userId);
    if (cached) setCache(userId, { ...cached, ...update });
  } catch (err) {
    log('ERROR', `updateUser ${userId}: ${err.message}`);
    throw err;
  }
}

async function addBalance(userId, amount) {
  try {
    const result = await db.collection('users').findOneAndUpdate(
      { userId },
      { $inc: { balance: amount }, $set: { lastSeen: new Date() } },
      { returnDocument: 'after', upsert: true }
    );
    invalidateCache(userId);
    return result.balance;
  } catch (err) {
    log('ERROR', `addBalance ${userId}: ${err.message}`);
    throw err;
  }
}

// =============================================================
// RANK SYSTEM
// =============================================================
const RANKS = [
  { name: 'Bronze',   elo: 0,    color: 0xCD7F32 },
  { name: 'Silver',   elo: 1200, color: 0xC0C0C0 },
  { name: 'Gold',     elo: 1800, color: 0xFFD700 },
  { name: 'Platinum', elo: 2500, color: 0x00BCD4 },
  { name: 'Diamond',  elo: 3500, color: 0x3498DB },
  { name: 'Master',   elo: 4800, color: 0x9B59B6 },
  { name: 'Legend',   elo: 6500, color: 0xE74C3C },
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
  if (streak >= 5) gain *= 1.8;
  if (currentElo > 3500) gain *= 0.7;
  if (currentElo > 5000) gain *= 0.5;
  return Math.round(gain);
}

const guildRankRoles = new Map();

async function applyRank(guild, member, elo) {
  const rankObj = getRankFromElo(elo);
  const roles = guildRankRoles.get(guild.id) || CONFIG.rankRoles;
  try {
    const removePromises = [];
    for (const key in roles) {
      if (member.roles.cache.has(roles[key])) {
        removePromises.push(member.roles.remove(roles[key]).catch(() => {}));
      }
    }
    await Promise.all(removePromises);
    const newRoleId = roles[rankObj.name];
    if (newRoleId) await member.roles.add(newRoleId).catch(() => {});
  } catch (err) {
    log('WARN', `applyRank ${member.id}: ${err.message}`);
  }
  return rankObj.name;
}

// =============================================================
// AUTO-ROLE
// =============================================================
async function assignAutoRoleToAll(guild) {
  try {
    const role = guild.roles.cache.get(CONFIG.autoRoleId);
    if (!role) {
      log('WARN', `Auto-role ${CONFIG.autoRoleId} not found in "${guild.name}"`);
      return { assigned: 0, skipped: 0, failed: 0 };
    }
    const members = await guild.members.fetch();
    let assigned = 0, skipped = 0, failed = 0;
    const batch = [];

    for (const member of members.values()) {
      if (member.user.bot || member.roles.cache.has(role.id)) { skipped++; continue; }
      batch.push(
        member.roles.add(role)
          .then(() => assigned++)
          .catch(() => failed++)
      );
      // Process in batches of 10 to avoid rate limits
      if (batch.length >= 10) {
        await Promise.allSettled(batch.splice(0, 10));
        await sleep(1000);
      }
    }
    if (batch.length) await Promise.allSettled(batch);

    log('SUCCESS', `Auto-role bulk: +${assigned} assigned, ${skipped} skipped, ${failed} failed`);
    await trackEvent('auto_role_bulk', { guildId: guild.id, assigned, skipped, failed });
    return { assigned, skipped, failed };
  } catch (err) {
    log('ERROR', `assignAutoRoleToAll: ${err.message}`);
    return { assigned: 0, skipped: 0, failed: 0 };
  }
}

async function assignAutoRoleOnJoin(member) {
  try {
    if (member.user.bot) return;
    const role = member.guild.roles.cache.get(CONFIG.autoRoleId);
    if (role) {
      await member.roles.add(role);
      log('INFO', `Auto-role -> ${member.user.tag}`);
      await trackEvent('auto_role_join', { userId: member.id, guildId: member.guild.id });
    }
  } catch (err) {
    log('WARN', `assignAutoRoleOnJoin: ${err.message}`);
  }
}

// =============================================================
// JACKPOT
// =============================================================
async function addToJackpot(amount) {
  const cut = Math.floor(amount * CONFIG.jackpotCut);
  if (cut <= 0) return;
  try {
    await db.collection('jackpot').updateOne(
      { id: 'main' }, { $inc: { pool: cut } }, { upsert: true }
    );
  } catch { /* non-critical */ }
}
async function getJackpot() {
  try {
    const d = await db.collection('jackpot').findOne({ id: 'main' });
    return d?.pool || 0;
  } catch { return 0; }
}
async function resetJackpot() {
  try {
    await db.collection('jackpot').updateOne(
      { id: 'main' }, { $set: { pool: 0 } }, { upsert: true }
    );
  } catch { /* non-critical */ }
}

// =============================================================
// RATE LIMITER
// =============================================================
const rateLimits = new Map();
const COOLDOWNS = {
  daily: 86_400_000, slots: 3000,     roulette: 3000,
  coinflip: 2000,    bet: 2000,       dice: 2000,
  spin: 2000,        blackjack: 5000, allin: 10_000,
  jackpot: 5000,     quality: 30_000, submit: 5000,
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

// Clean stale rate limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of rateLimits.entries()) {
    if (now - ts > 86_400_000) rateLimits.delete(key);
  }
}, 600_000);

// =============================================================
// SNIPE CACHE
// =============================================================
const snipeCache = new Map();

// =============================================================
// GIVEAWAYS
// =============================================================
const giveawayTimers = new Map();

async function startGiveaway(channel, prize, winners, durationMs, hostedBy) {
  const endsAt = new Date(Date.now() + durationMs);
  const doc = await db.collection('giveaways').insertOne({
    channelId: channel.id, guildId: channel.guildId,
    prize, winners, endsAt, hostedBy,
    entries: [], ended: false, createdAt: new Date(),
  });
  const id = doc.insertedId.toString();

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('GIVEAWAY')
    .setDescription(
      `**Prize:** ${prize}\n` +
      `**Winners:** ${winners}\n` +
      `**Ends:** <t:${Math.floor(endsAt.getTime() / 1000)}:R>\n` +
      `**Hosted by:** <@${hostedBy}>\n\n` +
      `Click the button below to enter!`
    )
    .setFooter({ text: `ID: ${id}` })
    .setTimestamp(endsAt);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw_enter_${id}`)
      .setLabel('Enter Giveaway')
      .setStyle(ButtonStyle.Primary)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  giveawayTimers.set(id, setTimeout(() => endGiveaway(id, msg), durationMs));
  await trackEvent('giveaway_start', { channelId: channel.id, prize, winners });
  return doc.insertedId;
}

async function endGiveaway(gwId, msg) {
  try {
    const gw = await db.collection('giveaways').findOneAndUpdate(
      { _id: new ObjectId(gwId), ended: false },
      { $set: { ended: true, endedAt: new Date() } },
      { returnDocument: 'before' }
    );
    if (!gw) return;

    const entries = gw.entries || [];
    let winnerMentions = 'No entries — no winner!';
    let picked = [];

    if (entries.length > 0) {
      const shuffled = [...entries].sort(() => Math.random() - 0.5);
      picked = shuffled.slice(0, Math.min(gw.winners, entries.length));
      winnerMentions = picked.map(id => `<@${id}>`).join(', ');
      await db.collection('giveaways').updateOne(
        { _id: gw._id }, { $set: { winnerIds: picked } }
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0xFF4444)
      .setTitle('GIVEAWAY ENDED')
      .setDescription(`**Prize:** ${gw.prize}\n**Winners:** ${winnerMentions}`)
      .setTimestamp();

    if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    if (msg && picked.length > 0) {
      await msg.channel
        .send(`Congratulations ${winnerMentions}! You won **${gw.prize}**!`)
        .catch(() => {});
    }
    giveawayTimers.delete(gwId);
  } catch (err) {
    log('ERROR', `endGiveaway: ${err.message}`);
  }
}

async function resumeGiveaways() {
  try {
    const active = await db.collection('giveaways').find({ ended: false }).toArray();
    let resumed = 0;
    for (const gw of active) {
      const rem = new Date(gw.endsAt).getTime() - Date.now();
      const id = gw._id.toString();
      if (rem <= 0) {
        await endGiveaway(id, null);
        continue;
      }
      const ch = client.channels.cache.get(gw.channelId);
      if (!ch) continue;
      const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => null);
      const gwMsg = msgs?.find(m => m.embeds[0]?.footer?.text?.includes(id));
      giveawayTimers.set(id, setTimeout(() => endGiveaway(id, gwMsg || null), rem));
      resumed++;
    }
    log('SUCCESS', `Resumed ${resumed} active giveaway(s)`);
  } catch (err) {
    log('ERROR', `resumeGiveaways: ${err.message}`);
  }
}

// =============================================================
// FUZZY MATCHING
// =============================================================
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

function fuzzyMatch(input, commands) {
  let best = null, bestScore = Infinity;
  for (const c of commands) {
    const s = levenshtein(input.toLowerCase(), c.toLowerCase());
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

// =============================================================
// AUTO-DETECT (Roles + Channels)
// =============================================================
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
      log('SUCCESS', `Rank role "${target}" -> "#${best.name}"`);
    }
  }
  guildRankRoles.set(guild.id, roles);
  Object.assign(CONFIG.rankRoles, roles);
  return roles;
}

async function autoDetectChannels(guild) {
  const reviewPat = ['clip-review', 'clipreview', 'review', 'submissions', 'clips'];
  const logPat    = ['mod-logs', 'modlogs', 'mod-log', 'logs', 'audit'];

  const findCh = pats => {
    for (const p of pats) {
      const ch = guild.channels.cache.find(c =>
        c.isTextBased() &&
        c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(p.replace(/[^a-z0-9]/g, ''))
      );
      if (ch) return ch;
    }
    return null;
  };

  const rCh = findCh(reviewPat);
  const lCh = findCh(logPat);
  if (rCh) { CONFIG.reviewChannelId = rCh.id; log('SUCCESS', `Review channel -> #${rCh.name}`); }
  if (lCh) { CONFIG.logChannelId = lCh.id;    log('SUCCESS', `Log channel -> #${lCh.name}`); }
}

// =============================================================
// XP / LEVEL SYSTEM
// =============================================================
const XP_COOLDOWNS = new Map();

async function handleXP(message) {
  if (XP_COOLDOWNS.has(message.author.id)) return;
  XP_COOLDOWNS.set(message.author.id, true);
  setTimeout(() => XP_COOLDOWNS.delete(message.author.id), 60_000);

  try {
    const ud = await getUser(message.author.id);
    const xpGain = Math.floor(Math.random() * 15) + 5;  // 5-20 XP per message
    const newXP  = ud.xp + xpGain;
    const needed = Math.floor(100 * Math.pow(1.15, ud.level));  // Exponential scaling

    if (newXP >= needed) {
      const newLvl = ud.level + 1;
      const bonus  = newLvl * 50;  // Coin bonus per level
      await updateUser(message.author.id, { xp: newXP - needed, level: newLvl });
      await addBalance(message.author.id, bonus);

      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('LEVEL UP!')
        .setDescription(
          `${message.author} reached **Level ${newLvl}**!\n` +
          `+${bonus} coins bonus!`
        )
        .setFooter({ text: `Next level needs ${Math.floor(100 * Math.pow(1.15, newLvl))} XP` });

      autoDelete(await message.channel.send({ embeds: [embed] }), 15);
      await trackEvent('level_up', { userId: message.author.id, level: newLvl });
    } else {
      await updateUser(message.author.id, { xp: newXP });
    }
  } catch (err) {
    log('WARN', `XP: ${err.message}`);
  }
}

// =============================================================
// MOD LOG
// =============================================================
async function modLog(guild, action, moderator, target, reason = 'No reason provided') {
  try {
    const tTag = target?.tag || target?.user?.tag || 'N/A';
    const tId  = target?.id  || target?.user?.id  || 'unknown';

    await db.collection('audit').insertOne({
      action, moderatorId: moderator.id, moderatorTag: moderator.tag,
      targetTag: tTag, targetId: tId, reason,
      guildId: guild.id, timestamp: new Date(),
    });

    const ch = guild.channels.cache.get(CONFIG.logChannelId);
    if (!ch) return;

    const embed = new EmbedBuilder()
      .setColor(0xFF4444)
      .setTitle(`Mod Action: ${action}`)
      .addFields(
        { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true },
        { name: 'Target',    value: `${tTag} (${tId})`,                   inline: true },
        { name: 'Reason',    value: reason }
      )
      .setTimestamp();

    await ch.send({ embeds: [embed] });
  } catch (err) {
    log('WARN', `modLog: ${err.message}`);
  }
}

// =============================================================
// GAMBLING HELPERS
// =============================================================
const SLOT_SYMBOLS = {
  cherry:  'Cherry',
  lemon:   'Lemon',
  diamond: 'Diamond',
  seven:   '7',
  bell:    'Bell',
  star:    'Star',
  bar:     'BAR',
};
const SLOT_DISPLAY = {
  cherry: '[Ch]', lemon: '[Le]', diamond: '[Di]',
  seven: '[7]', bell: '[Be]', star: '[St]', bar: '[BA]',
};

function spinSlots() {
  const keys = Object.keys(SLOT_SYMBOLS);
  // Weighted probabilities (diamond/seven are rarer)
  const weights = [20, 20, 5, 8, 20, 20, 7];
  const total   = weights.reduce((a, b) => a + b, 0);
  const pick    = () => {
    let rng = Math.random() * total;
    for (let i = 0; i < keys.length; i++) {
      rng -= weights[i];
      if (rng <= 0) return SLOT_DISPLAY[keys[i]];
    }
    return SLOT_DISPLAY[keys[0]];
  };
  return [pick(), pick(), pick()];
}

function slotsResult(r) {
  if (r[0] === r[1] && r[1] === r[2]) {
    if (r[0] === '[Di]') return { mult: 10, msg: 'JACKPOT! Triple Diamonds!' };
    if (r[0] === '[7]')  return { mult: 7,  msg: 'LUCKY SEVENS!' };
    if (r[0] === '[BA]') return { mult: 5,  msg: 'TRIPLE BAR!' };
    return { mult: 3, msg: 'Three of a kind!' };
  }
  if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2])
    return { mult: 1.5, msg: 'Two of a kind!' };
  return { mult: 0, msg: 'No match — better luck next time!' };
}

function drawCard() {
  const vals  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suits = ['S','H','D','C'];
  return vals[Math.floor(Math.random() * vals.length)] + suits[Math.floor(Math.random() * suits.length)];
}

function cardVal(card) {
  const v = card.slice(0, -1);
  if (['J','Q','K'].includes(v)) return 10;
  if (v === 'A') return 11;
  return parseInt(v, 10);
}

function handTotal(hand) {
  let total = hand.reduce((s, c) => s + cardVal(c), 0);
  let aces  = hand.filter(c => c.startsWith('A')).length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const bjGames = new Map();

async function recordBet(userId, cmd, bet, result, change) {
  try {
    await db.collection('users').updateOne(
      { userId },
      {
        $push: {
          betHistory: {
            $each: [{ cmd, bet, result, change, at: new Date() }],
            $slice: -20,
          },
        },
        $inc: {
          totalWagered: bet,
          totalWon:  change > 0 ? change : 0,
          totalLost: change < 0 ? Math.abs(change) : 0,
        },
      }
    );
    invalidateCache(userId);
    await trackEvent('bet', { userId, cmd, bet, change });
  } catch { /* non-critical */ }
}

// =============================================================
// VIDEO PROCESSOR
// =============================================================
async function processVideo(url) {
  const id     = Date.now();
  const tmpIn  = path.join('/tmp', `in_${id}.mp4`);
  const tmpOut = path.join('/tmp', `out_${id}.mp4`);

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);

  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > 500 * 1024 * 1024) throw new Error('File too large (500MB max)');
  await fs.writeFile(tmpIn, buf);

  await new Promise((resolve, reject) => {
    const cmd = [
      `ffmpeg -i "${tmpIn}"`,
      `-vf "scale=1920:-2:flags=lanczos,unsharp=5:5:1.0:5:5:0.0"`,
      `-c:v libx264 -crf 18 -preset slow`,
      `-c:a copy`,
      `-movflags +faststart`,
      `"${tmpOut}"`,
    ].join(' ');
    exec(cmd, { timeout: 300_000 }, err => err ? reject(err) : resolve());
  });

  await fs.unlink(tmpIn).catch(() => {});
  return tmpOut;
}

// =============================================================
// AUTO-DELETE HELPER
// =============================================================
function autoDelete(msg, secs = CONFIG.autoDeleteSeconds) {
  if (msg?.deletable) setTimeout(() => msg.delete().catch(() => {}), secs * 1000);
  return msg;
}

// =============================================================
// SUBMISSION SYSTEM — FULLY REBUILT (fixes /submit error)
// =============================================================

/**
 * Validates whether a string is a plausible media URL.
 * Returns null if valid, or an error string if not.
 */
function validateSubmissionUrl(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol))
      return 'URL must use http or https.';

    const allowed = [
      'cdn.discordapp.com', 'media.discordapp.net',
      'streamable.com',      'medal.tv',
      'youtube.com',         'youtu.be',
      'twitch.tv',           'clips.twitch.tv',
      'drive.google.com',    'dropbox.com',
      'gyazo.com',           'imgur.com',
      'streamff.com',        'jumpshare.com',
    ];

    if (!allowed.some(d => u.hostname === d || u.hostname.endsWith('.' + d)))
      return `Domain not allowed. Use: ${allowed.slice(0, 5).join(', ')} etc.`;

    return null; // valid
  } catch {
    return 'That does not look like a valid URL. Please paste a proper link.';
  }
}

// Pending submissions awaiting modal submission (userId -> { interactionId, data })
const pendingSubmissions = new Map();

/**
 * Handle /submit slash command.
 * Step 1: Show a modal to collect clip URL + description.
 */
async function handleSubmitSlash(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('submit_modal')
    .setTitle('Submit Your Clip');

  const urlInput = new TextInputBuilder()
    .setCustomId('submit_url')
    .setLabel('Clip URL')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://streamable.com/xxxxx  or  Discord CDN link')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(512);

  const descInput = new TextInputBuilder()
    .setCustomId('submit_desc')
    .setLabel('Description (what makes this clip special?)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe your clip in a few sentences...')
    .setRequired(false)
    .setMinLength(0)
    .setMaxLength(500);

  const categoryInput = new TextInputBuilder()
    .setCustomId('submit_category')
    .setLabel('Category')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. Highlight, Funny, Montage, Educational')
    .setRequired(false)
    .setMaxLength(50);

  modal.addComponents(
    new ActionRowBuilder().addComponents(urlInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(categoryInput),
  );

  await interaction.showModal(modal);
}

/**
 * Handle submit_modal submission — the FIXED core of /submit.
 */
async function handleSubmitModal(interaction) {
  // Always defer first to avoid "interaction failed" errors
  await interaction.deferReply({ ephemeral: true });

  try {
    const url      = interaction.fields.getTextInputValue('submit_url').trim();
    const desc     = interaction.fields.getTextInputValue('submit_desc').trim() || 'No description provided.';
    const category = interaction.fields.getTextInputValue('submit_category').trim() || 'General';

    // Validate URL
    const urlError = validateSubmissionUrl(url);
    if (urlError) {
      return await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('Submission Failed')
            .setDescription(`**Invalid URL:** ${urlError}\n\nPlease use \`/submit\` again with a valid link.`)
        ],
      });
    }

    const userId = interaction.user.id;
    const user   = await getUser(userId);

    // Rate limit: 3 submissions per 24h for non-premium
    const recentCount = await db.collection('submissions').countDocuments({
      userId,
      submittedAt: { $gte: new Date(Date.now() - 86_400_000) },
    });

    const dailyLimit = user.premium ? 10 : 3;
    if (recentCount >= dailyLimit) {
      return await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF8800)
            .setTitle('Daily Limit Reached')
            .setDescription(
              `You've submitted ${recentCount}/${dailyLimit} clips today.\n` +
              `${user.premium ? '' : 'Premium members can submit up to 10/day!'}`
            )
        ],
      });
    }

    // Check for duplicate URL
    const duplicate = await db.collection('submissions').findOne({
      url, reviewed: false,
    });
    if (duplicate) {
      return await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF8800)
            .setTitle('Duplicate Submission')
            .setDescription('That clip has already been submitted and is awaiting review!')
        ],
      });
    }

    // Save submission
    const subDoc = {
      userId,
      userTag:     interaction.user.tag,
      url,
      description: desc,
      category,
      status:      'pending',
      reviewed:    false,
      submittedAt: new Date(),
      guildId:     interaction.guildId,
      votes:       { up: 0, down: 0 },
    };
    const result = await db.collection('submissions').insertOne(subDoc);
    const subId  = result.insertedId.toString();

    // Update user submission count
    await db.collection('users').updateOne(
      { userId }, { $inc: { submissions: 1 } }, { upsert: true }
    );
    invalidateCache(userId);

    await trackEvent('submission', { userId, subId, category });

    // Notify review channel
    const reviewCh = interaction.client.channels.cache.get(CONFIG.reviewChannelId);
    if (reviewCh) {
      const reviewEmbed = new EmbedBuilder()
        .setColor(0x00BCD4)
        .setTitle('New Clip Submission')
        .setDescription(`**Submitted by:** <@${userId}> (${interaction.user.tag})`)
        .addFields(
          { name: 'Category',    value: category, inline: true },
          { name: 'Total Clips', value: `${user.submissions + 1}`, inline: true },
          { name: 'Premium',     value: user.premium ? 'Yes' : 'No', inline: true },
          { name: 'URL',         value: url },
          { name: 'Description', value: desc },
        )
        .setFooter({ text: `Submission ID: ${subId}` })
        .setTimestamp();

      const reviewRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`sub_approve_${subId}`)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`sub_reject_${subId}`)
          .setLabel('Reject')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`sub_info_${subId}`)
          .setLabel('View Info')
          .setStyle(ButtonStyle.Secondary),
      );

      await reviewCh.send({ embeds: [reviewEmbed], components: [reviewRow] }).catch(err => {
        log('WARN', `Could not post to review channel: ${err.message}`);
      });
    } else {
      log('WARN', 'Review channel not configured — submission saved to DB only.');
    }

    // Success response
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00FF7F)
          .setTitle('Clip Submitted!')
          .setDescription(
            `Your clip has been submitted for review!\n\n` +
            `**Category:** ${category}\n` +
            `**Submission ID:** \`${subId}\`\n\n` +
            `You'll be notified when a moderator reviews it.\n` +
            `Daily submissions: **${recentCount + 1}/${dailyLimit}**`
          )
          .setTimestamp()
      ],
    });

    log('SUCCESS', `Submission from ${interaction.user.tag}: ${url}`);
  } catch (err) {
    log('ERROR', `handleSubmitModal: ${err.message}\n${err.stack}`);
    try {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('Submission Error')
            .setDescription(
              'An internal error occurred while processing your submission.\n' +
              'Please try again in a moment. If this persists, contact an admin.\n\n' +
              `Error: \`${err.message}\``
            )
        ],
      });
    } catch { /* if even editReply fails */ }
  }
}

/**
 * Handle submission review buttons (approve/reject/info).
 */
async function handleSubmissionReview(interaction, action, subId) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: 'You need Manage Messages permission.', ephemeral: true });
  }

  await interaction.deferUpdate();

  try {
    const sub = await db.collection('submissions').findOne({ _id: new ObjectId(subId) });
    if (!sub) {
      return interaction.followUp({ content: 'Submission not found (already handled?)', ephemeral: true });
    }
    if (sub.reviewed) {
      return interaction.followUp({ content: 'This submission was already reviewed.', ephemeral: true });
    }

    if (action === 'info') {
      return interaction.followUp({
        ephemeral: true,
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle('Submission Details')
            .addFields(
              { name: 'User',        value: `<@${sub.userId}> (${sub.userTag})`, inline: true },
              { name: 'Category',    value: sub.category, inline: true },
              { name: 'Submitted',   value: `<t:${Math.floor(new Date(sub.submittedAt).getTime() / 1000)}:R>`, inline: true },
              { name: 'URL',         value: sub.url },
              { name: 'Description', value: sub.description },
            )
            .setFooter({ text: `ID: ${subId}` })
        ],
      });
    }

    const approved = action === 'approve';
    const eloGain  = approved ? calcElo('A', 1000, 0) : 0;

    await db.collection('submissions').updateOne(
      { _id: sub._id },
      {
        $set: {
          reviewed: true, status: approved ? 'approved' : 'rejected',
          reviewedBy: interaction.user.id, reviewedAt: new Date(),
        },
      }
    );

    if (approved && eloGain > 0) {
      const ud      = await getUser(sub.userId);
      const newElo  = ud.elo + eloGain;
      const newPeak = Math.max(ud.peakElo, newElo);
      await updateUser(sub.userId, {
        elo: newElo, peakElo: newPeak, wins: ud.wins + 1,
        rank: getRankFromElo(newElo).name,
      });

      const guild = interaction.guild;
      const mem   = await guild.members.fetch(sub.userId).catch(() => null);
      if (mem) await applyRank(guild, mem, newElo);
    }

    // DM the submitter
    const notifyEmbed = new EmbedBuilder()
      .setColor(approved ? 0x00FF7F : 0xFF4444)
      .setTitle(`Clip ${approved ? 'Approved' : 'Rejected'}`)
      .setDescription(
        approved
          ? `Your clip was approved! +${eloGain} ELO gained.`
          : 'Your clip was not approved this time. Keep trying!'
      );

    const submitter = await interaction.client.users.fetch(sub.userId).catch(() => null);
    if (submitter) await submitter.send({ embeds: [notifyEmbed] }).catch(() => {});

    await trackEvent('submission_reviewed', {
      subId, reviewerId: interaction.user.id, approved,
    });

    // Update the review message
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(approved ? 0x00FF7F : 0xFF4444)
      .setTitle(`[${approved ? 'APPROVED' : 'REJECTED'}] Clip Submission`)
      .addFields({ name: 'Reviewed By', value: interaction.user.tag, inline: true });

    await interaction.message.edit({ embeds: [updatedEmbed], components: [] }).catch(() => {});

  } catch (err) {
    log('ERROR', `handleSubmissionReview: ${err.message}`);
    await interaction.followUp({ content: `Error: ${err.message}`, ephemeral: true });
  }
}

// =============================================================
// COMMAND TOGGLE SYSTEM
// =============================================================
function isCommandDisabled(cmd) {
  return CONFIG.disabledCommands.has(cmd);
}

async function setCommandEnabled(cmd, enabled) {
  if (enabled) CONFIG.disabledCommands.delete(cmd);
  else         CONFIG.disabledCommands.add(cmd);

  await db.collection('settings').updateOne(
    { key: 'disabled_commands' },
    { $set: { value: Array.from(CONFIG.disabledCommands), updatedAt: new Date() } },
    { upsert: true }
  );
  log('ADMIN', `Command "${cmd}" ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

// =============================================================
// HELP REGISTRY
// =============================================================
const HELP = {
  balance:    { desc: 'Check your coin balance',           usage: '!balance' },
  daily:      { desc: 'Claim daily coins + streak bonus',  usage: '!daily' },
  history:    { desc: 'View last 20 bets',                 usage: '!history' },
  coinflip:   { desc: 'Flip a coin bet',                   usage: '!coinflip <amount> <heads|tails>' },
  bet:        { desc: 'Dice roll — win on 4+',             usage: '!bet <amount>' },
  dice:       { desc: 'Alias for !bet',                    usage: '!dice <amount>' },
  slots:      { desc: 'Slot machine',                      usage: '!slots <amount>' },
  roulette:   { desc: 'Bet on red/black/green',            usage: '!roulette <amount> <color>' },
  blackjack:  { desc: 'Play blackjack vs dealer',          usage: '!blackjack <amount>' },
  spin:       { desc: 'Prize wheel spin',                  usage: '!spin <amount>' },
  allin:      { desc: 'Go all-in on a dice roll',          usage: '!allin' },
  jackpot:    { desc: 'View current jackpot pool',         usage: '!jackpot' },
  rankcard:   { desc: 'View your rank card',               usage: '!rankcard [@user]' },
  submit:     { desc: 'Submit a clip for review',          usage: '!submit (or /submit)' },
  quality:    { desc: 'AI upscale a video',                usage: '!quality <url>' },
  code:       { desc: 'Generate code (Owner only)',        usage: '!code' },
  snipe:      { desc: 'Show last deleted message',         usage: '!snipe' },
  kick:       { desc: 'Kick a member',                     usage: '!kick @user [reason]' },
  ban:        { desc: 'Ban a member',                      usage: '!ban @user [reason]' },
  mute:       { desc: 'Timeout a member (10 min)',         usage: '!mute @user [reason]' },
  unmute:     { desc: 'Remove a timeout',                  usage: '!unmute @user' },
  warn:       { desc: 'Warn a member',                     usage: '!warn @user [reason]' },
  clear:      { desc: 'Bulk delete messages',              usage: '!clear <1–100>' },
  lock:       { desc: 'Lock a channel',                    usage: '!lock' },
  unlock:     { desc: 'Unlock a channel',                  usage: '!unlock' },
  slowmode:   { desc: 'Set channel slowmode',              usage: '!slowmode <seconds>' },
  stats:      { desc: 'View bot statistics',               usage: '!stats' },
  leaderboard:{ desc: 'Top 10 by balance or ELO',         usage: '!leaderboard [balance|elo|level]' },
  giveaway:   { desc: 'Start a giveaway',                  usage: '!giveaway <duration> <winners> <prize>' },
  help:       { desc: 'Show command list',                 usage: '!help [command]' },
};
const ALL_COMMANDS = Object.keys(HELP);

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
  partials: [
    Partials.Channel, Partials.Message,
    Partials.Reaction, Partials.GuildMember,
  ],
  failIfNotExists: false,
});

// =============================================================
// EXPORTS (for other modules)
// =============================================================
module.exports = {
  client, CONFIG, get db() { return db; }, log, logBuffer,
  getUser, updateUser, addBalance, invalidateCache, userCache,
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
  handleXP, fuzzyMatch, levenshtein,
  handleSubmitSlash, handleSubmitModal, handleSubmissionReview,
  validateSubmissionUrl,
};

// =============================================================
// MESSAGE HANDLER
// =============================================================
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  handleXP(message).catch(() => {});

  if (!message.content.startsWith(CONFIG.prefix)) return;

  const args = message.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
  let cmd    = args.shift().toLowerCase();

  // Command routing
  if (!ALL_COMMANDS.includes(cmd)) {
    const match = fuzzyMatch(cmd, ALL_COMMANDS);
    if (match) {
      autoDelete(await message.reply(`Did you mean \`!${match}\`?`));
      cmd = match;
    } else {
      autoDelete(await message.reply('Unknown command. Type `!help` for a list.'));
      return;
    }
  }

  // Disabled command check
  if (isCommandDisabled(cmd) && !CONFIG.ownerIds.includes(message.author.id)) {
    autoDelete(await message.reply(
      `Command \`!${cmd}\` is currently disabled by an administrator.`
    ));
    await logCommand(message.author.id, cmd, args, false, message.guild?.id);
    return;
  }

  // Rate limit check
  const remaining = checkRateLimit(message.author.id, cmd);
  if (remaining !== null) {
    autoDelete(await message.reply(
      `Slow down! Wait **${(remaining / 1000).toFixed(1)}s** before using \`!${cmd}\` again.`
    ));
    return;
  }

  const handleCommand = require('./commands');
  try {
    await handleCommand(message, cmd, args);
    await logCommand(message.author.id, cmd, args, true, message.guild?.id);
  } catch (err) {
    log('ERROR', `Cmd "${cmd}": ${err.message}`);
    await logCommand(message.author.id, cmd, args, false, message.guild?.id);
    try {
      autoDelete(await message.reply('Something went wrong. Please try again.'));
    } catch { /* ignore */ }
  }
});

// =============================================================
// EVENT HANDLERS
// =============================================================
client.on('messageDelete', message => {
  if (!message.author || message.author.bot || !message.content) return;
  snipeCache.set(message.channelId, {
    content:    message.content,
    author:     message.author.tag,
    avatarURL:  message.author.displayAvatarURL(),
    at:         new Date(),
  });
});

client.on('guildMemberAdd', async member => {
  await assignAutoRoleOnJoin(member);
  try {
    await getUser(member.id);  // Ensure user doc exists
    log('INFO', `New member: ${member.user.tag} in "${member.guild.name}"`);
  } catch { /* non-critical */ }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const wasBoosting = !!oldMember.premiumSince;
    const isBoosting  = !!newMember.premiumSince;

    if (!wasBoosting && isBoosting) {
      const code = 'BOOST-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      await db.collection('codes').insertOne({
        code, userId: newMember.id, used: false,
        type: 'boost', createdAt: new Date(),
      });
      await updateUser(newMember.id, { premium: true });
      await newMember.send(`Thanks for boosting! Your reward code: \`${code}\``).catch(() => {});
      await trackEvent('boost_start', { userId: newMember.id });
      log('INFO', `Boost started: ${newMember.user.tag}`);
    }

    if (wasBoosting && !isBoosting) {
      await updateUser(newMember.id, { premium: false });
      await newMember.send('Your server boost has ended. Premium perks have been removed.').catch(() => {});
      await trackEvent('boost_end', { userId: newMember.id });
    }
  } catch (err) {
    log('ERROR', `guildMemberUpdate: ${err.message}`);
  }
});

// Interaction handler — FULLY handles /submit modal + review buttons
client.on('interactionCreate', async interaction => {
  try {
    // ── Slash Commands ──
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'submit') {
        await handleSubmitSlash(interaction);
        return;
      }
      // Delegate all other slash commands
      const handleSlash = require('./interactions');
      await handleSlash(interaction);
      return;
    }

    // ── Modal Submissions ──
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'submit_modal') {
        await handleSubmitModal(interaction);
        return;
      }
      // Delegate other modals
      const handleSlash = require('./interactions');
      await handleSlash(interaction);
      return;
    }

    // ── Button Interactions ──
    if (interaction.isButton()) {
      const { customId } = interaction;

      // Submission review buttons
      if (customId.startsWith('sub_approve_') || customId.startsWith('sub_reject_') || customId.startsWith('sub_info_')) {
        const parts  = customId.split('_');
        const action = parts[1]; // approve | reject | info
        const subId  = parts[2];
        await handleSubmissionReview(interaction, action, subId);
        return;
      }

      // Giveaway entry buttons
      if (customId.startsWith('gw_enter_')) {
        const gwId = customId.slice('gw_enter_'.length);
        await interaction.deferReply({ ephemeral: true });
        try {
          const gw = await db.collection('giveaways').findOne({
            _id: new ObjectId(gwId), ended: false,
          });
          if (!gw) {
            return interaction.editReply({ content: 'This giveaway has ended!' });
          }
          if (gw.entries.includes(interaction.user.id)) {
            return interaction.editReply({ content: 'You are already entered!' });
          }
          await db.collection('giveaways').updateOne(
            { _id: gw._id },
            { $push: { entries: interaction.user.id } }
          );
          await interaction.editReply({
            content: `You entered the giveaway for **${gw.prize}**! Good luck!`,
          });
        } catch (err) {
          await interaction.editReply({ content: `Error: ${err.message}` });
        }
        return;
      }

      // Delegate other buttons
      const handleSlash = require('./interactions');
      await handleSlash(interaction);
      return;
    }

    // ── Select Menus / Autocomplete ──
    const handleSlash = require('./interactions');
    if (handleSlash) await handleSlash(interaction);

  } catch (err) {
    log('ERROR', `interactionCreate: ${err.message}\n${err.stack}`);
    try {
      const reply = {
        content: 'An unexpected error occurred. Please try again.',
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    } catch { /* last resort — swallow */ }
  }
});

// =============================================================
// SAFETY NETS
// =============================================================
process.on('unhandledRejection', err => {
  log('ERROR', `Unhandled rejection: ${err?.message || err}`);
});
process.on('uncaughtException', err => {
  log('ERROR', `Uncaught exception: ${err?.message || err}`);
  // Don't exit — keep bot alive
});

// =============================================================
// SLASH COMMAND REGISTRATION
// ─── Deletes ALL old global commands before re-registering ───
// =============================================================
async function registerSlash() {
  if (!CONFIG.token || !CONFIG.clientId) {
    log('WARN', 'DISCORD_TOKEN or CLIENT_ID not set — skipping slash registration');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(CONFIG.token);

  try {
    // STEP 1: Wipe every existing global slash command
    log('INFO', 'Clearing all existing global slash commands...');
    const existing = await rest.get(Routes.applicationCommands(CONFIG.clientId));
    if (Array.isArray(existing) && existing.length > 0) {
      await Promise.all(
        existing.map(cmd =>
          rest.delete(Routes.applicationCommand(CONFIG.clientId, cmd.id))
            .then(() => log('INFO', `  Deleted: /${cmd.name}`))
            .catch(err => log('WARN', `  Failed to delete /${cmd.name}: ${err.message}`))
        )
      );
      log('SUCCESS', `Purged ${existing.length} stale slash command(s)`);
    } else {
      log('INFO', 'No existing slash commands to purge');
    }

    // STEP 2: Register fresh commands
    let slashDefs;
    try {
      slashDefs = require('./slashDefs');
    } catch (err) {
      log('ERROR', `slashDefs.js not found or has syntax error: ${err.message}`);
      slashDefs = getBuiltinSlashDefs();
    }

    await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: slashDefs });
    log('SUCCESS', `Registered ${slashDefs.length} slash command(s)`);

    // Also wipe guild-specific commands (cleans up dev leftovers)
    for (const guild of client.guilds.cache.values()) {
      try {
        await rest.put(Routes.applicationGuildCommands(CONFIG.clientId, guild.id), { body: [] });
        log('INFO', `Cleared guild commands for "${guild.name}"`);
      } catch { /* guild may not be accessible */ }
    }

  } catch (err) {
    log('ERROR', `registerSlash: ${err.message}`);
  }
}

/**
 * Fallback slash command definitions if slashDefs.js is missing.
 * Includes a properly defined /submit command.
 */
function getBuiltinSlashDefs() {
  log('INFO', 'Using built-in slash command definitions');
  return [
    new SlashCommandBuilder()
      .setName('submit')
      .setDescription('Submit a clip for review — opens a form for URL + description')
      .toJSON(),

    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your coin balance')
      .toJSON(),

    new SlashCommandBuilder()
      .setName('rankcard')
      .setDescription('View your rank card')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the top players')
      .addStringOption(o =>
        o.setName('type')
          .setDescription('Leaderboard type')
          .setRequired(false)
          .addChoices(
            { name: 'Balance', value: 'balance' },
            { name: 'ELO',     value: 'elo' },
            { name: 'Level',   value: 'level' },
          )
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName('daily')
      .setDescription('Claim your daily coins')
      .toJSON(),

    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('View bot statistics')
      .toJSON(),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show all commands')
      .addStringOption(o =>
        o.setName('command')
          .setDescription('Specific command to look up')
          .setRequired(false)
      )
      .toJSON(),
  ];
}

// =============================================================
// LAUNCH SEQUENCE
// =============================================================
(async () => {
  try {
    await bootSequence();
    await connectDB();

    // Start Express API server
    try {
      const startApiServer = require('./api');
      startApiServer();
    } catch (err) {
      log('WARN', `API server failed to start: ${err.message}`);
    }

    await client.login(CONFIG.token);

    client.once('ready', async () => {
      log('SUCCESS', `${client.user.tag} is ONLINE — ${client.guilds.cache.size} guild(s)`);

      const activities = [
        { name: 'GOD MODE v5 | /help', type: ActivityType.Playing },
        { name: `${client.guilds.cache.size} servers`,  type: ActivityType.Watching },
      ];
      let actIdx = 0;
      client.user.setActivity(activities[0].name, { type: activities[0].type });
      setInterval(() => {
        actIdx = (actIdx + 1) % activities.length;
        client.user.setActivity(activities[actIdx].name, { type: activities[actIdx].type });
      }, 60_000);

      // Register slash commands (with purge) after client is ready
      // so guild list is populated for guild command cleanup
      await registerSlash();

      // Per-guild initialization
      const initPromises = [];
      for (const guild of client.guilds.cache.values()) {
        initPromises.push(
          (async () => {
            try {
              await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
              await autoDetectRankRoles(guild);
              await autoDetectChannels(guild);
              log('INFO', `Assigning auto-role in "${guild.name}"...`);
              assignAutoRoleToAll(guild).catch(() => {});
            } catch (err) {
              log('ERROR', `Guild init "${guild.name}": ${err.message}`);
            }
          })()
        );
      }
      await Promise.all(initPromises);

      await resumeGiveaways();

      log('SUCCESS', '>> BOT FULLY OPERATIONAL — ALL SYSTEMS GO');
    });

  } catch (err) {
    log('ERROR', `FATAL STARTUP ERROR: ${err.message}\n${err.stack}`);
    process.exit(1);
  }
})();
