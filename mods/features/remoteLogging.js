import { configRead, configChangeEmitter } from '../config.js';

function createRemoteLogger() {
  const queue = [];
  let timer = null;

  function isEnabled() {
    return !!configRead('enableRemoteLogging');
  }

  function endpoint() {
    return String(configRead('remoteLoggingUrl') || '').trim();
  }

  function batchSize() {
    return Number(configRead('remoteLoggingBatchSize') || 10);
  }

  function flush() {
    if (!isEnabled()) return;
    const url = endpoint();
    if (!url || queue.length === 0) return;

    const payload = queue.splice(0, Math.max(1, batchSize()));
    const body = JSON.stringify({
      source: 'tizentube',
      sentAt: new Date().toISOString(),
      entries: payload
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      mode: 'cors'
    }).catch(() => {
      queue.unshift(...payload.slice(0, 20));
    });
  }

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, 1500);
  }

  function log(level, message) {
    if (!isEnabled()) return;
    if (!endpoint()) return;
    queue.push({
      level,
      message,
      ts: new Date().toISOString(),
      href: location.href
    });
    if (queue.length >= Math.max(1, batchSize())) {
      flush();
      return;
    }
    scheduleFlush();
  }

  function test() {
    log('info', '[RemoteLogger] Test message from TizenTube');
    flush();
  }

  configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail?.key === 'enableRemoteLogging' && !e.detail.value) {
      queue.length = 0;
    }
  });

  window.addEventListener('beforeunload', flush);

  return { log, flush, test };
}

if (typeof window !== 'undefined') {
  window.remoteLogger = createRemoteLogger();
}
