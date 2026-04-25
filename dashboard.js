'use strict';
// =============================================================
// DASHBOARD HTML — v8 INFINITY EDITION (UPGRADED)
// =============================================================
module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GOD MODE v8 — Infinity Dashboard</title>
<style>
:root{
  --bg:#0a0f1e;--bg-card:rgba(30,41,59,0.8);--border:#334155;--text:#e2e8f0;--text-muted:#94a3b8;
  --primary:#6366f1;--success:#22c55e;--warning:#f59e0b;--danger:#ef4444;--glass:blur(10px);--radius:12px;
}
*{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',system-ui,sans-serif}
body{background:linear-gradient(135deg,var(--bg) 0%,#1a103c 100%);color:var(--text);min-height:100vh;display:flex;flex-direction:column}
header{background:#020617;padding:16px 24px;border-bottom:2px solid var(--primary);display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 12px rgba(99,102,241,0.2);position:sticky;top:0;z-index:50}
header h1{color:#818cf8;font-size:20px;display:flex;align-items:center;gap:8px}
.status{display:flex;gap:10px;align-items:center}
.badge{background:var(--success);color:#fff;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px}
.live-dot{width:8px;height:8px;background:#fff;border-radius:50%;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.ws-badge{background:var(--warning);color:#000;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;transition:all .3s}
.ws-badge.live{background:var(--success);color:#fff}

.tabs{background:#020617;padding:0 16px;border-bottom:1px solid var(--border);display:flex;gap:0;overflow-x:auto;position:sticky;top:60px;z-index:40}
.tab{padding:12px 18px;cursor:pointer;border-bottom:3px solid transparent;transition:all .2s;color:var(--text-muted);font-weight:500;white-space:nowrap}
.tab:hover{color:#818cf8;background:rgba(129,140,248,0.05)}
.tab.active{color:#818cf8;border-bottom-color:#818cf8}
.tab.admin{color:var(--warning)}
.tab.admin.active{border-bottom-color:var(--warning);color:#fbbf24}

main{flex:1;padding:24px;max-width:1400px;margin:0 auto;width:100%}
.page{display:none;animation:fadeIn .3s ease}
.page.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.card{background:var(--bg-card);backdrop-filter:var(--glass);border-radius:var(--radius);padding:20px;border:1px solid var(--border);transition:transform .2s,border-color .2s}
.card:hover{transform:translateY(-2px);border-color:var(--primary)}
.card h3{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.card .value{font-size:28px;font-weight:700}
.val-blue{color:var(--primary)}.val-green{color:var(--success)}.val-red{color:var(--danger)}.val-gold{color:var(--warning)}

.section{background:var(--bg-card);border-radius:var(--radius);border:1px solid var(--border);overflow:hidden;margin-bottom:20px}
.section h2{padding:14px 20px;border-bottom:1px solid var(--border);color:var(--text);display:flex;justify-content:space-between;align-items:center;font-size:16px}
.section-body{padding:16px 20px;max-height:500px;overflow-y:auto}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
.row:last-child{border-bottom:none}
.row:hover{background:rgba(51,65,85,0.3)}
.rank-num{color:var(--warning);font-weight:700;width:40px}
.mmr{color:#818cf8;font-weight:600}

.btn{background:var(--primary);color:#fff;padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-weight:500;transition:background .2s;font-size:13px}
.btn:hover{background:#4f46e5}
.btn.danger{background:var(--danger)}.btn.danger:hover{background:#dc2626}
.btn.warn{background:var(--warning);color:#000}.btn.warn:hover{background:#d97706}
.btn.success{background:var(--success)}.btn.success:hover{background:#16a34a}
.btn.small{padding:5px 10px;font-size:12px}
.btn:disabled{opacity:.5;cursor:not-allowed}

input,select,textarea{background:#0f172a;border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;width:100%;margin-bottom:8px;font-size:13px}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--primary)}
label{display:block;margin-bottom:4px;color:var(--text-muted);font-size:12px;font-weight:500}

.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:1000;justify-content:center;align-items:center;backdrop-filter:blur(4px)}
.modal.open{display:flex}
.modal-content{background:#1e293b;border:1px solid var(--primary);border-radius:var(--radius);padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.6)}
.modal-content h2{color:#818cf8;margin-bottom:12px;font-size:18px}

.cmd-toggle{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(51,65,85,0.4);border-radius:8px;margin-bottom:6px}
.cmd-toggle.disabled{opacity:.7;background:rgba(239,68,68,0.1);border:1px solid var(--danger)}
.switch{position:relative;width:44px;height:24px;background:#475569;border-radius:99px;cursor:pointer;transition:background .2s}
.switch.on{background:var(--success)}
.switch::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;background:#fff;border-radius:50%;transition:left .2s}
.switch.on::after{left:23px}

.admin-warning{background:rgba(239,68,68,0.1);border:1px solid var(--danger);padding:12px;border-radius:8px;margin-bottom:16px;color:#fca5a5;font-size:13px}
.log-entry{padding:6px 10px;border-bottom:1px solid var(--border);font-family:'Consolas',monospace;font-size:12px;display:flex;gap:10px}
.log-ts{color:#64748b;min-width:80px}
.lvl-INFO{color:#38bdf8}.lvl-WARN{color:var(--warning)}.lvl-ERROR{color:var(--danger)}.lvl-SUCCESS{color:var(--success)}.lvl-ADMIN{color:#fbbf24}

.toast-container{position:fixed;bottom:20px;right:20px;z-index:999;display:flex;flex-direction:column;gap:8px}
.toast{padding:12px 16px;border-radius:8px;background:#1e293b;border:1px solid var(--border);box-shadow:0 8px 24px rgba(0,0,0,0.4);animation:slideIn .3s ease;display:flex;align-items:center;gap:8px;font-size:13px;max-width:320px}
@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
.toast.success{border-left:4px solid var(--success)}.toast.error{border-left:4px solid var(--danger)}.toast.info{border-left:4px solid var(--primary)}.toast.warning{border-left:4px solid var(--warning)}

.guild-card{background:#0f172a;padding:12px;border-radius:8px;border:1px solid var(--border);margin-bottom:8px}
.guild-card h4{color:#818cf8;margin-bottom:4px}
.guild-card .meta{color:var(--text-muted);font-size:12px}
.loading{text-align:center;padding:30px;color:var(--text-muted)}
.hidden{display:none}
footer{text-align:center;padding:20px;color:#475569;font-size:12px;margin-top:auto}
@media(max-width:768px){.tabs{padding:0 8px}.tab{padding:10px 12px;font-size:13px}main{padding:16px}}
</style>
</head>
<body>
<header>
  <h1>⚡ GOD MODE v8 <span style="font-size:13px;color:#64748b;font-weight:400">Infinity Dashboard</span></h1>
  <div class="status">
    <span class="ws-badge" id="wsStatus">CONNECTING</span>
    <span class="badge"><span class="live-dot"></span>LIVE</span>
    <button class="btn small" id="authBtn">ADMIN LOGIN</button>
  </div>
</header>

<nav class="tabs">
  <div class="tab active" data-tab="overview">📊 Overview</div>
  <div class="tab" data-tab="leaderboard">🏆 Leaderboard</div>
  <div class="tab" data-tab="submissions">📝 Submissions</div>
  <div class="tab" data-tab="analytics">📈 Analytics</div>
  <div class="tab" data-tab="guilds">🏰 Guilds</div>
  <div class="tab" data-tab="logs">📋 Logs</div>
  <div class="tab" data-tab="audit">🔍 Audit</div>
  <div class="tab admin" data-tab="admin">🔐 Admin</div>
</nav>

<main>
  <div class="page active" id="page-overview">
    <div class="grid">
      <div class="card"><h3>Total Users</h3><div class="value val-blue" id="d-users">-</div></div>
      <div class="card"><h3>Submissions</h3><div class="value" id="d-subs">-</div></div>
      <div class="card"><h3>Pending Review</h3><div class="value val-red" id="d-pending">-</div></div>
      <div class="card"><h3>Jackpot Pool</h3><div class="value val-gold" id="d-jackpot">-</div></div>
      <div class="card"><h3>Total Bets</h3><div class="value val-green" id="d-bets">-</div></div>
      <div class="card"><h3>Uptime</h3><div class="value" id="d-uptime">-</div></div>
      <div class="card"><h3>Guilds</h3><div class="value val-blue" id="d-guilds">-</div></div>
      <div class="card"><h3>Members</h3><div class="value val-green" id="d-members">-</div></div>
      <div class="card"><h3>WS Clients</h3><div class="value" id="d-ws">-</div></div>
    </div>
    <div class="section"><h2>🏆 Top 5 Players</h2><div class="section-body" id="topPlayers"><div class="loading">Loading...</div></div></div>
  </div>

  <div class="page" id="page-leaderboard">
    <div class="section">
      <h2>🏆 Global Leaderboard <select id="lbSort" style="width:auto"><option value="elo">ELO</option><option value="balance">Balance</option><option value="level">Level</option><option value="totalWagered">Wagered</option><option value="totalWon">Won</option></select></h2>
      <div class="section-body" id="leaderboard"><div class="loading">Loading...</div></div>
    </div>
  </div>

  <div class="page" id="page-submissions">
    <div class="section">
      <h2>📝 Recent Submissions <select id="subFilter" style="width:auto"><option value="">All</option><option value="false">Pending</option><option value="true">Reviewed</option></select></h2>
      <div class="section-body" id="submissions"><div class="loading">Loading...</div></div>
    </div>
  </div>

  <div class="page" id="page-analytics">
    <div class="section"><h2>📈 Event Analytics (7d)</h2><div class="section-body" id="analytics"><div class="loading">Loading...</div></div></div>
    <div class="section"><h2>🔥 Command Usage</h2><div class="section-body" id="cmdStats"><div class="loading">Loading...</div></div></div>
  </div>

  <div class="page" id="page-guilds">
    <div class="section"><h2>🏰 Connected Guilds</h2><div class="section-body" id="guildsList"><div class="loading">Loading...</div></div></div>
  </div>

  <div class="page" id="page-logs">
    <div class="section"><h2>📋 System Logs <button class="btn small" id="refreshLogs">Refresh</button></h2><div class="section-body" id="logs"><div class="loading">Loading...</div></div></div>
  </div>

  <div class="page" id="page-audit">
    <div class="section"><h2>🔍 Audit Trail <button class="btn small" id="refreshAudit">Refresh</button></h2><div class="section-body" id="audit"><div class="loading">Loading...</div></div></div>
  </div>

  <div class="page" id="page-admin">
    <div id="adminLoginPrompt" class="card" style="max-width:400px;margin:0 auto;text-align:center">
      <h2 style="margin-bottom:12px">🔐 Owner Authentication</h2>
      <p style="color:var(--text-muted);margin-bottom:16px;font-size:13px">Secure JWT login required for admin controls.</p>
      <button class="btn" id="openLoginModal">Open Login</button>
    </div>
    <div id="adminPanel" class="hidden">
      <div class="admin-warning">⚠️ <b>Admin Panel</b> — Full system control. All actions are audit-logged.</div>
      <div class="grid">
        <div class="card"><h3>Authenticated As</h3><div class="value" id="adminUser" style="font-size:16px">-</div></div>
        <div class="card"><h3>Quick Actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn warn small" data-action="restart">Restart Bot</button><button class="btn small" data-action="logout">Logout</button></div></div>
      </div>

      <div class="section"><h2>⚡ Command Toggles</h2><div class="section-body" id="cmdToggles"><div class="loading">Loading...</div></div></div>

      <div class="section"><h2>⚙️ Bot Configuration</h2><div class="section-body" id="configForm"><div class="loading">Loading...</div></div></div>

      <div class="section"><h2>👤 User Management</h2>
        <div class="section-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>User ID</label><input type="text" id="mgmtUserId" placeholder="17-20 digit ID"></div>
            <div><label>Search Users</label><input type="text" id="userSearch" placeholder="Partial ID..."></div>
          </div>
          <div id="searchResults" style="margin:8px 0;max-height:120px;overflow-y:auto"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
            <div>
              <label>Balance</label><input type="number" id="mgmtBalance" placeholder="Amount">
              <select id="mgmtBalOp"><option value="set">Set</option><option value="add">Add</option><option value="subtract">Subtract</option></select>
              <button class="btn success small" data-action="updateBalance">Update Balance</button>
            </div>
            <div>
              <label>ELO</label><input type="number" id="mgmtElo" placeholder="New ELO">
              <button class="btn success small" data-action="updateElo">Update ELO</button>
              <div style="margin-top:8px;display:flex;gap:6px">
                <button class="btn small" data-action="grantPremium">Grant Premium</button>
                <button class="btn danger small" data-action="revokePremium">Revoke</button>
              </div>
            </div>
          </div>
          <label style="margin-top:12px">Send DM</label>
          <textarea id="mgmtDm" rows="2" placeholder="Message to user..."></textarea>
          <button class="btn small" data-action="sendDm">Send DM</button>
        </div>
      </div>

      <div class="section"><h2>💎 Jackpot Control</h2>
        <div class="section-body">
          <div style="display:flex;gap:10px;align-items:flex-end">
            <div style="flex:1"><label>Set Amount</label><input type="number" id="jpAmount" placeholder="0"></div>
            <button class="btn success small" data-action="setJackpot">Update</button>
            <button class="btn danger small" data-action="resetJackpot">Reset</button>
          </div>
        </div>
      </div>

      <div class="section"><h2>📢 Broadcast</h2>
        <div class="section-body">
          <label>Channel Name</label><input type="text" id="broadcastCh" value="general">
          <label>Message</label><textarea id="broadcastMsg" rows="2" placeholder="Announcement..."></textarea>
          <button class="btn warn small" data-action="broadcast">📣 Send to All Guilds</button>
        </div>
      </div>

      <div class="section"><h2>🎮 Bot Presence</h2>
        <div class="section-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px">
            <select id="presStatus"><option value="online">Online</option><option value="idle">Idle</option><option value="dnd">DND</option><option value="invisible">Invisible</option></select>
            <select id="presType"><option value="playing">Playing</option><option value="streaming">Streaming</option><option value="listening">Listening</option><option value="watching">Watching</option><option value="competing">Competing</option></select>
            <input type="text" id="presActivity" placeholder="Activity text...">
          </div>
          <button class="btn success small" style="margin-top:8px" data-action="updatePresence">Update Presence</button>
        </div>
      </div>

      <div class="section"><h2>🔑 Premium Codes</h2>
        <div class="section-body">
          <div style="display:flex;gap:10px;align-items:flex-end">
            <div style="width:80px"><label>Count</label><input type="number" id="codeCount" value="1" min="1" max="100"></div>
            <button class="btn small" data-action="genCodes">Generate</button>
          </div>
          <div id="genCodesOut" style="margin-top:10px;font-family:monospace;font-size:12px"></div>
        </div>
      </div>

      <div class="section"><h2>🛠️ System Info</h2><div class="section-body" id="sysInfo"><div class="loading">Loading...</div></div></div>
    </div>
  </div>
</main>

<div class="toast-container" id="toasts"></div>

<div class="modal" id="loginModal">
  <div class="modal-content">
    <h2>🔐 Owner Login</h2>
    <label>Discord User ID</label><input type="text" id="loginUid" placeholder="Your ID">
    <label>Admin Password</label><input type="password" id="loginPass" placeholder="ENV password">
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn success" id="doLogin">🔓 Authenticate</button>
      <button class="btn danger" id="closeLogin">Cancel</button>
    </div>
    <div id="loginErr" style="color:var(--danger);margin-top:10px;font-size:12px"></div>
  </div>
</div>

<footer>⚡ GOD MODE v8 Infinity Edition • Live Dashboard • WebSocket Enabled • Zero Backend Mods</footer>

<script>
(function(){
  const $ = id => document.getElementById(id);
  const state = { token: localStorage.getItem('gm_token')||null, userId: localStorage.getItem('gm_uid')||null, tab: 'overview', ws: null, wsTimer: null };
  const fmt = n => new Intl.NumberFormat().format(n??0);
  const fmtTime = s => { const h=Math.floor(s/3600), m=Math.floor((s%3600)/60); return h+'h '+m+'m'; };

  // Toast System
  function toast(msg, type='info'){
    const t = document.createElement('div');
    t.className = 'toast '+type;
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(()=>t.remove(), 4000);
  }

  // API Wrapper
  async function api(path, opts={}){
    const headers = {'Content-Type':'application/json', ...(opts.headers||{})};
    if(state.token) headers['Authorization'] = 'Bearer '+state.token;
    try{
      const r = await fetch(path, {...opts, headers});
      const j = await r.json();
      if(!r.ok) throw new Error(j.error||'API Error');
      return j;
    }catch(e){ toast(e.message,'error'); throw e; }
  }

  // WebSocket Manager
  function connectWS(){
    const proto = location.protocol==='https:'?'wss:':'ws:';
    state.ws = new WebSocket(proto+'//'+location.host+'/ws');
    state.ws.onopen = ()=>{
      $('wsStatus').textContent='LIVE'; $('wsStatus').classList.add('live');
      if(state.token) state.ws.send(JSON.stringify({type:'auth',token:state.token}));
    };
    state.ws.onmessage = e=>{
      try{
        const {event,data} = JSON.parse(e.data);
        if(event==='stats_update') updateDash(data);
        if(event==='jackpot_updated') $('d-jackpot').textContent=fmt(data.amount)+' 🪙';
        if(event==='command_toggled' && state.tab==='admin') loadCmdToggles();
        if(event==='server_restart') toast('Server restarting in 3s...','warning');
        if(event==='auth_ok') toast('WS Admin Authenticated','success');
      }catch{}
    };
    state.ws.onclose = ()=>{
      $('wsStatus').textContent='RECONNECTING'; $('wsStatus').classList.remove('live');
      clearTimeout(state.wsTimer);
      state.wsTimer = setTimeout(connectWS, 3000);
    };
  }

  // UI Router
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
  function switchTab(tab){
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
    document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+tab));
    loadTab(tab);
  }

  async function loadTab(tab){
    try{
      if(tab==='overview') await loadOverview();
      if(tab==='leaderboard') await loadLeaderboard();
      if(tab==='submissions') await loadSubmissions();
      if(tab==='analytics') await loadAnalytics();
      if(tab==='guilds') await loadGuilds();
      if(tab==='logs') await loadLogs();
      if(tab==='audit') await loadAudit();
      if(tab==='admin') await loadAdmin();
    }catch(e){}
  }

  function updateDash(d){
    $('d-users').textContent=fmt(d.users);
    $('d-jackpot').textContent=fmt(d.jackpot)+' 🪙';
    $('d-uptime').textContent=fmtTime(d.uptime);
    $('d-guilds').textContent=fmt(d.guilds);
    $('d-members').textContent=fmt(d.members);
    $('d-ws').textContent=fmt(d.wsClients);
    $('d-cache').textContent=fmt(d.cacheSize);
  }

  async function loadOverview(){
    const d = await api('/api/dashboard');
    $('d-subs').textContent=fmt(d.totalSubmissions);
    $('d-pending').textContent=fmt(d.pendingReviews);
    $('d-bets').textContent=fmt(d.totalBets);
    updateDash(d);
    const lb = await api('/api/leaderboard?limit=5');
    $('topPlayers').innerHTML = lb.data.map((u,i)=>'<div class="row"><span class="rank-num">#'+(i+1)+'</span><span>'+u.userId+'</span><span class="mmr">'+fmt(u.elo)+' ELO</span></div>').join('');
  }

  async function loadLeaderboard(){
    const sort = $('lbSort').value;
    const lb = await api('/api/leaderboard?limit=50&sortBy='+sort);
    $('leaderboard').innerHTML = lb.data.map((u,i)=>'<div class="row"><span class="rank-num">#'+(i+1)+'</span><span>'+u.userId+'</span><span class="mmr">'+fmt(u[sort]||u.elo)+'</span></div>').join('');
  }

  async function loadSubmissions(){
    const f = $('subFilter').value;
    const url = '/api/submissions'+(f?'?reviewed='+f:'');
    const s = await api(url);
    $('submissions').innerHTML = s.data.length ? s.data.map(x=>'<div class="row"><div><b>'+x.userId+'</b><br><span style="color:var(--text-muted);font-size:12px">'+(x.url||'').slice(0,60)+'</span></div><span class="'+(x.reviewed?'mmr':'')+'">'+(x.reviewed?'✅ Reviewed':'⏳ Pending')+'</span></div>').join('') : '<div style="text-align:center;color:var(--text-muted);padding:20px">No submissions.</div>';
  }

  async function loadAnalytics(){
    const ev = await api('/api/analytics?days=7');
    $('analytics').innerHTML = ev.byType.length ? ev.byType.map(e=>'<div class="row"><span>'+e._id+'</span><span class="mmr">'+e.count+'</span></div>').join('') : '<div style="padding:20px;color:var(--text-muted)">No data.</div>';
    const cmd = await api('/api/commands/stats');
    $('cmdStats').innerHTML = cmd.length ? cmd.map(c=>'<div class="row"><span>!'+c._id+'</span><span><span class="mmr">'+c.count+'</span> runs ('+c.success+' ok)</span></div>').join('') : '<div style="padding:20px;color:var(--text-muted)">No data.</div>';
  }

  async function loadGuilds(){
    const g = await api('/api/guilds');
    $('guildsList').innerHTML = g.map(x=>'<div class="guild-card"><h4>'+x.name+'</h4><div class="meta">ID: '+x.id+' | Members: '+x.memberCount+' | Channels: '+x.channels+' | Roles: '+x.roles+'</div>'+(state.token?'<button class="btn warn small" style="margin-top:8px" data-action="syncRole" data-gid="'+x.id+'">🔄 Sync Roles</button>':'')+'</div>').join('');
  }

  async function loadLogs(){
    const l = await api('/api/logs?limit=200');
    $('logs').innerHTML = l.map(x=>'<div class="log-entry lvl-'+x.level+'"><span class="log-ts">'+new Date(x.ts).toLocaleTimeString()+'</span><span>['+x.level+']</span><span>'+x.msg+'</span></div>').join('');
  }

  async function loadAudit(){
    const a = await api('/api/audit?limit=50');
    $('audit').innerHTML = a.length ? a.map(x=>'<div class="log-entry lvl-ADMIN"><span class="log-ts">'+new Date(x.timestamp).toLocaleTimeString()+'</span><span>['+x.action+']</span><span>'+JSON.stringify(x.data||{}).slice(0,80)+'</span></div>').join('') : '<div style="padding:20px;color:var(--text-muted)">No audit logs.</div>';
  }

  // Admin Flow
  async function loadAdmin(){
    if(!state.token){ $('adminLoginPrompt').classList.remove('hidden'); $('adminPanel').classList.add('hidden'); return; }
    $('adminLoginPrompt').classList.add('hidden'); $('adminPanel').classList.remove('hidden');
    $('adminUser').textContent = state.userId;
    await Promise.all([loadCmdToggles(), loadConfig(), loadSysInfo()]);
  }

  async function loadCmdToggles(){
    const d = await api('/api/commands/list');
    $('cmdToggles').innerHTML = d.all.map(c=>{
      const off = d.disabled.includes(c);
      return '<div class="cmd-toggle '+(off?'disabled':'')+'"><span><b>!'+c+'</b></span><div class="switch '+(off?'':'on')+'" data-action="toggleCmd" data-cmd="'+c+'" data-state="'+off+'"></div></div>';
    }).join('');
  }

  async function loadConfig(){
    const c = await api('/api/admin/config');
    const allowed = ['prefix','autoDeleteSeconds','jackpotCut','autoRoleId','reviewChannelId','logChannelId','maxBet','minBet','dailyAmount','dailyStreakBonus'];
    $('configForm').innerHTML = allowed.map(k=>'<div style="margin-bottom:8px"><label>'+k+'</label><input type="text" data-cfg="'+k+'" value="'+(Array.isArray(c[k])?c[k].join(','):c[k])+'"></div>').join('')+'<button class="btn success small" data-action="saveConfig">Save Configuration</button>';
  }

  async function loadSysInfo(){
    const i = await api('/api/admin/system/info');
    $('sysInfo').innerHTML = '<div class="row"><span>Node</span><span class="mmr">'+i.node+'</span></div><div class="row"><span>Platform</span><span class="mmr">'+i.platform+'</span></div><div class="row"><span>Memory</span><span class="mmr">'+i.memory.rss+'</span></div><div class="row"><span>Uptime</span><span class="mmr">'+Math.floor(i.uptime)+'s</span></div><div class="row"><span>PID</span><span class="mmr">'+i.pid+'</span></div>';
  }

  // Event Delegation
  document.addEventListener('click', async e=>{
    const t = e.target.closest('[data-action]');
    if(!t) return;
    const act = t.dataset.action;
    try{
      if(act==='toggleCmd'){
        const cmd=t.dataset.cmd, enabled=t.dataset.state==='true';
        await api('/api/admin/commands/toggle',{method:'POST',body:{command:cmd,enabled}});
        toast('Command '+cmd+(enabled?' enabled':' disabled'),'success');
        loadCmdToggles();
      }
      if(act==='saveConfig'){
        const updates={};
        document.querySelectorAll('[data-cfg]').forEach(i=>{
          let v=i.value; if(!isNaN(v)&&v.trim()!=='') v=Number(v); if(v==='true')v=true; if(v==='false')v=false;
          updates[i.dataset.cfg]=v;
        });
        await api('/api/admin/config/update',{method:'POST',body:updates});
        toast('Config saved','success');
      }
      if(act==='updateBalance'){
        const uid=$('mgmtUserId').value, amt=parseInt($('mgmtBalance').value), op=$('mgmtBalOp').value;
        if(!uid||isNaN(amt)) return toast('Invalid input','error');
        const r=await api('/api/admin/user/balance',{method:'POST',body:{userId:uid,amount:amt,operation:op}});
        toast('Balance: '+r.balance,'success');
      }
      if(act==='updateElo'){
        const uid=$('mgmtUserId').value, elo=parseInt($('mgmtElo').value);
        if(!uid||isNaN(elo)) return toast('Invalid input','error');
        await api('/api/admin/user/elo',{method:'POST',body:{userId:uid,elo}});
        toast('ELO updated','success');
      }
      if(act==='grantPremium'||act==='revokePremium'){
        const uid=$('mgmtUserId').value; if(!uid) return toast('Enter User ID','error');
        await api('/api/admin/user/premium',{method:'POST',body:{userId:uid,premium:act==='grantPremium'}});
        toast('Premium updated','success');
      }
      if(act==='sendDm'){
        const uid=$('mgmtUserId').value, msg=$('mgmtDm').value; if(!uid||!msg) return toast('Missing fields','error');
        await api('/api/admin/user/dm',{method:'POST',body:{userId:uid,message:msg}});
        toast('DM sent','success');
      }
      if(act==='setJackpot'){
        const amt=parseInt($('jpAmount').value); if(isNaN(amt)) return;
        await api('/api/admin/jackpot/set',{method:'POST',body:{amount:amt}});
        toast('Jackpot set','success');
      }
      if(act==='resetJackpot'){
        if(!confirm('Reset jackpot?')) return;
        await api('/api/admin/jackpot/reset',{method:'POST'});
        toast('Jackpot reset','success');
      }
      if(act==='broadcast'){
        const msg=$('broadcastMsg').value, ch=$('broadcastCh').value; if(!msg) return;
        if(!confirm('Broadcast to ALL guilds?')) return;
        const r=await api('/api/admin/broadcast',{method:'POST',body:{message:msg,channelName:ch}});
        toast('Sent to '+r.sent+' guilds','success');
      }
      if(act==='updatePresence'){
        await api('/api/admin/presence',{method:'POST',body:{status:$('presStatus').value,type:$('presType').value,activity:$('presActivity').value}});
        toast('Presence updated','success');
      }
      if(act==='genCodes'){
        const c=parseInt($('codeCount').value)||1;
        const r=await api('/api/admin/code/generate',{method:'POST',body:{count:c}});
        $('genCodesOut').innerHTML=r.codes.map(x=>'<div style="padding:4px;background:#0f172a;margin:2px 0;border-radius:4px">'+x+'</div>').join('');
        toast('Codes generated','success');
      }
      if(act==='syncRole'){
        if(!confirm('Sync auto-role for all members?')) return;
        const r=await api('/api/admin/role/sync',{method:'POST',body:{guildId:t.dataset.gid}});
        toast('Assigned:'+r.assigned+' Skipped:'+r.skipped,'success');
      }
      if(act==='restart'){
        if(!confirm('Restart bot process?')) return;
        await api('/api/admin/system/restart',{method:'POST'});
        toast('Restarting...','warning');
      }
      if(act==='logout'){
        await api('/api/admin/logout',{method:'POST'}).catch(()=>{});
        state.token=null; state.userId=null;
        localStorage.removeItem('gm_token'); localStorage.removeItem('gm_uid');
        toast('Logged out','info');
        switchTab('overview');
      }
    }catch(err){}
  });

  // User Search
  let searchTimeout;
  $('userSearch').addEventListener('input', e=>{
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async ()=>{
      const q=e.target.value.trim(); if(q.length<3) return $('searchResults').innerHTML='';
      try{
        const u=await api('/api/admin/users/search?q='+q);
        $('searchResults').innerHTML=u.map(x=>'<div class="row" style="cursor:pointer;padding:6px" onclick="document.getElementById(\\'mgmtUserId\\').value=\\''+x.userId+'\\'"><span>'+x.userId+'</span><span class="mmr">'+fmt(x.balance)+' 🪙</span></div>').join('');
      }catch{}
    }, 400);
  });

  // Login Modal
  $('authBtn').addEventListener('click', ()=> state.token ? switchTab('admin') : $('loginModal').classList.add('open'));
  $('openLoginModal').addEventListener('click', ()=> $('loginModal').classList.add('open'));
  $('closeLogin').addEventListener('click', ()=>{ $('loginModal').classList.remove('open'); $('loginErr').textContent=''; });
  $('doLogin').addEventListener('click', async ()=>{
    const uid=$('loginUid').value.trim(), pass=$('loginPass').value;
    if(!uid||!pass) return $('loginErr').textContent='Missing fields';
    try{
      const r=await api('/api/admin/login',{method:'POST',body:{userId:uid,password:pass}});
      state.token=r.token; state.userId=r.userId;
      localStorage.setItem('gm_token',r.token); localStorage.setItem('gm_uid',r.userId);
      $('loginModal').classList.remove('open');
      toast('Authenticated','success');
      if(state.ws?.readyState===WebSocket.OPEN) state.ws.send(JSON.stringify({type:'auth',token:state.token}));
      switchTab('admin');
    }catch(e){ $('loginErr').textContent='❌ '+e.message; }
  });

  // Refresh Buttons
  $('refreshLogs').addEventListener('click', loadLogs);
  $('refreshAudit').addEventListener('click', loadAudit);
  $('lbSort').addEventListener('change', loadLeaderboard);
  $('subFilter').addEventListener('change', loadSubmissions);

  // Init
  connectWS();
  if(state.token){
    api('/api/admin/verify',{method:'POST'}).then(()=>switchTab('overview')).catch(()=>{
      state.token=null; state.userId=null; localStorage.removeItem('gm_token'); localStorage.removeItem('gm_uid');
    });
  }
  loadTab('overview');
})();
</script>
</body>
</html>`;
