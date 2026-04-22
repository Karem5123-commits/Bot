'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const WebSocket = require('ws');
const {
  CONFIG, db, log, logBuffer, client, userCache,
  getUser, updateUser, getJackpot,
  isCommandDisabled, setCommandEnabled, ALL_COMMANDS,
  assignAutoRoleToAll, trackEvent,
} = require('./main');
const DASHBOARD_HTML = require('./dashboard');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const apiLimiter = rateLimit({ windowMs: 60000, max: 200 });
const authLimiter = rateLimit({ windowMs: 15 * 60000, max: 10 });

app.use('/api', apiLimiter);

let apiRequests = 0;
const startTime = Date.now();
app.use((req, res, next) => { apiRequests++; next(); });

// =============================================================
// WEBSOCKET BROADCAST (LIVE UPDATES)
// =============================================================
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, timestamp: Date.now() });
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

wss.on('connection', ws => {
  log('API', 'WebSocket client connected');
  ws.send(JSON.stringify({ event: 'connected', data: { msg: 'Welcome to GOD MODE live feed' } }));
});

// Live broadcast every 5s
setInterval(async () => {
  try {
    const stats = {
      users: await db.collection('users').countDocuments(),
      jackpot: await getJackpot(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      cacheSize: userCache.size,
      guilds: client.guilds.cache.size,
      members: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
    };
    broadcast('stats_update', stats);
  } catch (e) {}
}, 5000);

// =============================================================
// AUTH MIDDLEWARE
// =============================================================
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, CONFIG.jwtSecret);
    if (!decoded.isOwner) return res.status(403).json({ error: 'Not owner' });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// =============================================================
// DASHBOARD
// =============================================================
app.get('/', (req, res) => res.send(DASHBOARD_HTML));

// =============================================================
// ADMIN AUTH
// =============================================================
app.post('/api/admin/login', authLimiter, async (req, res) => {
  const { userId, password } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'Missing credentials' });
  if (!CONFIG.ownerIds.includes(userId)) {
    log('ADMIN', `❌ Login attempt from non-owner: ${userId}`);
    return res.status(403).json({ error: 'Not authorized (not an owner)' });
  }
  if (password !== CONFIG.adminPassword) {
    log('ADMIN', `❌ Wrong password for ${userId}`);
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = jwt.sign({ userId, isOwner: true }, CONFIG.jwtSecret, { expiresIn: '24h' });
  log('ADMIN', `✅ Owner ${userId} logged in`);
  await trackEvent('admin_login', { userId });
  res.json({ token, userId, expiresIn: 86400 });
});

app.post('/api/admin/verify', adminAuth, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// =============================================================
// PUBLIC API
// =============================================================
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    requests: apiRequests,
    version: '4.0.0',
  });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const [totalUsers, totalSubs, pending, jackpot, totalBets] = await Promise.all([
      db.collection('users').countDocuments(),
      db.collection('submissions').countDocuments(),
      db.collection('submissions').countDocuments({ reviewed: false }),
      getJackpot(),
      db.collection('command_logs').countDocuments({ command: { $in: ['coinflip','slots','roulette','blackjack','dice','spin','allin','bet'] } }),
    ]);
    res.json({
      totalUsers, totalSubmissions: totalSubs, pendingReviews: pending,
      jackpot, totalBets,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      cacheSize: userCache.size,
      guilds: client.guilds.cache.size,
      members: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
      channels: client.channels.cache.size,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const sortBy = req.query.sortBy || 'elo';
    const validSorts = ['elo','balance','level','totalWagered','totalWon','submissions'];
    const sort = validSorts.includes(sortBy) ? sortBy : 'elo';
    const top = await db.collection('users').find({ [sort]: { $gt: 0 } })
      .sort({ [sort]: -1 }).skip((page-1)*limit).limit(limit).toArray();
    res.json(top.map(u => ({
      userId: u.userId, elo: u.elo, rank: u.rank, level: u.level,
      balance: u.balance, submissions: u.submissions,
      totalWagered: u.totalWagered || 0, totalWon: u.totalWon || 0,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/user/:userId', async (req, res) => {
  try {
    const user = await getUser(req.params.userId);
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/submissions', async (req, res) => {
  try {
    const filter = {};
    if (req.query.reviewed === 'true') filter.reviewed = true;
    if (req.query.reviewed === 'false') filter.reviewed = false;
    if (req.query.userId) filter.userId = req.query.userId;
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const subs = await db.collection('submissions').find(filter).sort({ submittedAt: -1 }).limit(limit).toArray();
    res.json(subs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/giveaways', async (req, res) => {
  try {
    const filter = {};
    if (req.query.ended === 'true') filter.ended = true;
    if (req.query.ended === 'false') filter.ended = false;
    const gws = await db.collection('giveaways').find(filter).sort({ createdAt: -1 }).limit(50).toArray();
    res.json(gws);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const days = Math.min(30, parseInt(req.query.days) || 7);
    const since = new Date(Date.now() - days * 86400000);
    const events = await db.collection('analytics').aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();
    res.json(events);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/commands/stats', async (req, res) => {
  try {
    const stats = await db.collection('command_logs').aggregate([
      { $group: { _id: '$command', count: { $sum: 1 }, success: { $sum: { $cond: ['$success', 1, 0] } } } },
      { $sort: { count: -1 } },
    ]).toArray();
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/commands/list', (req, res) => {
  res.json({
    all: ALL_COMMANDS,
    disabled: Array.from(CONFIG.disabledCommands),
    enabled: ALL_COMMANDS.filter(c => !CONFIG.disabledCommands.has(c)),
  });
});

app.get('/api/guilds', (req, res) => {
  const guilds = client.guilds.cache.map(g => ({
    id: g.id, name: g.name, memberCount: g.memberCount,
    iconURL: g.iconURL(), ownerId: g.ownerId,
    createdAt: g.createdAt, channels: g.channels.cache.size,
    roles: g.roles.cache.size,
  }));
  res.json(guilds);
});

app.get('/api/audit', async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const logs = await db.collection('audit').find().sort({ timestamp: -1 }).limit(limit).toArray();
    res.json(logs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/logs', (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  res.json(logBuffer.slice(-limit).reverse());
});

// =============================================================
// ADMIN-ONLY ROUTES
// =============================================================

// Toggle command
app.post('/api/admin/commands/toggle', adminAuth, async (req, res) => {
  const { command, enabled } = req.body;
  if (!ALL_COMMANDS.includes(command)) return res.status(400).json({ error: 'Invalid command' });
  await setCommandEnabled(command, enabled);
  broadcast('command_toggled', { command, enabled });
  res.json({ success: true, command, enabled });
});

// Bulk toggle
app.post('/api/admin/commands/bulk-toggle', adminAuth, async (req, res) => {
  const { commands, enabled } = req.body;
  if (!Array.isArray(commands)) return res.status(400).json({ error: 'commands must be array' });
  for (const cmd of commands) {
    if (ALL_COMMANDS.includes(cmd)) await setCommandEnabled(cmd, enabled);
  }
  broadcast('commands_bulk_toggled', { commands, enabled });
  res.json({ success: true, affected: commands.length });
});

// Modify user balance
app.post('/api/admin/user/balance', adminAuth, async (req, res) => {
  const { userId, amount, operation } = req.body;
  if (!userId || amount === undefined) return res.status(400).json({ error: 'Missing params' });
  const user = await getUser(userId);
  let newBal = user.balance;
  if (operation === 'set') newBal = amount;
  else if (operation === 'add') newBal += amount;
  else if (operation === 'subtract') newBal -= amount;
  newBal = Math.max(0, newBal);
  await updateUser(userId, { balance: newBal });
  broadcast('user_updated', { userId, balance: newBal });
  log('ADMIN', `💰 Balance ${operation} ${amount} on ${userId} -> ${newBal}`);
  res.json({ success: true, userId, balance: newBal });
});

// Modify user ELO
app.post('/api/admin/user/elo', adminAuth, async (req, res) => {
  const { userId, elo } = req.body;
  await updateUser(userId, { elo: Math.max(0, elo) });
  broadcast('user_updated', { userId, elo });
  log('ADMIN', `📊 ELO set to ${elo} on ${userId}`);
  res.json({ success: true, userId, elo });
});

// Grant premium
app.post('/api/admin/user/premium', adminAuth, async (req, res) => {
  const { userId, premium } = req.body;
  await updateUser(userId, { premium: !!premium });
  log('ADMIN', `💎 Premium=${premium} on ${userId}`);
  res.json({ success: true });
});

// Ban user from bot
app.post('/api/admin/user/ban', adminAuth, async (req, res) => {
  const { userId, banned } = req.body;
  await updateUser(userId, { botBanned: !!banned });
  log('ADMIN', `🔨 Bot-banned=${banned} for ${userId}`);
  res.json({ success: true });
});

// Send DM to user
app.post('/api/admin/user/dm', adminAuth, async (req, res) => {
  const { userId, message } = req.body;
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Broadcast to all guilds
app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  const { message, channelName } = req.body;
  let sent = 0;
  for (const guild of client.guilds.cache.values()) {
    const ch = guild.channels.cache.find(c => c.name === (channelName || 'general') && c.isTextBased());
    if (ch) { await ch.send(message).catch(() => {}); sent++; }
  }
  log('ADMIN', `📢 Broadcast to ${sent} guilds`);
  res.json({ success: true, sent });
});

// Reset jackpot
app.post('/api/admin/jackpot/reset', adminAuth, async (req, res) => {
  await db.collection('jackpot').updateOne({ id: 'main' }, { $set: { pool: 0 } }, { upsert: true });
  broadcast('jackpot_reset', {});
  res.json({ success: true });
});

// Set jackpot
app.post('/api/admin/jackpot/set', adminAuth, async (req, res) => {
  const { amount } = req.body;
  await db.collection('jackpot').updateOne({ id: 'main' }, { $set: { pool: amount } }, { upsert: true });
  broadcast('jackpot_updated', { amount });
  res.json({ success: true, amount });
});

// Force re-sync auto-role
app.post('/api/admin/role/sync', adminAuth, async (req, res) => {
  const { guildId } = req.body;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  const result = await assignAutoRoleToAll(guild);
  res.json({ success: true, ...result });
});

// Kick/ban user via API
app.post('/api/admin/member/kick', adminAuth, async (req, res) => {
  const { guildId, userId, reason } = req.body;
  try {
    const guild = client.guilds.cache.get(guildId);
    const member = await guild.members.fetch(userId);
    await member.kick(reason || 'Via dashboard');
    log('ADMIN', `👢 Kicked ${userId} via API`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/member/ban', adminAuth, async (req, res) => {
  const { guildId, userId, reason } = req.body;
  try {
    const guild = client.guilds.cache.get(guildId);
    await guild.members.ban(userId, { reason: reason || 'Via dashboard' });
    log('ADMIN', `🔨 Banned ${userId} via API`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Change bot presence
app.post('/api/admin/presence', adminAuth, (req, res) => {
  const { status, activity, type } = req.body;
  const types = { playing: 0, streaming: 1, listening: 2, watching: 3, competing: 5 };
  client.user.setPresence({
    status: status || 'online',
    activities: activity ? [{ name: activity, type: types[type] ?? 0 }] : [],
  });
  log('ADMIN', `🎮 Presence updated`);
  res.json({ success: true });
});

// Config viewer/updater
app.get('/api/admin/config', adminAuth, (req, res) => {
  res.json({
    prefix: CONFIG.prefix,
    autoDeleteSeconds: CONFIG.autoDeleteSeconds,
    jackpotCut: CONFIG.jackpotCut,
    autoRoleId: CONFIG.autoRoleId,
    ownerIds: CONFIG.ownerIds,
    reviewChannelId: CONFIG.reviewChannelId,
    logChannelId: CONFIG.logChannelId,
    disabledCommands: Array.from(CONFIG.disabledCommands),
    rankRoles: CONFIG.rankRoles,
  });
});

app.post('/api/admin/config/update', adminAuth, (req, res) => {
  const allowed = ['prefix', 'autoDeleteSeconds', 'jackpotCut', 'autoRoleId'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) CONFIG[key] = req.body[key];
  }
  log('ADMIN', `⚙️ Config updated`);
  res.json({ success: true, config: CONFIG });
});

// Database ops
app.get('/api/admin/db/collections', adminAuth, async (req, res) => {
  const collections = await db.listCollections().toArray();
  const stats = {};
  for (const c of collections) {
    stats[c.name] = await db.collection(c.name).countDocuments();
  }
  res.json(stats);
});

app.delete('/api/admin/db/clear/:collection', adminAuth, async (req, res) => {
  const allowed = ['analytics', 'command_logs', 'audit'];
  if (!allowed.includes(req.params.collection)) return res.status(403).json({ error: 'Not allowed' });
  const result = await db.collection(req.params.collection).deleteMany({});
  log('ADMIN', `🗑️ Cleared ${req.params.collection}: ${result.deletedCount} docs`);
  res.json({ success: true, deleted: result.deletedCount });
});

// System commands
app.post('/api/admin/system/restart', adminAuth, (req, res) => {
  log('ADMIN', '🔄 RESTART REQUESTED');
  res.json({ success: true, message: 'Restarting in 3s...' });
  setTimeout(() => process.exit(0), 3000);
});

app.get('/api/admin/system/info', adminAuth, (req, res) => {
  res.json({
    node: process.version,
    platform: process.platform,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    pid: process.pid,
    cacheSize: userCache.size,
  });
});

// Search users
app.get('/api/admin/users/search', adminAuth, async (req, res) => {
  const q = req.query.q || '';
  const users = await db.collection('users')
    .find({ userId: { $regex: q } })
    .limit(50).toArray();
  res.json(users);
});

// Top spenders/earners
app.get('/api/admin/economy/top', adminAuth, async (req, res) => {
  const [topWagered, topWon, topBalance] = await Promise.all([
    db.collection('users').find().sort({ totalWagered: -1 }).limit(10).toArray(),
    db.collection('users').find().sort({ totalWon: -1 }).limit(10).toArray(),
    db.collection('users').find().sort({ balance: -1 }).limit(10).toArray(),
  ]);
  res.json({ topWagered, topWon, topBalance });
});

// Generate premium code
app.post('/api/admin/code/generate', adminAuth, async (req, res) => {
  const count = Math.min(100, parseInt(req.body.count) || 1);
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = 'PREM-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    codes.push(code);
    await db.collection('codes').insertOne({ code, used: false, createdAt: new Date(), generatedBy: req.user.userId });
  }
  res.json({ success: true, codes });
});

app.get('/api/admin/codes', adminAuth, async (req, res) => {
  const codes = await db.collection('codes').find().sort({ createdAt: -1 }).limit(100).toArray();
  res.json(codes);
});

// Force rank recalculation
app.post('/api/admin/ranks/recalc', adminAuth, async (req, res) => {
  const users = await db.collection('users').find().toArray();
  let updated = 0;
  const { getRankFromElo } = require('./main');
  for (const u of users) {
    const rank = getRankFromElo(u.elo).name;
    if (rank !== u.rank) {
      await updateUser(u.userId, { rank });
      updated++;
    }
  }
  res.json({ success: true, updated, total: users.length });
});

// =============================================================
// START
// =============================================================
module.exports = function startApiServer() {
  server.listen(CONFIG.port, () => {
    log('SUCCESS', `🌐 API + Dashboard at http://localhost:${CONFIG.port}`);
    log('SUCCESS', `🔌 WebSocket at ws://localhost:${CONFIG.port}/ws`);
  });
};
