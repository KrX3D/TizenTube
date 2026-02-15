import { configRead, configChangeEmitter } from '../config.js';

function safeSerialize(value, seen = new WeakSet()) {
  try {
    if (value === null || value === undefined) return String(value);
    const type = typeof value;
    if (type === 'string') return value;
    if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
    if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`.trim();
    if (type === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      return JSON.stringify(value, (_, nested) => {
        if (typeof nested === 'object' && nested !== null) {
          if (seen.has(nested)) return '[Circular]';
          seen.add(nested);
        }
        if (typeof nested === 'function') return `[Function ${nested.name || 'anonymous'}]`;
        if (typeof nested === 'bigint') return nested.toString();
        if (nested instanceof Error) return `${nested.name}: ${nested.message}`;
        return nested;
      });
    }
    return String(value);
  } catch (_) {
    return '[Unserializable]';
  }
}

function createRemoteLogger(settingsAccessor = configRead) {
  const state = {
    queue: [],
    flushTimer: null,
    ws: null,
    wsConnecting: false,
    wsBackoffMs: 1000,
    wsReconnectTimer: null,
    httpInFlight: false
  };

  function isEnabled() {
    return !!settingsAccessor('enableRemoteLogging');
  }

  function transportMode() {
    return String(settingsAccessor('remoteLoggingTransport') || 'http').toLowerCase();
  }

  function httpEndpoint() {
    return String(settingsAccessor('remoteLoggingUrl') || '').trim();
  }

  function wsEndpoint() {
    return String(settingsAccessor('remoteLoggingWsUrl') || '').trim();
  }

  function authToken() {
    return String(settingsAccessor('remoteLoggingAuthToken') || '').trim();
  }

  function queueSize() {
    return Math.max(20, Number(settingsAccessor('remoteLoggingQueueSize') || 300));
  }

  function batchSize() {
    return Math.max(1, Number(settingsAccessor('remoteLoggingBatchSize') || 10));
  }

  function httpTimeoutMs() {
    return Math.max(500, Number(settingsAccessor('remoteLoggingHttpTimeoutMs') || 3500));
  }

  function activeTransport() {
    const mode = transportMode();
    if (mode === 'ws') return 'ws';
    return 'http';
  }

  function useHttp() {
    return activeTransport() === 'http';
  }

  function useWs() {
    return activeTransport() === 'ws';
  }

  function pushLog(level, args) {
    const payload = {
      level,
      args: Array.isArray(args) ? args.map((arg) => safeSerialize(arg)) : [safeSerialize(args)],
      ts: Date.now(),
      href: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      source: 'TizenTube'
    };

    if (state.queue.length >= queueSize()) {
      state.queue.splice(0, state.queue.length - queueSize() + 1);
    }
    state.queue.push(payload);
  }

  function wsReady() {
    return state.ws && state.ws.readyState === WebSocket.OPEN;
  }

  function closeWs() {
    if (state.ws) {
      try { state.ws.close(); } catch (_) {}
    }
    state.ws = null;
    state.wsConnecting = false;
  }

  function scheduleWsReconnect() {
    if (state.wsReconnectTimer || !isEnabled() || !useWs() || !wsEndpoint()) return;
    state.wsReconnectTimer = setTimeout(() => {
      state.wsReconnectTimer = null;
      connectWs();
    }, state.wsBackoffMs);
    state.wsBackoffMs = Math.min(30000, state.wsBackoffMs * 2);
  }

  function connectWs() {
    if (!isEnabled() || !useWs()) return;
    const rawUrl = wsEndpoint();
    if (!rawUrl || wsReady() || state.wsConnecting) return;

    state.wsConnecting = true;
    try {
      let target = rawUrl;
      const token = authToken();
      if (token) {
        const joiner = rawUrl.includes('?') ? '&' : '?';
        target = `${rawUrl}${joiner}token=${encodeURIComponent(token)}`;
      }
      const ws = new WebSocket(target);
      state.ws = ws;

      ws.addEventListener('open', () => {
        state.wsConnecting = false;
        state.wsBackoffMs = 1000;
        const token = authToken();
        if (token) {
          try {
            ws.send(JSON.stringify({ type: 'auth', token, source: 'TizenTube' }));
          } catch (_) {}
        }
        flush();
      });

      ws.addEventListener('close', () => {
        state.wsConnecting = false;
        state.ws = null;
        scheduleWsReconnect();
      });

      ws.addEventListener('error', () => {
        state.wsConnecting = false;
        try { ws.close(); } catch (_) {}
      });
    } catch (_) {
      state.wsConnecting = false;
      scheduleWsReconnect();
    }
  }

  async function sendHttpBatch(batch) {
    const url = httpEndpoint();
    if (!url || batch.length === 0) return false;

    const body = JSON.stringify({ source: 'TizenTube', sentAt: Date.now(), entries: batch });
    const token = authToken();

    // 1) Fast path for best effort telemetry
    try {
      if (!token && navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return true;
      }
    } catch (_) {}

    // 2) Standard CORS fetch path
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutHandle = controller ? setTimeout(() => controller.abort(), httpTimeoutMs()) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        keepalive: true,
        mode: 'cors',
        signal: controller ? controller.signal : undefined
      });
      if (response && response.ok) return true;
    } catch (_) {
      // fall through to no-cors fallback
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    // 3) Fallback similar to your simple snippet
    // (No custom headers here, avoids preflight/auth constraints)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        mode: 'no-cors',
        keepalive: true
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function sendWsBatch(batch) {
    if (!wsReady()) return false;
    try {
      const token = authToken();
      state.ws.send(JSON.stringify({ type: 'logs', source: 'TizenTube', token: token || undefined, entries: batch }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function flush() {
    if (!isEnabled()) return;
    if (state.queue.length === 0) return;
    if (state.httpInFlight) return;

    const batch = state.queue.slice(0, batchSize());
    const httpWanted = useHttp() && !!httpEndpoint();
    const wsWanted = useWs() && !!wsEndpoint();

    if (wsWanted && !wsReady()) connectWs();

    let httpOk = !httpWanted;
    let wsOk = !wsWanted;

    if (httpWanted) {
      state.httpInFlight = true;
      httpOk = await sendHttpBatch(batch);
      state.httpInFlight = false;
    }

    if (wsWanted) {
      wsOk = sendWsBatch(batch);
    }

    if (httpOk || wsOk) {
      state.queue.splice(0, batch.length);
    }

    if (state.queue.length > 0) scheduleFlush();
  }

  function scheduleFlush() {
    if (state.flushTimer) return;
    state.flushTimer = setTimeout(async () => {
      state.flushTimer = null;
      await flush();
    }, 1200);
  }

  function log(level, ...args) {
    if (!isEnabled()) return;
    if (!useHttp() && !useWs()) return;
    pushLog(level, args);
    scheduleFlush();
    if (useWs()) connectWs();
  }

  async function test() {
    log('info', '[RemoteLogger] Test message from TizenTube');
    await flush();
  }

  async function testConnection() {
    const checks = {
      http: !useHttp() || !httpEndpoint() ? 'skipped' : 'failed',
      ws: !useWs() || !wsEndpoint() ? 'skipped' : 'failed'
    };

    if (useHttp() && httpEndpoint()) {
      checks.http = (await sendHttpBatch([{ level: 'info', args: ['[RemoteLogger] HTTP test'], ts: Date.now(), href: location.href, userAgent: navigator.userAgent, source: 'TizenTube' }])) ? 'ok' : 'failed';
    }

    if (useWs() && wsEndpoint()) {
      checks.ws = await new Promise((resolve) => {
        let resolved = false;
        try {
          const token = authToken();
          const raw = wsEndpoint();
          const joiner = raw.includes('?') ? '&' : '?';
          const probeUrl = token ? `${raw}${joiner}token=${encodeURIComponent(token)}` : raw;
          const probe = new WebSocket(probeUrl);
          const done = (value) => {
            if (resolved) return;
            resolved = true;
            try { probe.close(); } catch (_) {}
            resolve(value);
          };
          const timeout = setTimeout(() => done('failed'), 2500);
          probe.addEventListener('open', () => {
            clearTimeout(timeout);
            try {
              probe.send(JSON.stringify({ type: 'logs', source: 'TizenTube', entries: [{ level: 'info', args: ['[RemoteLogger] WS test'], ts: Date.now(), href: location.href, userAgent: navigator.userAgent, source: 'TizenTube' }] }));
            } catch (_) {}
            done('ok');
          });
          probe.addEventListener('error', () => {
            clearTimeout(timeout);
            done('failed');
          });
        } catch (_) {
          resolve('failed');
        }
      });
    }

    return checks;
  }

  function resetStateOnConfigChange(key, value) {
    if (key === 'enableRemoteLogging' && !value) {
      state.queue.length = 0;
      closeWs();
      return;
    }

    if (key === 'remoteLoggingWsUrl' || key === 'remoteLoggingTransport' || key === 'remoteLoggingAuthToken') {
      closeWs();
      if (isEnabled() && useWs()) connectWs();
    }
  }

  configChangeEmitter.addEventListener('configChange', (event) => {
    resetStateOnConfigChange(event.detail?.key, event.detail?.value);
  });

  window.addEventListener('beforeunload', () => {
    flush();
  });

  return {
    log,
    flush,
    test,
    testConnection,
    connectWs
  };
}

export function initRemoteLogger(settingsAccessor = configRead) {
  if (typeof window === 'undefined') return null;
  if (window.remoteLogger) return window.remoteLogger;
  window.remoteLogger = createRemoteLogger(settingsAccessor);
  return window.remoteLogger;
}

if (typeof window !== 'undefined') {
  initRemoteLogger(configRead);
}
