// Remote Syslog Logger for TizenTube - FIXED VERSION
import { configRead, configChangeEmitter } from '../config.js';

class SyslogLogger {
  constructor() {
    this.enabled = false;
    this.serverUrl = '';
    this.logLevel = 'INFO';
    this.maxBatchSize = 10;
    this.batchInterval = 5000;
    this.logQueue = [];
    this.batchTimer = null;
    this.lastError = null;
    this.connectionTested = false;

    // Listen for config changes so the logger re-initializes automatically
    try {
      configChangeEmitter.addEventListener('configChange', (ev) => {
        const key = ev.detail && ev.detail.key;
        if (['enableRemoteLogging', 'syslogServerIp', 'syslogServerPort', 'logLevel'].includes(key)) {
          this.reinitialize();
        }
      });
    } catch (e) {
      // ignore if emitter not available
    }

    this.init();
  }

  init() {
    try {
      this.enabled = configRead('enableRemoteLogging') || false;

      const ip = configRead('syslogServerIp') || '192.168.1.100';
      const port = configRead('syslogServerPort') || 514;
      this.serverUrl = `http://${ip}:${port}`; // keep without trailing slash

      this.logLevel = configRead('logLevel') || 'INFO';

      if (this.enabled) {
        console.log(`[Logger] ✓ Remote logging ENABLED`);
        console.log(`[Logger] → Server: ${this.serverUrl}`);
        console.log(`[Logger] → Log Level: ${this.logLevel}`);
        this.startBatchTimer();

        // Don't send test on init, wait for explicit test
      } else {
        console.log('[Logger] ✗ Remote logging DISABLED');
        if (this.batchTimer) {
          clearInterval(this.batchTimer);
          this.batchTimer = null;
        }
      }
    } catch (error) {
      console.error('[Logger] Initialization error:', error);
      this.enabled = false;
    }
  }

  // Call this when settings change
  reinitialize() {
    console.log('[Logger] Re-initializing with new settings...');
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    this.logQueue = [];
    this.init();
  }

  startBatchTimer() {
    if (this.batchTimer) clearInterval(this.batchTimer);

    this.batchTimer = setInterval(() => {
      this.flush();
    }, this.batchInterval);
  }

  shouldLog(level) {
    const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    return levels[level] >= levels[this.logLevel];
  }

  formatMessage(level, category, message, data) {
    const timestamp = new Date().toISOString();
    const device = window.h5vcc?.tizentube?.GetVersion() || 'TizenTube';

    return {
      timestamp,
      device,
      level,
      category,
      message,
      data: data || {},
      url: window.location.href
    };
  }

  async sendBatch(logs) {
    if (!this.enabled || !this.serverUrl) {
      console.log('[Logger] Cannot send: logging disabled or no server URL');
      return false;
    }

    console.log(`[Logger] → Sending ${logs.length} logs to ${this.serverUrl}...`);

    try {
      const payload = {
        logs,
        source: 'TizenTube',
        version: window.h5vcc?.tizentube?.GetVersion() || 'unknown'
      };

      console.log('[Logger] Payload:', JSON.stringify(payload, null, 2));

      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        this.lastError = `HTTP ${response.status}: ${response.statusText}`;
        console.error(`[Logger] ✗ Failed to send logs: ${this.lastError}`);
        return false;
      }

      // Try to parse JSON but be tolerant
      let result = null;
      try { result = await response.json(); } catch (_) { result = null; }

      console.log(`[Logger] ✓ Successfully sent ${logs.length} logs`, result);
      this.lastError = null;
      this.connectionTested = true;
      return true;
    } catch (error) {
      this.lastError = error.message;
      console.error('[Logger] ✗ Error sending logs:', error);
      console.error('[Logger] Server URL:', this.serverUrl);
      console.error('[Logger] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  log(level, category, message, data) {
    // Always log to console with color coding
    const consoleMethod = level === 'ERROR' ? 'error' :
      level === 'WARN' ? 'warn' :
        level === 'DEBUG' ? 'debug' : 'log';

    console[consoleMethod](
      `[${category}]`,
      message,
      data || ''
    );

    // Send to remote syslog if enabled
    if (this.enabled && this.shouldLog(level)) {
      const logEntry = this.formatMessage(level, category, message, data);
      this.logQueue.push(logEntry);

      // Flush immediately if queue is full or if it's an error
      if (this.logQueue.length >= this.maxBatchSize || level === 'ERROR') {
        this.flush();
      }
    }
  }

  flush() {
    if (this.logQueue.length === 0) return;

    const logsToSend = [...this.logQueue];
    this.logQueue = [];

    this.sendBatch(logsToSend);
  }

  debug(category, message, data) {
    this.log('DEBUG', category, message, data);
  }

  info(category, message, data) {
    this.log('INFO', category, message, data);
  }

  warn(category, message, data) {
    this.log('WARN', category, message, data);
  }

  error(category, message, data) {
    this.log('ERROR', category, message, data);
  }

  // TEST CONNECTION METHOD - Call this from the settings UI
  async testConnection() {
    console.log('[Logger] ═══════════════════════════════════════');
    console.log('[Logger] Testing connection to syslog server...');
    console.log('[Logger] ═══════════════════════════════════════');

    // Read current config (allow test even if enableRemoteLogging === false)
    const ip = configRead('syslogServerIp') || '192.168.50.98';
    const port = configRead('syslogServerPort') || 8080;
    const url = `http://${ip}:${port}`;

    console.log(`[Logger] → Attempting test POST to: ${url} (enableRemoteLogging=${configRead('enableRemoteLogging')})`);

    const testLog = this.formatMessage(
      'INFO',
      'CONNECTION_TEST',
      '🧪 This is a TEST connection from TizenTube',
      {
        testId: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        serverIp: ip,
        serverPort: port
      }
    );

    try {
      const payload = {
        logs: [testLog],
        source: 'TizenTube',
        version: window.h5vcc?.tizentube?.GetVersion() || 'unknown'
      };

      console.log('[Logger] Test payload:', JSON.stringify(payload, null, 2));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        this.lastError = `HTTP ${response.status}: ${response.statusText}`;
        console.error('[Logger] ✗ Test POST returned non-OK:', this.lastError);
        return { success: false, error: this.lastError };
      }

      // Try to parse JSON, but not strictly required
      let result = null;
      try { result = await response.json(); } catch (_) { result = null; }

      console.log('[Logger] ✓ CONNECTION TEST SUCCESSFUL!', result);
      this.connectionTested = true;
      this.lastError = null;
      // if init hasn't set serverUrl yet, set it for future use
      this.serverUrl = url;
      return { success: true, message: 'Connection successful! Check your PC terminal.' };
    } catch (error) {
      this.lastError = error.message;
      console.error('[Logger] ✗ CONNECTION TEST FAILED!', error);
      console.error('[Logger] Troubleshooting:');
      console.error('[Logger] 1. Is syslog-server.js running on your PC and listening on the configured port?');
      console.error('[Logger] 2. Is the IP address correct?', url);
      console.error('[Logger] 3. Are TV and PC on the same network?');
      console.error('[Logger] 4. Is Windows Firewall blocking the port?');
      return { success: false, error: this.lastError || 'Connection failed' };
    }
  }

  // Get status for UI
  getStatus() {
    return {
      enabled: this.enabled,
      serverUrl: this.serverUrl,
      logLevel: this.logLevel,
      queueSize: this.logQueue.length,
      lastError: this.lastError,
      connectionTested: this.connectionTested
    };
  }
}

// Create global logger instance
const logger = new SyslogLogger();

// Export for use in other modules
export default logger;

// Expose globally for debugging
if (typeof window !== 'undefined') {
  window.TizenLogger = logger;

  // Add console helper
  console.log('[Logger] ═══════════════════════════════════════');
  console.log('[Logger] TizenLogger available in console');
  console.log('[Logger] Try: TizenLogger.testConnection()');
  console.log('[Logger] Try: TizenLogger.getStatus()');
  console.log('[Logger] ═══════════════════════════════════════');
}
