'use strict';
// =============================================================
// API SERVER v8 — INFINITY EDITION
// Express + WebSocket + JWT + Full Admin Dashboard API
// =============================================================

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const helmet     = require('helmet');
const http       = require('http');
const WebSocket  = require('ws');
const crypto     = require('crypto');

const {
  CONFIG, db, log, logBuffer, client, userCache,
  getUser, updateUser, addBalance, getJackpot, resetJackpot,
  getRankFromElo, isCommandDisabled, setCommandEnabled,
  assignAutoRoleToAll, trackEvent, RANKS, ObjectId,
} = require('./main');

const DASHBOARD_HTML = require('./dashboard');

// =============================================================
// APP SETUP
// =============================================================
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc:     ["'self'", 'data:', 'cdn.discordapp.com', '*.discordapp.com'],
    },
  },
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : ['*'];
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS blocked'));
  },
  methods: ['GET', 'POST', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '2mb' }));

let apiRequests = 0;
const startTime = Date.now();
app.use((req, res, next) => { apiRequests++; res.setHeader('X-Powered-By', 'GOD MODE BOT v8'); next(); });

// =============================================================
// RATE LIMITERS
// =============================================================
const apiLimiter = rateLimit({ windowMs: 60000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' }, skip: (req) => req.path === '/health' });
const authLimiter = rateLimit({ windowMs: 15 * 60000, max: 10, message: { error: 'Too many login attempts. Try again in 15 minutes.' } });
const strictLimiter = rateLimit({ windowMs: 60000, max: 20, message: { error: 'Too many admin requests.' } });

app.use('/api', apiLimiter);
app.use('/api/admin', strictLimiter);

// =============================================================
// WEBSOCKET — LIVE UPDATES
// =============================================================
const wsClients = new Map();

function broadcast(event, data, authOnly = false) {
  const msg = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const [ws, meta] of wsClients.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (authOnly && !meta.isAuthed) continue;
    ws.send(msg, err => { if (err) wsClients.delete(ws); });
  }
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  wsClients.set(ws, { ip, connectedAt: Date.now(), isAuthed: false });
  log('API', `WS connected from ${ip} (${wsClients.size} total)`);
  ws.send(JSON.stringify({ event: 'connected', data: { message: 'GOD MODE BOT v8 Live Feed', clients: wsClients.size }, timestamp: Date.now() }));

  ws.on('message', raw => {
    try {
      const { type, token } = JSON.parse(raw);
      if (type === 'auth' && token) {
        const decoded = jwt.verify(token, CONFIG.jwtSecret);
        if (decoded.isOwner) {
          const meta = wsClients.get(ws);
          if (meta) { meta.isAuthed = true; wsClients.set(ws, meta); }
          ws.send(JSON.stringify({ event: 'auth_ok', data: {}, timestamp: Date.now() }));
        }
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => { wsClients.delete(ws); log('API', `WS disconnected (${wsClients.size} remaining)`); });
  ws.on('error', err => { log('WARN', `WS error: ${err.message}`); wsClients.delete(ws); });
});

let liveInterval = null;
function startLiveBroadcast() {
  if (liveInterval) clearInterval(liveInterval);
  liveInterval = setInterval(async () => {
    if (!wsClients.size) return;
    try {
      const [userCount, jackpot] = await Promise.all([
        db.collection('users').countDocuments(), getJackpot(),
      ]);
      broadcast('stats_update', {
        users: userCount, jackpot, uptime: Math.floor((Date.now() - startTime) / 1000),
        cacheSize: userCache?.size || 0, guilds: client.guilds.cache.size,
        members: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
        requests: apiRequests, wsClients: wsClients.size,
      });
    } catch { /* db may be initializing */ }
  }, 5000);
}

// =============================================================
// HELPERS
// =============================================================
function sendError(res, status, message, details) {
  const body = { error: message, status };
  if (details && process.env.NODE_ENV !== 'production') body.details = details;
  return res.status(status).json(body);
}

function isValidUserId(id) { return typeof id === 'string' && /^\d{17,20}$/.test(id); }

function parseIntBounded(val, def, min, max) {
  const n = parseInt(val);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return sendError(res, 401, 'Authorization header missing or malformed.');
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, CONFIG.jwtSecret);
    if (!decoded.isOwner) return sendError(res, 403, 'Insufficient privileges.');
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return sendError(res, 401, 'Token expired.');
    return sendError(res, 401, 'Invalid token.');
  }
}

const asyncRoute = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(err => {
    log('ERROR', `API route error [${req.method} ${req.path}]: ${err.message}`);
    return sendError(res, 500, 'Internal server error.', err.message);
  });

// =============================================================
// DASHBOARD + HEALTH
// =============================================================
app.get('/',       (req, res) => res.send(DASHBOARD_HTML));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// =============================================================
// PUBLIC API
// =============================================================
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', version: '8.0.0', uptime: Math.floor((Date.now() - startTime) / 1000), requests: apiRequests, guilds: client.guilds.cache.size, members: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0) });
});

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const [totalUsers, totalSubs, pending, jackpot, totalBets, totalGiveaways] = await Promise.all([
    db.collection('users').countDocuments(),
    db.collection('submissions').countDocuments(),
    db.collection('submissions').countDocuments({ reviewed: false }),
    getJackpot(),
    db.collection('command_logs').countDocuments({ command: { $in: ['coinflip','slots','roulette','blackjack','dice','allin'] } }),
    db.collection('giveaways').countDocuments(),
  ]);
  res.json({ totalUsers, totalSubmissions: totalSubs, pendingReviews: pending, jackpot, totalBets, totalGiveaways, uptime: Math.floor((Date.now() - startTime) / 1000), cacheSize: userCache?.size || 0, guilds: client.guilds.cache.size, members: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0), channels: client.channels.cache.size, requests: apiRequests, wsClients: wsClients.size });
}));

app.get('/api/leaderboard', asyncRoute(async (req, res) => {
  const page = parseIntBounded(req.query.page, 1, 1, 1000);
  const limit = parseIntBounded(req.query.limit, 10, 1, 50);
  const validSorts = ['elo', 'balance', 'level', 'totalWagered', 'totalWon', 'submissions', 'wins'];
  const sort = validSorts.includes(req.query.sortBy) ? req.query.sortBy : 'elo';
  const top = await db.collection('users').find({ [sort]: { $gt: 0 } }).sort({ [sort]: -1 }).skip((page - 1) * limit).limit(limit).toArray();
  const total = await db.collection('users').countDocuments({ [sort]: { $gt: 0 } });
  res.json({ data: top.map((u, i) => ({ position: (page - 1) * limit + i + 1, userId: u.userId, elo: u.elo, rank: u.rank, level: u.level, balance: u.balance, submissions: u.submissions || 0, wins: u.wins || 0, losses: u.losses || 0, totalWagered: u.totalWagered || 0, totalWon: u.totalWon || 0, premium: u.premium || false })), pagination: { page, limit, total, pages: Math.ceil(total / limit) }, sortBy: sort });
}));

app.get('/api/user/:userId', asyncRoute(async (req, res) => {
  if (!isValidUserId(req.params.userId)) return sendError(res, 400, 'Invalid userId.');
  const user = await getUser(req.params.userId);
  const { warns: _w, betHistory: _b, ...publicUser } = user;
  res.json(publicUser);
}));

app.get('/api/submissions', asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.reviewed === 'true') filter.reviewed = true;
  if (req.query.reviewed === 'false') filter.reviewed = false;
  if (req.query.userId) filter.userId = req.query.userId;
  const limit = parseIntBounded(req.query.limit, 50, 1, 100);
  const skip = parseIntBounded(req.query.skip, 0, 0, 100000);
  const [subs, total] = await Promise.all([
    db.collection('submissions').find(filter).sort({ submittedAt: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('submissions').countDocuments(filter),
  ]);
  res.json({ data: subs, total });
}));

app.get('/api/giveaways', asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.ended === 'true') filter.ended = true;
  if (req.query.ended === 'false') filter.ended = false;
  const gws = await db.collection('giveaways').find(filter).sort({ createdAt: -1 }).limit(50).toArray();
  res.json(gws);
}));

app.get('/api/analytics', asyncRoute(async (req, res) => {
  const days = parseIntBounded(req.query.days, 7, 1, 30);
  const since = new Date(Date.now() - days * 86400000);
  const [byType, byDay] = await Promise.all([
    db.collection('analytics').aggregate([{ $match: { timestamp: { $gte: since } } }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
    db.collection('analytics').aggregate([{ $match: { timestamp: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
  ]);
  res.json({ byType, byDay, days });
}));

app.get('/api/commands/stats', asyncRoute(async (req, res) => {
  const stats = await db.collection('command_logs').aggregate([
    { $group: { _id: '$command', count: { $sum: 1 }, success: { $sum: { $cond: ['$success', 1, 0] } }, failed: { $sum: { $cond: ['$success', 0, 1] } } } },
    { $addFields: { successRate: { $cond: [{ $gt: ['$count', 0] }, { $multiply: [{ $divide: ['$success', '$count'] }, 100] }, 0] } } },
    { $sort: { count: -1 } },
  ]).toArray();
  res.json(stats);
}));

app.get('/api/commands/list', (req, res) => {
  const all = require('./main').ALL_COMMANDS;
  res.json({ all, disabled: Array.from(CONFIG.disabledCommands), enabled: all.filter(c => !CONFIG.disabledCommands.has(c)), total: all.length, disabledCount: CONFIG.disabledCommands.size });
});

app.get('/api/guilds', (req, res) => {
  const guilds = client.guilds.cache.map(g => ({
    id: g.id, name: g.name, memberCount: g.memberCount, iconURL: g.iconURL(), ownerId: g.ownerId,
    createdAt: g.createdAt, channels: g.channels.cache.size, roles: g.roles.cache.size,
    premiumTier: g.premiumTier, boosts: g.premiumSubscriptionCount || 0,
  }));
  res.json(guilds);
});

app.get('/api/audit', asyncRoute(async (req, res) => {
  const limit = parseIntBounded(req.query.limit, 50, 1, 100);
  const action = req.query.action;
  const filter = action ? { action: { $regex: action, $options: 'i' } } : {};
  const logs = await db.collection('audit').find(filter).sort({ timestamp: -1 }).limit(limit).toArray();
  res.json(logs);
}));

app.get('/api/logs', (req, res) => {
  const limit = parseIntBounded(req.query.limit, 100, 1, 500);
  const level = req.query.level?.toUpperCase();
  let logs = (logBuffer || []).slice(-1000);
  if (level) logs = logs.filter(l => l.level === level);
  res.json(logs.slice(-limit).reverse());
});

// =============================================================
// AUTH
// =============================================================
app.post('/api/admin/login', authLimiter, asyncRoute(async (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password) return sendError(res, 400, 'Missing userId or password.');
  if (!isValidUserId(userId)) return sendError(res, 400, 'Invalid userId.');
  await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
  if (!CONFIG.ownerIds.includes(userId)) { log('ADMIN', `Login rejected — not owner: ${userId}`); await trackEvent('admin_login_fail', { userId, reason: 'not_owner' }); return sendError(res, 403, 'Not authorized.'); }
  if (password !== CONFIG.adminPassword) { log('ADMIN', `Wrong password for ${userId}`); await trackEvent('admin_login_fail', { userId, reason: 'wrong_password' }); return sendError(res, 401, 'Invalid password.'); }
  const token = jwt.sign({ userId, isOwner: true, iat: Math.floor(Date.now() / 1000) }, CONFIG.jwtSecret, { expiresIn: '24h' });
  log('ADMIN', `Owner ${userId} logged in`); await trackEvent('admin_login', { userId });
  res.json({ token, userId, expiresIn: 86400 });
}));

app.post('/api/admin/verify', adminAuth, (req, res) => {
  res.json({ valid: true, user: req.admin, server: { uptime: Math.floor((Date.now() - startTime) / 1000), version: '8.0.0' } });
});

app.post('/api/admin/logout', adminAuth, asyncRoute(async (req, res) => {
  log('ADMIN', `Owner ${req.admin.userId} logged out`); await trackEvent('admin_logout', { userId: req.admin.userId });
  res.json({ success: true });
}));

// =============================================================
// ADMIN — COMMANDS
// =============================================================
app.post('/api/admin/commands/toggle', adminAuth, asyncRoute(async (req, res) => {
  const { command, enabled } = req.body;
  const all = require('./main').ALL_COMMANDS;
  if (!all.includes(command)) return sendError(res, 400, `Invalid command.`);
  setCommandEnabled(command, enabled);
  broadcast('command_toggled', { command, enabled }, true);
  log('ADMIN', `${req.admin.userId} ${enabled ? 'ENABLED' : 'DISABLED'} command: ${command}`);
  await trackEvent('command_toggle', { command, enabled, by: req.admin.userId });
  res.json({ success: true, command, enabled });
}));

app.post('/api/admin/commands/bulk-toggle', adminAuth, asyncRoute(async (req, res) => {
  const { commands, enabled } = req.body;
  const all = require('./main').ALL_COMMANDS;
  const valid = commands.filter(c => all.includes(c));
  valid.forEach(cmd => setCommandEnabled(cmd, enabled));
  broadcast('commands_bulk_toggled', { commands: valid, enabled }, true);
  log('ADMIN', `${req.admin.userId} bulk ${enabled ? 'ENABLED' : 'DISABLED'}: ${valid.join(', ')}`);
  res.json({ success: true, affected: valid.length });
}));

// =============================================================
// ADMIN — USER MANAGEMENT
// =============================================================
app.get('/api/admin/user/:userId', adminAuth, asyncRoute(async (req, res) => {
  if (!isValidUserId(req.params.userId)) return sendError(res, 400, 'Invalid userId.');
  const user = await getUser(req.params.userId);
  res.json(user);
}));

app.post('/api/admin/user/balance', adminAuth, asyncRoute(async (req, res) => {
  const { userId, amount, operation } = req.body;
  if (!isValidUserId(userId)) return sendError(res, 400, 'Invalid userId.');
  const user = await getUser(userId);
  let newBal = user.balance;
  if (operation === 'set') newBal = amount;
  else if (operation === 'add') newBal += amount;
  else newBal -= amount;
  newBal = Math.max(0, Math.floor(newBal));
  await updateUser(userId, { balance: newBal });
  broadcast('user_updated', { userId, balance: newBal }, true);
  log('ADMIN', `${req.admin.userId} balance ${operation} ${amount} -> ${userId} = ${newBal}`);
  await trackEvent('admin_balance_change', { by: req.admin.userId, userId, operation, amount, result: newBal });
  res.json({ success: true, userId, balance: newBal });
}));

app.post('/api/admin/user/elo', adminAuth, asyncRoute(async (req, res) => {
  const { userId, elo } = req.body;
  if (!isValidUserId(userId)) return sendError(res, 400, 'Invalid userId.');
  const safeElo = Math.max(0, Math.floor(elo));
  const rank = getRankFromElo(safeElo).name;
  await updateUser(userId, { elo: safeElo, rank });
  broadcast('user_updated', { userId, elo: safeElo, rank }, true);
  log('ADMIN', `${req.admin.userId} set ELO=${safeElo} for ${userId} -> ${rank}`);
  res.json({ success: true, userId, elo: safeElo, rank });
}));

app.post('/api/admin/user/premium', adminAuth, asyncRoute(async (req, res) => {
  const { userId, premium } = req.body;
  if (!isValidUserId(userId)) return sendError(res, 400, 'Invalid userId.');
  await updateUser(userId, { premium: !!premium });
  log('ADMIN', `${req.admin.userId} set premium=${premium} for ${userId}`);
  await trackEvent('admin_premium_change', { by: req.admin.userId, userId, premium });
  res.json({ success: true, userId, premium: !!premium });
}));

app.post('/api/admin/user/ban', adminAuth, asyncRoute(async (req, res) => {
  const { userId, banned, reason } = req.body;
  if (!isValidUserId(userId)) return sendError(res, 400, 'Invalid userId.');
  await updateUser(userId, { botBanned: !!banned, banReason: reason || 'No reason', bannedAt: banned ? new Date() : null, bannedBy: banned ? req.admin.userId : null });
  log('ADMIN', `${req.admin.userId} ${banned ? 'BANNED' : 'UNBANNED'} ${userId}`);
  await trackEvent('admin_bot_ban', { by: req.admin.userId, userId, banned });
  res.json({ success: true, userId, botBanned: !!banned });
}));

app.patch('/api/admin/user/:userId/level', adminAuth, asyncRoute(async (req, res) => {
  if (!isValidUserId(req.params.userId)) return sendError(res, 400, 'Invalid userId.');
  const update = {};
  if (typeof req.body.level === 'number') update.level = Math.max(1, Math.floor(req.body.level));
  if (typeof req.body.xp === 'number') update.xp = Math.max(0, Math.floor(req.body.xp));
  if (!Object.keys(update).length) return sendError(res, 400, 'Provide level or xp.');
  await updateUser(req.params.userId, update);
  log('ADMIN', `${req.admin.userId} updated level/xp for ${req.params.userId}`);
  res.json({ success: true, ...update });
}));

app.post('/api/admin/user/dm', adminAuth, asyncRoute(async (req, res) => {
  const { userId, message: msg } = req.body;
  if (!isValidUserId(userId)) return sendError(res, 400, 'Invalid userId.');
  const user = await client.users.fetch(userId);
  await user.send(msg.slice(0, 2000));
  log('ADMIN', `${req.admin.userId} DM'd ${userId}`);
  await trackEvent('admin_dm', { by: req.admin.userId, userId });
  res.json({ success: true });
}));

app.get('/api/admin/users/search', adminAuth, asyncRoute(async (req, res) => {
  const q = (req.query.q || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const limit = parseIntBounded(req.query.limit, 20, 1, 50);
  const sortBy = ['balance','elo','level'].includes(req.query.sortBy) ? req.query.sortBy : 'elo';
  const filter = q ? { userId: { $regex: q } } : {};
  const users = await db.collection('users').find(filter).sort({ [sortBy]: -1 }).limit(limit).toArray();
  res.json(users);
}));

// =============================================================
// ADMIN — MESSAGING
// =============================================================
app.post('/api/admin/broadcast', adminAuth, asyncRoute(async (req, res) => {
  const { message: msg, channelName, guildId } = req.body;
  if (!msg) return sendError(res, 400, 'message required.');
  let sent = 0, failed = 0;
  const targetGuilds = guildId ? [client.guilds.cache.get(guildId)].filter(Boolean) : [...client.guilds.cache.values()];
  for (const guild of targetGuilds) {
    const ch = guild.channels.cache.find(c => c.isTextBased() && c.name === (channelName || 'general'));
    if (ch) { const ok = await ch.send(msg.slice(0, 2000)).then(() => true).catch(() => false); ok ? sent++ : failed++; }
  }
  log('ADMIN', `${req.admin.userId} broadcast to ${sent}/${targetGuilds.length} guilds`);
  await trackEvent('admin_broadcast', { by: req.admin.userId, sent, failed });
  res.json({ success: true, sent, failed });
}));

// =============================================================
// ADMIN — JACKPOT
// =============================================================
app.post('/api/admin/jackpot/reset', adminAuth, asyncRoute(async (req, res) => {
  const old = await getJackpot();
  await resetJackpot();
  broadcast('jackpot_reset', { previous: old }, true);
  log('ADMIN', `${req.admin.userId} reset jackpot (was ${old})`);
  await trackEvent('admin_jackpot_reset', { by: req.admin.userId, previous: old });
  res.json({ success: true, previous: old });
}));

app.post('/api/admin/jackpot/set', adminAuth, asyncRoute(async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== 'number' || amount < 0) return sendError(res, 400, 'amount must be non-negative.');
  const safeAmount = Math.floor(amount);
  await db.collection('jackpot').updateOne({ id: 'main' }, { $set: { pool: safeAmount } }, { upsert: true });
  broadcast('jackpot_updated', { amount: safeAmount }, true);
  log('ADMIN', `${req.admin.userId} set jackpot to ${safeAmount}`);
  res.json({ success: true, amount: safeAmount });
}));

// =============================================================
// ADMIN — ROLES
// =============================================================
app.post('/api/admin/role/sync', adminAuth, asyncRoute(async (req, res) => {
  const { guildId } = req.body;
  if (!guildId) return sendError(res, 400, 'guildId required.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return sendError(res, 404, 'Guild not found.');
  const result = await assignAutoRoleToAll(guild);
  res.json({ success: true, guildId, ...result });
}));

// =============================================================
// ADMIN — MEMBER ACTIONS
// =============================================================
app.post('/api/admin/member/kick', adminAuth, asyncRoute(async (req, res) => {
  const { guildId, userId, reason } = req.body;
  if (!guildId || !isValidUserId(userId)) return sendError(res, 400, 'guildId and valid userId required.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return sendError(res, 404, 'Guild not found.');
  const member = await guild.members.fetch(userId);
  await member.kick(reason || 'Via dashboard');
  log('ADMIN', `${req.admin.userId} kicked ${userId} from ${guildId}`);
  await trackEvent('admin_kick', { by: req.admin.userId, userId, guildId, reason });
  res.json({ success: true });
}));

app.post('/api/admin/member/ban', adminAuth, asyncRoute(async (req, res) => {
  const { guildId, userId, reason, deleteMessageDays } = req.body;
  if (!guildId || !isValidUserId(userId)) return sendError(res, 400, 'guildId and valid userId required.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return sendError(res, 404, 'Guild not found.');
  await guild.members.ban(userId, { reason: reason || 'Via dashboard', deleteMessageSeconds: Math.min(604800, Math.max(0, (deleteMessageDays || 0) * 86400)) });
  log('ADMIN', `${req.admin.userId} banned ${userId} from ${guildId}`);
  await trackEvent('admin_ban', { by: req.admin.userId, userId, guildId, reason });
  res.json({ success: true });
}));

app.post('/api/admin/member/unban', adminAuth, asyncRoute(async (req, res) => {
  const { guildId, userId, reason } = req.body;
  if (!guildId || !isValidUserId(userId)) return sendError(res, 400, 'guildId and valid userId required.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return sendError(res, 404, 'Guild not found.');
  await guild.members.unban(userId, reason || 'Via dashboard');
  log('ADMIN', `${req.admin.userId} unbanned ${userId} from ${guildId}`);
  res.json({ success: true });
}));

app.post('/api/admin/member/timeout', adminAuth, asyncRoute(async (req, res) => {
  const { guildId, userId, minutes, reason } = req.body;
  if (!guildId || !isValidUserId(userId)) return sendError(res, 400, 'guildId and valid userId required.');
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return sendError(res, 404, 'Guild not found.');
  const member = await guild.members.fetch(userId);
  const ms = minutes ? Math.min(40320, Math.max(1, minutes)) * 60000 : null;
  await member.timeout(ms, reason || 'Via dashboard');
  log('ADMIN', `${req.admin.userId} timed out ${userId} for ${minutes}min`);
  res.json({ success: true });
}));

// =============================================================
// ADMIN — BOT PRESENCE
// =============================================================
app.post('/api/admin/presence', adminAuth, asyncRoute(async (req, res) => {
  const { status, activity, type } = req.body;
  const typeMap = { playing: 0, streaming: 1, listening: 2, watching: 3, competing: 5 };
  client.user.setPresence({
    status: status || 'online',
    activities: activity ? [{ name: activity.slice(0, 128), type: typeMap[type] ?? 0 }] : [],
  });
  log('ADMIN', `${req.admin.userId} updated bot presence`);
  res.json({ success: true });
}));

// =============================================================
// ADMIN — CONFIG
// =============================================================
app.get('/api/admin/config', adminAuth, (req, res) => {
  res.json({
    prefix: CONFIG.prefix, autoDeleteSeconds: CONFIG.autoDeleteSeconds,
    jackpotCut: CONFIG.jackpotCut, autoRoleId: CONFIG.autoRoleId,
    ownerIds: CONFIG.ownerIds, reviewChannelId: CONFIG.reviewChannelId,
    logChannelId: CONFIG.logChannelId, maxBet: CONFIG.maxBet,
    minBet: CONFIG.minBet, dailyAmount: CONFIG.dailyAmount,
    dailyStreakBonus: CONFIG.dailyStreakBonus,
    disabledCommands: Array.from(CONFIG.disabledCommands),
  });
});

app.post('/api/admin/config/update', adminAuth, asyncRoute(async (req, res) => {
  const allowed = ['prefix','autoDeleteSeconds','jackpotCut','autoRoleId','reviewChannelId','logChannelId','maxBet','minBet','dailyAmount','dailyStreakBonus'];
  const changed = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) { CONFIG[key] = req.body[key]; changed[key] = req.body[key]; }
  }
  await db.collection('settings').updateOne({ key: 'bot_config' }, { $set: { value: changed, updatedAt: new Date(), updatedBy: req.admin.userId } }, { upsert: true });
  broadcast('config_updated', changed, true);
  log('ADMIN', `${req.admin.userId} updated config: ${Object.keys(changed).join(', ')}`);
  res.json({ success: true, changed });
}));

// =============================================================
// ADMIN — DATABASE
// =============================================================
app.get('/api/admin/db/collections', adminAuth, asyncRoute(async (req, res) => {
  const collections = await db.listCollections().toArray();
  const stats = Object.fromEntries(await Promise.all(collections.map(async c => [c.name, await db.collection(c.name).countDocuments()])));
  res.json(stats);
}));

app.delete('/api/admin/db/clear/:collection', adminAuth, asyncRoute(async (req, res) => {
  const allowed = ['analytics', 'command_logs', 'audit'];
  if (!allowed.includes(req.params.collection)) return sendError(res, 403, `Not allowed. Clearable: ${allowed.join(', ')}`);
  const result = await db.collection(req.params.collection).deleteMany({});
  log('ADMIN', `${req.admin.userId} cleared ${req.params.collection} (${result.deletedCount} docs)`);
  await trackEvent('admin_db_clear', { by: req.admin.userId, collection: req.params.collection, count: result.deletedCount });
  res.json({ success: true, deleted: result.deletedCount });
}));

// =============================================================
// ADMIN — ECONOMY
// =============================================================
app.get('/api/admin/economy/top', adminAuth, asyncRoute(async (req, res) => {
  const limit = parseIntBounded(req.query.limit, 10, 1, 25);
  const [topWagered, topWon, topBalance, topLevel] = await Promise.all([
    db.collection('users').find().sort({ totalWagered: -1 }).limit(limit).toArray(),
    db.collection('users').find().sort({ totalWon: -1 }).limit(limit).toArray(),
    db.collection('users').find().sort({ balance: -1 }).limit(limit).toArray(),
    db.collection('users').find().sort({ level: -1 }).limit(limit).toArray(),
  ]);
  res.json({ topWagered, topWon, topBalance, topLevel });
}));

app.get('/api/admin/economy/stats', adminAuth, asyncRoute(async (req, res) => {
  const [balanceAgg, eloAgg] = await Promise.all([
    db.collection('users').aggregate([{ $group: { _id: null, total: { $sum: '$balance' }, average: { $avg: '$balance' }, max: { $max: '$balance' }, min: { $min: '$balance' } } }]).toArray(),
    db.collection('users').aggregate([{ $group: { _id: null, average: { $avg: '$elo' }, max: { $max: '$elo' } } }]).toArray(),
  ]);
  res.json({ balance: balanceAgg[0] || {}, elo: eloAgg[0] || {}, jackpot: await getJackpot() });
}));

// =============================================================
// ADMIN — CODES
// =============================================================
app.post('/api/admin/code/generate', adminAuth, asyncRoute(async (req, res) => {
  const count = parseIntBounded(req.body.count, 1, 1, 100);
  const type = ['premium', 'boost', 'bonus'].includes(req.body.type) ? req.body.type : 'premium';
  const codes = [];
  const docs = Array.from({ length: count }, () => {
    const code = `${type.toUpperCase().slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    codes.push(code);
    return { code, type, used: false, createdAt: new Date(), generatedBy: req.admin.userId };
  });
  await db.collection('codes').insertMany(docs);
  log('ADMIN', `${req.admin.userId} generated ${count} ${type} codes`);
  res.json({ success: true, codes, type });
}));

app.get('/api/admin/codes', adminAuth, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.used === 'true') filter.used = true;
  if (req.query.used === 'false') filter.used = false;
  if (req.query.type) filter.type = req.query.type;
  const codes = await db.collection('codes').find(filter).sort({ createdAt: -1 }).limit(100).toArray();
  res.json(codes);
}));

app.delete('/api/admin/code/:code', adminAuth, asyncRoute(async (req, res) => {
  const result = await db.collection('codes').deleteOne({ code: req.params.code });
  if (result.deletedCount === 0) return sendError(res, 404, 'Code not found.');
  res.json({ success: true });
}));

// =============================================================
// ADMIN — RANKS
// =============================================================
app.post('/api/admin/ranks/recalc', adminAuth, asyncRoute(async (req, res) => {
  const users = await db.collection('users').find({}, { projection: { userId: 1, elo: 1, rank: 1 } }).toArray();
  let updated = 0;
  const bulkOps = [];
  for (const u of users) {
    const correctRank = getRankFromElo(u.elo || 0).name;
    if (correctRank !== u.rank) { bulkOps.push({ updateOne: { filter: { userId: u.userId }, update: { $set: { rank: correctRank } } } }); updated++; }
  }
  if (bulkOps.length > 0) await db.collection('users').bulkWrite(bulkOps, { ordered: false });
  log('ADMIN', `${req.admin.userId} recalculated ranks: ${updated}/${users.length} updated`);
  res.json({ success: true, updated, total: users.length });
}));

// =============================================================
// ADMIN — SUBMISSIONS
// =============================================================
app.get('/api/admin/submissions/pending', adminAuth, asyncRoute(async (req, res) => {
  const limit = parseIntBounded(req.query.limit, 20, 1, 100);
  const subs = await db.collection('submissions').find({ reviewed: false }).sort({ submittedAt: 1 }).limit(limit).toArray();
  res.json({ data: subs, count: subs.length });
}));

app.post('/api/admin/submissions/:id/review', adminAuth, asyncRoute(async (req, res) => {
  const { action, note } = req.body;
  if (!['approve', 'reject'].includes(action)) return sendError(res, 400, 'action must be approve or reject.');
  let oid;
  try { oid = new ObjectId(req.params.id); } catch { return sendError(res, 400, 'Invalid submission ID.'); }
  const sub = await db.collection('submissions').findOneAndUpdate(
    { _id: oid, reviewed: false },
    { $set: { reviewed: true, status: action === 'approve' ? 'approved' : 'rejected', reviewedBy: req.admin.userId, reviewedAt: new Date(), reviewNote: note || '' } },
    { returnDocument: 'before' }
  );
  if (!sub.value) return sendError(res, 404, 'Submission not found or already reviewed.');
  broadcast('submission_reviewed', { subId: req.params.id, action }, true);
  res.json({ success: true, action });
}));

// =============================================================
// ADMIN — SYSTEM
// =============================================================
app.get('/api/admin/system/info', adminAuth, (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    node: process.version, platform: process.platform, arch: process.arch,
    pid: process.pid, uptime: process.uptime(),
    memory: { rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`, heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`, heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`, external: `${(mem.external / 1024 / 1024).toFixed(1)} MB` },
    bot: { guilds: client.guilds.cache.size, users: client.users.cache.size, channels: client.channels.cache.size, cacheSize: userCache?.size || 0, wsClients: wsClients.size },
    apiRequests, startTime: new Date(startTime).toISOString(),
  });
});

app.post('/api/admin/system/restart', adminAuth, asyncRoute(async (req, res) => {
  log('ADMIN', `RESTART requested by ${req.admin.userId}`);
  await trackEvent('admin_restart', { by: req.admin.userId });
  broadcast('server_restart', { in: 3 }, true);
  res.json({ success: true, message: 'Restarting in 3 seconds...' });
  setTimeout(() => process.exit(0), 3000);
}));

app.post('/api/admin/system/gc', adminAuth, (req, res) => {
  if (global.gc) { global.gc(); log('ADMIN', `${req.admin.userId} triggered GC`); res.json({ success: true }); }
  else res.json({ success: false, message: 'GC not exposed. Start node with --expose-gc.' });
});

// =============================================================
// 404 + ERROR HANDLERS
// =============================================================
app.use((req, res) => sendError(res, 404, `Route not found: ${req.method} ${req.path}`));
app.use((err, req, res, _next) => {
  log('ERROR', `Express error [${req.method} ${req.path}]: ${err.message}`);
  sendError(res, 500, 'Internal server error.', err.message);
});

// =============================================================
// EXPORT
// =============================================================
module.exports = function startApiServer() {
  server.listen(CONFIG.port, '0.0.0.0', () => {
    log('SUCCESS', `API + Dashboard  ->  http://localhost:${CONFIG.port}`);
    log('SUCCESS', `WebSocket feed   ->  ws://localhost:${CONFIG.port}/ws`);
    log('INFO',    `Admin panel      ->  http://localhost:${CONFIG.port}/ (requires login)`);
    startLiveBroadcast();
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') { log('ERROR', `Port ${CONFIG.port} in use.`); process.exit(1); }
    log('ERROR', `Server error: ${err.message}`);
  });
  return { app, server, wss, broadcast };
};
