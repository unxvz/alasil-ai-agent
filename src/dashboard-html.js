// Self-contained monitoring dashboard HTML. One file, no external deps.
// Polls /agent/stats, /agent/recent, /agent/corrections every 5s.

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
  .section h2 { margin: 0; padding: 14px 16px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--border); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; display: flex; justify-content: space-between; align-items: center; }
  .section h2 .hint { text-transform: none; font-weight: 400; font-size: 11px; color: var(--text-dim); letter-spacing: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; background: var(--panel-2); }
  tr:last-child td { border-bottom: none; }
  tr.recent-row:hover td { background: var(--panel-2); }
  .mono { font-family: var(--mono); font-size: 12px; color: var(--text-dim); }
  .tool-pill { display: inline-block; padding: 2px 8px; margin: 2px 2px 2px 0; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; font-family: var(--mono); }
  .tool-pill.empty { color: var(--yellow); border-color: rgba(210, 153, 34, 0.3); }
  .tool-pill.hit { color: var(--green); border-color: rgba(63, 185, 80, 0.3); }
  .status-err { color: var(--red); font-weight: 600; }
  .status-max { color: var(--yellow); font-weight: 600; }
  .status-ok { color: var(--green); font-weight: 600; }
  .text-cell { max-width: 320px; }
  .text-cell .text { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; }
  @media (max-width: 900px) { .text-cell { max-width: 200px; } }
  .ts { font-family: var(--mono); color: var(--text-dim); font-size: 11px; white-space: nowrap; }
  .controls { display: flex; gap: 8px; align-items: center; }
  button { background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; }
  button:hover { background: var(--panel-2); border-color: var(--accent); }
  button.flag { background: transparent; border: 1px solid var(--border); color: var(--text-dim); padding: 4px 8px; font-size: 11px; }
  button.flag:hover { color: var(--red); border-color: var(--red); }
  button.flag.flagged { color: var(--red); border-color: var(--red); background: rgba(248, 81, 73, 0.08); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 600; }
  button.primary:hover { background: #79b8ff; border-color: #79b8ff; color: #000; }
  button.danger { color: var(--red); border-color: rgba(248, 81, 73, 0.3); }
  button.danger:hover { background: rgba(248, 81, 73, 0.1); }
  .loading { color: var(--text-dim); font-size: 13px; padding: 20px; text-align: center; }
  .alert-banner { background: rgba(248, 81, 73, 0.1); border: 1px solid var(--red); color: var(--red); padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
  .alert-banner .alert-title { font-weight: 600; margin-right: 8px; }
  .alert-banner.warn { background: rgba(210, 153, 34, 0.1); border-color: var(--yellow); color: var(--yellow); }
  .alert-banner.ok { background: rgba(63, 185, 80, 0.1); border-color: var(--green); color: var(--green); }

  /* Correction inline form */
  .correction-form { display: none; background: rgba(248, 81, 73, 0.06); border: 1px solid rgba(248, 81, 73, 0.2); border-radius: 8px; padding: 12px; margin: 8px 0; }
  .correction-form.open { display: block; }
  .correction-form label { display: block; color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; margin: 8px 0 4px 0; }
  .correction-form textarea { width: 100%; min-height: 60px; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 8px; border-radius: 6px; font-family: inherit; font-size: 13px; resize: vertical; }
  .correction-form textarea:focus { outline: none; border-color: var(--accent); }
  .correction-form .actions { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; flex-wrap: wrap; }
  .correction-form .actions .left { margin-right: auto; }
  .correction-form .gen-note { color: var(--text-dim); font-size: 11px; margin-top: 6px; font-style: italic; }
  .correction-form .generated-badge { display: inline-block; padding: 2px 8px; background: rgba(88, 166, 255, 0.1); border: 1px solid var(--accent); color: var(--accent); border-radius: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; margin-left: 6px; }
  button.generate { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 600; }
  button.generate:hover { background: #79b8ff; border-color: #79b8ff; color: #000; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(0,0,0,0.2); border-top-color: #000; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Corrections list */
  .correction-item { padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .correction-item:last-child { border-bottom: none; }
  .correction-item .row { display: flex; gap: 12px; align-items: flex-start; }
  .correction-item .body { flex: 1; min-width: 0; }
  .correction-item .ts-small { color: var(--text-dim); font-size: 11px; font-family: var(--mono); margin-bottom: 4px; }
  .correction-item .q { font-size: 13px; margin: 4px 0; }
  .correction-item .q-label { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  .correction-item .wrong-text { color: var(--red); font-size: 12px; background: rgba(248, 81, 73, 0.06); padding: 6px 10px; border-radius: 6px; margin: 4px 0; white-space: pre-wrap; }
  .correction-item .correct-text { color: var(--green); font-size: 12px; background: rgba(63, 185, 80, 0.06); padding: 6px 10px; border-radius: 6px; margin: 4px 0; white-space: pre-wrap; }

  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 100; }
  .toast.show { opacity: 1; }
  .toast.ok { border-color: var(--green); color: var(--green); }
  .toast.err { border-color: var(--red); color: var(--red); }
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
      <div class="label">Corrections learned</div>
      <div class="value ok" id="m-corr">—</div>
      <div class="hint">Injected into agent prompt</div>
    </div>
  </div>

  <div class="section">
    <h2>Corrections (owner feedback)
      <span class="hint">Flagged replies and preferred answers — agent learns from these on every turn</span>
    </h2>
    <div id="corrections-body">
      <div class="loading">Loading…</div>
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
    <h2>Recent turns
      <span class="hint">Click Flag on any turn to teach the agent the correct answer</span>
    </h2>
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
          <th></th>
        </tr>
      </thead>
      <tbody id="recent-body">
        <tr><td colspan="8" class="loading">Loading…</td></tr>
      </tbody>
    </table>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const PATHNAME = window.location.pathname;
    // Strip /dashboard[/secret] from pathname to find the app root (supports BASE_PATH).
    const ROOT = PATHNAME.replace(/\\/dashboard(\\/[^/?#]+)?$/, '');
    // If URL has /dashboard/:secret we pass the secret back on gated endpoints.
    const SECRET_MATCH = PATHNAME.match(/\\/dashboard\\/([^/?#]+)$/);
    const SECRET = SECRET_MATCH ? SECRET_MATCH[1] : '';
    const SECRET_HEADERS = SECRET ? { 'X-Dashboard-Secret': SECRET } : {};

    function api(p, opts) {
      const qs = SECRET ? (p.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(SECRET) : '';
      return fetch(ROOT + p + qs, Object.assign({ cache: 'no-store', headers: SECRET_HEADERS }, opts || {}));
    }

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
    function fmtPct(rate) { return (rate * 100).toFixed(1) + '%'; }
    function fmtTs(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch { return iso; }
    }
    function fmtDateTime(iso) {
      try { return new Date(iso).toLocaleString(); } catch { return iso; }
    }
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(msg, kind) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show ' + (kind || 'ok');
      setTimeout(() => { el.className = 'toast ' + (kind || 'ok'); }, 3000);
    }

    // Track which row's correction form is open
    let openFormKey = null;
    // Track which turns have been flagged (by msg+ts key)
    let flaggedKeys = new Set();

    function turnKey(t) { return (t.ts || '') + '::' + (t.msg || ''); }

    function toggleForm(key) {
      openFormKey = (openFormKey === key) ? null : key;
      document.querySelectorAll('.correction-form').forEach(el => {
        el.classList.toggle('open', el.getAttribute('data-key') === openFormKey);
      });
      document.querySelectorAll('button.flag').forEach(el => {
        el.classList.toggle('flagged', el.getAttribute('data-key') === openFormKey);
      });
    }

    async function generateReply(key, userMsg, wrongReply, lang) {
      const form = document.querySelector('.correction-form[data-key="' + CSS.escape(key) + '"]');
      if (!form) return;
      const whatWrong = form.querySelector('textarea[name=what_wrong]').value.trim();
      if (!whatWrong) {
        toast('First write WHY the reply was wrong — then I can generate the fix', 'err');
        return;
      }
      const btn = form.querySelector('button.generate');
      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Generating…';
      try {
        const resp = await api('/agent/corrections/generate', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, SECRET_HEADERS),
          body: JSON.stringify({
            user_msg: userMsg,
            wrong_reply: wrongReply,
            what_wrong: whatWrong,
            language: lang || 'en',
          }),
        });
        if (!resp.ok) {
          const txt = await resp.text();
          toast('Generate failed: ' + resp.status + ' ' + txt.slice(0, 80), 'err');
          return;
        }
        const data = await resp.json();
        const correctArea = form.querySelector('textarea[name=correct]');
        correctArea.value = data.generated || '';
        form.querySelector('.gen-note').style.display = 'block';
        toast('Generated — review and edit before saving');
      } catch (err) {
        toast('Network error: ' + err.message, 'err');
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }

    async function submitCorrection(key, userMsg, wrongReply) {
      const form = document.querySelector('.correction-form[data-key="' + CSS.escape(key) + '"]');
      if (!form) return;
      const correct = form.querySelector('textarea[name=correct]').value.trim();
      const note = form.querySelector('textarea[name=what_wrong]').value.trim();
      if (!correct && !note) {
        toast('Write what was wrong, generate a reply, or type one yourself', 'err');
        return;
      }
      try {
        const resp = await api('/agent/corrections', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, SECRET_HEADERS),
          body: JSON.stringify({ user_msg: userMsg, wrong_reply: wrongReply, correct_reply: correct, note: note }),
        });
        if (!resp.ok) {
          const txt = await resp.text();
          toast('Save failed: ' + resp.status + ' ' + txt.slice(0, 80), 'err');
          return;
        }
        toast('Correction saved — agent will use it on next turn');
        flaggedKeys.add(key);
        openFormKey = null;
        form.querySelector('textarea[name=correct]').value = '';
        form.querySelector('textarea[name=what_wrong]').value = '';
        refresh(true);
      } catch (err) {
        toast('Network error: ' + err.message, 'err');
      }
    }

    async function deleteCorrection(id) {
      if (!confirm('Delete this correction? The agent will no longer use it.')) return;
      try {
        const resp = await api('/agent/corrections/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: SECRET_HEADERS,
        });
        if (!resp.ok) {
          toast('Delete failed', 'err');
          return;
        }
        toast('Deleted');
        refresh(true);
      } catch (err) {
        toast('Network error: ' + err.message, 'err');
      }
    }

    let lastTurns = 0;

    async function refresh(manual) {
      const badge = document.getElementById('status-badge');
      const statusText = document.getElementById('status-text');
      try {
        const [statsResp, recentResp, corrResp] = await Promise.all([
          api('/agent/stats'),
          api('/agent/recent?n=25'),
          api('/agent/corrections'),
        ]);
        if (!statsResp.ok || !recentResp.ok) throw new Error('stats endpoint error');
        const stats = await statsResp.json();
        const recent = await recentResp.json();
        const corrections = corrResp.ok ? (await corrResp.json()).corrections || [] : [];

        badge.className = 'badge live';
        statusText.textContent = 'Live';

        document.getElementById('sub').textContent =
          'Uptime ' + fmtUptime(stats.uptime_ms || 0) +
          ' · Last refresh ' + new Date().toLocaleTimeString();

        // Metrics
        document.getElementById('m-turns').textContent = stats.total_turns || 0;
        document.getElementById('m-turns-2').textContent = stats.total_turns || 0;
        document.getElementById('m-lat').textContent = fmtMs(stats.avg_latency_ms || 0);
        document.getElementById('m-err').textContent = fmtPct(stats.error_rate || 0);
        document.getElementById('m-err-n').textContent = stats.total_errors || 0;
        document.getElementById('m-corr').textContent = corrections.length;

        const errEl = document.getElementById('m-err');
        errEl.className = 'value ' + (stats.error_rate > 0.05 ? 'bad' : stats.error_rate > 0 ? 'warn' : 'ok');
        const latEl = document.getElementById('m-lat');
        latEl.className = 'value ' + (stats.avg_latency_ms > 20000 ? 'bad' : stats.avg_latency_ms > 15000 ? 'warn' : 'ok');

        // Alerts
        const alerts = [];
        if ((stats.error_rate || 0) > 0.05) alerts.push({ level: 'bad', text: 'Error rate above 5% — check recent failures below' });
        if ((stats.maxed_rate || 0) > 0.08) alerts.push({ level: 'bad', text: 'Max-iter rate above 8% — agent hitting tool-call cap too often' });
        if ((stats.avg_latency_ms || 0) > 20000) alerts.push({ level: 'warn', text: 'Avg latency above 20s — customers will feel lag' });
        let toolCalls = 0, toolEmpty = 0;
        for (const [, t] of Object.entries(stats.by_tool || {})) {
          toolCalls += t.calls || 0;
          toolEmpty += t.zero_results || 0;
        }
        if (toolCalls > 10 && toolEmpty / toolCalls > 0.3) {
          alerts.push({ level: 'warn', text: Math.round(100 * toolEmpty / toolCalls) + '% of tool calls returned 0 results — search quality may be degrading' });
        }
        document.getElementById('alerts').innerHTML = alerts
          .map(a => '<div class="alert-banner ' + (a.level === 'warn' ? 'warn' : '') + '"><span class="alert-title">ALERT</span>' + esc(a.text) + '</div>')
          .join('');

        // Corrections list
        const corrHtml = corrections.length === 0
          ? '<div class="loading">No corrections yet. Click Flag next to a wrong turn below to teach the agent.</div>'
          : corrections.slice().reverse().map(c => {
              return '<div class="correction-item">' +
                '<div class="row">' +
                  '<div class="body">' +
                    '<div class="ts-small">' + esc(fmtDateTime(c.ts)) + '</div>' +
                    (c.user_msg ? '<div class="q"><span class="q-label">Customer:</span> ' + esc(c.user_msg) + '</div>' : '') +
                    (c.wrong_reply ? '<div class="wrong-text">WRONG: ' + esc(c.wrong_reply) + '</div>' : '') +
                    (c.correct_reply ? '<div class="correct-text">CORRECT: ' + esc(c.correct_reply) + '</div>' : '') +
                    (c.note ? '<div class="q"><span class="q-label">Note:</span> ' + esc(c.note) + '</div>' : '') +
                  '</div>' +
                  '<button class="danger" onclick="deleteCorrection(\\'' + esc(c.id) + '\\')">Remove</button>' +
                '</div>' +
              '</div>';
            }).join('');
        document.getElementById('corrections-body').innerHTML = corrHtml;

        // Tool usage
        const toolRows = Object.entries(stats.by_tool || {}).sort((a, b) => b[1].calls - a[1].calls);
        document.getElementById('tools-body').innerHTML = toolRows.length === 0
          ? '<tr><td colspan="4" class="loading">No tool calls yet</td></tr>'
          : toolRows.map(([name, s]) => {
              const hit = s.calls ? ((s.calls - s.zero_results) / s.calls * 100).toFixed(0) + '%' : '—';
              const hitClass = s.calls && (s.calls - s.zero_results) / s.calls > 0.7 ? 'status-ok' : 'status-max';
              return '<tr><td class="mono">' + esc(name) + '</td><td style="text-align:right">' + s.calls + '</td><td style="text-align:right">' + s.zero_results + '</td><td style="text-align:right" class="' + hitClass + '">' + hit + '</td></tr>';
            }).join('');

        // Build set of flagged keys from existing corrections (match by user_msg substring for approx)
        const corrMsgs = new Set(corrections.map(c => (c.user_msg || '').trim()));

        // Recent turns with flag button + inline form
        // If a correction form is currently open, DO NOT re-render the table —
        // otherwise auto-refresh wipes whatever the owner is typing.
        if (openFormKey) {
          // Still refresh the corrections panel and stats (already done above).
          lastTurns = stats.total_turns;
          return;
        }
        const rows = recent.turns || [];
        document.getElementById('recent-body').innerHTML = rows.length === 0
          ? '<tr><td colspan="8" class="loading">No turns yet — send a Telegram message to the bot</td></tr>'
          : rows.map(t => {
              const key = turnKey(t);
              const status = t.error ? '<span class="status-err">ERR</span>' : t.maxed_out ? '<span class="status-max">MAX</span>' : '<span class="status-ok">OK</span>';
              const tools = (t.tool_calls || []).map(tc => {
                const cls = (tc.count || 0) > 0 ? 'tool-pill hit' : 'tool-pill empty';
                return '<span class="' + cls + '">' + esc(tc.name) + '(' + (tc.count || 0) + ')</span>';
              }).join('') || '<span class="mono">—</span>';
              const isFlagged = corrMsgs.has((t.msg || '').trim()) || flaggedKeys.has(key);
              const userAttr = esc(t.msg || '');
              const replyAttr = esc(t.reply || '');
              const keyAttr = esc(key);
              return '<tr class="recent-row">' +
                '<td class="ts">' + fmtTs(t.ts) + '</td>' +
                '<td>' + status + '</td>' +
                '<td class="mono">' + esc(t.language || '—') + '</td>' +
                '<td class="text-cell"><div class="text" title="' + userAttr + '">' + esc(t.msg) + '</div></td>' +
                '<td>' + tools + '</td>' +
                '<td class="text-cell"><div class="text" title="' + replyAttr + '">' + esc((t.reply || '').slice(0, 200)) + '</div></td>' +
                '<td class="mono" style="text-align:right">' + fmtMs(t.latency_ms || 0) + '</td>' +
                '<td><button class="flag ' + (isFlagged ? 'flagged' : '') + '" data-key="' + keyAttr + '" onclick="toggleForm(\\'' + keyAttr.replace(/\\\\/g,'\\\\\\\\').replace(/\\'/g,"\\\\'") + '\\')">' + (isFlagged ? '✓ Flagged' : '⚑ Flag') + '</button></td>' +
              '</tr>' +
              '<tr><td colspan="8" style="padding: 0 16px;">' +
                '<div class="correction-form ' + (openFormKey === key ? 'open' : '') + '" data-key="' + keyAttr + '">' +
                  '<label>What was wrong with the reply</label>' +
                  '<textarea name="what_wrong" placeholder="Describe the mistake. e.g. \\"we carry Bose — dont say we dont\\", \\"UAE iPhones dont have FaceTime\\", \\"iPad Air M4 uses Apple Pencil Pro only\\"..."></textarea>' +
                  '<label>Correct reply (click Generate to draft, then edit)' +
                    '<span class="generated-badge" style="display:none" id="gen-badge-' + keyAttr.replace(/[^a-z0-9]/gi,'') + '">AI draft</span>' +
                  '</label>' +
                  '<textarea name="correct" placeholder="Leave empty and click Generate — or type the reply yourself..."></textarea>' +
                  '<div class="gen-note" style="display:none">AI-generated based on your feedback. Review and edit before saving.</div>' +
                  '<div class="actions">' +
                    '<button class="left" onclick="toggleForm(\\'' + keyAttr.replace(/\\\\/g,'\\\\\\\\').replace(/\\'/g,"\\\\'") + '\\')">Cancel</button>' +
                    '<button class="generate" onclick=\\'generateReply("' + keyAttr.replace(/"/g,'&quot;') + '", ' + JSON.stringify(t.msg || '') + ', ' + JSON.stringify(t.reply || '') + ', ' + JSON.stringify(t.language || 'en') + ')\\'>✨ Generate</button>' +
                    '<button class="primary" onclick=\\'submitCorrection("' + keyAttr.replace(/"/g,'&quot;') + '", ' + JSON.stringify(t.msg || '') + ', ' + JSON.stringify(t.reply || '') + ')\\'>Save correction</button>' +
                  '</div>' +
                '</div>' +
              '</td></tr>';
            }).join('');

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
