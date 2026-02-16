export function initVisualConsole({ APP_VERSION, APP_VERSION_LABEL, resolveCommand, configWrite }) {
  const CONFIG_KEY = 'ytaf-configuration';

  const getConsolePosition = () => {
    try {
      const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
      return config.debugConsolePosition || 'bottom-right';
    } catch (e) {
      return 'bottom-right';
    }
  };

  const getConsoleEnabled = () => {
    try {
      const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
      return config.enableDebugConsole !== false;
    } catch (e) {
      return true;
    }
  };

  let currentPosition = getConsolePosition();
  let enabled = getConsoleEnabled();
  let consoleVisible = enabled;

  const positions = {
    'top-left': { top: '0', left: '0', right: '', bottom: '', transform: '' },
    'top-right': { top: '0', right: '0', left: '', bottom: '', transform: '' },
    'bottom-left': { bottom: '0', left: '0', right: '', top: '', transform: '' },
    'bottom-right': { bottom: '0', right: '0', left: '', top: '', transform: '' },
    center: { top: '50%', left: '50%', right: '', bottom: '', transform: 'translate(-50%, -50%)' }
  };

  const getConsoleHeight = () => {
    try {
      const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
      return config.debugConsoleHeight || '500';
    } catch (e) {
      return '500';
    }
  };

  let currentHeight = getConsoleHeight();

  const consoleDiv = document.createElement('div');
  consoleDiv.id = 'tv-debug-console';

  const posStyles = positions[currentPosition] || positions['bottom-right'];
  consoleDiv.style.cssText = `
    position: fixed;
    width: 900px;
    height: ${currentHeight}px;
    background: rgba(0, 0, 0, 0.95);
    color: #0f0;
    font-family: monospace;
    font-size: 13px;
    padding: 10px;
    overflow-y: scroll !important;
    overflow-x: hidden;
    z-index: 999999;
    border: 3px solid #0f0;
    display: ${enabled ? 'block' : 'none'};
    box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
    pointer-events: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  `;

  Object.assign(consoleDiv.style, posStyles);

  if (document.body) {
    document.body.appendChild(consoleDiv);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(consoleDiv);
    });
  }

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  let logs = [];
  window.consoleAutoScroll = true;

  function safeStringify(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return String(value);
    if (typeof value !== 'object') return String(value);

    const seen = new WeakSet();
    try {
      const serialized = JSON.stringify(value, (key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      });
      if (typeof serialized === 'string') return serialized;
    } catch (_) {}

    try {
      return String(value);
    } catch (_) {
      return '[Unserializable]';
    }
  }

  function formatConsoleArgs(args) {
    return args.map((arg) => safeStringify(arg)).join(' ');
  }

  window.scrollConsoleUp = function() {
    if (!consoleDiv || !enabled || !consoleVisible) return;

    const step = Math.max(180, Math.floor(consoleDiv.clientHeight * 0.85));
    const before = consoleDiv.scrollTop;
    const maxScroll = Math.max(0, consoleDiv.scrollHeight - consoleDiv.clientHeight);
    const target = Math.min(maxScroll, before + step);
    if (typeof consoleDiv.scrollBy === 'function') consoleDiv.scrollBy(0, step);
    consoleDiv.scrollTop = target;
    const after = consoleDiv.scrollTop;
    originalLog('[ConsoleScroll] RED old=', before, 'new=', after, 'step=', step, 'h=', consoleDiv.clientHeight, 'sh=', consoleDiv.scrollHeight);

    window.consoleAutoScroll = false;
    updateBorder();
  };

  window.scrollConsoleDown = function() {
    if (!consoleDiv || !enabled || !consoleVisible) return;

    const step = Math.max(180, Math.floor(consoleDiv.clientHeight * 0.85));
    const before = consoleDiv.scrollTop;
    const target = Math.max(0, before - step);
    if (typeof consoleDiv.scrollBy === 'function') consoleDiv.scrollBy(0, -step);
    consoleDiv.scrollTop = target;
    const after = consoleDiv.scrollTop;
    originalLog('[ConsoleScroll] GREEN old=', before, 'new=', after, 'step=', step, 'h=', consoleDiv.clientHeight, 'sh=', consoleDiv.scrollHeight);

    window.consoleAutoScroll = false;
    updateBorder();
  };

  window.enableConsoleAutoScroll = function() {
    if (!consoleDiv || !enabled || !consoleVisible) return;

    window.consoleAutoScroll = true;
    updateBorder();
    consoleDiv.scrollTop = 0;
    consoleDiv.scroll(0, 0);
    consoleDiv.scrollTo(0, 0);
    consoleDiv.innerHTML = logs.join('');
  };

  window.deleteConsoleLastLog = function() {
    if (!consoleDiv || !enabled || !consoleVisible) return;
    if (logs.length === 0) return;
    logs.splice(0, Math.min(1, logs.length));
    consoleDiv.innerHTML = logs.join('');
  };

  function updateBorder() {
    if (consoleDiv) {
      consoleDiv.style.borderColor = window.consoleAutoScroll ? '#0f0' : '#f80';
    }
  }

  function addLog(message, type = 'log') {
    if (!enabled) return;

    const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `<div style="color:${color};margin-bottom:5px;word-wrap:break-word;white-space:pre-wrap;">[${timestamp}] ${message}</div>`;

    logs.unshift(logEntry);
    if (logs.length > 600) logs.pop();

    if (consoleDiv && consoleVisible) {
      if (!window.consoleAutoScroll) return;
      const previousScrollTop = consoleDiv.scrollTop;
      consoleDiv.innerHTML = logs.join('');
      if (window.consoleAutoScroll) {
        consoleDiv.scrollTop = 0;
      } else {
        consoleDiv.scrollTop = previousScrollTop;
      }
    }
  }

  console.log = function(...args) {
    originalLog.apply(console, args);
    if (enabled) addLog(formatConsoleArgs(args), 'log');
  };

  console.info = function(...args) {
    originalInfo.apply(console, args);
    if (enabled) addLog(formatConsoleArgs(args), 'log');
  };

  console.error = function(...args) {
    originalError.apply(console, args);
    if (enabled) addLog(formatConsoleArgs(args), 'error');
  };

  console.warn = function(...args) {
    originalWarn.apply(console, args);
    if (enabled) addLog(formatConsoleArgs(args), 'warn');
  };

  console.debug = function(...args) {
    originalDebug.apply(console, args);
    if (enabled) addLog(formatConsoleArgs(args), 'log');
  };

  let lastToggleTime = 0;

  window.toggleDebugConsole = function() {
    const now = Date.now();
    if (now - lastToggleTime < 500) return;
    lastToggleTime = now;

    enabled = !enabled;
    consoleVisible = enabled;

    try {
      configWrite('enableDebugConsole', enabled);
    } catch (e) {
      console.error('[Console] Failed to save config:', e);
      try {
        const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
        config.enableDebugConsole = enabled;
        window.localStorage[CONFIG_KEY] = JSON.stringify(config);
      } catch (fallbackError) {
        console.error('[Console] Failed to save config fallback:', fallbackError);
      }
    }

    if (consoleDiv) {
      consoleDiv.style.display = consoleVisible ? 'block' : 'none';
      if (consoleVisible) {
        window.consoleAutoScroll = true;
        updateBorder();
        consoleDiv.scrollTop = 0;
        if (logs.length > 0) {
          consoleDiv.innerHTML = logs.join('');
        }
      }
    }

    setTimeout(() => {
      console.log('[Console] Console ' + (enabled ? 'ENABLED ✓' : 'DISABLED ✗') + ' via BLUE button');
      console.log('[Console] Settings UI will update next time you open it');
    }, 100);
  };

  window.setDebugConsolePosition = function(pos) {
    currentPosition = pos;
    const posStylesNext = positions[pos] || positions['bottom-right'];
    if (consoleDiv) Object.assign(consoleDiv.style, posStylesNext);
  };

  setInterval(() => {
    try {
      const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
      const newEnabled = config.enableDebugConsole !== false;
      if (newEnabled !== enabled) {
        enabled = newEnabled;
        consoleVisible = newEnabled;
        if (consoleDiv) {
          consoleDiv.style.display = consoleVisible ? 'block' : 'none';
          if (consoleVisible) {
            window.consoleAutoScroll = true;
            updateBorder();
            consoleDiv.scrollTop = 0;
          }
        }
      }

      const newPosition = config.debugConsolePosition || 'bottom-right';
      if (newPosition !== currentPosition) {
        currentPosition = newPosition;
        const posStylesNext = positions[newPosition] || positions['bottom-right'];
        if (consoleDiv) Object.assign(consoleDiv.style, posStylesNext);
      }

      const newHeight = config.debugConsoleHeight || '500';
      if (newHeight !== currentHeight) {
        currentHeight = newHeight;
        if (consoleDiv) consoleDiv.style.height = newHeight + 'px';
      }
    } catch (e) {}
  }, 500);

  console.log('[Console] ========================================');
  console.log('[Console] Visual Console ' + APP_VERSION_LABEL + ' - NEWEST FIRST');
  console.log('[Console] ========================================');
  console.log('[Console] ⚡ NEWEST LOGS AT TOP (scroll down for older)');
  console.log('[Console] Remote Controls:');
  console.log('[Console]   RED button - Scroll UP (older logs)');
  console.log('[Console]   GREEN button - Scroll DOWN (newer logs)');
  console.log('[Console]   YELLOW button - Delete last log line');
  console.log('[Console]   BLUE button - Toggle console ON/OFF');
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
    try {
      resolveCommand(versionToastCmd);
    } catch (_) {}
    setTimeout(() => {
      try {
        resolveCommand(versionToastCmd);
      } catch (_) {}
    }, 2500);
  }, 1200);

  updateBorder();
}
