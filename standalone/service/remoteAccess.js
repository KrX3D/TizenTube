"use strict";

// Remote access: a small page on the LAN (TCP 8098) for a notebook or phone.
//
// It shows the service's log live — without the PC receiver script — and,
// when separately switched on, runs JavaScript in the YouTube page for
// testing. Port 8099 stays on 127.0.0.1: it is the YouTube proxy and must
// never be reachable from the network.
//
// Core modules only, so index.js can create this before any require() that
// might fail: the startup lines are the ones worth having.
//
// Access needs a 4-digit PIN. It is kept on the TV across restarts, so a
// bookmark with ?pin= keeps working; a new one can be made from Settings.
// Off by default; the page's setting turns it on and the choice is kept, so
// the port is also there before the page loads (startup problems).

const http = require('http');
const url = require('url');
const os = require('os');
const fs = require('fs');
const path = require('path');

const REMOTE_PORT = 8098;
const STATE_FILE = 'tt-remote-access.json';
const MAX_LINES = 2000;
const MAX_MESSAGE = 4000;
const MAX_EVAL_SOURCE = 100000;
const MAX_FAILURES = 10;
const LOCKOUT_MS = 10 * 60 * 1000;
const VIEWER_WINDOW_MS = 10000;

function newPin() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function lanAddresses() {
    const out = [];
    try {
        const ifaces = os.networkInterfaces();
        Object.keys(ifaces).forEach(function (name) {
            (ifaces[name] || []).forEach(function (addr) {
                if ((addr.family === 'IPv4' || addr.family === 4) && !addr.internal) out.push(addr.address);
            });
        });
    } catch (e) { }
    return out;
}

/**
 * opts.storeDir()   directory to keep the state file in, or null
 * opts.health()     object for /api/health
 * opts.evaluate(js) Promise of { value } / { error }, or null when the page
 *                   cannot be reached (proxy path, no CDP session)
 * opts.canEvaluate() whether a page session is up
 * opts.log(level, message)
 */
function createRemoteAccess(opts) {
    const lines = [];
    let nextId = 1;
    let state = { enabled: false, evalEnabled: false, pin: newPin() };
    let server = null;
    const failures = {};
    let lastViewerAt = 0;

    function log(level, message) {
        try { if (opts.log) opts.log(level, 'remoteAccess: ' + message); } catch (e) { }
    }

    function statePath() {
        try {
            const dir = opts.storeDir && opts.storeDir();
            return dir ? path.join(dir, STATE_FILE) : null;
        } catch (e) { return null; }
    }

    function load() {
        const file = statePath();
        if (!file) return;
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            state = {
                enabled: data.enabled === true,
                evalEnabled: data.evalEnabled === true,
                pin: /^\d{4}$/.test(String(data.pin)) ? String(data.pin) : state.pin
            };
        } catch (e) { }
    }

    function save() {
        const file = statePath();
        if (!file) return;
        try { fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 }); } catch (e) { }
    }

    function addLog(entry) {
        if (!entry || typeof entry !== 'object' || entry.__ttRemoteBuffered) return;
        // Held entries pass relayLog twice (before and after the receiver is
        // known); the mark keeps them from showing up twice here.
        try { entry.__ttRemoteBuffered = true; } catch (e) { }
        let message = entry.message;
        if (typeof message !== 'string') {
            try { message = JSON.stringify(message); } catch (e) { message = String(message); }
        }
        if (message && message.length > MAX_MESSAGE) message = message.slice(0, MAX_MESSAGE) + ' …';
        lines.push({
            id: nextId++,
            ts: entry.ts || new Date().toISOString(),
            level: entry.level || 'INFO',
            context: entry.context || 'TizenTube',
            message: message || ''
        });
        if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    }

    // Someone has the page open: it polls /api/logs every second. The page
    // (TizenTube) sends its own log lines only while this is true, so they
    // cost nothing when nobody is watching.
    function viewerActive() {
        return state.enabled && Date.now() - lastViewerAt < VIEWER_WINDOW_MS;
    }

    function info() {
        const ips = lanAddresses();
        return {
            enabled: state.enabled,
            evalEnabled: state.evalEnabled,
            // Starting counts: listen() is async, and the page asks right after
            // turning this on. A failed listen clears server.
            listening: !!server,
            pin: state.pin,
            port: REMOTE_PORT,
            viewer: viewerActive(),
            urls: ips.map(function (ip) { return 'http://' + ip + ':' + REMOTE_PORT + '/?pin=' + state.pin; })
        };
    }

    // ── HTTP ────────────────────────────────────────────────────────────────

    function send(res, status, type, body) {
        res.writeHead(status, {
            'Content-Type': type,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(body);
    }

    function sendJson(res, status, obj) {
        send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));
    }

    function clientIp(req) {
        return String((req.socket && req.socket.remoteAddress) || '');
    }

    function checkPin(req, query) {
        const ip = clientIp(req);
        const f = failures[ip];
        if (f && f.lockedUntil > Date.now()) return 'locked';
        const given = String(query.pin || req.headers['x-tt-pin'] || '');
        if (given === state.pin) {
            delete failures[ip];
            return 'ok';
        }
        const entry = f || { count: 0, lockedUntil: 0 };
        entry.count++;
        if (entry.count >= MAX_FAILURES) {
            entry.count = 0;
            entry.lockedUntil = Date.now() + LOCKOUT_MS;
            log('WARN', 'too many wrong PINs from ' + ip + ', locked for 10 minutes');
        }
        failures[ip] = entry;
        return 'wrong';
    }

    function readBody(req, limit, done) {
        let size = 0;
        const chunks = [];
        let failed = false;
        req.on('data', function (chunk) {
            if (failed) return;
            size += chunk.length;
            if (size > limit) { failed = true; done(new Error('too large')); return; }
            chunks.push(chunk);
        });
        req.on('end', function () { if (!failed) done(null, Buffer.concat(chunks).toString('utf8')); });
        req.on('error', function (err) { if (!failed) { failed = true; done(err); } });
    }

    function handle(req, res) {
        const parsed = url.parse(req.url || '/', true);
        const pathname = parsed.pathname || '/';
        const query = parsed.query || {};

        const auth = checkPin(req, query);
        if (auth === 'locked') return send(res, 429, 'text/plain; charset=utf-8', 'Too many wrong PINs. Try again in 10 minutes.');
        if (auth !== 'ok') {
            if (pathname === '/' && req.method === 'GET') return send(res, 401, 'text/html; charset=utf-8', PIN_PAGE);
            return sendJson(res, 401, { error: 'PIN missing or wrong' });
        }

        if (pathname === '/' && req.method === 'GET') return send(res, 200, 'text/html; charset=utf-8', REMOTE_PAGE);

        if (pathname === '/api/logs' && req.method === 'GET') {
            lastViewerAt = Date.now();
            const since = Number(query.since) || 0;
            const out = [];
            for (let i = 0; i < lines.length; i++) if (lines[i].id > since) out.push(lines[i]);
            return sendJson(res, 200, { lines: out, next: nextId - 1 });
        }

        if (pathname === '/api/status' && req.method === 'GET') {
            let health = null;
            try { health = opts.health ? opts.health() : null; } catch (e) {
                // Detail to the log only, never into the response (CodeQL js/stack-trace-exposure).
                log('ERROR', 'health check failed: ' + (e && e.stack || e));
                health = { error: 'health check failed; see the log' };
            }
            return sendJson(res, 200, { evalEnabled: state.evalEnabled, pageReachable: !!(opts.canEvaluate && opts.canEvaluate()), health: health });
        }

        if (pathname === '/api/eval' && req.method === 'POST') {
            if (!state.evalEnabled) return sendJson(res, 403, { error: 'Running code is turned off in TizenTube settings on the TV.' });
            return readBody(req, MAX_EVAL_SOURCE, function (err, body) {
                if (err) return sendJson(res, 413, { error: 'Code too large' });
                let code = '';
                try { code = String(JSON.parse(body).code || ''); } catch (e) { return sendJson(res, 400, { error: 'Expected JSON {"code": "..."}' }); }
                if (!code.trim()) return sendJson(res, 400, { error: 'No code' });
                const pending = opts.evaluate ? opts.evaluate(code) : null;
                if (!pending) return sendJson(res, 503, { error: 'The YouTube page is not reachable. Running code only works on the debugger launch path while TizenTube is open.' });
                log('INFO', 'eval from ' + clientIp(req) + ' (' + code.length + ' chars)');
                pending.then(function (result) {
                    sendJson(res, 200, result || {});
                }, function (e) {
                    log('ERROR', 'eval failed: ' + (e && e.stack || e));
                    sendJson(res, 500, { error: 'Running the code failed on the TV side; see the log.' });
                });
            });
        }

        return sendJson(res, 404, { error: 'Not found' });
    }

    function start() {
        if (server) return;
        server = http.createServer(function (req, res) {
            try { handle(req, res); } catch (e) {
                log('ERROR', 'request failed: ' + (e && e.stack || e));
                try { sendJson(res, 500, { error: 'internal error' }); } catch (e2) { }
            }
        });
        server.on('error', function (err) {
            log('ERROR', 'listen on ' + REMOTE_PORT + ' failed: ' + (err && err.message || err));
            server = null;
        });
        server.listen(REMOTE_PORT, '0.0.0.0', function () {
            log('INFO', 'listening on 0.0.0.0:' + REMOTE_PORT + ' (' + lanAddresses().join(', ') + ')');
        });
    }

    function stop() {
        if (!server) return;
        try { server.close(); } catch (e) { }
        server = null;
        log('INFO', 'stopped');
    }

    /**
     * What the page wants: { enabled, evalEnabled, newPin }. Returns info().
     */
    function applyState(wanted) {
        if (!wanted || typeof wanted !== 'object') return info();
        const next = {
            enabled: wanted.enabled === true,
            evalEnabled: wanted.enabled === true && wanted.evalEnabled === true,
            pin: wanted.newPin === true ? newPin() : state.pin
        };
        const changed = next.enabled !== state.enabled || next.evalEnabled !== state.evalEnabled || next.pin !== state.pin;
        state = next;
        if (changed) save();
        if (state.enabled) start(); else stop();
        return info();
    }

    // Separate from creation: index.js creates this first thing, so the log
    // buffer catches startup, but the storage path is only known later.
    function begin() {
        load();
        if (state.enabled) start();
    }

    return { addLog: addLog, applyState: applyState, info: info, viewerActive: viewerActive, begin: begin, port: REMOTE_PORT };
}

// ── Pages ───────────────────────────────────────────────────────────────────
// Served to a desktop or phone browser, not to the TV, so modern JS is fine
// inside them; the strings themselves stay plain for the Node 4 bundle.

const PIN_PAGE = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TizenTube remote</title>'
    + '<style>body{background:#111;color:#eee;font-family:Arial,sans-serif;display:flex;justify-content:center;padding-top:15vh}form{background:#1e1e1e;padding:24px;border-radius:12px}input,button{font-size:20px;padding:10px;border-radius:8px;border:1px solid #444;background:#2a2a2a;color:#fff}button{background:#c00;border:none;margin-left:8px;cursor:pointer}</style></head>'
    + '<body><form onsubmit="location.search=\'?pin=\'+encodeURIComponent(this.pin.value);return false">'
    + '<p id="t">PIN from the TV (Settings &gt; Remote access):</p><input name="pin" inputmode="numeric" maxlength="4" autofocus><button>OK</button></form>'
    + '<script>if(/^de/i.test(navigator.language||""))document.getElementById("t").textContent="PIN vom TV (Einstellungen > Fernzugriff):";</script></body></html>';

const REMOTE_PAGE = String.raw`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TizenTube remote</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #111; color: #ddd; font-family: Arial, sans-serif; display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 12px; background: #1c1c1c; border-bottom: 1px solid #333; }
  header h1 { font-size: 16px; margin: 0 12px 0 0; color: #f33; }
  input, select, button, textarea { font: inherit; font-size: 14px; background: #262626; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 6px 8px; }
  button { cursor: pointer; } button.on { background: #c00; border-color: #c00; }
  #status { font-size: 12px; color: #999; margin-left: auto; }
  #log { flex: 1; overflow: auto; font-family: Consolas, monospace; font-size: 12px; padding: 6px 12px; white-space: pre-wrap; word-break: break-word; }
  .l { padding: 1px 0; border-bottom: 1px solid #1b1b1b; }
  .WARN { color: #fc6; } .ERROR { color: #f77; } .DEBUG { color: #888; }
  .ctx { color: #6af; } .ts { color: #777; }
  #evalBox { display: none; border-top: 1px solid #333; padding: 8px 12px; background: #181818; }
  #evalBox textarea { width: 100%; box-sizing: border-box; height: 90px; font-family: Consolas, monospace; }
  #evalOut { font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap; max-height: 30vh; overflow: auto; margin-top: 6px; }
  .hint { font-size: 12px; color: #888; }
</style></head>
<body>
<header>
  <h1>TizenTube</h1>
  <input id="filter" placeholder="Filter" size="18">
  <select id="level"><option value="">all</option><option value="WARN">WARN+</option><option value="ERROR">ERROR</option></select>
  <button id="pause">Pause</button>
  <button id="clear">Clear</button>
  <button id="copy">Copy</button>
  <button id="save">Download</button>
  <button id="evalToggle" style="display:none">JS</button>
  <span id="status"></span>
</header>
<div id="log"></div>
<div id="evalBox">
  <textarea id="code" spellcheck="false" placeholder="document.title"></textarea>
  <button id="run">Run (Ctrl+Enter)</button> <span class="hint" id="evalHint"></span>
  <div id="evalOut"></div>
</div>
<script>
(function () {
  var de = /^de/i.test(navigator.language || '');
  var L = de ? { pause: 'Pause', resume: 'Weiter', clear: 'Leeren', save: 'Herunterladen', copy: 'Kopieren', copied: 'Kopiert', copyTitle: 'Kopiert nur die angezeigten (gefilterten) Zeilen', saveTitle: 'Lädt alle Zeilen herunter, ohne Filter', filter: 'Filter', all: 'alle', run: 'Ausführen (Strg+Enter)',
      offline: 'TV nicht erreichbar', lines: 'Zeilen', pageNo: 'YouTube-Seite nicht erreichbar (nur über den Debugger-Startweg)',
      hint: 'Läuft in der YouTube-Seite. Promises werden abgewartet.', note: 'Seiten-Logs kommen, solange diese Seite offen ist (ab dem Öffnen, ältere nicht).' }
    : { pause: 'Pause', resume: 'Resume', clear: 'Clear', save: 'Download', copy: 'Copy', copied: 'Copied', copyTitle: 'Copies only the lines shown (filtered)', saveTitle: 'Downloads every line, unfiltered', filter: 'Filter', all: 'all', run: 'Run (Ctrl+Enter)',
      offline: 'TV not reachable', lines: 'lines', pageNo: 'YouTube page not reachable (debugger launch path only)',
      hint: 'Runs in the YouTube page. Promises are awaited.', note: 'Page logs arrive while this page is open (from when it was opened, not before).' };
  var pin = (/[?&]pin=(\d+)/.exec(location.search) || [])[1] || '';
  var $ = function (id) { return document.getElementById(id); };
  $('pause').textContent = L.pause; $('clear').textContent = L.clear; $('save').textContent = L.save;
  $('copy').textContent = L.copy; $('copy').title = L.copyTitle; $('save').title = L.saveTitle;
  $('filter').placeholder = L.filter; $('level').options[0].textContent = L.all; $('run').textContent = L.run; $('evalHint').textContent = L.hint;
  var all = [], since = 0, paused = false, logEl = $('log');

  function api(path, init) {
    init = init || {}; init.headers = Object.assign({ 'X-TT-Pin': pin }, init.headers || {});
    return fetch(path, init).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function rank(l) { return l === 'ERROR' ? 2 : l === 'WARN' ? 1 : 0; }
  function visible(x) {
    var lv = $('level').value, f = $('filter').value.toLowerCase();
    if (lv && rank(x.level) < rank(lv)) return false;
    if (f && (x.context + ' ' + x.message).toLowerCase().indexOf(f) < 0) return false;
    return true;
  }
  function row(x) {
    var d = document.createElement('div'); d.className = 'l ' + x.level;
    var ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = (x.ts || '').replace('T', ' ').replace('Z', '') + ' ';
    var c = document.createElement('span'); c.className = 'ctx'; c.textContent = '[' + x.context + '] ';
    d.appendChild(ts); d.appendChild(c); d.appendChild(document.createTextNode((x.level !== 'INFO' ? x.level + ' ' : '') + x.message));
    return d;
  }
  function redraw() {
    logEl.textContent = '';
    var frag = document.createDocumentFragment();
    all.forEach(function (x) { if (visible(x)) frag.appendChild(row(x)); });
    logEl.appendChild(frag); logEl.scrollTop = logEl.scrollHeight;
  }
  // Polls on while paused: the TV sends page logs only while this page is
  // asking for them. Paused just stops drawing; Resume draws the backlog.
  function poll() {
    api('api/logs?since=' + since).then(function (j) {
      var atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30;
      j.lines.forEach(function (x) { all.push(x); if (!paused && visible(x)) logEl.appendChild(row(x)); });
      if (all.length > 5000) { all = all.slice(-4000); redraw(); }
      since = j.next;
      if (atBottom) logEl.scrollTop = logEl.scrollHeight;
      $('status').textContent = all.length + ' ' + L.lines;
    }).catch(function () { $('status').textContent = L.offline; }).then(function () { setTimeout(poll, 1000); });
  }
  function status() {
    api('api/status').then(function (j) {
      $('evalToggle').style.display = j.evalEnabled ? '' : 'none';
      if (!j.evalEnabled) $('evalBox').style.display = 'none';
      $('evalHint').textContent = j.pageReachable ? L.hint : L.pageNo;
    }).catch(function () { });
  }
  $('filter').oninput = redraw; $('level').onchange = redraw;
  $('pause').onclick = function () { paused = !paused; this.textContent = paused ? L.resume : L.pause; this.className = paused ? 'on' : ''; if (!paused) redraw(); };
  $('clear').onclick = function () { all = []; redraw(); };
  function line(x) { return '[' + x.ts + '] [' + x.level + '] [' + x.context + '] ' + x.message; }
  // navigator.clipboard needs https; this page is plain http on the LAN, so
  // the old textarea + execCommand route is the one that works here.
  $('copy').onclick = function () {
    var text = all.filter(visible).map(line).join('\n');
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).then(function () { }, function () { });
    var b = this; b.textContent = L.copied; setTimeout(function () { b.textContent = L.copy; }, 1500);
  };
  $('save').onclick = function () {
    var text = all.map(line).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'tizentube-' + new Date().toISOString().replace(/[:.]/g, '-') + '.log'; a.click();
  };
  $('evalToggle').onclick = function () { var b = $('evalBox'); b.style.display = b.style.display === 'block' ? 'none' : 'block'; if (b.style.display === 'block') $('code').focus(); };
  function run() {
    $('evalOut').textContent = '…';
    api('api/eval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }) })
      .then(function (j) { $('evalOut').style.color = j.error ? '#f77' : '#9e9'; $('evalOut').textContent = j.error ? j.error : j.value; })
      .catch(function (e) { $('evalOut').style.color = '#f77'; $('evalOut').textContent = String(e.message || e); });
  }
  $('run').onclick = run;
  $('code').onkeydown = function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } };
  var note = document.createElement('div'); note.className = 'hint'; note.textContent = L.note; logEl.appendChild(note);
  poll(); status(); setInterval(status, 10000);
})();
</script>
</body></html>`;

module.exports = createRemoteAccess;
