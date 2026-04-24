'use strict';
module.exports = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>OMEGA DASHBOARD — GOD MODE v8</title>
<style>
:root{--bg:#0b0f19;--card:#111827;--border:#1f2937;--text:#e2e8f0;--muted:#94a3b8;--primary:#3b82f6;--success:#22c55e;--warn:#f59e0b;--danger:#ef4444;--gold:#f59e0b}
*{box-sizing:border-box;margin:0;padding:0;font-family:'Inter',system-ui,-apple-system,sans-serif}
body{background:linear-gradient(135deg,#0b0f19,#0f172a);color:var(--text);min-height:100vh;overflow-x:hidden}
header{background:rgba(17,24,39,0.85);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:50}
header h1{color:var(--primary);font-size:20px;font-weight:700;display:flex;align-items:center;gap:10px}
header .status{display:flex;gap:10px;align-items:center}
.badge{background:var(--success);color:#fff;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.ws-status{background:var(--warn);color:#000;padding:4px 8px;border-radius:99px;font-size:10px;font-weight:600}
.ws-status.connected{background:var(--success);color:#fff}
nav{background:var(--card);border-bottom:1px solid var(--border);display:flex;overflow-x:auto;scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
.tab{padding:14px 20px;cursor:pointer;border-bottom:3px solid transparent;transition:all .2s;color:var(--muted);font-weight:500;white-space:nowrap;font-size:14px}
.tab:hover{color:var(--primary)}
.tab.active{color:var(--primary);border-bottom-color:var(--primary);background:rgba(59,130,246,0.05)}
main{padding:20px;max-width:1400px;margin:0 auto}
.page{display:none}
.page.active{display:block;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.card{background:var(--card);border-radius:12px;padding:18px;border:1px solid var(--border);transition:transform .2s,border-color .2s;position:relative;overflow:hidden}
.card:hover{transform:translateY(-2px);border-color:var(--primary)}
.card h3{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.card .value{font-size:28px;font-weight:700;color:#f8fafc}
.value.gold{color:var(--gold)}.value.green{color:var(--success)}.value.red{color:var(--danger)}.value.blue{color:var(--primary)}
.section{background:var(--card);border-radius:12px;border:1px solid var(--border);margin-bottom:20px;overflow:hidden}
.section h2{padding:16px 20px;border-bottom:1px solid var(--border);color:#f8fafc;display:flex;justify-content:space-between;align-items:center;font-size:16px}
.section-body{padding:16px 20px;max-height:450px;overflow-y:auto;scrollbar-width:thin}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px}
.row:last-child{border-bottom:none}.row:hover{background:rgba(255,255,255,0.03)}
.rank-num{color:var(--gold);font-weight:700;width:40px}
.btn{background:var(--primary);color:#fff;padding:8px 14px;border:none;border-radius:8px;cursor:pointer;font-weight:500;transition:background .2s;font-size:13px}
.btn:hover{background:#2563eb}
.btn.danger{background:var(--danger)}.btn.danger:hover{background:#dc2626}
.btn.warn{background:var(--warn);color:#000}.btn.warn:hover{background:#d97706}
.btn.success{background:var(--success)}.btn.success:hover{background:#16a34a}
.btn.small{padding:6px 10px;font-size:12px}
input,select,textarea{background:#0f172a;border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;width:100%;margin-bottom:10px;font-size:13px}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(59,130,246,0.2)}
label{display:block;margin-bottom:6px;color:var(--muted);font-size:13px;font-weight:500}
.modal{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:1000;justify-content:center;align-items:center;backdrop-filter:blur(6px)}
.modal.open{display:flex}
.modal-content{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:32px;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5)}
.modal-content h2{color:var(--primary);margin-bottom:16px;font-size:20px}
.cmd-toggle{display:flex;justify-content:space-between;align-items:center;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;margin-bottom:8px}
.cmd-toggle.disabled{opacity:0.5;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3)}
.switch{position:relative;width:48px;height:26px;background:#374151;border-radius:99px;cursor:pointer;transition:background .2s}
.switch.on{background:var(--success)}
.switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left .2s}
.switch.on::after{left:25px}
.admin-warning{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);padding:14px;border-radius:10px;margin-bottom:16px;color:#fca5a5;font-size:14px;display:flex;align-items:center;gap:8px}
.log-entry{padding:8px 12px;border-bottom:1px solid var(--border);font-family:'JetBrains Mono',monospace;font-size:12px;display:flex;gap:8px}
.log-entry.INFO{color:#60a5fa}.log-entry.WARN{color:#fbbf24}.log-entry.ERROR{color:#f87171}.log-entry.SUCCESS{color:#4ade80}
.ts{color:#64748b;min-width:160px}
footer{text-align:center;padding:24px;color:#475569;font-size:12px;border-top:1px solid var(--border)}
.chart-bar{height:8px;background:#1e
