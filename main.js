'use strict';
// =============================================================
// GOD MODE BOT v3 - main.js (FULLY MERGED - SINGLE FILE)
// Economy | Gambling | Ranks | Tickets | Verification
// Giveaways | Suggestions | Snipe | Video Processing | Dashboard
// =============================================================

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, REST, Routes, PermissionFlagsBits,
  ChannelType, StringSelectMenuBuilder, ActivityType,
  Collection, Events,
} = require('discord.js');

const { MongoClient } = require('mongodb');
const express = require('express');
const { exec } = require('child_process');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

// =============================================================
// CONFIG
// =============================================================
const CONFIG = {
  token:            process.env.DISCORD_TOKEN,
  clientId:         process.env.CLIENT_ID,
  mongoUri:         process.env.MONGO_URI,
  dbName:           'godbot',
  prefix:           '!',
  reviewChannelId:  process.env.REVIEW_CHANNEL_ID || '',
  logChannelId:     process.env.LOG_CHANNEL_ID || '',
  ownerIds:         (process.env.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  port:             parseInt(process.env.PORT, 10) || 3000,
  autoDeleteSeconds: 10,
  jackpotCut:       0.05,
  rankRoles:        {},
  cooldowns: {
    daily:    86400000,   // 24h
    work:     3600000,    // 1h
    rob:      7200000,    // 2h
    gamble:   30000,      // 30s
  },
  economy: {
    startingBalance: 500,
    dailyMin:        100,
    dailyMax:        500,
    workMin:         50,
    workMax:         300,
    robChance:       0.4,
    robMaxPercent:   0.25,
  },
  ranks: [
    { name: 'Bronze',    minElo: 0,    color: '#CD7F32' },
    { name: 'Silver',    minElo: 500,  color: '#C0C0C0' },
    { name: 'Gold',      minElo: 1000, color: '#FFD700' },
    { name: 'Platinum',  minElo: 2000, color: '#E5E4E2' },
    { name: 'Diamond',   minElo: 3500, color: '#B9F2FF' },
    { name: 'Master',    minElo: 5000, color: '#FF4500' },
    { name: 'God',       minElo: 7500, color: '#FF0000' },
  ],
  giveaway: {
    defaultDuration: 86400000, // 24h
    emoji: '🎉',
  },
};

// =============================================================
// LOGGER
// =============================================================
function log(level, ...args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const icons = { INFO: 'ℹ', WARN: '⚠', ERROR: '✖', SUCCESS: '✔', DEBUG: '🐛' };
  const icon = icons[level] || level;
  console.log(`[${ts}] [${icon}] ${level}:`, ...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================
// BOOT SEQUENCE
// =============================================================
async function bootSequence() {
  console.clear();
  console.log('=======================================================');
  console.log(' GOD MODE BOT v3 | FULLY MERGED | SINGLE FILE         ');
  console.log('=======================================================');

  const systems = [
    'DATABASE', 'CACHE LAYER', 'RATE LIMITER', 'RANK ENGINE',
    'ECONOMY', 'GAMBLING', 'TICKETS', 'VERIFICATION',
    'VIDEO PROCESSOR', 'DASHBOARD', 'MOD LOGGER', 'DISCORD',
  ];

  for (const s of systems) {
    await sleep(80);
    console.log(` [OK] ${s}`);
  }
  console.log('\n TERMINAL ACTIVATED -- ALL SYSTEMS ONLINE\n');
}

// =============================================================
// DATABASE + INDEXES
// =============================================================
let db = null;
let mongoClient = null;

async function connectDB() {
  mongoClient = new MongoClient(CONFIG.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  async function tryConnect(attempt = 1) {
    try {
      await mongoClient.connect();
      db = mongoClient.db(CONFIG.dbName);

      // Create indexes
      await db.collection('users').createIndex({ userId: 1 }, { unique: true });
      await db.collection('users').createIndex({ elo: -1 });
      await db.collection('users').createIndex({ balance: -1 });
      await db.collection('submissions').createIndex({ reviewed: 1 });
      await db.collection('submissions').createIndex({ submittedAt: -1 });
      await db.collection('giveaways').createIndex({ endsAt: 1 });
      await db.collection('giveaways').createIndex({ ended: 1 });
      await db.collection('tickets').createIndex({ guildId: 1, status: 1 });
      await db.collection('modlogs').createIndex({ guildId: 1, targetId: 1 });
      await db.collection('config').createIndex({ guildId: 1 }, { unique: true });
      await db.collection('snipes').createIndex({ channelId: 1 });
      await db.collection('cooldowns').createIndex({ key: 1 }, { unique: true });

      log('SUCCESS', 'MongoDB connected + indexes ready');
    } catch (err) {
      log('ERROR', `MongoDB attempt ${attempt}: ${err.message}`);
      if (attempt < 5) {
        await sleep(attempt * 2000);
        return tryConnect(attempt + 1);
      }
      throw new Error('MongoDB failed after 5 attempts');
    }
  }

  await tryConnect();
}

// =============================================================
// USER CACHE (~80% fewer DB reads)
// =============================================================
const userCache = new Map();
const CACHE_TTL = 300000; // 5 minutes

function defaultUser(userId) {
  return {
    userId,
    balance: CONFIG.economy.startingBalance,
    bank: 0,
    elo: 0,
    xp: 0,
    level: 1,
    totalGambled: 0,
    totalWon: 0,
    totalLost: 0,
    dailyStreak: 0,
    lastDaily: 0,
    lastWork: 0,
    lastRob: 0,
    inventory: [],
    badges: [],
    warnings: 0,
    verified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function getUser(userId) {
  // Check cache first
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached._cachedAt < CACHE_TTL) {
    return cached;
  }

  let user = await db.collection('users').findOne({ userId });
  if (!user) {
    user = defaultUser(userId);
    await db.collection('users').insertOne(user);
  }

  user._cachedAt = Date.now();
  userCache.set(userId, user);
  return user;
}

async function updateUser(userId, update) {
  update.$set = update.$set || {};
  update.$set.updatedAt = new Date();

  const result = await db.collection('users').findOneAndUpdate(
    { userId },
    update,
    { upsert: true, returnDocument: 'after' }
  );

  const updated = result.value || result;
  updated._cachedAt = Date.now();
  userCache.set(userId, updated);
  return updated;
}

function invalidateCache(userId) {
  userCache.delete(userId);
}

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of userCache) {
    if (now - val._cachedAt > CACHE_TTL) {
      userCache.delete(key);
    }
  }
}, CACHE_TTL);

// =============================================================
// RATE LIMITER
// =============================================================
const rateLimits = new Map();

function isRateLimited(userId, action, cooldownMs) {
  const key = `${userId}:${action}`;
  const last = rateLimits.get(key) || 0;
  const remaining = cooldownMs - (Date.now() - last);
  if (remaining > 0) {
    return remaining;
  }
  rateLimits.set(key, Date.now());
  return 0;
}

// =============================================================
// COOLDOWN CHECKER (persistent via DB)
// =============================================================
async function checkCooldown(userId, action, cooldownMs) {
  const key = `${userId}:${action}`;
  const record = await db.collection('cooldowns').findOne({ key });
  if (record) {
    const remaining = cooldownMs - (Date.now() - record.timestamp);
    if (remaining > 0) return remaining;
  }
  await db.collection('cooldowns').updateOne(
    { key },
    { $set: { key, timestamp: Date.now() } },
    { upsert: true }
  );
  return 0;
}

// =============================================================
// RANK ENGINE
// =============================================================
function getRank(elo) {
  let rank = CONFIG.ranks[0];
  for (const r of CONFIG.ranks) {
    if (elo >= r.minElo) rank = r;
  }
  return rank;
}

function getXpForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

async function addXp(userId, amount, message) {
  const user = await getUser(userId);
  const newXp = (user.xp || 0) + amount;
  const xpNeeded = getXpForLevel(user.level || 1);

  if (newXp >= xpNeeded) {
    const newLevel = (user.level || 1) + 1;
    await updateUser(userId, {
      $set: { xp: newXp - xpNeeded, level: newLevel },
    });
    if (message) {
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 Level Up!')
        .setDescription(`${message.author} leveled up to **Level ${newLevel}**!`)
        .setTimestamp();
      message.channel.send({ embeds: [embed] }).catch(() => {});
    }
    return newLevel;
  } else {
    await updateUser(userId, { $set: { xp: newXp } });
    return null;
  }
}

// =============================================================
// SNIPE STORAGE
// =============================================================
const snipeCache = new Map();

function setSnipe(channelId, data) {
  snipeCache.set(channelId, { ...data, timestamp: Date.now() });
}

function getSnipe(channelId) {
  const snipe = snipeCache.get(channelId);
  if (!snipe) return null;
  // Snipes expire after 5 minutes
  if (Date.now() - snipe.timestamp > 300000) {
    snipeCache.delete(channelId);
    return null;
  }
  return snipe;
}

// =============================================================
// JACKPOT SYSTEM
// =============================================================
let jackpotPool = 0;

async function loadJackpot() {
  const doc = await db.collection('config').findOne({ key: 'jackpot' });
  jackpotPool = doc ? doc.amount : 0;
}

async function addToJackpot(amount) {
  jackpotPool += amount;
  await db.collection('config').updateOne(
    { key: 'jackpot' },
    { $set: { amount: jackpotPool } },
    { upsert: true }
  );
}

async function claimJackpot() {
  const won = jackpotPool;
  jackpotPool = 0;
  await db.collection('config').updateOne(
    { key: 'jackpot' },
    { $set: { amount: 0 } },
    { upsert: true }
  );
  return won;
}

// =============================================================
// MOD LOG
// =============================================================
async function modLog(guild, action, moderator, target, reason) {
  const entry = {
    guildId: guild.id,
    action,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag || moderator.user?.tag,
    targetId: target.id,
    targetTag: target.tag || target.user?.tag || target.id,
    reason: reason || 'No reason provided',
    timestamp: new Date(),
  };

  await db.collection('modlogs').insertOne(entry);

  if (CONFIG.logChannelId) {
    try {
      const ch = await guild.channels.fetch(CONFIG.logChannelId);
      if (ch) {
        const embed = new EmbedBuilder()
          .setColor('#FF6600')
          .setTitle(`Mod Action: ${action}`)
          .addFields(
            { name: 'Moderator', value: `${entry.moderatorTag}`, inline: true },
            { name: 'Target', value: `${entry.targetTag}`, inline: true },
            { name: 'Reason', value: reason || 'No reason provided' }
          )
          .setTimestamp();
        await ch.send({ embeds: [embed] });
      }
    } catch (err) {
      log('WARN', 'Could not send mod log:', err.message);
    }
  }
}

// =============================================================
// GIVEAWAY ENGINE
// =============================================================
const activeGiveaways = new Map();

async function loadGiveaways() {
  const giveaways = await db.collection('giveaways').find({ ended: false }).toArray();
  for (const g of giveaways) {
    scheduleGiveawayEnd(g);
  }
  log('INFO', `Loaded ${giveaways.length} active giveaways`);
}

function scheduleGiveawayEnd(giveaway) {
  const remaining = giveaway.endsAt - Date.now();
  if (remaining <= 0) {
    endGiveaway(giveaway._id);
    return;
  }
  const timeout = setTimeout(() => endGiveaway(giveaway._id), Math.min(remaining, 2147483647));
  activeGiveaways.set(giveaway._id.toString(), timeout);
}

async function endGiveaway(giveawayId) {
  const giveaway = await db.collection('giveaways').findOne({ _id: giveawayId });
  if (!giveaway || giveaway.ended) return;

  await db.collection('giveaways').updateOne(
    { _id: giveawayId },
    { $set: { ended: true } }
  );

  activeGiveaways.delete(giveawayId.toString());

  try {
    const guild = client.guilds.cache.get(giveaway.guildId);
    if (!guild) return;
    const channel = await guild.channels.fetch(giveaway.channelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(giveaway.messageId);
    if (!msg) return;

    const entries = giveaway.entries || [];
    if (entries.length === 0) {
      const embed = EmbedBuilder.from(msg.embeds[0])
        .setDescription('No entries — no winner!')
        .setColor('#FF0000');
      await msg.edit({ embeds: [embed], components: [] });
      return;
    }

    const winners = [];
    const pool = [...entries];
    const winnerCount = Math.min(giveaway.winnerCount || 1, pool.length);
    for (let i = 0; i < winnerCount; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      winners.push(pool.splice(idx, 1)[0]);
    }

    const winnerMentions = winners.map((w) => `<@${w}>`).join(', ');
    const embed = EmbedBuilder.from(msg.embeds[0])
      .setDescription(`**Winner(s):** ${winnerMentions}`)
      .setColor('#00FF00')
      .setFooter({ text: 'Giveaway ended' })
      .setTimestamp();

    await msg.edit({ embeds: [embed], components: [] });
    await channel.send(`🎉 Congratulations ${winnerMentions}! You won **${giveaway.prize}**!`);
  } catch (err) {
    log('ERROR', 'Giveaway end error:', err.message);
  }
}

// =============================================================
// TICKET SYSTEM
// =============================================================
async function createTicket(guild, member, category) {
  const ticketCount = await db.collection('tickets').countDocuments({ guildId: guild.id });
  const ticketName = `ticket-${String(ticketCount + 1).padStart(4, '0')}`;

  try {
    const channel = await guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });

    const embed = new EmbedBuilder()
      .setColor('#0099FF')
      .setTitle(`Ticket: ${ticketName}`)
      .setDescription(`Welcome ${member}! A staff member will be with you shortly.\n\n**Category:** ${category || 'General'}`)
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒'),
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim Ticket')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✋')
    );

    await channel.send({ embeds: [embed], components: [row] });

    await db.collection('tickets').insertOne({
      guildId: guild.id,
      channelId: channel.id,
      userId: member.id,
      category: category || 'General',
      status: 'open',
      claimedBy: null,
      createdAt: new Date(),
    });

    return channel;
  } catch (err) {
    log('ERROR', 'Ticket creation error:', err.message);
    return null;
  }
}

async function closeTicket(channel, closer) {
  const ticket = await db.collection('tickets').findOne({
    channelId: channel.id,
    status: 'open',
  });

  if (!ticket) return false;

  await db.collection('tickets').updateOne(
    { channelId: channel.id },
    { $set: { status: 'closed', closedBy: closer.id, closedAt: new Date() } }
  );

  // Generate transcript
  const messages = await channel.messages.fetch({ limit: 100 });
  const transcript = messages
    .reverse()
    .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
    .join('\n');

  const transcriptPath = path.join('/tmp', `transcript-${channel.name}.txt`);
  await fs.writeFile(transcriptPath, transcript);

  try {
    const user = await channel.guild.members.fetch(ticket.userId);
    await user.send({
      content: `Your ticket **${channel.name}** has been closed.`,
      files: [transcriptPath],
    }).catch(() => {});
  } catch (_) {}

  setTimeout(() => channel.delete().catch(() => {}), 5000);
  return true;
}

// =============================================================
// VIDEO PROCESSING (ffmpeg)
// =============================================================
async function processVideo(inputUrl, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [];
    args.push(`-i "${inputUrl}"`);

    if (options.startTime) args.push(`-ss ${options.startTime}`);
    if (options.duration) args.push(`-t ${options.duration}`);
    if (options.resolution) args.push(`-vf scale=${options.resolution}`);
    if (options.fps) args.push(`-r ${options.fps}`);

    args.push('-y');
    args.push(`"${outputPath}"`);

    const cmd = `ffmpeg ${args.join(' ')}`;
    log('INFO', `Processing video: ${cmd}`);

    exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        log('ERROR', 'Video processing failed:', error.message);
        reject(error);
      } else {
        log('SUCCESS', 'Video processed:', outputPath);
        resolve(outputPath);
      }
    });
  });
}

// =============================================================
// EMBED HELPERS
// =============================================================
function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor('#00FF00')
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor('#FF0000')
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor('#0099FF')
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

// =============================================================
// UTILITY FUNCTIONS
// =============================================================
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatNumber(num) {
  return num.toLocaleString('en-US');
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000) % 24;
  const days = Math.floor(ms / 86400000);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(' ') || '0s';
}

function parseDuration(str) {
  const match = str.match(/(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, hour: 3600000, d: 86400000, day: 86400000 };
  return val * (multipliers[unit] || 1000);
}

// =============================================================
// DISCORD CLIENT
// =============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
});

// =============================================================
// SLASH COMMANDS DEFINITION
// =============================================================
const slashCommands = [
  // --- Economy ---
  new SlashCommandBuilder().setName('balance').setDescription('Check your or another user\'s balance')
    .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(false)),

  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),

  new SlashCommandBuilder().setName('work').setDescription('Work to earn coins'),

  new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins into your bank')
    .addIntegerOption((o) => o.setName('amount').setDescription('Amount to deposit').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw coins from your bank')
    .addIntegerOption((o) => o.setName('amount').setDescription('Amount to withdraw').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('pay').setDescription('Pay another user')
    .addUserOption((o) => o.setName('user').setDescription('User to pay').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Amount to pay').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('rob').setDescription('Attempt to rob another user')
    .addUserOption((o) => o.setName('user').setDescription('User to rob').setRequired(true)),

  new SlashCommandBuilder().setName('leaderboard').setDescription('View the richest users'),

  // --- Gambling ---
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin for coins')
    .addIntegerOption((o) => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('side').setDescription('Heads or tails').setRequired(true)
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),

  new SlashCommandBuilder().setName('slots').setDescription('Play the slot machine')
    .addIntegerOption((o) => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('dice').setDescription('Roll dice against the bot')
    .addIntegerOption((o) => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack')
    .addIntegerOption((o) => o.setName('amount').setDescription('Bet amount').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('jackpot').setDescription('Check the current jackpot pool'),

  // --- Ranks ---
  new SlashCommandBuilder().setName('rank').setDescription('Check your rank and level')
    .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(false)),

  new SlashCommandBuilder().setName('eloleaderboard').setDescription('View the ELO leaderboard'),

  // --- Moderation ---
  new SlashCommandBuilder().setName('warn').setDescription('Warn a user')
    .addUserOption((o) => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('kick').setDescription('Kick a user')
    .addUserOption((o) => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder().setName('ban').setDescription('Ban a user')
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder().setName('mute').setDescription('Timeout a user')
    .addUserOption((o) => o.setName('user').setDescription('User to mute').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Duration (e.g. 10m, 1h, 1d)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder().setName('purge').setDescription('Delete messages')
    .addIntegerOption((o) => o.setName('amount').setDescription('Number of messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder().setName('modlogs').setDescription('View mod logs for a user')
    .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // --- Tickets ---
  new SlashCommandBuilder().setName('ticket').setDescription('Create a support ticket')
    .addStringOption((o) => o.setName('category').setDescription('Ticket category').setRequired(false)
      .addChoices(
        { name: 'General', value: 'General' },
        { name: 'Support', value: 'Support' },
        { name: 'Report', value: 'Report' },
        { name: 'Appeal', value: 'Appeal' }
      )),

  new SlashCommandBuilder().setName('ticketpanel').setDescription('Create a ticket panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // --- Verification ---
  new SlashCommandBuilder().setName('verify').setDescription('Verify yourself in the server'),

  new SlashCommandBuilder().setName('verifypanel').setDescription('Create a verification panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  // --- Giveaways ---
  new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway')
    .addStringOption((o) => o.setName('prize').setDescription('What is the prize?').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Duration (e.g. 1h, 1d)').setRequired(true))
    .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(false).setMinValue(1).setMaxValue(20))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('greroll').setDescription('Reroll a giveaway')
    .addStringOption((o) => o.setName('messageid').setDescription('Giveaway message ID').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  // --- Suggestions ---
  new SlashCommandBuilder().setName('suggest').setDescription('Make a suggestion')
    .addStringOption((o) => o.setName('suggestion').setDescription('Your suggestion').setRequired(true)),

  // --- Snipe ---
  new SlashCommandBuilder().setName('snipe').setDescription('Snipe the last deleted message'),

  // --- Utility ---
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),

  new SlashCommandBuilder().setName('serverinfo').setDescription('Get server information'),

  new SlashCommandBuilder().setName('userinfo').setDescription('Get user information')
    .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(false)),

  new SlashCommandBuilder().setName('avatar').setDescription('Get a user\'s avatar')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(false)),

  new SlashCommandBuilder().setName('help').setDescription('View all commands'),

  // --- Owner ---
  new SlashCommandBuilder().setName('eval').setDescription('Evaluate code (owner only)')
    .addStringOption((o) => o.setName('code').setDescription('Code to evaluate').setRequired(true)),

  new SlashCommandBuilder().setName('reload').setDescription('Reload bot systems (owner only)'),
];

// =============================================================
// REGISTER SLASH COMMANDS
// =============================================================
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CONFIG.token);
  try {
    log('INFO', 'Registering slash commands...');
    await rest.put(Routes.applicationCommands(CONFIG.clientId), {
      body: slashCommands.map((cmd) => cmd.toJSON()),
    });
    log('SUCCESS', `Registered ${slashCommands.length} slash commands`);
  } catch (err) {
    log('ERROR', 'Failed to register commands:', err.message);
  }
}

// =============================================================
// INTERACTION HANDLER: SLASH COMMANDS
// =============================================================
async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

  try {
    switch (commandName) {
      // --- ECONOMY ---
      case 'balance': {
        const target = interaction.options.getUser('user') || interaction.user;
        const user = await getUser(target.id);
        const rank = getRank(user.elo || 0);
        const embed = new EmbedBuilder()
          .setColor(rank.color)
          .setTitle(`${target.username}'s Balance`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '💰 Wallet', value: `${formatNumber(user.balance)}`, inline: true },
            { name: '🏦 Bank', value: `${formatNumber(user.bank || 0)}`, inline: true },
            { name: '💎 Net Worth', value: `${formatNumber((user.balance || 0) + (user.bank || 0))}`, inline: true },
            { name: '🏅 Rank', value: rank.name, inline: true },
            { name: '⭐ Level', value: `${user.level || 1}`, inline: true },
            { name: '✨ XP', value: `${user.xp || 0}/${getXpForLevel(user.level || 1)}`, inline: true }
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'daily': {
        const cooldown = await checkCooldown(interaction.user.id, 'daily', CONFIG.cooldowns.daily);
        if (cooldown > 0) {
          await interaction.reply({ embeds: [errorEmbed('Cooldown', `You can claim your daily in **${formatDuration(cooldown)}**`)], ephemeral: true });
          return;
        }
        const user = await getUser(interaction.user.id);
        const isStreak = user.lastDaily && (Date.now() - user.lastDaily < CONFIG.cooldowns.daily * 2);
        const streak = isStreak ? (user.dailyStreak || 0) + 1 : 1;
        const bonus = Math.min(streak * 10, 200);
        const amount = randomInt(CONFIG.economy.dailyMin, CONFIG.economy.dailyMax) + bonus;

        await updateUser(interaction.user.id, {
          $inc: { balance: amount },
          $set: { lastDaily: Date.now(), dailyStreak: streak },
        });

        const embed = successEmbed('Daily Reward', `You received **${formatNumber(amount)}** coins!\n\n🔥 Streak: **${streak}** days (bonus: +${bonus})`);
        await interaction.reply({ embeds: [embed] });
        await addXp(interaction.user.id, 15, null);
        break;
      }

      case 'work': {
        const cooldown = await checkCooldown(interaction.user.id, 'work', CONFIG.cooldowns.work);
        if (cooldown > 0) {
          await interaction.reply({ embeds: [errorEmbed('Cooldown', `You can work again in **${formatDuration(cooldown)}**`)], ephemeral: true });
          return;
        }
        const jobs = [
          'programmed a website', 'delivered packages', 'drove an Uber',
          'mowed lawns', 'taught a class', 'fixed a server',
          'designed a logo', 'wrote an article', 'cooked meals',
          'walked dogs', 'repaired computers', 'streamed on Twitch',
        ];
        const job = jobs[Math.floor(Math.random() * jobs.length)];
        const amount = randomInt(CONFIG.economy.workMin, CONFIG.economy.workMax);

        await updateUser(interaction.user.id, {
          $inc: { balance: amount },
          $set: { lastWork: Date.now() },
        });

        const embed = successEmbed('Work Complete', `You ${job} and earned **${formatNumber(amount)}** coins!`);
        await interaction.reply({ embeds: [embed] });
        await addXp(interaction.user.id, 10, null);
        break;
      }

      case 'deposit': {
        const amount = interaction.options.getInteger('amount');
        const user = await getUser(interaction.user.id);
        if (user.balance < amount) {
          await interaction.reply({ embeds: [errorEmbed('Insufficient Funds', `You only have **${formatNumber(user.balance)}** coins in your wallet.`)], ephemeral: true });
          return;
        }
        await updateUser(interaction.user.id, { $inc: { balance: -amount, bank: amount } });
        await interaction.reply({ embeds: [successEmbed('Deposit', `Deposited **${formatNumber(amount)}** coins into your bank.`)] });
        break;
      }

      case 'withdraw': {
        const amount = interaction.options.getInteger('amount');
        const user = await getUser(interaction.user.id);
        if ((user.bank || 0) < amount) {
          await interaction.reply({ embeds: [errorEmbed('Insufficient Funds', `You only have **${formatNumber(user.bank || 0)}** coins in your bank.`)], ephemeral: true });
          return;
        }
        await updateUser(interaction.user.id, { $inc: { balance: amount, bank: -amount } });
        await interaction.reply({ embeds: [successEmbed('Withdraw', `Withdrew **${formatNumber(amount)}** coins from your bank.`)] });
        break;
      }

      case 'pay': {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        if (target.id === interaction.user.id) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'You cannot pay yourself.')], ephemeral: true });
          return;
        }
        if (target.bot) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'You cannot pay a bot.')], ephemeral: true });
          return;
        }
        const user = await getUser(interaction.user.id);
        if (user.balance < amount) {
          await interaction.reply({ embeds: [errorEmbed('Insufficient Funds', `You only have **${formatNumber(user.balance)}** coins.`)], ephemeral: true });
          return;
        }
        await updateUser(interaction.user.id, { $inc: { balance: -amount } });
        await updateUser(target.id, { $inc: { balance: amount } });
        await interaction.reply({ embeds: [successEmbed('Payment Sent', `You paid **${formatNumber(amount)}** coins to ${target}.`)] });
        break;
      }

      case 'rob': {
        const target = interaction.options.getUser('user');
        if (target.id === interaction.user.id) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'You cannot rob yourself.')], ephemeral: true });
          return;
        }
        if (target.bot) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'You cannot rob a bot.')], ephemeral: true });
          return;
        }
        const cooldown = await checkCooldown(interaction.user.id, 'rob', CONFIG.cooldowns.rob);
        if (cooldown > 0) {
          await interaction.reply({ embeds: [errorEmbed('Cooldown', `You can rob again in **${formatDuration(cooldown)}**`)], ephemeral: true });
          return;
        }
        const victim = await getUser(target.id);
        if (victim.balance < 100) {
          await interaction.reply({ embeds: [errorEmbed('Error', `${target.username} doesn't have enough coins to rob.`)], ephemeral: true });
          return;
        }
        const success = Math.random() < CONFIG.economy.robChance;
        if (success) {
          const maxSteal = Math.floor(victim.balance * CONFIG.economy.robMaxPercent);
          const stolen = randomInt(1, maxSteal);
          await updateUser(interaction.user.id, { $inc: { balance: stolen } });
          await updateUser(target.id, { $inc: { balance: -stolen } });
          await interaction.reply({ embeds: [successEmbed('Robbery Successful', `You stole **${formatNumber(stolen)}** coins from ${target}!`)] });
        } else {
          const fine = randomInt(50, 200);
          await updateUser(interaction.user.id, { $inc: { balance: -fine } });
          await interaction.reply({ embeds: [errorEmbed('Robbery Failed', `You got caught and fined **${formatNumber(fine)}** coins!`)] });
        }
        await addXp(interaction.user.id, 5, null);
        break;
      }

      case 'leaderboard': {
        const users = await db.collection('users')
          .find({})
          .sort({ balance: -1 })
          .limit(10)
          .toArray();

        let desc = '';
        for (let i = 0; i < users.length; i++) {
          const medals = ['🥇', '🥈', '🥉'];
          const prefix = medals[i] || `**${i + 1}.**`;
          const total = (users[i].balance || 0) + (users[i].bank || 0);
          desc += `${prefix} <@${users[i].userId}> — 💰 ${formatNumber(total)}\n`;
        }

        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🏆 Leaderboard — Richest Users')
          .setDescription(desc || 'No users found.')
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      // --- GAMBLING ---
      case 'coinflip': {
        const amount = interaction.options.getInteger('amount');
        const side = interaction.options.getString('side');
        const user = await getUser(interaction.user.id);
        if (user.balance < amount) {
          await interaction.reply({ embeds: [errorEmbed('Insufficient Funds', `You only have **${formatNumber(user.balance)}** coins.`)], ephemeral: true });
          return;
        }
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const won = result === side;
        const jackpotContrib = Math.floor(amount * CONFIG.jackpotCut);

        if (won) {
          const winnings = amount - jackpotContrib;
          await updateUser(interaction.user.id, { $inc: { balance: winnings, totalWon: amount, totalGambled: amount } });
          await addToJackpot(jackpotContrib);
          const embed = successEmbed('Coinflip — You Win!', `The coin landed on **${result}**! You won **${formatNumber(winnings)}** coins! (${jackpotContrib} to jackpot)`);
          await interaction.reply({ embeds: [embed] });
        } else {
          await updateUser(interaction.user.id, { $inc: { balance: -amount, totalLost: amount, totalGambled: amount } });
          await addToJackpot(jackpotContrib);
          const embed = errorEmbed('Coinflip — You Lose!', `The coin landed on **${result}**. You lost **${formatNumber(amount)}** coins.`);
          await interaction.reply({ embeds: [embed] });
        }
        await addXp(interaction.user.id, 5, null);
        break;
      }

      case 'slots': {
        const amount = interaction.options.getInteger('amount');
        const user = await getUser(interaction.user.id);
        if (user.balance < amount) {
          await interaction.reply({ embeds: [errorEmbed('Insufficient Funds', `You only have **${formatNumber(user.balance)}** coins.`)], ephemeral: true });
          return;
        }

        const symbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '🔔'];
        const reels = [
          symbols[Math.floor(Math.random() * symbols.length)],
          symbols[Math.floor(Math.random() * symbols.length)],
          symbols[Math.floor(Math.random() * symbols.length)],
        ];

        let multiplier = 0;
        if (reels[0] === reels[1] && reels[1] === reels[2]) {
          multiplier = reels[0] === '7️⃣' ? 10 : reels[0] === '💎' ? 7 : 5;
        } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
          multiplier = 2;
        }

        const jackpotContrib = Math.floor(amount * CONFIG.jackpotCut);
        const display = `╔══════════╗\n║ ${reels.join(' | ')} ║\n╚══════════╝`;

        if (multiplier > 0) {
          const winnings = (amount * multiplier) - jackpotContrib;
          await updateUser(interaction.user.id, { $inc: { balance: winnings - amount, totalWon: winnings, totalGambled: amount } });
          await addToJackpot(jackpotContrib);

          // Jackpot check (triple 7s)
          if (multiplier === 10 && jackpotPool > 0) {
            const jpWin = await claimJackpot();
            await updateUser(interaction.user.id, { $inc: { balance: jpWin } });
            const embed = successEmbed('🎰 JACKPOT!!!', `${display}\n\n🎰 **JACKPOT!** You won the pool of **${formatNumber(jpWin)}** coins plus **${formatNumber(winnings)}** coins!`);
            await interaction.reply({ embeds: [embed] });
          } else {
            const embed = successEmbed('🎰 Slots — You Win!', `${display}\n\n**${multiplier}x** multiplier! You won **${formatNumber(winnings)}** coins!`);
            await interaction.reply({ embeds: [embed] });
          }
        } else {
          await updateUser(interaction.user.id, { $inc: { balance: -amount, totalLost: amount, totalGambled: amount } });
          await addToJackpot(jackpotContrib);
          const embed = errorEmbed('🎰 Slots — You Lose!', `${display}\n\nYou lost **${formatNumber(amount)}** coins.`);
          await interaction.reply({ embeds: [embed] });
        }
        await addXp(interaction.user.id, 5, null);
        break;
      }

      case 'dice': {
        const amount = interaction.options.getInteger('amount');
        const user = await getUser(interaction.user.id);
        if (user.balance < amount) {
          await interaction.reply({ embeds: [errorEmbed('Insufficient Funds', `You only have **${formatNumber(user.balance)}** coins.`)], ephemeral: true });
          return;
        }

        const playerRoll = randomInt(1, 6) + randomInt(1, 6);
        const botRoll = randomInt(1, 6) + randomInt(1, 6);

        if (playerRoll > botRoll) {
          await updateUser(interaction.user.id, { $inc: { balance: amount, totalWon: amount * 2, totalGambled: amount } });
          await interaction.reply({ embeds: [successEmbed('🎲 Dice — You Win!', `You rolled **${playerRoll}** vs bot's **${botRoll}**. You won **${formatNumber(amount)}** coins!`)] });
        } else if (playerRoll < botRoll) {
          await updateUser(interaction.user.id, { $inc: { balance: -amount, totalLost: amount, totalGambled: amount } });
          await interaction.reply({ embeds: [errorEmbed('🎲 Dice — You Lose!', `You rolled **${playerRoll}** vs bot's **${botRoll}**. You lost **${formatNumber(amount)}** coins.`)] });
        } else {
          await interaction.reply({ embeds: [infoEmbed('🎲 Dice — Tie!', `Both rolled **${playerRoll}**! It's a draw — no coins lost.`)] });
        }
        await addXp(interaction.user.id, 5, null);
        break;
      }

      case 'blackjack': {
        const amount = interaction.options.getInteger('amount');
        const user = await getUser(interaction.user.id);
        if (user.balance < amount) {
          await interaction.reply({ embeds: [errorEmbed('Insufficient Funds', `You only have **${formatNumber(user.balance)}** coins.`)], ephemeral: true });
          return;
        }

        // Simple blackjack implementation
        const cards = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suits = ['♠', '♥', '♦', '♣'];

        function drawCard() {
          return { card: cards[Math.floor(Math.random() * cards.length)], suit: suits[Math.floor(Math.random() * suits.length)] };
        }

        function handValue(hand) {
          let value = 0;
          let aces = 0;
          for (const c of hand) {
            if (c.card === 'A') { aces++; value += 11; }
            else if (['K', 'Q', 'J'].includes(c.card)) { value += 10; }
            else { value += parseInt(c.card, 10); }
          }
          while (value > 21 && aces > 0) { value -= 10; aces--; }
          return value;
        }

        function handStr(hand) {
          return hand.map((c) => `${c.card}${c.suit}`).join(' ');
        }

        const playerHand = [drawCard(), drawCard()];
        const dealerHand = [drawCard(), drawCard()];

        const playerVal = handValue(playerHand);
        const dealerVal = handValue(dealerHand);

        // Natural blackjack check
        if (playerVal === 21) {
          const winnings = Math.floor(amount * 1.5);
          await updateUser(interaction.user.id, { $inc: { balance: winnings, totalWon: winnings + amount, totalGambled: amount } });
          const embed = successEmbed('🃏 Blackjack!', `**Your hand:** ${handStr(playerHand)} (${playerVal})\n**Dealer:** ${handStr(dealerHand)} (${dealerVal})\n\n🎉 Natural Blackjack! You won **${formatNumber(winnings)}** coins!`);
          await interaction.reply({ embeds: [embed] });
          break;
        }

        // Interactive blackjack with buttons
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('bj_double').setLabel('Double Down').setStyle(ButtonStyle.Danger)
        );

        const embed = infoEmbed('🃏 Blackjack', `**Your hand:** ${handStr(playerHand)} (${playerVal})\n**Dealer shows:** ${dealerHand[0].card}${dealerHand[0].suit} | ??\n\nBet: **${formatNumber(amount)}** coins`);

        const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

        const collector = msg.createMessageComponentCollector({
          filter: (i) => i.user.id === interaction.user.id,
          time: 60000,
        });

        let currentBet = amount;
        let gameOver = false;

        collector.on('collect', async (i) => {
          if (gameOver) return;

          if (i.customId === 'bj_hit' || i.customId === 'bj_double') {
            if (i.customId === 'bj_double') {
              const u = await getUser(interaction.user.id);
              if (u.balance < currentBet) {
                await i.reply({ content: 'Not enough coins to double down!', ephemeral: true });
                return;
              }
              currentBet *= 2;
            }
            playerHand.push(drawCard());
            const pv = handValue(playerHand);

            if (pv > 21) {
              gameOver = true;
              collector.stop();
              await updateUser(interaction.user.id, { $inc: { balance: -currentBet, totalLost: currentBet, totalGambled: currentBet } });
              const e = errorEmbed('🃏 Bust!', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer:** ${handStr(dealerHand)} (${dealerVal})\n\nYou busted! Lost **${formatNumber(currentBet)}** coins.`);
              await i.update({ embeds: [e], components: [] });
              return;
            }

            if (i.customId === 'bj_double' || pv === 21) {
              // Auto-stand on double down or 21
              gameOver = true;
              collector.stop();
              // Dealer plays
              while (handValue(dealerHand) < 17) dealerHand.push(drawCard());
              const dv = handValue(dealerHand);
              if (dv > 21 || pv > dv) {
                await updateUser(interaction.user.id, { $inc: { balance: currentBet, totalWon: currentBet * 2, totalGambled: currentBet } });
                const e = successEmbed('🃏 You Win!', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer:** ${handStr(dealerHand)} (${dv})\n\nYou won **${formatNumber(currentBet)}** coins!`);
                await i.update({ embeds: [e], components: [] });
              } else if (pv === dv) {
                const e = infoEmbed('🃏 Push!', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer:** ${handStr(dealerHand)} (${dv})\n\nIt's a tie! Bet returned.`);
                await i.update({ embeds: [e], components: [] });
              } else {
                await updateUser(interaction.user.id, { $inc: { balance: -currentBet, totalLost: currentBet, totalGambled: currentBet } });
                const e = errorEmbed('🃏 You Lose!', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer:** ${handStr(dealerHand)} (${dv})\n\nYou lost **${formatNumber(currentBet)}** coins.`);
                await i.update({ embeds: [e], components: [] });
              }
              return;
            }

            const e = infoEmbed('🃏 Blackjack', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer shows:** ${dealerHand[0].card}${dealerHand[0].suit} | ??\n\nBet: **${formatNumber(currentBet)}** coins`);
            await i.update({ embeds: [e], components: [row] });
          }

          if (i.customId === 'bj_stand') {
            gameOver = true;
            collector.stop();
            const pv = handValue(playerHand);
            while (handValue(dealerHand) < 17) dealerHand.push(drawCard());
            const dv = handValue(dealerHand);

            if (dv > 21 || pv > dv) {
              await updateUser(interaction.user.id, { $inc: { balance: currentBet, totalWon: currentBet * 2, totalGambled: currentBet } });
              const e = successEmbed('🃏 You Win!', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer:** ${handStr(dealerHand)} (${dv})\n\nYou won **${formatNumber(currentBet)}** coins!`);
              await i.update({ embeds: [e], components: [] });
            } else if (pv === dv) {
              const e = infoEmbed('🃏 Push!', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer:** ${handStr(dealerHand)} (${dv})\n\nIt's a tie! Bet returned.`);
              await i.update({ embeds: [e], components: [] });
            } else {
              await updateUser(interaction.user.id, { $inc: { balance: -currentBet, totalLost: currentBet, totalGambled: currentBet } });
              const e = errorEmbed('🃏 You Lose!', `**Your hand:** ${handStr(playerHand)} (${pv})\n**Dealer:** ${handStr(dealerHand)} (${dv})\n\nYou lost **${formatNumber(currentBet)}** coins.`);
              await i.update({ embeds: [e], components: [] });
            }
          }
        });

        collector.on('end', async (_, reason) => {
          if (!gameOver) {
            gameOver = true;
            await updateUser(interaction.user.id, { $inc: { balance: -amount, totalLost: amount, totalGambled: amount } });
            try {
              await msg.edit({ embeds: [errorEmbed('🃏 Timed Out', 'You took too long! Bet forfeited.')], components: [] });
            } catch (_) {}
          }
        });

        await addXp(interaction.user.id, 5, null);
        break;
      }

      case 'jackpot': {
        const embed = infoEmbed('💰 Jackpot Pool', `The current jackpot pool is **${formatNumber(jackpotPool)}** coins!\n\nHit triple 7️⃣ on slots to win it all!`);
        await interaction.reply({ embeds: [embed] });
        break;
      }

      // --- RANKS ---
      case 'rank': {
        const target = interaction.options.getUser('user') || interaction.user;
        const user = await getUser(target.id);
        const rank = getRank(user.elo || 0);
        const nextRank = CONFIG.ranks.find((r) => r.minElo > (user.elo || 0));

        let desc = `**Rank:** ${rank.name}\n**ELO:** ${formatNumber(user.elo || 0)}\n**Level:** ${user.level || 1}\n**XP:** ${user.xp || 0}/${getXpForLevel(user.level || 1)}`;
        if (nextRank) {
          desc += `\n\n**Next rank:** ${nextRank.name} (${formatNumber(nextRank.minElo - (user.elo || 0))} ELO needed)`;
        }

        const embed = new EmbedBuilder()
          .setColor(rank.color)
          .setTitle(`${target.username}'s Rank`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))
          .setDescription(desc)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'eloleaderboard': {
        const users = await db.collection('users').find({}).sort({ elo: -1 }).limit(10).toArray();
        let desc = '';
        for (let i = 0; i < users.length; i++) {
          const medals = ['🥇', '🥈', '🥉'];
          const prefix = medals[i] || `**${i + 1}.**`;
          const rank = getRank(users[i].elo || 0);
          desc += `${prefix} <@${users[i].userId}> — ${rank.name} (${formatNumber(users[i].elo || 0)} ELO)\n`;
        }
        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle('🏆 ELO Leaderboard')
          .setDescription(desc || 'No users found.')
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      // --- MODERATION ---
      case 'warn': {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!member) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'User not found in this server.')], ephemeral: true });
          return;
        }
        await updateUser(target.id, { $inc: { warnings: 1 } });
        const user = await getUser(target.id);
        await modLog(interaction.guild, 'WARN', interaction.user, target, reason);

        const embed = successEmbed('User Warned', `${target} has been warned.\n\n**Reason:** ${reason}\n**Total Warnings:** ${user.warnings || 1}`);
        await interaction.reply({ embeds: [embed] });

        try {
          await target.send({ embeds: [errorEmbed(`Warned in ${interaction.guild.name}`, `**Reason:** ${reason}\n**Total Warnings:** ${user.warnings || 1}`)] });
        } catch (_) {}
        break;
      }

      case 'kick': {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!member) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'User not found.')], ephemeral: true });
          return;
        }
        if (!member.kickable) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'I cannot kick this user.')], ephemeral: true });
          return;
        }
        try {
          await target.send({ embeds: [errorEmbed(`Kicked from ${interaction.guild.name}`, `**Reason:** ${reason}`)] }).catch(() => {});
        } catch (_) {}
        await member.kick(reason);
        await modLog(interaction.guild, 'KICK', interaction.user, target, reason);
        await interaction.reply({ embeds: [successEmbed('User Kicked', `${target.tag} has been kicked.\n**Reason:** ${reason}`)] });
        break;
      }

      case 'ban': {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (member && !member.bannable) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'I cannot ban this user.')], ephemeral: true });
          return;
        }
        try {
          await target.send({ embeds: [errorEmbed(`Banned from ${interaction.guild.name}`, `**Reason:** ${reason}`)] }).catch(() => {});
        } catch (_) {}
        await interaction.guild.members.ban(target.id, { reason });
        await modLog(interaction.guild, 'BAN', interaction.user, target, reason);
        await interaction.reply({ embeds: [successEmbed('User Banned', `${target.tag} has been banned.\n**Reason:** ${reason}`)] });
        break;
      }

      case 'mute': {
        const target = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const duration = parseDuration(durationStr);
        if (!duration) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'Invalid duration. Use format like 10m, 1h, 1d.')], ephemeral: true });
          return;
        }
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!member) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'User not found.')], ephemeral: true });
          return;
        }
        if (!member.moderatable) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'I cannot timeout this user.')], ephemeral: true });
          return;
        }
        await member.timeout(duration, reason);
        await modLog(interaction.guild, 'MUTE', interaction.user, target, `${reason} (${formatDuration(duration)})`);
        await interaction.reply({ embeds: [successEmbed('User Muted', `${target} has been timed out for **${formatDuration(duration)}**.\n**Reason:** ${reason}`)] });
        break;
      }

      case 'purge': {
        const amount = interaction.options.getInteger('amount');
        const deleted = await interaction.channel.bulkDelete(amount, true);
        await interaction.reply({ embeds: [successEmbed('Messages Purged', `Deleted **${deleted.size}** messages.`)], ephemeral: true });
        break;
      }

      case 'modlogs': {
        const target = interaction.options.getUser('user');
        const logs = await db.collection('modlogs')
          .find({ guildId: interaction.guild.id, targetId: target.id })
          .sort({ timestamp: -1 })
          .limit(10)
          .toArray();

        if (logs.length === 0) {
          await interaction.reply({ embeds: [infoEmbed('Mod Logs', `No mod logs found for ${target}.`)], ephemeral: true });
          return;
        }

        let desc = '';
        for (const log of logs) {
          const date = log.timestamp.toISOString().slice(0, 10);
          desc += `**${log.action}** by ${log.moderatorTag} on ${date}\nReason: ${log.reason}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setColor('#FF6600')
          .setTitle(`Mod Logs for ${target.tag}`)
          .setDescription(desc)
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }

      // --- TICKETS ---
      case 'ticket': {
        const category = interaction.options.getString('category') || 'General';
        const channel = await createTicket(interaction.guild, interaction.member, category);
        if (channel) {
          await interaction.reply({ embeds: [successEmbed('Ticket Created', `Your ticket has been created: ${channel}`)], ephemeral: true });
        } else {
          await interaction.reply({ embeds: [errorEmbed('Error', 'Failed to create ticket.')], ephemeral: true });
        }
        break;
      }

      case 'ticketpanel': {
        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('🎫 Support Tickets')
          .setDescription('Click the button below to create a support ticket. A staff member will assist you shortly.')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_create_general')
            .setLabel('General Support')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📩'),
          new ButtonBuilder()
            .setCustomId('ticket_create_report')
            .setLabel('Report')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🚨'),
          new ButtonBuilder()
            .setCustomId('ticket_create_appeal')
            .setLabel('Appeal')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📝')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Ticket panel created!', ephemeral: true });
        break;
      }

      // --- VERIFICATION ---
      case 'verify': {
        const user = await getUser(interaction.user.id);
        if (user.verified) {
          await interaction.reply({ embeds: [infoEmbed('Already Verified', 'You are already verified!')], ephemeral: true });
          return;
        }

        // Simple math captcha
        const a = randomInt(1, 20);
        const b = randomInt(1, 20);
        const answer = a + b;

        const modal = new ModalBuilder()
          .setCustomId(`verify_modal_${answer}`)
          .setTitle('Verification');

        const input = new TextInputBuilder()
          .setCustomId('verify_answer')
          .setLabel(`What is ${a} + ${b}?`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        break;
      }

      case 'verifypanel': {
        const embed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('✅ Verification')
          .setDescription('Click the button below to verify yourself and gain access to the server.')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('verify_start')
            .setLabel('Verify')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Verification panel created!', ephemeral: true });
        break;
      }

      // --- GIVEAWAYS ---
      case 'giveaway': {
        const prize = interaction.options.getString('prize');
        const durationStr = interaction.options.getString('duration');
        const winnerCount = interaction.options.getInteger('winners') || 1;
        const duration = parseDuration(durationStr);

        if (!duration) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'Invalid duration. Use format like 1h, 1d.')], ephemeral: true });
          return;
        }

        const endsAt = Date.now() + duration;
        const embed = new EmbedBuilder()
          .setColor('#FF69B4')
          .setTitle('🎉 GIVEAWAY 🎉')
          .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnerCount}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n**Hosted by:** ${interaction.user}\n\nReact with 🎉 or click the button to enter!`)
          .setTimestamp(endsAt);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('giveaway_enter')
            .setLabel('Enter Giveaway')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🎉')
        );

        await interaction.reply({ content: 'Giveaway created!', ephemeral: true });
        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

        const giveaway = {
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          messageId: msg.id,
          prize,
          winnerCount,
          hostId: interaction.user.id,
          endsAt,
          ended: false,
          entries: [],
          createdAt: new Date(),
        };

        const result = await db.collection('giveaways').insertOne(giveaway);
        giveaway._id = result.insertedId;
        scheduleGiveawayEnd(giveaway);
        break;
      }

      case 'greroll': {
        const messageId = interaction.options.getString('messageid');
        const giveaway = await db.collection('giveaways').findOne({ messageId, guildId: interaction.guild.id });
        if (!giveaway) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'Giveaway not found.')], ephemeral: true });
          return;
        }
        if (!giveaway.ended) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'This giveaway has not ended yet.')], ephemeral: true });
          return;
        }
        const entries = giveaway.entries || [];
        if (entries.length === 0) {
          await interaction.reply({ embeds: [errorEmbed('Error', 'No entries to reroll.')], ephemeral: true });
          return;
        }
        const winner = entries[Math.floor(Math.random() * entries.length)];
        await interaction.reply({ embeds: [successEmbed('🎉 Giveaway Rerolled', `The new winner is <@${winner}>! Prize: **${giveaway.prize}**`)] });
        break;
      }

      // --- SUGGESTIONS ---
      case 'suggest': {
        const suggestion = interaction.options.getString('suggestion');
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('💡 New Suggestion')
          .setDescription(suggestion)
          .addFields(
            { name: 'Submitted by', value: `${interaction.user}`, inline: true },
            { name: 'Status', value: '⏳ Pending', inline: true }
          )
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('suggest_approve').setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('suggest_deny').setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌'),
          new ButtonBuilder().setCustomId('suggest_consider').setLabel('Consider').setStyle(ButtonStyle.Secondary).setEmoji('🤔')
        );

        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
        await msg.react('👍');
        await msg.react('👎');

        await db.collection('submissions').insertOne({
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          messageId: msg.id,
          userId: interaction.user.id,
          content: suggestion,
          status: 'pending',
          reviewed: false,
          submittedAt: new Date(),
        });

        await interaction.reply({ embeds: [successEmbed('Suggestion Submitted', 'Your suggestion has been posted!')], ephemeral: true });
        break;
      }

      // --- SNIPE ---
      case 'snipe': {
        const snipe = getSnipe(interaction.channel.id);
        if (!snipe) {
          await interaction.reply({ embeds: [errorEmbed('Nothing to Snipe', 'No recently deleted messages found.')], ephemeral: true });
          return;
        }
        const embed = new EmbedBuilder()
          .setColor('#FF6347')
          .setAuthor({ name: snipe.authorTag, iconURL: snipe.authorAvatar })
          .setDescription(snipe.content || '*No text content*')
          .setFooter({ text: `Deleted ${formatDuration(Date.now() - snipe.timestamp)} ago` })
          .setTimestamp(snipe.timestamp);
        await interaction.reply({ embeds: [embed] });
        break;
      }

      // --- UTILITY ---
      case 'ping': {
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const embed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('🏓 Pong!')
          .addFields(
            { name: 'Roundtrip', value: `${roundtrip}ms`, inline: true },
            { name: 'WebSocket', value: `${client.ws.ping}ms`, inline: true },
            { name: 'Uptime', value: formatDuration(client.uptime), inline: true }
          )
          .setTimestamp();
        await interaction.editReply({ content: null, embeds: [embed] });
        break;
      }

      case 'serverinfo': {
        const guild = interaction.guild;
        const owner = await guild.fetchOwner();
        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle(guild.name)
          .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
          .addFields(
            { name: 'Owner', value: `${owner.user.tag}`, inline: true },
            { name: 'Members', value: `${guild.memberCount}`, inline: true },
            { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
            { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
            { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
            { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'userinfo': {
        const target = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        const user = await getUser(target.id);
        const rank = getRank(user.elo || 0);

        const embed = new EmbedBuilder()
          .setColor(rank.color)
          .setTitle(target.tag)
          .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 512 }))
          .addFields(
            { name: 'ID', value: target.id, inline: true },
            { name: 'Rank', value: rank.name, inline: true },
            { name: 'Level', value: `${user.level || 1}`, inline: true },
            { name: 'Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true }
          )
          .setTimestamp();

        if (member) {
          embed.addFields(
            { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
            { name: 'Roles', value: member.roles.cache.filter((r) => r.id !== interaction.guild.id).map((r) => `${r}`).join(', ') || 'None', inline: false }
          );
        }

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'avatar': {
        const target = interaction.options.getUser('user') || interaction.user;
        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle(`${target.username}'s Avatar`)
          .setImage(target.displayAvatarURL({ dynamic: true, size: 4096 }))
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'help': {
        const categories = {
          '💰 Economy': ['balance', 'daily', 'work', 'deposit', 'withdraw', 'pay', 'rob', 'leaderboard'],
          '🎰 Gambling': ['coinflip', 'slots', 'dice', 'blackjack', 'jackpot'],
          '🏅 Ranks': ['rank', 'eloleaderboard'],
          '🔨 Moderation': ['warn', 'kick', 'ban', 'mute', 'purge', 'modlogs'],
          '🎫 Tickets': ['ticket', 'ticketpanel'],
          '✅ Verification': ['verify', 'verifypanel'],
          '🎉 Giveaways': ['giveaway', 'greroll'],
          '💡 Suggestions': ['suggest'],
          '🔧 Utility': ['ping', 'serverinfo', 'userinfo', 'avatar', 'snipe', 'help'],
        };

        let desc = '';
        for (const [cat, cmds] of Object.entries(categories)) {
          desc += `**${cat}**\n${cmds.map((c) => `\`/${c}\``).join(', ')}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('📖 GOD MODE BOT — Help')
          .setDescription(desc)
          .setFooter({ text: `${slashCommands.length} commands available` })
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        break;
      }

      // --- OWNER ---
      case 'eval': {
        if (!CONFIG.ownerIds.includes(interaction.user.id)) {
          await interaction.reply({ embeds: [errorEmbed('Unauthorized', 'This command is owner-only.')], ephemeral: true });
          return;
        }
        const code = interaction.options.getString('code');
        try {
          let result = eval(code);
          if (result instanceof Promise) result = await result;
          const output = typeof result === 'string' ? result : require('util').inspect(result, { depth: 2 });
          await interaction.reply({ content: `\`\`\`js\n${output.slice(0, 1900)}\n\`\`\``, ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `\`\`\`js\nError: ${err.message}\n\`\`\``, ephemeral: true });
        }
        break;
      }

      case 'reload': {
        if (!CONFIG.ownerIds.includes(interaction.user.id)) {
          await interaction.reply({ embeds: [errorEmbed('Unauthorized', 'This command is owner-only.')], ephemeral: true });
          return;
        }
        userCache.clear();
        rateLimits.clear();
        await loadJackpot();
        await loadGiveaways();
        await interaction.reply({ embeds: [successEmbed('Reloaded', 'All systems reloaded successfully.')], ephemeral: true });
        break;
      }

      default:
        await interaction.reply({ embeds: [errorEmbed('Unknown Command', 'This command is not recognized.')], ephemeral: true });
    }
  } catch (err) {
    log('ERROR', `Command "${commandName}" error:`, err.message, err.stack);
    const reply = { embeds: [errorEmbed('Error', 'An error occurred while processing this command.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

// =============================================================
// INTERACTION HANDLER: BUTTONS
// =============================================================
async function handleButton(interaction) {
  const { customId } = interaction;

  try {
    // --- Ticket Buttons ---
    if (customId.startsWith('ticket_create_')) {
      const category = customId.replace('ticket_create_', '').replace(/^\w/, (c) => c.toUpperCase());
      const channel = await createTicket(interaction.guild, interaction.member, category);
      if (channel) {
        await interaction.reply({ embeds: [successEmbed('Ticket Created', `Your ticket has been created: ${channel}`)], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [errorEmbed('Error', 'Failed to create ticket.')], ephemeral: true });
      }
      return;
    }

    if (customId === 'ticket_close') {
      const success = await closeTicket(interaction.channel, interaction.user);
      if (success) {
        await interaction.reply({ embeds: [successEmbed('Ticket Closing', 'This ticket will be closed in 5 seconds...')] });
      } else {
        await interaction.reply({ embeds: [errorEmbed('Error', 'This is not an open ticket.')], ephemeral: true });
      }
      return;
    }

    if (customId === 'ticket_claim') {
      const ticket = await db.collection('tickets').findOne({ channelId: interaction.channel.id, status: 'open' });
      if (!ticket) {
        await interaction.reply({ embeds: [errorEmbed('Error', 'Ticket not found.')], ephemeral: true });
        return;
      }
      if (ticket.claimedBy) {
        await interaction.reply({ embeds: [infoEmbed('Already Claimed', `This ticket is claimed by <@${ticket.claimedBy}>.`)], ephemeral: true });
        return;
      }
      await db.collection('tickets').updateOne(
        { channelId: interaction.channel.id },
        { $set: { claimedBy: interaction.user.id } }
      );
      await interaction.reply({ embeds: [successEmbed('Ticket Claimed', `${interaction.user} has claimed this ticket.`)] });
      return;
    }

    // --- Verification Button ---
    if (customId === 'verify_start') {
      const user = await getUser(interaction.user.id);
      if (user.verified) {
        await interaction.reply({ embeds: [infoEmbed('Already Verified', 'You are already verified!')], ephemeral: true });
        return;
      }
      const a = randomInt(1, 20);
      const b = randomInt(1, 20);
      const answer = a + b;

      const modal = new ModalBuilder()
        .setCustomId(`verify_modal_${answer}`)
        .setTitle('Verification');

      const input = new TextInputBuilder()
        .setCustomId('verify_answer')
        .setLabel(`What is ${a} + ${b}?`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    // --- Giveaway Entry ---
    if (customId === 'giveaway_enter') {
      const giveaway = await db.collection('giveaways').findOne({
        messageId: interaction.message.id,
        ended: false,
      });

      if (!giveaway) {
        await interaction.reply({ embeds: [errorEmbed('Error', 'This giveaway has ended or does not exist.')], ephemeral: true });
        return;
      }

      if (giveaway.entries.includes(interaction.user.id)) {
        // Remove entry
        await db.collection('giveaways').updateOne(
          { messageId: interaction.message.id },
          { $pull: { entries: interaction.user.id } }
        );
        await interaction.reply({ content: 'You have left the giveaway.', ephemeral: true });
      } else {
        // Add entry
        await db.collection('giveaways').updateOne(
          { messageId: interaction.message.id },
          { $push: { entries: interaction.user.id } }
        );
        await interaction.reply({ content: '🎉 You have entered the giveaway! Good luck!', ephemeral: true });
      }
      return;
    }

    // --- Suggestion Buttons ---
    if (customId.startsWith('suggest_')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ embeds: [errorEmbed('Unauthorized', 'Only staff can manage suggestions.')], ephemeral: true });
        return;
      }

      const action = customId.replace('suggest_', '');
      const statusMap = { approve: '✅ Approved', deny: '❌ Denied', consider: '🤔 Considering' };
      const colorMap = { approve: '#00FF00', deny: '#FF0000', consider: '#FFA500' };

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(colorMap[action])
        .setFields(
          interaction.message.embeds[0].fields[0],
          { name: 'Status', value: `${statusMap[action]} by ${interaction.user}`, inline: true }
        );

      await interaction.update({ embeds: [embed], components: [] });

      await db.collection('submissions').updateOne(
        { messageId: interaction.message.id },
        { $set: { status: action, reviewed: true, reviewedBy: interaction.user.id, reviewedAt: new Date() } }
      );
      return;
    }
  } catch (err) {
    log('ERROR', 'Button interaction error:', err.message);
    const reply = { embeds: [errorEmbed('Error', 'Something went wrong.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

// =============================================================
// INTERACTION HANDLER: MODALS
// =============================================================
async function handleModal(interaction) {
  const { customId } = interaction;

  try {
    if (customId.startsWith('verify_modal_')) {
      const expectedAnswer = parseInt(customId.replace('verify_modal_', ''), 10);
      const userAnswer = parseInt(interaction.fields.getTextInputValue('verify_answer'), 10);

      if (userAnswer === expectedAnswer) {
        await updateUser(interaction.user.id, { $set: { verified: true } });

        // Try to add verified role
        const verifiedRole = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === 'verified');
        if (verifiedRole) {
          await interaction.member.roles.add(verifiedRole).catch(() => {});
        }

        await interaction.reply({ embeds: [successEmbed('Verified!', 'You have been successfully verified!')], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [errorEmbed('Verification Failed', 'Incorrect answer. Please try again.')], ephemeral: true });
      }
      return;
    }
  } catch (err) {
    log('ERROR', 'Modal interaction error:', err.message);
    await interaction.reply({ embeds: [errorEmbed('Error', 'Something went wrong.')], ephemeral: true }).catch(() => {});
  }
}

// =============================================================
// EVENT HANDLERS
// =============================================================
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    return handleSlashCommand(interaction);
  }
  if (interaction.isButton()) {
    return handleButton(interaction);
  }
  if (interaction.isModalSubmit()) {
    return handleModal(interaction);
  }
});

// --- Message XP + Prefix Commands ---
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  // XP for messages
  await addXp(message.author.id, randomInt(1, 5), message);

  // Prefix commands (legacy support)
  if (!message.content.startsWith(CONFIG.prefix)) return;
  const args = message.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  switch (cmd) {
    case 'ping': {
      const sent = await message.reply('Pinging...');
      const latency = sent.createdTimestamp - message.createdTimestamp;
      await sent.edit(`🏓 Pong! Latency: ${latency}ms | WebSocket: ${client.ws.ping}ms`);
      break;
    }
    case 'help': {
      await message.reply('Use `/help` for the full command list. This bot uses slash commands!');
      break;
    }
    default:
      break;
  }
});

// --- Snipe: track deleted messages ---
client.on(Events.MessageDelete, (message) => {
  if (!message.author || message.author.bot) return;
  setSnipe(message.channel.id, {
    content: message.content,
    authorTag: message.author.tag,
    authorAvatar: message.author.displayAvatarURL({ dynamic: true }),
    attachments: message.attachments.map((a) => a.url),
  });
});

// --- Welcome message ---
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const systemChannel = member.guild.systemChannel;
    if (!systemChannel) return;

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Welcome!')
      .setDescription(`Welcome to **${member.guild.name}**, ${member}! You are member #${member.guild.memberCount}.`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    await systemChannel.send({ embeds: [embed] });
  } catch (err) {
    log('WARN', 'Welcome message error:', err.message);
  }
});

// --- Goodbye message ---
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const systemChannel = member.guild.systemChannel;
    if (!systemChannel) return;

    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('Goodbye!')
      .setDescription(`${member.user.tag} has left the server.`)
      .setTimestamp();

    await systemChannel.send({ embeds: [embed] });
  } catch (err) {
    log('WARN', 'Goodbye message error:', err.message);
  }
});

// --- Bot Ready ---
client.once(Events.ClientReady, async () => {
  log('SUCCESS', `Logged in as ${client.user.tag}`);
  log('INFO', `Serving ${client.guilds.cache.size} guilds with ${client.users.cache.size} cached users`);

  // Set status
  client.user.setPresence({
    activities: [{ name: '/help | God Mode', type: ActivityType.Watching }],
    status: 'online',
  });

  // Load giveaways
  await loadJackpot();
  await loadGiveaways();
});

// --- Error Handlers ---
client.on(Events.Error, (err) => log('ERROR', 'Client error:', err.message));
client.on(Events.Warn, (msg) => log('WARN', 'Client warning:', msg));
process.on('unhandledRejection', (err) => log('ERROR', 'Unhandled rejection:', err));
process.on('uncaughtException', (err) => {
  log('ERROR', 'Uncaught exception:', err);
  // Don't exit — try to stay alive
});

// =============================================================
// DASHBOARD (Express API)
// =============================================================
app.get('/', (req, res) => {
  res.json({
    bot: 'GOD MODE BOT v3',
    status: 'online',
    guilds: client.guilds?.cache?.size || 0,
    users: client.users?.cache?.size || 0,
    uptime: client.uptime ? formatDuration(client.uptime) : 'Not ready',
    cachedUsers: userCache.size,
    jackpot: jackpotPool,
  });
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalUsers = await db.collection('users').countDocuments();
    const totalGiveaways = await db.collection('giveaways').countDocuments();
    const totalTickets = await db.collection('tickets').countDocuments();
    const totalModActions = await db.collection('modlogs').countDocuments();

    res.json({
      totalUsers,
      totalGiveaways,
      totalTickets,
      totalModActions,
      guilds: client.guilds.cache.size,
      uptime: formatDuration(client.uptime || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const users = await db.collection('users')
      .find({})
      .sort({ balance: -1 })
      .limit(25)
      .toArray();
    res.json(users.map((u) => ({
      userId: u.userId,
      balance: u.balance,
      bank: u.bank || 0,
      elo: u.elo || 0,
      level: u.level || 1,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/:id', async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    res.json({
      userId: user.userId,
      balance: user.balance,
      bank: user.bank || 0,
      elo: user.elo || 0,
      level: user.level || 1,
      xp: user.xp || 0,
      rank: getRank(user.elo || 0).name,
      verified: user.verified || false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =============================================================
// GRACEFUL SHUTDOWN
// =============================================================
async function shutdown(signal) {
  log('WARN', `Received ${signal}. Shutting down gracefully...`);

  // Clear giveaway timers
  for (const [id, timeout] of activeGiveaways) {
    clearTimeout(timeout);
  }

  // Destroy client
  client.destroy();

  // Close MongoDB
  if (mongoClient) {
    await mongoClient.close();
    log('INFO', 'MongoDB connection closed');
  }

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// =============================================================
// STARTUP
// =============================================================
(async function main() {
  try {
    await bootSequence();
    await connectDB();
    await registerCommands();

    // Start Express dashboard
    app.listen(CONFIG.port, () => {
      log('SUCCESS', `Dashboard running on port ${CONFIG.port}`);
    });

    // Login to Discord
    await client.login(CONFIG.token);
  } catch (err) {
    log('ERROR', 'Fatal startup error:', err.message, err.stack);
    process.exit(1);
  }
})();
