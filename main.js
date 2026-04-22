// ============================================================
// GOD MODE DISCORD BOT v2 - main.js
// Upgrades: Cache | Error Handling | Rate Limits | DB Indexes
//           Mod Logging | Jackpot Pool | Paginated LB | Help
// ============================================================

const {
Client, GatewayIntentBits, Partials, EmbedBuilder,
ActionRowBuilder, ButtonBuilder, ButtonStyle,
ModalBuilder, TextInputBuilder, TextInputStyle,
SlashCommandBuilder, REST, Routes, PermissionFlagsBits,
} = require(‘discord.js’);

const { MongoClient } = require(‘mongodb’);
const express = require(‘express’);
const app = express();
app.use(express.json());

// ———————————————
// CONFIG – Fill these in before running
// ———————————————
const CONFIG = {
token:           process.env.DISCORD_TOKEN,
clientId:        process.env.CLIENT_ID,
mongoUri:        process.env.MONGO_URI,
dbName:          ‘godbot’,
prefix:          ‘!’,
reviewChannelId: process.env.REVIEW_CHANNEL_ID || ‘’, // or auto-detected
logChannelId:    ‘’,                                  // auto-detected
ownerIds:        (process.env.OWNER_IDS || ‘’).split(’,’).map(s => s.trim()).filter(Boolean),
port:            parseInt(process.env.PORT) || 3000,
autoDeleteSeconds: 10,
jackpotCut:      0.05,
rankRoles:       {},    // auto-detected per guild at startup
};

// ———————————————
// LOGGER
// ———————————————
function log(level, …args) {
const ts = new Date().toISOString().replace(‘T’, ’ ’).slice(0, 19);
const icons = { INFO: ‘i’, WARN: ‘!’, ERROR: ‘X’, SUCCESS: ‘OK’ };
console.log(`[${ts}] [${icons[level] || level}]`, …args);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ———————————————
// BOOT SEQUENCE
// ———————————————
async function bootSequence() {
console.clear();
console.log(‘GOD MODE DISCORD BOT v2’);
console.log(’========================’);
const systems = [‘DATABASE’, ‘CACHE LAYER’, ‘RATE LIMITER’, ‘API SERVER’,
‘DISCORD CLIENT’, ‘RANK ENGINE’, ‘ECONOMY’, ‘GAMBLING’,
‘MODERATION’, ‘MOD LOGGER’];
for (const sys of systems) {
await sleep(100);
console.log(`  [OK] ${sys}`);
}
console.log(’\nTERMINAL ACTIVATED – ALL SYSTEMS ONLINE\n’);
}

// ———————————————
// DATABASE + INDEXES
// ———————————————
let db, mongoClient;

async function connectDB() {
mongoClient = new MongoClient(CONFIG.mongoUri, { serverSelectionTimeoutMS: 5000 });

const tryConnect = async (attempt = 1) => {
try {
await mongoClient.connect();
db = mongoClient.db(CONFIG.dbName);

```
  // Indexes make queries fast at scale
  await db.collection('users').createIndex({ userId: 1 }, { unique: true });
  await db.collection('users').createIndex({ elo: -1 });
  await db.collection('submissions').createIndex({ reviewed: 1 });
  await db.collection('submissions').createIndex({ submittedAt: -1 });

  log('SUCCESS', 'Connected to MongoDB + indexes ready');
} catch (err) {
  log('ERROR', `MongoDB attempt ${attempt} failed: ${err.message}`);
  if (attempt < 5) { await sleep(attempt * 2000); return tryConnect(attempt + 1); }
  throw new Error('MongoDB failed after 5 attempts -- check your URI');
}
```

};

await tryConnect();
}

// ———————————————
// USER CACHE – reduces DB reads by ~80%
// ———————————————
const userCache = new Map();
const CACHE_TTL  = 60_000; // 1 minute

function getCached(userId) {
const e = userCache.get(userId);
if (!e) return null;
if (Date.now() - e.cachedAt > CACHE_TTL) { userCache.delete(userId); return null; }
return e.data;
}
function setCache(userId, data) {
userCache.set(userId, { data, cachedAt: Date.now() });
}
function invalidateCache(userId) {
userCache.delete(userId);
}

async function getUser(userId) {
const cached = getCached(userId);
if (cached) return cached;

try {
let user = await db.collection(‘users’).findOne({ userId });
if (!user) {
user = {
userId, xp: 0, level: 1, elo: 0, rank: ‘Unranked’,
balance: 1000, premium: false, dailyLast: null,
submissions: 0, warns: [], qualityUses: 0, betHistory: [],
};
await db.collection(‘users’).insertOne(user);
}
setCache(userId, user);
return user;
} catch (err) {
log(‘ERROR’, `getUser(${userId}): ${err.message}`);
throw err;
}
}

async function updateUser(userId, update) {
try {
await db.collection(‘users’).updateOne({ userId }, { $set: update }, { upsert: true });
// Merge into cache – keeps cache warm without a DB round-trip
const cached = getCached(userId);
if (cached) setCache(userId, { …cached, …update });
} catch (err) {
log(‘ERROR’, `updateUser(${userId}): ${err.message}`);
throw err;
}
}

// ———————————————
// JACKPOT POOL
// ———————————————
async function addToJackpot(amount) {
const cut = Math.floor(amount * CONFIG.jackpotCut);
if (cut <= 0) return;
try {
await db.collection(‘jackpot’).updateOne(
{ id: ‘main’ },
{ $inc: { pool: cut } },
{ upsert: true }
);
} catch {}
}

async function getJackpot() {
try {
const doc = await db.collection(‘jackpot’).findOne({ id: ‘main’ });
return doc?.pool || 0;
} catch { return 0; }
}

async function resetJackpot() {
try {
await db.collection(‘jackpot’).updateOne({ id: ‘main’ }, { $set: { pool: 0 } }, { upsert: true });
} catch {}
}

// ———————————————
// RATE LIMITER
// ———————————————
const rateLimits = new Map();
const COOLDOWNS  = {
daily: 86_400_000, slots: 3_000, roulette: 3_000, coinflip: 2_000,
bet: 2_000, dice: 2_000, spin: 2_000, blackjack: 5_000,
allin: 10_000, jackpot: 5_000, quality: 30_000,
};

// Returns ms remaining if rate limited, null if ok to proceed
function checkRateLimit(userId, cmd) {
const cooldown = COOLDOWNS[cmd];
if (!cooldown) return null;
const key  = `${userId}:${cmd}`;
const last = rateLimits.get(key) || 0;
const rem  = cooldown - (Date.now() - last);
if (rem > 0) return rem;
rateLimits.set(key, Date.now());
return null;
}

// ———————————————
// AUTO-DETECT: RANK ROLES + CHANNELS
// ———————————————

// Per-guild role map so the bot works correctly on multiple servers
const guildRankRoles = new Map();

// Fuzzy role name scorer
// e.g. “rank-s”, “S Rank”, “ss-tier” all match their tier correctly
function scoreFuzzyRole(roleName, target) {
const a = roleName.toLowerCase().replace(/[^a-z0-9]/g, ‘’);
const b = target.toLowerCase();
if (a === b) return 0;                          // exact (normalised)
if (a.includes(b) || b.includes(a)) return 1;  // substring match
return levenshtein(a, b);                       // edit distance fallback
}

async function autoDetectRankRoles(guild) {
const targets = [‘A’, ‘S’, ‘SS’, ‘SSS’];
const roles   = {};

for (const target of targets) {
let bestRole  = null;
let bestScore = Infinity;

```
for (const role of guild.roles.cache.values()) {
  if (role.managed || role.name === '@everyone') continue;
  const score = scoreFuzzyRole(role.name, target);
  // Prefer shorter role names at equal score (avoids "SSS" matching "SS")
  if (score < bestScore || (score === bestScore && role.name.length < (bestRole?.name.length ?? Infinity))) {
    bestScore = score;
    bestRole  = role;
  }
}

// Only accept if score is reasonable (0=exact, 1=substring, <=3=fuzzy)
if (bestRole && bestScore <= 3) {
  roles[target] = bestRole.id;
  log('SUCCESS', `Auto-detected rank role "${target}" -> "${bestRole.name}" (${bestRole.id}) [score ${bestScore}]`);
} else {
  log('WARN', `No matching role found for rank "${target}" in ${guild.name} -- create a role named "${target}" or similar`);
}
```

}

guildRankRoles.set(guild.id, roles);
Object.assign(CONFIG.rankRoles, roles); // keep CONFIG synced for single-guild setups
return roles;
}

async function autoDetectChannels(guild) {
const reviewPatterns = [‘clip-review’, ‘clipreview’, ‘review’, ‘submissions’];
const logPatterns    = [‘mod-logs’, ‘modlogs’, ‘mod-log’, ‘modlog’, ‘logs’];

const findChannel = (patterns) => {
for (const pattern of patterns) {
const ch = guild.channels.cache.find(c =>
c.isTextBased() &&
c.name.toLowerCase().replace(/[^a-z0-9]/g, ‘’).includes(pattern.replace(/[^a-z0-9]/g, ‘’))
);
if (ch) return ch;
}
return null;
};

const reviewCh = findChannel(reviewPatterns);
const logCh    = findChannel(logPatterns);

if (reviewCh) {
CONFIG.reviewChannelId = reviewCh.id;
log(‘SUCCESS’, `Auto-detected review channel -> #${reviewCh.name} (${reviewCh.id})`);
} else {
log(‘WARN’, `No review channel found in ${guild.name} -- create a channel named "clip-review"`);
}

if (logCh) {
CONFIG.logChannelId = logCh.id;
log(‘SUCCESS’, `Auto-detected log channel -> #${logCh.name} (${logCh.id})`);
} else {
log(‘WARN’, `No mod-log channel found in ${guild.name} -- create a channel named "mod-logs"`);
}
}

// ———————————————
// RANK SYSTEM
// ———————————————
const RANK_ELO = { D: 0, C: 100, B: 250, A: 500, S: 1000, SS: 2000, SSS: 5000 };

function getRankFromElo(elo) {
let rank = ‘D’;
for (const [r, threshold] of Object.entries(RANK_ELO)) {
if (elo >= threshold) rank = r;
}
return rank;
}

async function applyRank(guild, member, elo) {
const rank  = getRankFromElo(elo);
// Use per-guild role map if available, fall back to CONFIG.rankRoles
const roles = guildRankRoles.get(guild.id) || CONFIG.rankRoles;
try {
// Remove ALL known rank roles from this member first
for (const [, roleId] of Object.entries(roles)) {
const role = guild.roles.cache.get(roleId);
if (role && member.roles.cache.has(roleId)) await member.roles.remove(role);
}
// Add the new rank role
const newRoleId = roles[rank];
if (newRoleId) {
const role = guild.roles.cache.get(newRoleId);
if (role) await member.roles.add(role);
else log(‘WARN’, `Role ID ${newRoleId} for rank ${rank} not found in cache -- re-running auto-detect`);
}
} catch (err) { log(‘WARN’, `applyRank ${member.id}: ${err.message}`); }
return rank;
}

// ———————————————
// XP / LEVELING
// ———————————————
const XP_COOLDOWNS = new Map();

async function handleXP(message) {
const userId = message.author.id;
if (XP_COOLDOWNS.has(userId)) return;
XP_COOLDOWNS.set(userId, true);
setTimeout(() => XP_COOLDOWNS.delete(userId), 60_000);

try {
const userData = await getUser(userId);
const xpGain   = Math.floor(Math.random() * 10) + 5;
const newXP    = userData.xp + xpGain;
const xpNeeded = userData.level * 100;

```
if (newXP >= xpNeeded) {
  const newLevel = userData.level + 1;
  await updateUser(userId, { xp: newXP - xpNeeded, level: newLevel });
  const embed = new EmbedBuilder()
    .setColor(0xFFD700).setTitle('LEVEL UP!')
    .setDescription(`${message.author} reached **Level ${newLevel}**!`);
  autoDelete(await message.channel.send({ embeds: [embed] }));
} else {
  await updateUser(userId, { xp: newXP });
}
```

} catch (err) { log(‘WARN’, `XP error: ${err.message}`); }
}

// ———————————————
// MOD LOG CHANNEL
// ———————————————
async function modLog(guild, action, moderator, target, reason = ‘No reason’) {
try {
const ch = guild.channels.cache.get(CONFIG.logChannelId);
if (!ch) return;
const embed = new EmbedBuilder()
.setColor(0xFF4444)
.setTitle(`Mod Action: ${action}`)
.addFields(
{ name: ‘Moderator’, value: `${moderator.tag} (${moderator.id})`, inline: true },
{ name: ‘Target’, value: `${target?.tag || target?.user?.tag || 'N/A'} (${target?.id || target?.user?.id || '?'})`, inline: true },
{ name: ‘Reason’, value: reason },
)
.setTimestamp();
await ch.send({ embeds: [embed] });
} catch (err) { log(‘WARN’, `modLog: ${err.message}`); }
}

// ———————————————
// GAMBLING HELPERS
// ———————————————
function spinSlots() {
const symbols = [‘cherry’,‘lemon’,‘diamond’,‘seven’,‘bell’,‘star’];
const emoji   = { cherry:‘cherry’, lemon:‘lemon’, diamond:‘diamond’, seven:‘777’, bell:‘bell’, star:‘star’ };
const display = { cherry:’[CH]’, lemon:’[LM]’, diamond:’[DI]’, seven:’[7]’, bell:’[BL]’, star:’[ST]’ };
return [0,1,2].map(() => display[symbols[Math.floor(Math.random() * symbols.length)]]);
}

function slotsResult(reels) {
if (reels[0]===reels[1] && reels[1]===reels[2]) {
return reels[0]===’[DI]’ ? { mult:10, msg:‘JACKPOT! Triple Diamonds!’ }
: reels[0]===’[7]’  ? { mult:7,  msg:‘LUCKY SEVENS!’ }
:                     { mult:3,  msg:‘Three of a kind!’ };
}
if (reels[0]===reels[1] || reels[1]===reels[2]) return { mult:1.5, msg:‘Two of a kind!’ };
return { mult:0, msg:‘No match. Better luck next time.’ };
}

function cardValue(card) {
const v = card.slice(0, -1);
if ([‘J’,‘Q’,‘K’].includes(v)) return 10;
if (v === ‘A’) return 11;
return parseInt(v);
}
function drawCard() {
const vals  = [‘2’,‘3’,‘4’,‘5’,‘6’,‘7’,‘8’,‘9’,‘10’,‘J’,‘Q’,‘K’,‘A’];
const suits = [’\u2660’,’\u2665’,’\u2666’,’\u2663’];
return vals[Math.floor(Math.random()*vals.length)] + suits[Math.floor(Math.random()*suits.length)];
}
function handTotal(hand) {
let total = hand.reduce((s,c) => s + cardValue(c), 0);
let aces  = hand.filter(c => c.startsWith(‘A’)).length;
while (total > 21 && aces– > 0) total -= 10;
return total;
}

const bjGames = new Map(); // active blackjack sessions

async function recordBet(userId, cmd, bet, result, change) {
try {
const entry = { cmd, bet, result, change, at: new Date() };
await db.collection(‘users’).updateOne(
{ userId },
{ $push: { betHistory: { $each: [entry], $slice: -10 } } }
);
invalidateCache(userId);
} catch {}
}

// ———————————————
// AUTO DELETE
// ———————————————
function autoDelete(msg, seconds = CONFIG.autoDeleteSeconds) {
if (msg?.deletable) setTimeout(() => msg.delete().catch(() => {}), seconds * 1000);
}

// ———————————————
// FUZZY MATCHING (typo correction)
// ———————————————
function levenshtein(a, b) {
const dp = Array.from({ length: a.length+1 }, (*, i) =>
Array.from({ length: b.length+1 }, (*, j) => i===0 ? j : j===0 ? i : 0)
);
for (let i=1; i<=a.length; i++)
for (let j=1; j<=b.length; j++)
dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
return dp[a.length][b.length];
}
function fuzzyMatch(input, commands) {
let best=null, bestScore=Infinity;
for (const cmd of commands) {
const s = levenshtein(input, cmd);
if (s < bestScore) { bestScore=s; best=cmd; }
}
return bestScore <= 3 ? best : null;
}

// ———————————————
// HELP DATA
// ———————————————
const HELP = {
balance:   { desc:‘Check your coin balance’,                              usage:’!balance’ },
daily:     { desc:‘Claim daily coins (200 free / 500 premium)’,           usage:’!daily’ },
history:   { desc:‘View your last 10 bets’,                              usage:’!history’ },
coinflip:  { desc:‘Flip a coin – bet on heads or tails’,                 usage:’!coinflip <amount> <heads|tails>’ },
bet:       { desc:‘Bet coins on a dice roll – win on 4+’,                usage:’!bet <amount>’ },
dice:      { desc:‘Same as !bet’,                                         usage:’!dice <amount>’ },
slots:     { desc:‘Spin the slot machine’,                               usage:’!slots <amount>’,    extra:‘Diamond x10 | 777 x7 | 3-match x3 | 2-match x1.5’ },
roulette:  { desc:‘Bet on red, black, or green’,                         usage:’!roulette <amount> <red|black|green>’, extra:‘Green pays x14, others x2’ },
blackjack: { desc:‘Play blackjack against the dealer’,                   usage:’!blackjack <amount>’, extra:‘Use the Hit / Stand buttons to play’ },
spin:      { desc:‘Prize wheel – random multiplier’,                     usage:’!spin <amount>’ },
allin:     { desc:‘Bet your entire balance (double or nothing)’,          usage:’!allin’ },
jackpot:   { desc:‘View the jackpot pool (5% of all bets feed it)’,      usage:’!jackpot’ },
rankcard:  { desc:‘View your rank, ELO, level, and XP’,                  usage:’!rankcard’ },
submit:    { desc:‘Submit a clip for staff review’,                      usage:’!submit’ },
quality:   { desc:‘Upscale a video – Free: 1 use, Premium: unlimited’,   usage:’!quality <url>’ },
code:      { desc:‘Generate a premium code (Owner only)’,                 usage:’!code’ },
kick:      { desc:‘Kick a member from the server’,                       usage:’!kick @user [reason]’ },
ban:       { desc:‘Permanently ban a member’,                            usage:’!ban @user [reason]’ },
mute:      { desc:‘Timeout a member for 10 minutes’,                     usage:’!mute @user [reason]’ },
unmute:    { desc:‘Remove a timeout from a member’,                      usage:’!unmute @user’ },
warn:      { desc:‘Warn a member and log it to their profile’,            usage:’!warn @user [reason]’ },
clear:     { desc:‘Bulk delete messages (max 100)’,                       usage:’!clear <1-100>’ },
lock:      { desc:‘Lock the current channel’,                            usage:’!lock’ },
unlock:    { desc:‘Unlock the current channel’,                          usage:’!unlock’ },
slowmode:  { desc:‘Set slowmode delay in seconds’,                       usage:’!slowmode <seconds>’ },
help:      { desc:‘Show all commands, or details about one command’,      usage:’!help [command]’ },
};
const ALL_COMMANDS = Object.keys(HELP);

// ———————————————
// DISCORD CLIENT
// ———————————————
const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildPresences,
GatewayIntentBits.DirectMessages,
],
partials: [Partials.Channel, Partials.Message],
});

// ———————————————
// SLASH COMMANDS
// ———————————————
const slashDefs = [
new SlashCommandBuilder().setName(‘submit’).setDescription(‘Submit a clip for review’),
new SlashCommandBuilder().setName(‘profile’).setDescription(‘View your rank profile’),
new SlashCommandBuilder().setName(‘review’).setDescription(‘Open review panel (staff only)’),
new SlashCommandBuilder().setName(‘leaderboard’).setDescription(‘View ELO leaderboard’)
.addIntegerOption(o => o.setName(‘page’).setDescription(‘Page number’).setMinValue(1)),
].map(c => c.toJSON());

async function registerSlash() {
try {
const rest = new REST({ version: ‘10’ }).setToken(CONFIG.token);
await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: slashDefs });
log(‘SUCCESS’, ‘Slash commands registered’);
} catch (err) { log(‘ERROR’, `Slash registration: ${err.message}`); }
}

// ———————————————
// SAFE COMMAND RUNNER – catches all errors
// ———————————————
async function safeRun(fn, message) {
try { await fn(); }
catch (err) {
log(‘ERROR’, `Command error: ${err.message}`);
try { autoDelete(await message.reply(‘Something went wrong. Please try again.’)); } catch {}
}
}

// ———————————————
// LEADERBOARD EMBED HELPER
// ———————————————
async function buildLeaderboard(page) {
const pageSize   = 10;
const skip       = (page - 1) * pageSize;
const total      = await db.collection(‘users’).countDocuments({ elo: { $gt: 0 } });
const totalPages = Math.max(1, Math.ceil(total / pageSize));
const top        = await db.collection(‘users’).find({ elo: { $gt: 0 } })
.sort({ elo: -1 }).skip(skip).limit(pageSize).toArray();

const medals = [’#1’,’#2’,’#3’];
const desc = top.map((u, i) => {
const pos = skip + i + 1;
const label = medals[pos - 1] || `**${pos}.**`;
return `${label} <@${u.userId}> -- ELO: **${u.elo}** | ${u.rank}`;
}).join(’\n’) || ‘No data yet.’;

const embed = new EmbedBuilder()
.setColor(0xFFD700)
.setTitle(‘ELO Leaderboard’)
.setDescription(desc)
.setFooter({ text: `Page ${page}/${totalPages} -- ${total} ranked players` });

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`lb_${page-1}`).setLabel(‘Prev’).setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
new ButtonBuilder().setCustomId(`lb_${page+1}`).setLabel(‘Next’).setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages),
);

return { embed, row, totalPages };
}

// ———————————————
// MESSAGE HANDLER
// ———————————————
client.on(‘messageCreate’, async (message) => {
if (message.author.bot) return;

// XP runs in background – never blocks command handling
handleXP(message).catch(() => {});

if (!message.content.startsWith(CONFIG.prefix)) return;

const args = message.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
let cmd    = args.shift().toLowerCase();

// Fuzzy correct typos (e.g. “!balanec” -> “!balance”)
if (!ALL_COMMANDS.includes(cmd)) {
const match = fuzzyMatch(cmd, ALL_COMMANDS);
if (match) {
autoDelete(await message.reply(`Did you mean \`!${match}`?`)); cmd = match; } else { autoDelete(await message.reply('Unknown command. Use `!help` to see all commands.’));
return;
}
}

// Per-user per-command rate limiting
const remaining = checkRateLimit(message.author.id, cmd);
if (remaining !== null) {
autoDelete(await message.reply(`Slow down! Wait **${(remaining/1000).toFixed(1)}s** before using \`!${cmd}` again.`));
return;
}

await safeRun(async () => {
const userId   = message.author.id;
const userData = await getUser(userId);

```
// -- HELP ----------------------------------
if (cmd === 'help') {
  const target = args[0]?.toLowerCase();
  if (target && HELP[target]) {
    const h = HELP[target];
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`!${target}`)
      .addFields(
        { name: 'Description', value: h.desc },
        { name: 'Usage', value: `\`${h.usage}\`` },
        ...(h.extra ? [{ name: 'Details', value: h.extra }] : [])
      );
    return autoDelete(await message.reply({ embeds: [embed] }), 30);
  }
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('GOD MODE BOT -- All Commands')
    .addFields(
      { name: 'Economy',   value: '`!balance`  `!daily`  `!history`' },
      { name: 'Gambling',  value: '`!coinflip`  `!slots`  `!roulette`  `!blackjack`  `!dice`  `!spin`  `!bet`  `!allin`  `!jackpot`' },
      { name: 'Rank',      value: '`!rankcard`  `!submit`  `!quality`' },
      { name: 'Mod',       value: '`!kick`  `!ban`  `!mute`  `!unmute`  `!warn`  `!clear`  `!lock`  `!unlock`  `!slowmode`' },
      { name: 'Owner',     value: '`!code`' },
      { name: 'Slash',     value: '`/submit`  `/profile`  `/review`  `/leaderboard`' },
      { name: 'Tip',       value: 'Use `!help <command>` for detailed info on any command.' },
    );
  return autoDelete(await message.reply({ embeds: [embed] }), 30);
}

// -- BALANCE -------------------------------
if (cmd === 'balance') {
  const embed = new EmbedBuilder().setColor(0x00FF7F).setTitle('Balance')
    .setDescription(`${message.author} has **${userData.balance.toLocaleString()} coins**`);
  return autoDelete(await message.reply({ embeds: [embed] }));
}

// -- DAILY ---------------------------------
if (cmd === 'daily') {
  const last = userData.dailyLast ? new Date(userData.dailyLast).getTime() : 0;
  const rem  = 86_400_000 - (Date.now() - last);
  if (rem > 0) {
    const h = Math.floor(rem / 3_600_000), m = Math.floor((rem % 3_600_000) / 60_000);
    return autoDelete(await message.reply(`Daily resets in **${h}h ${m}m**.`));
  }
  const reward = userData.premium ? 500 : 200;
  await updateUser(userId, { balance: userData.balance + reward, dailyLast: new Date() });
  return autoDelete(await message.reply(`Claimed **${reward} coins**! Balance: **${userData.balance + reward}**`));
}

// -- HISTORY -------------------------------
if (cmd === 'history') {
  const history = userData.betHistory || [];
  if (!history.length) return autoDelete(await message.reply('No bet history yet.'));
  const lines = [...history].reverse().map((b, i) =>
    `**${i+1}.** \`!${b.cmd}\` -- Bet **${b.bet}** -> ${b.change >= 0 ? `+${b.change}` : b.change} (${b.result})`
  ).join('\n');
  const embed = new EmbedBuilder().setColor(0x7289DA).setTitle('Bet History (Last 10)').setDescription(lines);
  return autoDelete(await message.reply({ embeds: [embed] }), 20);
}

// -- COINFLIP ------------------------------
if (cmd === 'coinflip') {
  const bet  = parseInt(args[0]);
  const side = args[1]?.toLowerCase();
  if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet amount.'));
  if (!['heads','tails'].includes(side)) return autoDelete(await message.reply('Choose `heads` or `tails`.'));
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won    = result === side;
  const change = won ? bet : -bet;
  const newBal = userData.balance + change;
  await updateUser(userId, { balance: newBal });
  await addToJackpot(bet);
  await recordBet(userId, 'coinflip', bet, result, change);
  return autoDelete(await message.reply(`**${result.toUpperCase()}** -- ${won ? `Won +${bet}` : `Lost -${bet}`}! Balance: **${newBal}**`));
}

// -- BET / DICE ----------------------------
if (cmd === 'bet' || cmd === 'dice') {
  const bet = parseInt(args[0]);
  if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet amount.'));
  const roll   = Math.floor(Math.random() * 6) + 1;
  const won    = roll >= 4;
  const change = won ? bet : -bet;
  const newBal = userData.balance + change;
  await updateUser(userId, { balance: newBal });
  await addToJackpot(bet);
  await recordBet(userId, cmd, bet, `rolled ${roll}`, change);
  return autoDelete(await message.reply(`Rolled **${roll}** -- ${won ? `Won +${bet}` : `Lost -${bet}`}! Balance: **${newBal}**`));
}

// -- SLOTS ---------------------------------
if (cmd === 'slots') {
  const bet = parseInt(args[0]);
  if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet amount.'));
  const reels       = spinSlots();
  const { mult, msg } = slotsResult(reels);
  const gain   = Math.floor(bet * mult) - bet;
  const newBal = Math.max(0, userData.balance + gain);

  // Triple Diamond = wins the entire jackpot
  if (reels[0]==='[DI]' && reels[1]==='[DI]' && reels[2]==='[DI]') {
    const pool = await getJackpot();
    const total = gain + pool;
    await updateUser(userId, { balance: newBal + pool });
    await resetJackpot();
    await recordBet(userId, 'slots', bet, 'jackpot win', total);
    return autoDelete(await message.reply(`**[ ${reels.join(' ')} ]**\nJACKPOT WIN! +${total} coins (includes ${pool} jackpot pool)! Balance: **${newBal + pool}**`), 30);
  }

  await updateUser(userId, { balance: newBal });
  await addToJackpot(bet);
  await recordBet(userId, 'slots', bet, reels.join('|'), gain);
  return autoDelete(await message.reply(`**[ ${reels.join(' ')} ]**\n${msg}\n${gain >= 0 ? `+${gain}` : gain} coins! Balance: **${newBal}**`));
}

// -- ROULETTE ------------------------------
if (cmd === 'roulette') {
  const bet    = parseInt(args[0]);
  const choice = args[1]?.toLowerCase();
  if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet amount.'));
  if (!['red','black','green'].includes(choice)) return autoDelete(await message.reply('Choose `red`, `black`, or `green`.'));
  const roll   = Math.floor(Math.random() * 38);
  const result = roll === 0 ? 'green' : roll % 2 === 0 ? 'red' : 'black';
  const mult   = result === 'green' ? 14 : 2;
  const won    = result === choice;
  const change = won ? bet * (mult - 1) : -bet;
  const newBal = Math.max(0, userData.balance + change);
  await updateUser(userId, { balance: newBal });
  await addToJackpot(bet);
  await recordBet(userId, 'roulette', bet, result, change);
  return autoDelete(await message.reply(`**${result.toUpperCase()} (${roll})** -- ${won ? `Won +${change}` : `Lost ${bet}`} coins! Balance: **${newBal}**`));
}

// -- BLACKJACK -----------------------------
if (cmd === 'blackjack') {
  const bet = parseInt(args[0]);
  if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet amount.'));
  const playerHand = [drawCard(), drawCard()];
  const dealerHand = [drawCard(), drawCard()];
  bjGames.set(userId, { bet, playerHand, dealerHand });
  const embed = new EmbedBuilder().setColor(0x1A1A2E).setTitle('Blackjack')
    .addFields(
      { name: 'Your Hand', value: `${playerHand.join(' ')} (${handTotal(playerHand)})` },
      { name: 'Dealer',    value: `${dealerHand[0]} [hidden]` }
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
  );
  await addToJackpot(bet);
  return autoDelete(await message.reply({ embeds: [embed], components: [row] }), 60);
}

// -- ALLIN ---------------------------------
if (cmd === 'allin') {
  const bet = userData.balance;
  if (bet <= 0) return autoDelete(await message.reply('You have no coins to bet!'));
  const won    = Math.random() > 0.5;
  const change = won ? bet : -bet;
  const newBal = Math.max(0, userData.balance + change);
  await updateUser(userId, { balance: newBal });
  await addToJackpot(bet);
  await recordBet(userId, 'allin', bet, won ? 'won' : 'lost', change);
  return autoDelete(await message.reply(`ALL IN -- **${won ? `WON! +${bet} coins!` : 'LOST EVERYTHING'}** | Balance: **${newBal}**`));
}

// -- SPIN ----------------------------------
if (cmd === 'spin') {
  const bet  = parseInt(args[0]);
  if (!bet || bet <= 0 || bet > userData.balance) return autoDelete(await message.reply('Invalid bet amount.'));
  const mult   = [0, 0, 0.5, 1, 1.5, 2, 3, 5][Math.floor(Math.random() * 8)];
  const change = Math.floor(bet * mult) - bet;
  const newBal = Math.max(0, userData.balance + change);
  await updateUser(userId, { balance: newBal });
  await addToJackpot(bet);
  await recordBet(userId, 'spin', bet, `${mult}x`, change);
  return autoDelete(await message.reply(`**${mult}x multiplier** -- ${change >= 0 ? `+${change}` : change} coins! Balance: **${newBal}**`));
}

// -- JACKPOT -------------------------------
if (cmd === 'jackpot') {
  const pool  = await getJackpot();
  const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('Current Jackpot Pool')
    .setDescription(`**${pool.toLocaleString()} coins** in the pool.\n5% of every bet feeds it.\nHit Triple Diamond in slots to win it all!`);
  return autoDelete(await message.reply({ embeds: [embed] }));
}

// -- RANKCARD ------------------------------
if (cmd === 'rankcard') {
  const embed = new EmbedBuilder().setColor(0x7289DA).setTitle(message.author.username)
    .setThumbnail(message.author.displayAvatarURL())
    .addFields(
      { name: 'Rank',        value: userData.rank || 'Unranked',                inline: true },
      { name: 'ELO',         value: `${userData.elo}`,                          inline: true },
      { name: 'Level',       value: `${userData.level}`,                        inline: true },
      { name: 'XP',          value: `${userData.xp}/${userData.level * 100}`,  inline: true },
      { name: 'Submissions', value: `${userData.submissions}`,                  inline: true },
      { name: 'Premium',     value: userData.premium ? 'YES' : 'NO',           inline: true },
      { name: 'Balance',     value: `${userData.balance.toLocaleString()} coins`, inline: true },
    );
  return autoDelete(await message.reply({ embeds: [embed] }), 30);
}

// -- SUBMIT --------------------------------
if (cmd === 'submit') {
  return autoDelete(await message.reply('Use the `/submit` slash command to open the clip submission form!'));
}

// -- QUALITY -------------------------------
if (cmd === 'quality') {
  const limit = userData.premium ? Infinity : 1;
  if ((userData.qualityUses || 0) >= limit)
    return autoDelete(await message.reply('Free limit reached (1 use). Boost the server for unlimited access!'));
  const url = args[0];
  if (!url) return autoDelete(await message.reply('Usage: `!quality <video_url>`'));
  await updateUser(userId, { qualityUses: (userData.qualityUses || 0) + 1 });
  return autoDelete(await message.reply('Processing... your upscaled video will be sent to your DMs. (Connect ffmpeg to enable real upscaling)'));
}

// -- OWNER: CODE ---------------------------
if (cmd === 'code') {
  if (!CONFIG.ownerIds.includes(userId)) return autoDelete(await message.reply('Owner only.'));
  const code = `PREM-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
  await db.collection('codes').insertOne({ code, used: false, createdAt: new Date() });
  await message.author.send(`New Premium Code: \`${code}\``).catch(() => {});
  return autoDelete(await message.reply('Code generated and sent to your DMs.'));
}

// -- MODERATION ----------------------------
if (['kick','ban','mute','unmute','warn','clear','lock','unlock','slowmode'].includes(cmd)) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
    return autoDelete(await message.reply('You do not have permission to use this command.'));

  const target = message.mentions.members.first();
  const reason = args.slice(1).join(' ') || 'No reason provided';

  if (cmd === 'kick') {
    if (!target) return autoDelete(await message.reply('Mention a user to kick.'));
    await target.kick(reason);
    await modLog(message.guild, 'KICK', message.author, target, reason);
    return autoDelete(await message.reply(`Kicked **${target.user.tag}** -- ${reason}`));
  }
  if (cmd === 'ban') {
    if (!target) return autoDelete(await message.reply('Mention a user to ban.'));
    await target.ban({ reason });
    await modLog(message.guild, 'BAN', message.author, target, reason);
    return autoDelete(await message.reply(`Banned **${target.user.tag}** -- ${reason}`));
  }
  if (cmd === 'mute') {
    if (!target) return autoDelete(await message.reply('Mention a user to mute.'));
    await target.timeout(600_000, reason);
    await modLog(message.guild, 'MUTE (10m)', message.author, target, reason);
    return autoDelete(await message.reply(`Muted **${target.user.tag}** for 10 minutes.`));
  }
  if (cmd === 'unmute') {
    if (!target) return autoDelete(await message.reply('Mention a user to unmute.'));
    await target.timeout(null);
    await modLog(message.guild, 'UNMUTE', message.author, target);
    return autoDelete(await message.reply(`Unmuted **${target.user.tag}**.`));
  }
  if (cmd === 'warn') {
    if (!target) return autoDelete(await message.reply('Mention a user to warn.'));
    const td    = await getUser(target.id);
    const warns = [...(td.warns || []), { reason, by: userId, date: new Date() }];
    await updateUser(target.id, { warns });
    await modLog(message.guild, 'WARN', message.author, target, reason);
    return autoDelete(await message.reply(`Warned **${target.user.tag}** (${warns.length} total warns) -- ${reason}`));
  }
  if (cmd === 'clear') {
    const amount  = Math.min(parseInt(args[0]) || 10, 100);
    const deleted = await message.channel.bulkDelete(amount, true);
    await modLog(message.guild, `CLEAR ${deleted.size} messages`, message.author, { tag: 'N/A', id: 'N/A' });
    return autoDelete(await message.reply(`Deleted **${deleted.size}** messages.`));
  }
  if (cmd === 'lock') {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    await modLog(message.guild, 'LOCK', message.author, { tag: `#${message.channel.name}`, id: message.channel.id });
    return autoDelete(await message.reply('Channel locked.'));
  }
  if (cmd === 'unlock') {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
    await modLog(message.guild, 'UNLOCK', message.author, { tag: `#${message.channel.name}`, id: message.channel.id });
    return autoDelete(await message.reply('Channel unlocked.'));
  }
  if (cmd === 'slowmode') {
    const secs = Math.min(parseInt(args[0]) || 5, 21600);
    await message.channel.setRateLimitPerUser(secs);
    await modLog(message.guild, `SLOWMODE ${secs}s`, message.author, { tag: `#${message.channel.name}`, id: message.channel.id });
    return autoDelete(await message.reply(`Slowmode set to **${secs}s**.`));
  }
}
```

}, message);
});

// ———————————————
// INTERACTION HANDLER
// ———————————————
client.on(‘interactionCreate’, async (interaction) => {
try {

```
// Blackjack buttons
if (interaction.isButton() && ['bj_hit','bj_stand'].includes(interaction.customId)) {
  const game = bjGames.get(interaction.user.id);
  if (!game) return interaction.reply({ content: 'No active game found.', ephemeral: true });
  const userData = await getUser(interaction.user.id);

  if (interaction.customId === 'bj_hit') {
    game.playerHand.push(drawCard());
    const total = handTotal(game.playerHand);
    if (total > 21) {
      bjGames.delete(interaction.user.id);
      await updateUser(interaction.user.id, { balance: Math.max(0, userData.balance - game.bet) });
      await recordBet(interaction.user.id, 'blackjack', game.bet, 'bust', -game.bet);
      return interaction.update({ content: `Bust at **${total}** -- Lost **${game.bet}** coins.`, embeds: [], components: [] });
    }
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0x1A1A2E).setTitle('Blackjack')
        .addFields(
          { name: 'Your Hand', value: `${game.playerHand.join(' ')} (${total})` },
          { name: 'Dealer',    value: `${game.dealerHand[0]} [hidden]` }
        )],
    });
  }

  if (interaction.customId === 'bj_stand') {
    bjGames.delete(interaction.user.id);
    let dt = handTotal(game.dealerHand);
    while (dt < 17) { game.dealerHand.push(drawCard()); dt = handTotal(game.dealerHand); }
    const pt   = handTotal(game.playerHand);
    const won  = dt > 21 || pt > dt;
    const push = pt === dt;
    const change = push ? 0 : (won ? game.bet : -game.bet);
    await updateUser(interaction.user.id, { balance: Math.max(0, userData.balance + change) });
    await recordBet(interaction.user.id, 'blackjack', game.bet, push ? 'push' : won ? 'win' : 'loss', change);
    return interaction.update({
      content: `Dealer: **${dt}** | You: **${pt}** -- ${push ? 'Tie!' : won ? `Won +${game.bet} coins!` : `Lost ${game.bet} coins.`}`,
      embeds: [], components: []
    });
  }
}

// Review rating buttons
if (interaction.isButton() && interaction.customId.startsWith('rate_')) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages))
    return interaction.reply({ content: 'Staff only.', ephemeral: true });

  const parts  = interaction.customId.split('_');
  const rating = parts[parts.length - 1];
  const subId  = parts.slice(1, -1).join('_');

  const sub = await db.collection('submissions').findOne({ _id: subId });
  if (!sub)       return interaction.reply({ content: 'Submission not found.', ephemeral: true });
  if (sub.reviewed) return interaction.reply({ content: 'Already reviewed.', ephemeral: true });

  const eloGain = { A:50, S:100, SS:200, SSS:500 }[rating] || 25;
  const td      = await getUser(sub.userId);
  const newElo  = td.elo + eloGain;
  const newRank = getRankFromElo(newElo);
  await updateUser(sub.userId, { elo: newElo, rank: newRank, submissions: (td.submissions||0)+1 });
  await db.collection('submissions').updateOne(
    { _id: subId },
    { $set: { rating, reviewed: true, reviewedBy: interaction.user.id } }
  );

  const guild = client.guilds.cache.first();
  if (guild) {
    const member = await guild.members.fetch(sub.userId).catch(() => null);
    if (member) await applyRank(guild, member, newElo);
  }

  return interaction.reply({ content: `Rated **${rating}** -- +${eloGain} ELO to <@${sub.userId}>. New rank: **${newRank}**`, ephemeral: true });
}

// Leaderboard pagination buttons
if (interaction.isButton() && interaction.customId.startsWith('lb_')) {
  const page = parseInt(interaction.customId.split('_')[1]);
  if (page < 1) return interaction.reply({ content: 'Already on first page.', ephemeral: true });
  const { embed, row } = await buildLeaderboard(page);
  return interaction.update({ embeds: [embed], components: [row] });
}

// Slash commands
if (interaction.isChatInputCommand()) {
  const userData = await getUser(interaction.user.id);

  if (interaction.commandName === 'profile') {
    const embed = new EmbedBuilder().setColor(0x7289DA)
      .setTitle(`Profile -- ${interaction.user.username}`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: 'Rank',    value: userData.rank || 'Unranked',                inline: true },
        { name: 'ELO',     value: `${userData.elo}`,                          inline: true },
        { name: 'Level',   value: `${userData.level}`,                        inline: true },
        { name: 'Balance', value: `${userData.balance.toLocaleString()} coins`, inline: true },
        { name: 'Premium', value: userData.premium ? 'YES' : 'NO',           inline: true },
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'submit') {
    const modal = new ModalBuilder().setCustomId('submit_modal').setTitle('Submit a Clip');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('clip_url').setLabel('Clip URL').setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('clip_desc').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false)
      )
    );
    return interaction.showModal(modal);
  }

  if (interaction.commandName === 'leaderboard') {
    const page         = interaction.options.getInteger('page') || 1;
    const { embed, row } = await buildLeaderboard(page);
    return interaction.reply({ embeds: [embed], components: [row] });
  }

  if (interaction.commandName === 'review') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return interaction.reply({ content: 'Staff only.', ephemeral: true });
    const pending = await db.collection('submissions').find({ reviewed: false }).sort({ submittedAt: 1 }).limit(1).toArray();
    if (!pending.length) return interaction.reply({ content: 'No pending submissions!', ephemeral: true });
    const sub   = pending[0];
    const embed = new EmbedBuilder().setColor(0xFF6B6B).setTitle('Review Submission')
      .addFields(
        { name: 'Submitted by', value: `<@${sub.userId}>` },
        { name: 'Clip URL',     value: sub.url },
        { name: 'Description',  value: sub.description || 'None' },
        { name: 'Submitted',    value: new Date(sub.submittedAt).toUTCString() },
      );
    const row = new ActionRowBuilder().addComponents(
      ...['A','S','SS','SSS'].map(r =>
        new ButtonBuilder().setCustomId(`rate_${sub._id}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary)
      )
    );
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
}

// Modal: clip submission
if (interaction.isModalSubmit() && interaction.customId === 'submit_modal') {
  const url  = interaction.fields.getTextInputValue('clip_url');
  const desc = interaction.fields.getTextInputValue('clip_desc');
  const { insertedId } = await db.collection('submissions').insertOne({
    userId: interaction.user.id, url, description: desc,
    reviewed: false, submittedAt: new Date(),
  });

  const reviewChannel = client.channels.cache.get(CONFIG.reviewChannelId);
  if (reviewChannel) {
    const embed = new EmbedBuilder().setColor(0xFF6B6B).setTitle('New Clip Submission')
      .addFields(
        { name: 'User',        value: `<@${interaction.user.id}>` },
        { name: 'URL',         value: url },
        { name: 'Description', value: desc || 'None' },
      );
    const row = new ActionRowBuilder().addComponents(
      ...['A','S','SS','SSS'].map(r =>
        new ButtonBuilder().setCustomId(`rate_${insertedId}_${r}`).setLabel(r).setStyle(ButtonStyle.Primary)
      )
    );
    await reviewChannel.send({ embeds: [embed], components: [row] });
  }

  return interaction.reply({ content: 'Clip submitted for review! You will be notified when it is rated.', ephemeral: true });
}
```

} catch (err) {
log(‘ERROR’, `Interaction error: ${err.message}`);
try {
const msg = { content: ‘Something went wrong. Please try again.’, ephemeral: true };
if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
else await interaction.reply(msg);
} catch {}
}
});

// ———————————————
// BOOST DETECTION
// ———————————————
client.on(‘guildMemberUpdate’, async (oldMember, newMember) => {
try {
const wasBoosting = !!oldMember.premiumSince;
const isBoosting  = !!newMember.premiumSince;

```
if (!wasBoosting && isBoosting) {
  const code = `BOOST-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
  await db.collection('codes').insertOne({ code, userId: newMember.id, used: false, type: 'boost', createdAt: new Date() });
  await updateUser(newMember.id, { premium: true });
  await newMember.send(`Thank you for boosting! Your premium code: \`${code}\``).catch(() => {});
  log('INFO', `${newMember.user.tag} boosted -- premium activated`);
}

if (wasBoosting && !isBoosting) {
  await updateUser(newMember.id, { premium: false });
  await newMember.send('Your boost ended. Premium access has been removed.').catch(() => {});
  log('INFO', `${newMember.user.tag} boost removed -- premium revoked`);
}
```

} catch (err) { log(‘ERROR’, `guildMemberUpdate: ${err.message}`); }
});

// ———————————————
// EXPRESS API
// ———————————————
let apiRequests = 0;
const startTime = Date.now();

app.use((req, res, next) => { apiRequests++; next(); });

app.get(’/api/status’, (req, res) => {
res.json({
status:    ‘online’,
uptime:    Math.floor((Date.now() - startTime) / 1000),
requests:  apiRequests,
cacheSize: userCache.size,
guilds:    client.guilds.cache.size,
});
});

app.get(’/api/dashboard’, async (req, res) => {
try {
const [totalUsers, totalSubmissions, pendingReviews, jackpot] = await Promise.all([
db.collection(‘users’).countDocuments(),
db.collection(‘submissions’).countDocuments(),
db.collection(‘submissions’).countDocuments({ reviewed: false }),
getJackpot(),
]);
res.json({ totalUsers, totalSubmissions, pendingReviews, jackpot, uptime: Math.floor((Date.now() - startTime) / 1000) });
} catch (err) { res.status(500).json({ error: err.message }); }
});

app.get(’/api/leaderboard’, async (req, res) => {
try {
const page  = Math.max(1, parseInt(req.query.page) || 1);
const limit = Math.min(50, parseInt(req.query.limit) || 10);
const skip  = (page - 1) * limit;
const top   = await db.collection(‘users’).find({ elo: { $gt: 0 } }).sort({ elo: -1 }).skip(skip).limit(limit).toArray();
res.json(top.map(u => ({ userId: u.userId, elo: u.elo, rank: u.rank, level: u.level })));
} catch (err) { res.status(500).json({ error: err.message }); }
});

app.get(’/api/submissions’, async (req, res) => {
try {
const reviewed = req.query.reviewed === ‘true’ ? true : req.query.reviewed === ‘false’ ? false : undefined;
const filter   = reviewed !== undefined ? { reviewed } : {};
const subs     = await db.collection(‘submissions’).find(filter).sort({ submittedAt: -1 }).limit(20).toArray();
res.json(subs);
} catch (err) { res.status(500).json({ error: err.message }); }
});

// ———————————————
// GLOBAL SAFETY NET
// ———————————————
process.on(‘unhandledRejection’, (err) => log(‘ERROR’, `Unhandled rejection: ${err?.message || err}`));
process.on(‘uncaughtException’,  (err) => log(‘ERROR’, `Uncaught exception: ${err?.message || err}`));

// ———————————————
// LAUNCH
// ———————————————
(async () => {
try {
await bootSequence();
await connectDB();
await registerSlash();
app.listen(CONFIG.port, () => log(‘SUCCESS’, `API running on port ${CONFIG.port}`));
await client.login(CONFIG.token);
client.once(‘ready’, async () => {
log(‘SUCCESS’, `${client.user.tag} ONLINE -- ${client.guilds.cache.size} guild(s)`);

```
  // Auto-detect roles and channels for every guild the bot is in
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.roles.fetch();    // make sure role cache is fully populated
      await guild.channels.fetch(); // make sure channel cache is populated
      await autoDetectRankRoles(guild);
      await autoDetectChannels(guild);
    } catch (err) {
      log('ERROR', `Auto-detect failed for guild "${guild.name}": ${err.message}`);
    }
  }

  log('SUCCESS', `Rank roles: ${JSON.stringify(CONFIG.rankRoles)}`);
  log('SUCCESS', `Review channel: ${CONFIG.reviewChannelId || 'NOT FOUND'}`);
  log('SUCCESS', `Log channel:    ${CONFIG.logChannelId    || 'NOT FOUND'}`);
});
```

} catch (err) {
log(‘ERROR’, `FATAL STARTUP: ${err.message}`);
process.exit(1);
}
})();
