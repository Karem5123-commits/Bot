'use strict';

module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GOD MODE v4 — Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif}
body{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);color:#e2e8f0;min-height:100vh}
header{background:#020617;padding:16px 24px;border-bottom:2px solid #3b82f6;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 12px rgba(59,130,246,0.2)}
header h1{color:#38bdf8;font-size:22px;display:flex;align-items:center;gap:8px}
header .status{display:flex;gap:12px;align-items:center}
.badge{background:#22c55e;color:#fff;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.ws-status{background:#f59e0b;color:#000;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600}
.ws-status.connected{background:#22c55e;color:#fff}
.tabs{background:#020617;padding:0 24px;border-bottom:1px solid #334155;display:flex;gap:0}
.tab{padding:14px 24px;cursor:pointer;border-bottom:3px solid transparent;transition:all .2s;color:#94a3b8;font-weight:500}
.tab:hover{color:#38bdf8;background:rgba(56,189,248,0.05)}
.tab.active{color:#38bdf8;border-bottom-color:#38bdf8}
.tab.admin{color:#f59e0b}
.tab.admin.active{border-bottom-color:#f59e0b;color:#fbbf24}
.page{padding:24px;display:none}
.page.active{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.card{background:rgba(30,41,59,0.8);backdrop-filter:blur(10px);border-radius:12px;padding:20px;border:1px solid #334155;transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-2px);border-color:#3b82f6}
.card h3{color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px}
.card .value{font-size:32px;font-weight:700;color:#f1f5f9}
.value.gold{color:#facc15}
.value.green{color:#22c55e}
.value.red{color:#ef4444}
.value.blue{color:#3b82f6}
.section{background:rgba(30,41,59,0.8);border-radius:12px;border:1px solid #334155;overflow:hidden;margin-bottom:20px}
.section h2{padding:16px 20px;border-bottom:1px solid #334155;color:#f1f5f9;display:flex;justify-content:space-between;align-items:center}
.section-body{padding:16px 20px;max-height:500px;overflow-y:auto}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155}
.row:last-child{border-bottom:none}
.row:hover{background:rgba(51,65,85,0.3)}
.rank-num{color:#facc15;font-weight:700;width:40px}
.mmr{color:#38bdf8;font-weight:600}
.btn{background:#3b82f6;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-weight:500;transition:background .2s}
.btn:hover{background:#2563eb}
.btn.danger{background:#ef4444}
.btn.danger:hover{background:#dc2626}
.btn.warn{background:#f59e0b;color:#000}
.btn.warn:hover{background:#d97706}
.btn.success{background:#22c55e}
.btn.success:hover{background:#16a34a}
.btn.small{padding:4px 10px;font-size:12px}
input,select,textarea{background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:6px;width:100%;margin-bottom:8px}
input:focus,select:focus,textarea:focus{outline:none;border-color:#3b82f6}
label{display:block;margin-bottom:4px;color:#94a3b8;font-size:13px;font-weight:500}
.modal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:1000;justify-content:center;align-items:center;backdrop-filter:blur(4px)}
.modal.open{display:flex}
.modal-content{background:#1e293b;border:1px solid #3b82f6;border-radius:12px;padding:32px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
.modal-content h2{color:#38bdf8;margin-bottom:16px}
.cmd-toggle{display:flex;justify-content:space-between;align-items:center;padding:12px;background:rgba(51,65,85,0.5);border-radius:8px;margin-bottom:8px}
.cmd-toggle.disabled{opacity:0.6;background:rgba(239,68,68,0.1);border:1px solid #ef4444}
.switch{position:relative;width:50px;height:26px;background:#475569;border-radius:99px;cursor:pointer;transition:background .2s}
.switch.on{background:#22c55e}
.switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left .2s}
.switch.on::after{left:27px}
.admin-warning{background:rgba(239,68,68,0.1);border:1px solid #ef4444;padding:12px;border-radius:8px;margin-bottom:16px;color:#fca5a5}
.log-entry{padding:8px 12px;border-bottom:1px solid #334155;font-family:'Courier New',monospace;font-size:12px}
.log-entry.INFO{color:#3b82f6}
.log-entry.WARN{color:#f59e0b}
.log-entry.ERROR{color:#ef4444}
.log-entry.SUCCESS{color:#22c55e}
.log-entry.ADMIN{color:#fbbf24}
.log-entry.API{color:#06b6d4}
.ts{color:#64748b}
footer{text-align:center;padding:20px;color:#475569;font-size:13px}
.live-dot{display:inline-block;width:8px;height:8px;background:#22c55e;border-radius:50%;animation:pulse 1s infinite;margin-right:6px}
.guild-card{background:#0f172a;padding:12px;border-radius:8px;border:1px solid #334155;margin-bottom:8px}
.guild-card h4{color:#38bdf8}
.guild-card .meta{color:#94a3b8;font-size:12px;margin-top:4px}
</style>
</head>
<body>
<header>
  <h1>⚡ GOD MODE v4</h1>
  <div class="status">
    <span class="ws-status" id="wsStatus">CONNECTING</span>
    <span class="badge"><span class="live-dot"></span>LIVE</span>
  </div>
</header>

<div class="tabs">
  <div class="tab active" onclick="switchTab('overview')">📊 Overview</div>
  <div class="tab" onclick="switchTab('leaderboard')">🏆 Leaderboard</div>
  <div class="tab" onclick="switchTab('submissions')">📝 Submissions</div>
  <div class="tab" onclick="switchTab('analytics')">📈 Analytics</div>
  <div class="tab" onclick="switchTab('guilds')">🏰 Guilds</div>
  <div class="tab" onclick="switchTab('logs')">📋 Logs</div>
  <div class="tab admin" onclick="openAdminLogin()" id="adminTab">🔐 Admin Panel</div>
</div>

<!-- OVERVIEW -->
<div class="page active" id="page-overview">
  <div class="grid">
    <div class="card"><h3>Total Users</h3><div class="value blue" id="users">--</div></div>
    <div class="card"><h3>Submissions</h3><div class="value" id="subs">--</div></div>
    <div class="card"><h3>Pending Review</h3><div class="value red" id="pending">--</div></div>
    <div class="card"><h3>Jackpot</h3><div class="value gold" id="jackpot">--</div></div>
    <div class="card"><h3>Total Bets</h3><div class="value green" id="bets">--</div></div>
    <div class="card"><h3>Uptime</h3><div class="value" id="uptime">--</div></div>
    <div class="card"><h3>Guilds</h3><div class="value blue" id="guilds">--</div></div>
    <div class="card"><h3>Members</h3><div class="value green" id="members">--</div></div>
    <div class="card"><h3>Cache</h3><div class="value" id="cache">--</div></div>
  </div>
  <div class="section">
    <h2>🏆 Top 5 Players</h2>
    <div class="section-body" id="topPlayers"></div>
  </div>
</div>

<!-- LEADERBOARD -->
<div class="page" id="page-leaderboard">
  <div class="section">
    <h2>🏆 ELO Leaderboard
      <select onchange="loadLeaderboard(this.value)" style="width:auto">
        <option value="elo">Sort: ELO</option>
        <option value="balance">Balance</option>
        <option value="level">Level</option>
        <option value="totalWagered">Wagered</option>
        <option value="totalWon">Won</option>
        <option value="submissions">Submissions</option>
      </select>
    </h2>
    <div class="section-body" id="leaderboard"></div>
  </div>
</div>

<!-- SUBMISSIONS -->
<div class="page" id="page-submissions">
  <div class="section">
    <h2>📝 Recent Submissions
      <select onchange="loadSubmissions(this.value)" style="width:auto">
        <option value="">All</option>
        <option value="false">Pending</option>
        <option value="true">Reviewed</option>
      </select>
    </h2>
    <div class="section-body" id="submissions"></div>
  </div>
</div>

<!-- ANALYTICS -->
<div class="page" id="page-analytics">
  <div class="section">
    <h2>📈 Event Analytics (7 days)</h2>
    <div class="section-body" id="analytics"></div>
  </div>
  <div class="section">
    <h2>🔥 Command Usage</h2>
    <div class="section-body" id="cmdStats"></div>
  </div>
</div>

<!-- GUILDS -->
<div class="page" id="page-guilds">
  <div class="section">
    <h2>🏰 Connected Guilds</h2>
    <div class="section-body" id="guildsList"></div>
  </div>
</div>

<!-- LOGS -->
<div class="page" id="page-logs">
  <div class="section">
    <h2>📋 System Logs (Live)</h2>
    <div class="section-body" id="logs"></div>
  </div>
</div>

<!-- ADMIN PANEL -->
<div class="page" id="page-admin">
  <div class="admin-warning">⚠️ <b>Admin Panel</b> — You have full control. All actions are logged.</div>

  <div class="grid">
    <div class="card"><h3>Logged in as</h3><div class="value" id="adminUser" style="font-size:18px">--</div></div>
    <div class="card">
      <h3>Actions</h3>
      <button class="btn danger small" onclick="adminLogout()">Logout</button>
      <button class="btn warn small" onclick="restartBot()">Restart Bot</button>
    </div>
  </div>

  <div class="section">
    <h2>⚡ Command Toggles</h2>
    <div class="section-body" id="cmdToggles"></div>
  </div>

  <div class="section">
    <h2>👤 User Management</h2>
    <div class="section-body">
      <label>User ID</label>
      <input type="text" id="userMgmtId" placeholder="Discord User ID">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label>Balance</label>
          <input type="number" id="userMgmtBalance" placeholder="Amount">
          <select id="userMgmtBalanceOp">
            <option value="set">Set</option>
            <option value="add">Add</option>
            <option value="subtract">Subtract</option>
          </select>
          <button class="btn success small" onclick="updateUserBalance()">Update Balance</button>
        </div>
        <div>
          <label>ELO</label>
          <input type="number" id="userMgmtElo" placeholder="New ELO">
          <button class="btn success small" onclick="updateUserElo()">Update ELO</button>
          <div style="margin-top:8px">
            <button class="btn small" onclick="togglePremium(true)">Grant Premium</button>
            <button class="btn danger small" onclick="togglePremium(false)">Revoke Premium</button>
          </div>
        </div>
      </div>
      <label style="margin-top:12px">Send DM</label>
      <textarea id="userMgmtDm" rows="2" placeholder="Message to send..."></textarea>
      <button class="btn small" onclick="sendDm()">Send DM</button>
    </div>
  </div>

  <div class="section">
    <h2>💎 Jackpot Control</h2>
    <div class="section-body">
      <input type="number" id="jackpotAmount" placeholder="Amount">
      <button class="btn success small" onclick="setJackpot()">Set Jackpot</button>
      <button class="btn danger small" onclick="resetJackpot()">Reset to 0</button>
    </div>
  </div>

  <div class="section">
    <h2>📢 Broadcast</h2>
    <div class="section-body">
      <label>Channel Name (default: general)</label>
      <input type="text" id="broadcastChannel" value="general">
      <label>Message</label>
      <textarea id="broadcastMsg" rows="3" placeholder="Announcement to all guilds..."></textarea>
      <button class="btn warn small" onclick="doBroadcast()">📣 Broadcast to All</button>
    </div>
  </div>

  <div class="section">
    <h2>🎮 Bot Presence</h2>
    <div class="section-body">
      <label>Status</label>
      <select id="presenceStatus">
        <option value="online">Online</option>
        <option value="idle">Idle</option>
        <option value="dnd">Do Not Disturb</option>
        <option value="invisible">Invisible</option>
      </select>
      <label>Activity Type</label>
      <select id="presenceType">
        <option value="playing">Playing</option>
        <option value="streaming">Streaming</option>
        <option value="listening">Listening to</option>
        <option value="watching">Watching</option>
        <option value="competing">Competing in</option>
      </select>
      <label>Activity Text</label>
      <input type="text" id="presenceActivity" placeholder="GOD MODE | /help">
      <button class="btn success small" onclick="updatePresence()">Update Presence</button>
    </div>
  </div>

  <div class="section">
    <h2>🔑 Generate Premium Codes</h2>
    <div class="section-body">
      <input type="number" id="codeCount" value="1" min="1" max="100">
      <button class="btn small" onclick="generateCodes()">Generate Codes</button>
      <div id="generatedCodes" style="margin-top:12px"></div>
    </div>
  </div>

  <div class="section">
    <h2>🛠️ System Info</h2>
    <div class="section-body" id="systemInfo"></div>
  </div>
</div>

<!-- ADMIN LOGIN MODAL -->
<div class="modal" id="loginModal">
  <div class="modal-content">
    <h2>🔐 Owner Admin Login</h2>
    <p style="color:#94a3b8;margin-bottom:16px;font-size:13px">Only bot owners can access this panel.</p>
    <label>Discord User ID</label>
    <input type="text" id="loginUserId" placeholder="Your Discord ID">
    <label>Admin Password</label>
    <input type="password" id="loginPassword" placeholder="Enter password">
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn success" onclick="doLogin()">🔓 Login</button>
      <button class="btn danger" onclick="closeModal()">Cancel</button>
    </div>
    <div id="loginError" style="color:#ef4444;margin-top:12px;font-size:13px"></div>
  </div>
</div>

<footer>⚡ GOD MODE v4 Dashboard | WebSocket: Real-time | API: 40+ endpoints</footer>

<script>
let adminToken = localStorage.getItem('adminToken');
let adminUserId = localStorage.getItem('adminUserId');
let currentTab = 'overview';
let ws = null;

// WebSocket
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');
  ws.onopen = () => document.getElementById('wsStatus').textContent = 'LIVE', document.getElementById('wsStatus').classList.add('connected');
  ws.onclose = () => { document.getElementById('wsStatus').textContent = 'RECONNECTING'; document.getElementById('wsStatus').classList.remove('connected'); setTimeout(connectWS, 3000); };
  ws.onmessage = e => {
    const { event, data } = JSON.parse(e.data);
    if (event === 'stats_update') updateStats(data);
    if (event === 'command_toggled' && currentTab === 'admin') loadCmdToggles();
  };
}
connectWS();

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('page-' + name).classList.add('active');
  if (name === 'leaderboard') loadLeaderboard();
  if (name === 'submissions') loadSubmissions();
  if (name === 'analytics') loadAnalytics();
  if (name === 'guilds') loadGuilds();
  if (name === 'logs') loadLogs();
}

function openAdminLogin() {
  if (adminToken) {
    verifyAndOpenAdmin();
  } else {
    document.getElementById('loginModal').classList.add('open');
  }
}

function closeModal() {
  document.getElementById('loginModal').classList.remove('open');
  document.getElementById('loginError').textContent = '';
}

async function doLogin() {
  const userId = document.getElementById('loginUserId').value;
  const password = document.getElementById('loginPassword').value;
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    adminToken = d.token;
    adminUserId = d.userId;
    localStorage.setItem('adminToken', adminToken);
    localStorage.setItem('adminUserId', adminUserId);
    closeModal();
    openAdminPanel();
  } catch (e) {
    document.getElementById('loginError').textContent = '❌ ' + e.message;
  }
}

async function verifyAndOpenAdmin() {
  try {
    const r = await fetch('/api/admin/verify', { headers: { Authorization: 'Bearer ' + adminToken } });
    if (!r.ok) throw new Error('Invalid');
    openAdminPanel();
  } catch (e) {
    adminLogout();
    document.getElementById('loginModal').classList.add('open');
  }
}

function openAdminPanel() {
  currentTab = 'admin';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('adminTab').classList.add('active');
  document.getElementById('page-admin').classList.add('active');
  document.getElementById('adminUser').textContent = adminUserId;
  loadCmdToggles();
  loadSystemInfo();
}

function adminLogout() {
  adminToken = null;
  adminUserId = null;
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUserId');
  switchTab('overview');
  event.target?.classList.remove('active');
}

async function apiCall(url, opts = {}) {
  opts.headers = opts.headers || {};
  if (adminToken) opts.headers['Authorization'] = 'Bearer ' + adminToken;
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, opts);
  if (r.status === 401) { adminLogout(); throw new Error('Unauthorized'); }
  return r.json();
}

function updateStats(d) {
  document.getElementById('users').textContent = (d.users || 0).toLocaleString();
  document.getElementById('jackpot').textContent = (d.jackpot || 0).toLocaleString() + ' 🪙';
  const u = d.uptime || 0;
  document.getElementById('uptime').textContent = Math.floor(u/3600) + 'h ' + Math.floor((u%3600)/60) + 'm';
  document.getElementById('cache').textContent = d.cacheSize || 0;
  document.getElementById('guilds').textContent = d.guilds || 0;
  document.getElementById('members').textContent = (d.members || 0).toLocaleString();
}

async function loadOverview() {
  const d = await apiCall('/api/dashboard');
  document.getElementById('subs').textContent = d.totalSubmissions || 0;
  document.getElementById('pending').textContent = d.pendingReviews || 0;
  document.getElementById('bets').textContent = (d.totalBets || 0).toLocaleString();
  updateStats(d);
  const lb = await apiCall('/api/leaderboard?limit=5');
  document.getElementById('topPlayers').innerHTML = lb.map((u, i) =>
    '<div class="row"><span class="rank-num">#' + (i+1) + '</span><span>' + u.userId + '</span><span class="mmr">' + u.elo + ' ELO</span></div>'
  ).join('');
}

async function loadLeaderboard(sortBy = 'elo') {
  const lb = await apiCall('/api/leaderboard?limit=50&sortBy=' + sortBy);
  document.getElementById('leaderboard').innerHTML = lb.map((u, i) =>
    '<div class="row"><span class="rank-num">#' + (i+1) + '</span><span>' + u.userId + '</span><span class="mmr">' + (u[sortBy] || u.elo) + '</span></div>'
  ).join('');
}

async function loadSubmissions(filter = '') {
  const url = '/api/submissions' + (filter ? '?reviewed=' + filter : '');
  const subs = await apiCall(url);
  document.getElementById('submissions').innerHTML = subs.map(s =>
    '<div class="row"><div><b>' + s.userId + '</b><br><span style="color:#94a3b8;font-size:12px">' + (s.url || '').slice(0,60) + '</span></div>' +
    '<span class="' + (s.reviewed ? 'mmr' : '') + '">' + (s.reviewed ? '✅ ' + s.rating : '⏳ Pending') + '</span></div>'
  ).join('') || '<div style="text-align:center;color:#64748b;padding:20px">No submissions.</div>';
}

async function loadAnalytics() {
  const events = await apiCall('/api/analytics?days=7');
  document.getElementById('analytics').innerHTML = events.map(e =>
    '<div class="row"><span>' + e._id + '</span><span class="mmr">' + e.count + '</span></div>'
  ).join('') || '<div style="padding:20px;color:#64748b">No data.</div>';
  const cmds = await apiCall('/api/commands/stats');
  document.getElementById('cmdStats').innerHTML = cmds.map(c =>
    '<div class="row"><span>!' + c._id + '</span><span><span class="mmr">' + c.count + '</span> runs (' + c.success + ' ok)</span></div>'
  ).join('') || '<div style="padding:20px;color:#64748b">No data.</div>';
}

async function loadGuilds() {
  const guilds = await apiCall('/api/guilds');
  document.getElementById('guildsList').innerHTML = guilds.map(g =>
    '<div class="guild-card"><h4>' + g.name + '</h4>' +
    '<div class="meta">ID: ' + g.id + ' | Members: ' + g.memberCount + ' | Channels: ' + g.channels + ' | Roles: ' + g.roles + '</div>' +
    (adminToken ? '<button class="btn warn small" style="margin-top:8px" onclick="syncRoles(\\'' + g.id + '\\')">🔄 Re-sync Auto-Role</button>' : '') +
    '</div>'
  ).join('');
}

async function loadLogs() {
  const logs = await apiCall('/api/logs?limit=200');
  document.getElementById('logs').innerHTML = logs.map(l =>
    '<div class="log-entry ' + l.level + '"><span class="ts">[' + l.ts + ']</span> [' + l.level + '] ' + l.message + '</div>'
  ).join('');
}

async function loadCmdToggles() {
  const data = await apiCall('/api/commands/list');
  document.getElementById('cmdToggles').innerHTML = data.all.map(cmd => {
    const disabled = data.disabled.includes(cmd);
    return '<div class="cmd-toggle ' + (disabled ? 'disabled' : '') + '">' +
      '<span><b>!' + cmd + '</b></span>' +
      '<div class="switch ' + (disabled ? '' : 'on') + '" onclick="toggleCmd(\\'' + cmd + '\\',' + disabled + ')"></div>' +
    '</div>';
  }).join('');
}

async function toggleCmd(cmd, wasDisabled) {
  await apiCall('/api/admin/commands/toggle', { method: 'POST', body: { command: cmd, enabled: wasDisabled } });
  loadCmdToggles();
}

async function updateUserBalance() {
  const userId = document.getElementById('userMgmtId').value;
  const amount = parseInt(document.getElementById('userMgmtBalance').value);
  const operation = document.getElementById('userMgmtBalanceOp').value;
  if (!userId || isNaN(amount)) return alert('Invalid');
  const r = await apiCall('/api/admin/user/balance', { method: 'POST', body: { userId, amount, operation } });
  alert('✅ Balance: ' + r.balance);
}

async function updateUserElo() {
  const userId = document.getElementById('userMgmtId').value;
  const elo = parseInt(document.getElementById('userMgmtElo').value);
  if (!userId || isNaN(elo)) return alert('Invalid');
  await apiCall('/api/admin/user/elo', { method: 'POST', body: { userId, elo } });
  alert('✅ ELO updated');
}

async function togglePremium(premium) {
  const userId = document.getElementById('userMgmtId').value;
  if (!userId) return alert('Enter user ID');
  await apiCall('/api/admin/user/premium', { method: 'POST', body: { userId, premium } });
  alert('✅ Premium ' + (premium ? 'granted' : 'revoked'));
}

async function sendDm() {
  const userId = document.getElementById('userMgmtId').value;
  const message = document.getElementById('userMgmtDm').value;
  if (!userId || !message) return alert('Invalid');
  await apiCall('/api/admin/user/dm', { method: 'POST', body: { userId, message } });
  alert('✅ DM sent');
}

async function setJackpot() {
  const amount = parseInt(document.getElementById('jackpotAmount').value);
  if (isNaN(amount)) return;
  await apiCall('/api/admin/jackpot/set', { method: 'POST', body: { amount } });
  alert('✅ Jackpot: ' + amount);
}

async function resetJackpot() {
  if (!confirm('Reset jackpot to 0?')) return;
  await apiCall('/api/admin/jackpot/reset', { method: 'POST' });
  alert('✅ Reset');
}

async function doBroadcast() {
  const message = document.getElementById('broadcastMsg').value;
  const channelName = document.getElementById('broadcastChannel').value;
  if (!message) return;
  if (!confirm('Broadcast to ALL guilds?')) return;
  const r = await apiCall('/api/admin/broadcast', { method: 'POST', body: { message, channelName } });
  alert('✅ Sent to ' + r.sent + ' guilds');
}

async function updatePresence() {
  const status = document.getElementById('presenceStatus').value;
  const type = document.getElementById('presenceType').value;
  const activity = document.getElementById('presenceActivity').value;
  await apiCall('/api/admin/presence', { method: 'POST', body: { status, type, activity } });
  alert('✅ Presence updated');
}

async function generateCodes() {
  const count = parseInt(document.getElementById('codeCount').value) || 1;
  const r = await apiCall('/api/admin/code/generate', { method: 'POST', body: { count } });
  document.getElementById('generatedCodes').innerHTML = r.codes.map(c => '<div style="padding:4px;background:#0f172a;margin:2px 0;border-radius:4px;font-family:monospace">' + c + '</div>').join('');
}

async function loadSystemInfo() {
  try {
    const info = await apiCall('/api/admin/system/info');
    document.getElementById('systemInfo').innerHTML =
      '<div class="row"><span>Node</span><span class="mmr">' + info.node + '</span></div>' +
      '<div class="row"><span>Platform</span><span class="mmr">' + info.platform + '</span></div>' +
      '<div class="row"><span>Memory (RSS)</span><span class="mmr">' + (info.memoryUsage.rss / 1024 / 1024).toFixed(1) + ' MB</span></div>' +
      '<div class="row"><span>Uptime</span><span class="mmr">' + Math.floor(info.uptime) + 's</span></div>' +
      '<div class="row"><span>PID</span><span class="mmr">' + info.pid + '</span></div>';
  } catch (e) {}
}

async function syncRoles(guildId) {
  if (!confirm('Re-sync auto-role to ALL members in this guild?')) return;
  const r = await apiCall('/api/admin/role/sync', { method: 'POST', body: { guildId } });
  alert('✅ Assigned: ' + r.assigned + ' | Skipped: ' + r.skipped + ' | Failed: ' + r.failed);
}

async function restartBot() {
  if (!confirm('Restart the bot NOW?')) return;
  await apiCall('/api/admin/system/restart', { method: 'POST' });
  alert('🔄 Restarting...');
}

// Initial load & refresh
loadOverview();
setInterval(loadOverview, 10000);
setInterval(() => { if (currentTab === 'logs') loadLogs(); }, 5000);
</script>
</body>
</html>`;
