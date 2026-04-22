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
    --bg:          #f6f8fa;
    --panel:       #ffffff;
    --panel-2:     #f6f8fa;
    --panel-3:     #eaeef2;
    --border:      #d0d7de;
    --border-light:#afb8c1;
    --text:        #1f2328;
    --text-dim:    #656d76;
    --text-dimmer: #8c959f;
    --accent:      #0969da;
    --green:       #1a7f37;
    --yellow:      #9a6700;
    --red:         #cf222e;
    --mono:        ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    --shadow:      0 1px 3px rgba(31, 35, 40, 0.1);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; }
  body { min-height: 100vh; padding: 24px; max-width: 1400px; margin: 0 auto; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; }
  .header .sub { color: var(--text-dim); font-size: 12px; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .header .controls { display: flex; gap: 10px; align-items: center; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 11px; background: var(--panel-2); border: 1px solid var(--border); color: var(--text-dim); }
  .badge .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); }
  .badge.live .dot { background: var(--green); animation: pulse 2s infinite; }
  .badge.error .dot { background: var(--red); }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* Metric cards */
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  @media (max-width: 800px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 450px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; transition: border-color 0.15s; }
  .card:hover { border-color: var(--border-light); }
  .card .label { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px; font-weight: 500; }
  .card .value { font-size: 24px; font-weight: 600; font-family: var(--mono); letter-spacing: -0.5px; }
  .card .value.ok { color: var(--green); }
  .card .value.warn { color: var(--yellow); }
  .card .value.bad { color: var(--red); }
  .card .hint { color: var(--text-dimmer); font-size: 11px; margin-top: 4px; font-variant-numeric: tabular-nums; }

  /* Sections */
  .section { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
  .section h2 { margin: 0; padding: 12px 16px; font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--border); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.6px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .section h2 .hint { text-transform: none; font-weight: 400; font-size: 11px; color: var(--text-dimmer); letter-spacing: 0; text-align: right; }

  /* Alerts */
  .alert-banner { padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; display: flex; align-items: center; gap: 10px; }
  .alert-banner.bad { background: rgba(207, 34, 46, 0.06); border: 1px solid rgba(207, 34, 46, 0.35); color: var(--red); }
  .alert-banner.warn { background: rgba(154, 103, 0, 0.06); border: 1px solid rgba(154, 103, 0, 0.3); color: var(--yellow); }
  .alert-banner .alert-title { font-weight: 600; font-size: 11px; padding: 2px 8px; background: currentColor; color: #fff; border-radius: 4px; letter-spacing: 0.5px; }

  /* Tool usage table */
  .tool-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tool-table th, .tool-table td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border); }
  .tool-table th { color: var(--text-dim); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; background: var(--panel-2); }
  .tool-table tr:last-child td { border-bottom: none; }
  .tool-table tr:hover td { background: var(--panel-2); }
  .tool-table .num { font-family: var(--mono); text-align: right; font-variant-numeric: tabular-nums; }
  .tool-table .bar-wrap { position: relative; width: 100%; height: 4px; background: var(--panel-3); border-radius: 2px; overflow: hidden; margin-top: 4px; }
  .tool-table .bar-fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--green); border-radius: 2px; }
  .tool-table .bar-fill.warn { background: var(--yellow); }

  /* Recent turns — chat-style cards */
  .turns-list { padding: 4px; }
  .turn { border-bottom: 1px solid var(--border); padding: 14px 16px; transition: background 0.1s; }
  .turn:last-child { border-bottom: none; }
  .turn:hover { background: var(--panel-2); }
  .turn-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
  .turn-head .ts { font-family: var(--mono); color: var(--text-dimmer); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; font-family: var(--mono); }
  .pill.ok { color: var(--green); background: rgba(26, 127, 55, 0.1); }
  .pill.max { color: var(--yellow); background: rgba(154, 103, 0, 0.1); }
  .pill.err { color: var(--red); background: rgba(207, 34, 46, 0.1); }
  .pill.lang { color: var(--text-dim); background: var(--panel-3); text-transform: none; letter-spacing: 0; font-weight: 500; }
  .pill.lat { color: var(--text-dim); background: var(--panel-3); text-transform: none; letter-spacing: 0; font-weight: 500; }
  .turn-head .spacer { flex: 1; }
  .turn-head .flag-btn { font-size: 11px; padding: 4px 10px; }

  /* Chat bubbles */
  .bubble { padding: 9px 12px; border-radius: 10px; margin: 4px 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .bubble.user { background: var(--panel-3); border: 1px solid var(--border); max-width: 80%; margin-right: auto; }
  .bubble.bot { background: rgba(9, 105, 218, 0.06); border: 1px solid rgba(9, 105, 218, 0.2); max-width: 85%; margin-left: auto; color: #0a3069; }
  .bubble.bot.err-bg { background: rgba(207, 34, 46, 0.05); border-color: rgba(207, 34, 46, 0.25); color: #86181d; }
  .bubble .label { display: block; font-size: 10px; color: var(--text-dimmer); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 500; }
  .bubble.bot .label { text-align: right; color: var(--accent); opacity: 0.7; }

  /* Tool pills inside a turn */
  .tools-row { margin: 6px 0 2px 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .tools-row .tools-label { font-size: 10px; color: var(--text-dimmer); text-transform: uppercase; letter-spacing: 0.5px; margin-right: 4px; }
  .tool-pill { display: inline-block; padding: 2px 7px; background: var(--panel-3); border: 1px solid var(--border); border-radius: 4px; font-size: 10px; font-family: var(--mono); color: var(--text-dim); }
  .tool-pill.empty { color: var(--yellow); border-color: rgba(154, 103, 0, 0.3); background: rgba(154, 103, 0, 0.06); }
  .tool-pill.hit { color: var(--green); border-color: rgba(26, 127, 55, 0.25); background: rgba(26, 127, 55, 0.06); }

  /* Buttons */
  button { background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; font-weight: 500; transition: all 0.1s; }
  button:hover { background: var(--panel-2); border-color: var(--border-light); }
  button.flag-btn { color: var(--text-dim); background: var(--panel); }
  button.flag-btn:hover { color: var(--red); border-color: rgba(207, 34, 46, 0.4); background: rgba(207, 34, 46, 0.05); }
  button.flag-btn.flagged { color: var(--red); border-color: var(--red); background: rgba(207, 34, 46, 0.08); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { background: #0550ae; border-color: #0550ae; color: #fff; }
  button.generate { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.generate:hover { background: #0550ae; border-color: #0550ae; color: #fff; }
  button.danger { color: var(--red); border-color: rgba(207, 34, 46, 0.3); background: var(--panel); }
  button.danger:hover { background: rgba(207, 34, 46, 0.08); border-color: var(--red); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button .spinner { display: inline-block; width: 11px; height: 11px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: -1px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Correction inline form */
  .correction-form { display: none; background: rgba(207, 34, 46, 0.03); border: 1px solid rgba(207, 34, 46, 0.2); border-radius: 8px; padding: 14px; margin: 10px 0 4px 0; }
  .correction-form.open { display: block; }
  .correction-form label { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 10px 0 6px 0; font-weight: 500; }
  .correction-form label:first-child { margin-top: 0; }
  .correction-form textarea { width: 100%; min-height: 60px; background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 10px; border-radius: 6px; font-family: inherit; font-size: 13px; resize: vertical; line-height: 1.5; }
  .correction-form textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.18); }
  .correction-form .actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; flex-wrap: wrap; }
  .correction-form .actions .left { margin-right: auto; }
  .correction-form .gen-note { color: var(--accent); font-size: 11px; margin-top: 6px; font-style: italic; }
  .generated-badge { display: inline-flex; align-items: center; padding: 2px 7px; background: rgba(9, 105, 218, 0.1); border: 1px solid rgba(9, 105, 218, 0.4); color: var(--accent); border-radius: 4px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }

  /* Corrections list */
  .correction-item { padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .correction-item:last-child { border-bottom: none; }
  .correction-item .top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .correction-item .ts-small { color: var(--text-dimmer); font-size: 11px; font-family: var(--mono); }
  .correction-item .q-label { display: inline-block; color: var(--text-dimmer); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 8px; font-weight: 500; }
  .correction-item .q { font-size: 13px; margin: 6px 0; line-height: 1.5; }
  .correction-item .wrong-text { color: var(--red); font-size: 12px; background: rgba(207, 34, 46, 0.05); border: 1px solid rgba(207, 34, 46, 0.25); padding: 8px 10px; border-radius: 6px; margin: 6px 0; white-space: pre-wrap; line-height: 1.5; }
  .correction-item .correct-text { color: var(--green); font-size: 12px; background: rgba(26, 127, 55, 0.05); border: 1px solid rgba(26, 127, 55, 0.25); padding: 8px 10px; border-radius: 6px; margin: 6px 0; white-space: pre-wrap; line-height: 1.5; }

  /* Empty states */
  .empty { color: var(--text-dimmer); font-size: 13px; padding: 28px 20px; text-align: center; font-style: italic; }

  /* Toast */
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; font-size: 13px; box-shadow: var(--shadow); opacity: 0; transform: translateY(8px); transition: all 0.2s; pointer-events: none; z-index: 100; max-width: 360px; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.ok { border-color: var(--green); color: var(--green); }
  .toast.err { border-color: var(--red); color: var(--red); }

  /* Mobile refinements */
  @media (max-width: 600px) {
    body { padding: 12px; }
    .header h1 { font-size: 18px; }
    .turn { padding: 12px; }
    .bubble { max-width: 95%; font-size: 12px; }
    .correction-form { padding: 10px; }
  }
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
      <button onclick="refresh(true)">Refresh</button>
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
      <div class="hint"><span id="m-err-n">0</span> of <span id="m-turns-2">0</span> turns</div>
    </div>
    <div class="card">
      <div class="label">Corrections</div>
      <div class="value ok" id="m-corr">—</div>
      <div class="hint">Injected into prompt</div>
    </div>
  </div>

  <div class="section">
    <h2>Corrections (owner feedback)
      <span class="hint">Agent learns from these on every turn</span>
    </h2>
    <div id="corrections-body">
      <div class="empty">Loading…</div>
    </div>
  </div>

  <div class="section">
    <h2>Tool usage</h2>
    <table class="tool-table">
      <thead>
        <tr><th>Tool</th><th class="num">Calls</th><th class="num">Empty</th><th class="num">Hit rate</th></tr>
      </thead>
      <tbody id="tools-body">
        <tr><td colspan="4" class="empty">Loading…</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Recent turns
      <span class="hint">Click ⚑ on any turn to flag a wrong reply</span>
    </h2>
    <div class="turns-list" id="turns-body">
      <div class="empty">Loading…</div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const PATHNAME = window.location.pathname;
    const ROOT = PATHNAME.replace(/\\/dashboard(\\/[^/?#]+)?$/, '');
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
      setTimeout(() => { el.className = 'toast ' + (kind || 'ok'); }, 3500);
    }

    let openFormKey = null;
    let flaggedKeys = new Set();

    function turnKey(t) { return (t.ts || '') + '::' + (t.msg || ''); }

    function toggleForm(key) {
      openFormKey = (openFormKey === key) ? null : key;
      document.querySelectorAll('.correction-form').forEach(el => {
        el.classList.toggle('open', el.getAttribute('data-key') === openFormKey);
      });
      document.querySelectorAll('button.flag-btn').forEach(el => {
        const isThisKey = el.getAttribute('data-key') === openFormKey;
        el.classList.toggle('flagged', isThisKey || flaggedKeys.has(el.getAttribute('data-key')));
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
        const genNote = form.querySelector('.gen-note');
        if (genNote) genNote.style.display = 'block';
        const genBadge = form.querySelector('.generated-badge');
        if (genBadge) genBadge.style.display = 'inline-flex';
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
        refresh(true);
      } catch (err) {
        toast('Network error: ' + err.message, 'err');
      }
    }

    async function deleteCorrection(id) {
      if (!confirm('Delete this correction? The agent will forget it.')) return;
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
          api('/agent/recent?n=30'),
          api('/agent/corrections'),
        ]);
        if (!statsResp.ok || !recentResp.ok) throw new Error('stats endpoint error');
        const stats = await statsResp.json();
        const recent = await recentResp.json();
        const corrections = corrResp.ok ? (await corrResp.json()).corrections || [] : [];

        badge.className = 'badge live';
        statusText.textContent = 'Live';

        const lim = stats.openai_limiter || {};
        const limText = lim.max ? ' · OpenAI gate ' + (lim.active || 0) + '/' + lim.max + (lim.queued ? ' (+' + lim.queued + ' queued)' : '') : '';
        document.getElementById('sub').textContent =
          'Uptime ' + fmtUptime(stats.uptime_ms || 0) +
          ' · Last refresh ' + new Date().toLocaleTimeString() +
          limText;

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
        if ((stats.maxed_rate || 0) > 0.08) alerts.push({ level: 'bad', text: 'Max-iter rate above 8% — agent hitting tool-call cap' });
        if ((stats.avg_latency_ms || 0) > 20000) alerts.push({ level: 'warn', text: 'Avg latency above 20s — customers feeling lag' });
        let toolCalls = 0, toolEmpty = 0;
        for (const [, t] of Object.entries(stats.by_tool || {})) {
          toolCalls += t.calls || 0;
          toolEmpty += t.zero_results || 0;
        }
        if (toolCalls > 10 && toolEmpty / toolCalls > 0.3) {
          alerts.push({ level: 'warn', text: Math.round(100 * toolEmpty / toolCalls) + '% of tool calls returned 0 results — search quality degrading' });
        }
        document.getElementById('alerts').innerHTML = alerts
          .map(a => '<div class="alert-banner ' + a.level + '"><span class="alert-title">Alert</span><span>' + esc(a.text) + '</span></div>')
          .join('');

        // Corrections list
        const corrHtml = corrections.length === 0
          ? '<div class="empty">No corrections yet. Click ⚑ on any wrong turn to teach the agent.</div>'
          : corrections.slice().reverse().map(c => {
              return '<div class="correction-item">' +
                '<div class="top-row">' +
                  '<span class="ts-small">' + esc(fmtDateTime(c.ts)) + '</span>' +
                  '<button class="danger" onclick="deleteCorrection(\\'' + esc(c.id) + '\\')">Remove</button>' +
                '</div>' +
                (c.user_msg ? '<div class="q"><span class="q-label">Customer</span>' + esc(c.user_msg) + '</div>' : '') +
                (c.wrong_reply ? '<div class="wrong-text"><strong>Wrong:</strong> ' + esc(c.wrong_reply) + '</div>' : '') +
                (c.correct_reply ? '<div class="correct-text"><strong>Correct:</strong> ' + esc(c.correct_reply) + '</div>' : '') +
                (c.note ? '<div class="q"><span class="q-label">Note</span>' + esc(c.note) + '</div>' : '') +
              '</div>';
            }).join('');
        document.getElementById('corrections-body').innerHTML = corrHtml;

        // Tool usage with relative bars
        const toolRows = Object.entries(stats.by_tool || {}).sort((a, b) => b[1].calls - a[1].calls);
        const maxCalls = toolRows.reduce((m, r) => Math.max(m, r[1].calls), 1);
        document.getElementById('tools-body').innerHTML = toolRows.length === 0
          ? '<tr><td colspan="4" class="empty">No tool calls yet</td></tr>'
          : toolRows.map(([name, s]) => {
              const hitRate = s.calls ? (s.calls - s.zero_results) / s.calls : 0;
              const hitPct = s.calls ? Math.round(hitRate * 100) + '%' : '—';
              const hitClass = hitRate > 0.7 ? 'ok' : 'warn';
              const widthPct = (s.calls / maxCalls * 100).toFixed(0);
              return '<tr>' +
                '<td>' +
                  '<code>' + esc(name) + '</code>' +
                  '<div class="bar-wrap"><div class="bar-fill ' + hitClass + '" style="width:' + widthPct + '%"></div></div>' +
                '</td>' +
                '<td class="num">' + s.calls + '</td>' +
                '<td class="num">' + s.zero_results + '</td>' +
                '<td class="num"><span class="pill ' + hitClass + '">' + hitPct + '</span></td>' +
              '</tr>';
            }).join('');

        // Recent turns — don't re-render if a form is open (owner is typing).
        if (openFormKey) {
          lastTurns = stats.total_turns;
          return;
        }

        const rows = recent.turns || [];
        const corrMsgs = new Set(corrections.map(c => (c.user_msg || '').trim()));

        document.getElementById('turns-body').innerHTML = rows.length === 0
          ? '<div class="empty">No turns yet — send a Telegram message to the bot</div>'
          : rows.map(t => {
              const key = turnKey(t);
              const keyAttr = esc(key);
              const statusPill = t.error
                ? '<span class="pill err">ERR</span>'
                : t.maxed_out ? '<span class="pill max">MAX</span>' : '<span class="pill ok">OK</span>';
              const tools = (t.tool_calls || []).map(tc => {
                const cls = (tc.count || 0) > 0 ? 'tool-pill hit' : 'tool-pill empty';
                return '<span class="' + cls + '">' + esc(tc.name) + ' (' + (tc.count || 0) + ')</span>';
              }).join('');
              const isFlagged = corrMsgs.has((t.msg || '').trim()) || flaggedKeys.has(key);
              const botBubbleClass = 'bubble bot' + (t.error ? ' err-bg' : '');
              const toggleCall = 'toggleForm(' + JSON.stringify(key).replace(/"/g,'&quot;') + ')';
              const genCall = 'generateReply(' + JSON.stringify(key) + ', ' + JSON.stringify(t.msg || '') + ', ' + JSON.stringify(t.reply || '') + ', ' + JSON.stringify(t.language || 'en') + ')';
              const saveCall = 'submitCorrection(' + JSON.stringify(key) + ', ' + JSON.stringify(t.msg || '') + ', ' + JSON.stringify(t.reply || '') + ')';

              return '<div class="turn">' +
                '<div class="turn-head">' +
                  '<span class="ts">' + fmtTs(t.ts) + '</span>' +
                  statusPill +
                  '<span class="pill lang">' + esc(t.language || 'en') + '</span>' +
                  '<span class="pill lat">' + fmtMs(t.latency_ms || 0) + '</span>' +
                  '<span class="spacer"></span>' +
                  '<button class="flag-btn ' + (isFlagged ? 'flagged' : '') + '" data-key="' + keyAttr + '" onclick=\\'' + toggleCall.replace(/'/g, '&#39;') + '\\'>' + (isFlagged ? '✓ Flagged' : '⚑ Flag') + '</button>' +
                '</div>' +
                '<div class="bubble user"><span class="label">Customer</span>' + esc(t.msg || '') + '</div>' +
                (tools ? '<div class="tools-row"><span class="tools-label">Tools:</span>' + tools + '</div>' : '') +
                '<div class="' + botBubbleClass + '"><span class="label">Bot reply</span>' + esc(t.reply || '') + '</div>' +
                '<div class="correction-form ' + (openFormKey === key ? 'open' : '') + '" data-key="' + keyAttr + '">' +
                  '<label>What was wrong with the reply</label>' +
                  '<textarea name="what_wrong" placeholder="Describe the mistake. e.g. we DO carry Bose (just out of stock), or UAE iPhones have FaceTime disabled..."></textarea>' +
                  '<label>Correct reply <span class="generated-badge" style="display:none">AI draft</span></label>' +
                  '<textarea name="correct" placeholder="Click Generate to draft, or type the reply yourself..."></textarea>' +
                  '<div class="gen-note" style="display:none">AI-generated from your feedback. Review and edit before saving.</div>' +
                  '<div class="actions">' +
                    '<button class="left" onclick=\\'' + toggleCall.replace(/'/g, '&#39;') + '\\'>Cancel</button>' +
                    '<button class="generate" onclick=\\'' + genCall.replace(/'/g, '&#39;') + '\\'>✨ Generate</button>' +
                    '<button class="primary" onclick=\\'' + saveCall.replace(/'/g, '&#39;') + '\\'>Save correction</button>' +
                  '</div>' +
                '</div>' +
              '</div>';
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
