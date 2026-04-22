// Self-contained monitoring dashboard HTML. One file, no external deps.
// Polls /agent/stats and /agent/recent every 5s.

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>alAsil Agent Dashboard</title>
<style>
  :root {
    --bg:          #0b0d10;
    --panel:       #14181d;
    --panel-2:     #1a1f25;
    --border:      #252b33;
    --text:        #e6edf3;
    --text-dim:    #8b949e;
    --accent:      #58a6ff;
    --green:       #3fb950;
    --yellow:      #d29922;
    --red:         #f85149;
    --mono:        ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  body { min-height: 100vh; padding: 20px; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .header h1 { margin: 0; font-size: 22px; font-weight: 600; }
  .header .sub { color: var(--text-dim); font-size: 13px; margin-top: 4px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; background: var(--panel-2); border: 1px solid var(--border); color: var(--text-dim); }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); }
  .badge.live .dot { background: var(--green); animation: pulse 2s infinite; }
  .badge.error .dot { background: var(--red); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
  @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 500px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .card .label { color: var(--text-dim); font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 8px; }
  .card .value { font-size: 26px; font-weight: 600; font-family: var(--mono); }
  .card .value.ok { color: var(--green); }
  .card .value.warn { color: var(--yellow); }
  .card .value.bad { color: var(--red); }
  .card .hint { color: var(--text-dim); font-size: 11px; margin-top: 6px; }
  .section { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
  .section h2 { margin: 0; padding: 14px 16px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--border); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; background: var(--panel-2); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--panel-2); }
  .mono { font-family: var(--mono); font-size: 12px; color: var(--text-dim); }
  .tool-pill { display: inline-block; padding: 2px 8px; margin: 2px 2px 2px 0; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; font-family: var(--mono); }
  .tool-pill.empty { color: var(--yellow); border-color: rgba(210, 153, 34, 0.3); }
  .tool-pill.hit { color: var(--green); border-color: rgba(63, 185, 80, 0.3); }
  .status-err { color: var(--red); font-weight: 600; }
  .status-max { color: var(--yellow); font-weight: 600; }
  .status-ok { color: var(--green); font-weight: 600; }
  .text-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 900px) { .text-cell { max-width: 180px; } }
  .ts { font-family: var(--mono); color: var(--text-dim); font-size: 11px; white-space: nowrap; }
  .controls { display: flex; gap: 8px; align-items: center; }
  button { background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; }
  button:hover { background: var(--panel-2); border-color: var(--accent); }
  .loading { color: var(--text-dim); font-size: 13px; padding: 20px; text-align: center; }
  .alert-banner { background: rgba(248, 81, 73, 0.1); border: 1px solid var(--red); color: var(--red); padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
  .alert-banner .alert-title { font-weight: 600; margin-right: 8px; }
  .alert-banner.warn { background: rgba(210, 153, 34, 0.1); border-color: var(--yellow); color: var(--yellow); }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>alAsil Agent Dashboard</h1>
      <div class="sub" id="sub">Loading…</div>
    </div>
    <div class="controls">
      <span class="badge" id="status-badge"><span class="dot"></span> <span id="status-text">Connecting…</span></span>
      <button onclick="refresh(true)">Refresh now</button>
    </div>
  </div>

  <div id="alerts"></div>

  <div class="grid">
    <div class="card">
      <div class="label">Total turns</div>
      <div class="value" id="m-turns">—</div>
      <div class="hint">Since server start</div>
    </div>
    <div class="card">
      <div class="label">Avg latency</div>
      <div class="value" id="m-lat">—</div>
      <div class="hint">Per agent turn</div>
    </div>
    <div class="card">
      <div class="label">Error rate</div>
      <div class="value" id="m-err">—</div>
      <div class="hint"><span id="m-err-n">0</span> / <span id="m-turns-2">0</span> turns</div>
    </div>
    <div class="card">
      <div class="label">Max-iter rate</div>
      <div class="value" id="m-max">—</div>
      <div class="hint"><span id="m-max-n">0</span> turns hit max</div>
    </div>
  </div>

  <div class="section">
    <h2>Tool usage</h2>
    <table>
      <thead>
        <tr><th>Tool</th><th style="text-align:right">Calls</th><th style="text-align:right">Empty results</th><th style="text-align:right">Hit rate</th></tr>
      </thead>
      <tbody id="tools-body">
        <tr><td colspan="4" class="loading">Loading…</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Recent turns</h2>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Status</th>
          <th>Lang</th>
          <th>User</th>
          <th>Tools</th>
          <th>Reply</th>
          <th style="text-align:right">Latency</th>
        </tr>
      </thead>
      <tbody id="recent-body">
        <tr><td colspan="7" class="loading">Loading…</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    const ROOT = window.location.pathname.replace(/\\/dashboard.*/, '');

    function fmtMs(ms) {
      if (!ms && ms !== 0) return '—';
      if (ms < 1000) return ms + ' ms';
      return (ms / 1000).toFixed(1) + ' s';
    }
    function fmtUptime(ms) {
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + sec + 's';
      return sec + 's';
    }
    function fmtPct(rate) {
      return (rate * 100).toFixed(1) + '%';
    }
    function fmtTs(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch { return iso; }
    }
    function escapeHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    let lastTurns = 0;

    async function refresh(manual) {
      const badge = document.getElementById('status-badge');
      const statusText = document.getElementById('status-text');
      try {
        const [statsResp, recentResp] = await Promise.all([
          fetch(ROOT + '/agent/stats', { cache: 'no-store' }),
          fetch(ROOT + '/agent/recent?n=25', { cache: 'no-store' }),
        ]);
        if (!statsResp.ok || !recentResp.ok) throw new Error('endpoint error');
        const stats = await statsResp.json();
        const recent = await recentResp.json();

        badge.className = 'badge live';
        statusText.textContent = 'Live';

        // Header sub
        document.getElementById('sub').textContent =
          'Uptime ' + fmtUptime(stats.uptime_ms || 0) +
          ' · Last refresh ' + new Date().toLocaleTimeString();

        // Metrics
        document.getElementById('m-turns').textContent = stats.total_turns || 0;
        document.getElementById('m-turns-2').textContent = stats.total_turns || 0;
        document.getElementById('m-lat').textContent = fmtMs(stats.avg_latency_ms || 0);
        document.getElementById('m-err').textContent = fmtPct(stats.error_rate || 0);
        document.getElementById('m-err-n').textContent = stats.total_errors || 0;
        document.getElementById('m-max').textContent = fmtPct(stats.maxed_rate || 0);
        document.getElementById('m-max-n').textContent = stats.total_max_iter || 0;

        // Color-code metrics
        const errEl = document.getElementById('m-err');
        errEl.className = 'value ' + (stats.error_rate > 0.05 ? 'bad' : stats.error_rate > 0 ? 'warn' : 'ok');
        const maxEl = document.getElementById('m-max');
        maxEl.className = 'value ' + (stats.maxed_rate > 0.08 ? 'bad' : stats.maxed_rate > 0 ? 'warn' : 'ok');
        const latEl = document.getElementById('m-lat');
        latEl.className = 'value ' + (stats.avg_latency_ms > 20000 ? 'bad' : stats.avg_latency_ms > 15000 ? 'warn' : 'ok');

        // Alerts
        const alerts = [];
        if ((stats.error_rate || 0) > 0.05) alerts.push({ level: 'bad', text: 'Error rate above 5% — check recent failures below' });
        if ((stats.maxed_rate || 0) > 0.08) alerts.push({ level: 'bad', text: 'Max-iteration rate above 8% — agent is hitting the tool-call cap too often' });
        if ((stats.avg_latency_ms || 0) > 20000) alerts.push({ level: 'warn', text: 'Average latency above 20s — customers will feel lag' });
        let toolCalls = 0, toolEmpty = 0;
        for (const [, t] of Object.entries(stats.by_tool || {})) {
          toolCalls += t.calls || 0;
          toolEmpty += t.zero_results || 0;
        }
        if (toolCalls > 10 && toolEmpty / toolCalls > 0.3) {
          alerts.push({ level: 'warn', text: Math.round(100 * toolEmpty / toolCalls) + '% of tool calls returned 0 results — search quality may be degrading' });
        }
        const ab = document.getElementById('alerts');
        ab.innerHTML = alerts.map(a => '<div class="alert-banner ' + (a.level === 'warn' ? 'warn' : '') + '"><span class="alert-title">ALERT</span>' + escapeHtml(a.text) + '</div>').join('');

        // Tool usage
        const toolRows = Object.entries(stats.by_tool || {}).sort((a, b) => b[1].calls - a[1].calls);
        const toolsHtml = toolRows.length === 0
          ? '<tr><td colspan="4" class="loading">No tool calls yet</td></tr>'
          : toolRows.map(([name, s]) => {
              const hit = s.calls ? ((s.calls - s.zero_results) / s.calls * 100).toFixed(0) + '%' : '—';
              const hitClass = s.calls && (s.calls - s.zero_results) / s.calls > 0.7 ? 'status-ok' : 'status-max';
              return '<tr><td class="mono">' + escapeHtml(name) + '</td><td style="text-align:right">' + s.calls + '</td><td style="text-align:right">' + s.zero_results + '</td><td style="text-align:right" class="' + hitClass + '">' + hit + '</td></tr>';
            }).join('');
        document.getElementById('tools-body').innerHTML = toolsHtml;

        // Recent turns
        const recentHtml = (recent.turns || []).length === 0
          ? '<tr><td colspan="7" class="loading">No turns yet — send a Telegram message to the bot</td></tr>'
          : (recent.turns || []).map(t => {
              const status = t.error ? '<span class="status-err">ERR</span>' : t.maxed_out ? '<span class="status-max">MAX</span>' : '<span class="status-ok">OK</span>';
              const tools = (t.tool_calls || []).map(tc => {
                const cls = (tc.count || 0) > 0 ? 'tool-pill hit' : 'tool-pill empty';
                return '<span class="' + cls + '">' + escapeHtml(tc.name) + '(' + (tc.count || 0) + ')</span>';
              }).join('') || '<span class="mono">—</span>';
              return '<tr>' +
                '<td class="ts">' + fmtTs(t.ts) + '</td>' +
                '<td>' + status + '</td>' +
                '<td class="mono">' + escapeHtml(t.language || '—') + '</td>' +
                '<td class="text-cell" title="' + escapeHtml(t.msg) + '">' + escapeHtml(t.msg) + '</td>' +
                '<td>' + tools + '</td>' +
                '<td class="text-cell" title="' + escapeHtml(t.reply) + '">' + escapeHtml((t.reply || '').slice(0, 140)) + '</td>' +
                '<td class="mono" style="text-align:right">' + fmtMs(t.latency_ms || 0) + '</td>' +
              '</tr>';
            }).join('');
        document.getElementById('recent-body').innerHTML = recentHtml;

        // Flash new turn indicator
        if (stats.total_turns > lastTurns && !manual && lastTurns > 0) {
          document.title = '(' + (stats.total_turns - lastTurns) + ') alAsil Agent';
          setTimeout(() => { document.title = 'alAsil Agent Dashboard'; }, 2000);
        }
        lastTurns = stats.total_turns;
      } catch (err) {
        badge.className = 'badge error';
        statusText.textContent = 'Offline';
        console.error(err);
      }
    }

    refresh(true);
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
