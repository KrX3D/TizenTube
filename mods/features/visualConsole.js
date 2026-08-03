import { configRead, configWrite, configChangeEmitter } from '../config.js';
import resolveCommand from '../resolveCommand.js';
import rootPkg from '../../package.json';
import { sendRemotePayload, isEnabled as isLogServerEnabled } from './logServer.js';

const APP_VERSION_LABEL = 'TizenTube';
const APP_VERSION = rootPkg.version;

function detectTvModel() {
  let modelName = null;
  let modelCode = null;

  try {
    const h5vccModel = window?.h5vcc?.system?.getDeviceInfo?.()?.modelName;
    if (h5vccModel) modelName = String(h5vccModel);
  } catch (_) { }

  try {
    const webapisModel = window?.webapis?.productinfo?.getModel?.();
    if (webapisModel) modelName = String(webapisModel);
  } catch (_) { }

  try {
    const webapisRealModel = window?.webapis?.productinfo?.getRealModel?.();
    if (webapisRealModel) modelName = String(webapisRealModel);
  } catch (_) { }

  try {
    const maybeCode = window?.webapis?.productinfo?.getModelCode?.();
    if (maybeCode) modelCode = String(maybeCode);
  } catch (_) { }

  try {
    const ua = String(navigator.userAgent || '');
    const match = ua.match(/\(([^)]*?TV[^)]*?)\)/i);
    if (!modelName && match?.[1]) modelName = match[1];
  } catch (_) { }

  if (!modelName && !modelCode) return 'unknown';
  if (modelName && modelCode) return `${modelName} (${modelCode})`;
  return modelName || modelCode;
}

function initVisualConsole() {
  const positions = {
    'top-left': { top: '0', left: '0', right: '', bottom: '', transform: '' },
    'top-right': { top: '0', right: '0', left: '', bottom: '', transform: '' },
    'bottom-left': { bottom: '0', left: '0', right: '', top: '', transform: '' },
    'bottom-right': { bottom: '0', right: '0', left: '', top: '', transform: '' },
    center: { top: '50%', left: '50%', right: '', bottom: '', transform: 'translate(-50%, -50%)' }
  };

  const consoleDiv = document.createElement('div');
  consoleDiv.id = 'tv-debug-console';

  const applyPosition = () => {
    const pos = configRead('debugConsolePosition') || 'bottom-right';
    Object.assign(consoleDiv.style, positions[pos] || positions['bottom-right']);
  };

  const applyHeight = () => {
    const h = Number(configRead('debugConsoleHeight') || 500);
    consoleDiv.style.height = `${h}px`;
  };

  consoleDiv.style.cssText = `
    position: fixed;
    width: 1054px;
    background: rgba(0, 0, 0, 0.95);
    color: #0f0;
    font-family: monospace;
    font-size: 13px;
    padding: 10px;
    overflow-y: auto;
    overflow-x: hidden;
    z-index: 999999;
    border: 3px solid #0f0;
    display: none;
    box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
    pointer-events: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  `;

  applyPosition();
  applyHeight();

  const mount = () => {
    if (document.body && !document.getElementById('tv-debug-console')) document.body.appendChild(consoleDiv);
  };
  mount();
  document.addEventListener('DOMContentLoaded', mount);

  let logs = [];
  if (!Array.isArray(window.__ttFileOnlyLogs)) window.__ttFileOnlyLogs = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  const renderLogs = () => {
    while (consoleDiv.firstChild) {
      consoleDiv.removeChild(consoleDiv.firstChild);
    }

    for (const entry of logs) {
      const row = document.createElement('div');
      row.style.color = entry.color;
      row.style.marginBottom = '4px';
      row.style.whiteSpace = 'pre-wrap';
      row.style.wordWrap = 'break-word';
      row.textContent = `[${entry.time}] ${entry.msg}`;
      consoleDiv.appendChild(row);
    }
  };

  const syncVisible = () => {
    const enabled = !!configRead('enableDebugConsole');
    consoleDiv.style.display = enabled ? 'block' : 'none';
    if (enabled) {
      applyPosition();
      applyHeight();
      renderLogs();
      consoleDiv.scrollTop = 0;
    }
  };

  const addLog = (type, args) => {
    // Previously gated entirely on enableDebugConsole/enableDebugLogging —
    // meaning logServerEnabled (Remote Log Server) alone did nothing for
    // regular console.* output, even though it's a completely separate
    // setting. That left two disconnected log pipelines: console.* calls
    // (visible on-screen, but never reached the PC) and the file-only
    // stream used for things like parse.begin (reached the PC, but never
    // shown on-screen) — user-reported confusion: the PC receiver showed
    // different entries than the visual console. logServerEnabled now
    // relays this exact same stream, independent of the visual flags below
    // (which still control only the on-screen accumulation/rendering).
    const wantsVisual = !!configRead('enableDebugConsole') || !!configRead('enableDebugLogging');
    const wantsRemote = isLogServerEnabled();
    if (!wantsVisual && !wantsRemote) return;

    const msg = args.map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }).join(' ');

    if (wantsVisual) {
      // Capped for on-screen display only — a giant wall of text in the
      // fixed-size overlay is genuinely bad UX. The remote-relay path below
      // sends the full, uncapped message; logServer.js's sendRemotePayload
      // splits anything long into multiple sent parts rather than losing
      // content, so this cap has no bearing on what reaches the PC.
      const MAX_VISUAL_LENGTH = 500;
      const visualMsg = msg.length > MAX_VISUAL_LENGTH ? msg.slice(0, MAX_VISUAL_LENGTH) + '…[truncated on-screen]' : msg;
      const color = type === 'error' ? '#f55' : type === 'warn' ? '#ff0' : '#0f0';
      logs.unshift({
        color,
        msg: visualMsg,
        time: new Date().toLocaleTimeString()
      });
      if (logs.length > 600) logs.pop();
      if (consoleDiv.style.display !== 'none') {
        renderLogs();
        consoleDiv.scrollTop = 0;
      }
    }

    if (wantsRemote) {
      const ts = new Date().toISOString();
      const level = type === 'error' ? 'ERROR' : type === 'warn' ? 'WARN' : 'INFO';
      sendRemotePayload(null, {
        ts,
        level,
        context: 'TizenTube',
        message: msg,
        _formatted: `[${ts}] [${level}] [TizenTube] ${msg}`,
      });
    }
  };

  console.log = (...args) => { original.log.apply(console, args); addLog('log', args); };
  console.info = (...args) => { original.info.apply(console, args); addLog('info', args); };
  console.warn = (...args) => { original.warn.apply(console, args); addLog('warn', args); };
  console.error = (...args) => { original.error.apply(console, args); addLog('error', args); };
  console.debug = (...args) => { original.debug.apply(console, args); addLog('debug', args); };

  const downloadLogs = () => {
    try {
      const plainTextLogs = logs
        .map((entry) => `[${entry.time}] ${entry.msg}`)
        .join('\n');
      const fileOnlyLogs = Array.isArray(window.__ttFileOnlyLogs) ? window.__ttFileOnlyLogs.join('\n') : '';
      const combinedLogs = `${plainTextLogs}\n\n===== FILE-ONLY DEBUG LOGS =====\n${fileOnlyLogs}`;
      const blob = new Blob([combinedLogs], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tizentube-logs-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      original.error('Failed to download logs', err);
    }
  };

  window.downloadTizenTubeLogs = downloadLogs;

  const toggleDebugConsole = function () {
    configWrite('enableDebugConsole', !configRead('enableDebugConsole'));
    syncVisible();
  };

  window.toggleDebugConsole = toggleDebugConsole;

  configChangeEmitter.addEventListener('configChange', (event) => {
    if (event?.detail?.key === 'enableDebugConsole' || event?.detail?.key === 'debugConsolePosition' || event?.detail?.key === 'debugConsoleHeight') {
      syncVisible();
    }
  });

  syncVisible();

  console.log('[Console] ========================================');
  console.log('[Console] Use TizenTube settings to configure position/height');
  console.log(`[Console] Visual Console ${APP_VERSION_LABEL} v${APP_VERSION}`);
  console.log(`[Console] TV Model: ${detectTvModel()}`);
  console.log(`[Console] User-Agent: ${navigator.userAgent}`);
  console.log('[Console] ========================================');

  const versionToastCmd = {
    openPopupAction: {
      popupType: 'TOAST',
      popupDurationSeconds: 5,
      popup: {
        overlayToastRenderer: {
          title: { simpleText: 'TizenTube started' },
          subtitle: { simpleText: 'Version ' + APP_VERSION }
        }
      }
    }
  };

  setTimeout(() => {
    try { resolveCommand(versionToastCmd); } catch (_) { }
  }, 1200);
}

if (typeof window.toggleDebugConsole !== 'function') {
  window.toggleDebugConsole = function () {
    configWrite('enableDebugConsole', !configRead('enableDebugConsole'));
  };
}

const interval = setInterval(() => {
  if (document.querySelector('video')) {
    initVisualConsole();
    clearInterval(interval);
  }
}, 500);