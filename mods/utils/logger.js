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

    console.log('[Logger] ===== LOGGER CONSTRUCTOR CALLED =====');

    try {
      configChangeEmitter.addEventListener('configChange', (ev) => {
        const key = ev.detail && ev.detail.key;
        console.log('[Logger] Config changed:', key);
        if (['enableRemoteLogging', 'syslogServerIp', 'syslogServerPort', 'logLevel'].includes(key)) {
          this.reinitialize();
        }
      });
    } catch (e) {
      console.error('[Logger] Could not attach config listener:', e);
    }

    this.init();
  }

  init() {
    console.log('[Logger] ===== INIT CALLED =====');
    
    try {
      this.enabled = configRead('enableRemoteLogging') || false;
      console.log('[Logger] enableRemoteLogging:', this.enabled);

      const ip = configRead('syslogServerIp') || '192.168.1.100';
      const port = configRead('syslogServerPort') || 8080;
      console.log('[Logger] IP:', ip, 'Port:', port);
      
      this.serverUrl = `http://${ip}:${port}`;
      this.logLevel = configRead('logLevel') || 'INFO';

      console.log('[Logger] Final config:', {
        enabled: this.enabled,
        serverUrl: this.serverUrl,
        logLevel: this.logLevel
      });

      if (this.enabled) {
        console.log('[Logger] ✓ Remote logging ENABLED');
        this.startBatchTimer();
      } else {
        console.log('[Logger] ✗ Remote logging DISABLED');
        if (this.batchTimer) {
          clearInterval(this.batchTimer);
          this.batchTimer = null;
        }
      }
    } catch (error) {
      console.error('[Logger] Init error:', error);
      console.error('[Logger] Error stack:', error.stack);
      this.enabled = false;
    }
  }

  reinitialize() {
    console.log('[Logger] ===== REINITIALIZE CALLED =====');
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    this.logQueue = [];
    this.init();
  }
  
  // Add this new method to sync logs to debug viewer
  syncToDebugViewer() {
    const debugServerIp = configRead('syslogServerIp') || '192.168.70.124';
    const debugViewerUrl = `http://${debugServerIp}:3123/api/logs`;
    
    // Collect all console logs from debugServer if available
    const allLogs = window.TizenDebugServer ? window.TizenDebugServer.getLogs() : [];
    
    if (allLogs.length === 0) return;
    
    try {
      fetch(debugViewerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: allLogs })
      }).catch(() => {
        // Silently fail if debug viewer not running
      });
    } catch (e) {
      // Ignore errors
    }
  }

  // Call this in the startBatchTimer method - add after the existing setInterval:
  startBatchTimer() {
    if (this.batchTimer) clearInterval(this.batchTimer);

    this.batchTimer = setInterval(() => {
      this.flush();
    }, this.batchInterval);
    
    // Also sync to debug viewer every 2 seconds
    this.debugSyncTimer = setInterval(() => {
      this.syncToDebugViewer();
    }, 2000);
    
    console.log('[Logger] Batch timer started');
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
    console.log('[Logger] ===== SEND BATCH CALLED =====');
    console.log('[Logger] Logs to send:', logs.length);
    console.log('[Logger] Enabled:', this.enabled);
    console.log('[Logger] Server URL:', this.serverUrl);
    
    if (!this.enabled || !this.serverUrl) {
      console.log('[Logger] ✗ Cannot send: disabled or no URL');
      return false;
    }

    // Validate URL
    if (!this.serverUrl.startsWith('http://') && !this.serverUrl.startsWith('https://')) {
      console.error('[Logger] ✗ Invalid URL - must start with http:// or https://');
      console.error('[Logger] Current URL:', this.serverUrl);
      this.lastError = 'Invalid URL protocol';
      return false;
    }

    const payload = {
      logs,
      source: 'TizenTube',
      version: window.h5vcc?.tizentube?.GetVersion() || 'unknown'
    };

    console.log('[Logger] Payload:', JSON.stringify(payload, null, 2));
    console.log('[Logger] Sending POST to:', this.serverUrl);

    try {
      console.log('[Logger] Creating fetch request...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('[Logger] Response received');
      console.log('[Logger] Status:', response.status);
      console.log('[Logger] Status Text:', response.statusText);
      console.log('[Logger] OK:', response.ok);

      if (!response.ok) {
        this.lastError = `HTTP ${response.status}: ${response.statusText}`;
        console.error('[Logger] ✗ Response not OK:', this.lastError);
        
        // Specific error messages
        if (response.status === 0) {
          console.error('[Logger] Status 0 usually means:');
          console.error('[Logger]   - CORS blocking the request');
          console.error('[Logger]   - Server not reachable');
          console.error('[Logger]   - Network error');
        } else if (response.status === 404) {
          console.error('[Logger] 404 - Server running but wrong endpoint');
        } else if (response.status === 500) {
          console.error('[Logger] 500 - Server error');
        }
        
        return false;
      }

      let result = null;
      try {
        const text = await response.text();
        console.log('[Logger] Response text:', text);
        result = JSON.parse(text);
        console.log('[Logger] Parsed result:', result);
      } catch (e) {
        console.log('[Logger] Could not parse JSON response:', e);
      }

      console.log('[Logger] ✓ Successfully sent', logs.length, 'logs');
      this.lastError = null;
      this.connectionTested = true;
      return true;
    } catch (error) {
      this.lastError = error.message;
      console.error('[Logger] ===== SEND BATCH ERROR =====');
      console.error('[Logger] Error name:', error.name);
      console.error('[Logger] Error message:', error.message);
      console.error('[Logger] Error stack:', error.stack);
      console.error('[Logger] Server URL was:', this.serverUrl);
      
      // Detailed error diagnosis
      if (error.name === 'TypeError') {
        console.error('[Logger] ═══════════════════════════════════');
        console.error('[Logger] TypeError - "Failed to fetch" usually means:');
        console.error('[Logger]   1. Server not running at ' + this.serverUrl);
        console.error('[Logger]   2. Firewall blocking the connection');
        console.error('[Logger]   3. Wrong IP address or port');
        console.error('[Logger]   4. TV and PC not on same network');
        console.error('[Logger]   5. CORS issue (but server should allow)');
        console.error('[Logger] ═══════════════════════════════════');
        console.error('[Logger] CHECK:');
        console.error('[Logger]   - Is server running? (node syslog-server.js)');
        console.error('[Logger]   - Is IP correct? Current:', this.serverUrl);
        console.error('[Logger]   - Firewall rule exists? Port:', this.serverUrl.match(/:(\d+)/)?.[1]);
        console.error('[Logger] ═══════════════════════════════════');
      } else if (error.name === 'AbortError') {
        console.error('[Logger] Request timeout after 5 seconds');
        console.error('[Logger] Server might be slow or unreachable');
      } else if (error.name === 'NetworkError') {
        console.error('[Logger] NetworkError - server unreachable');
      }
      
      return false;
    }
  }

  log(level, category, message, data) {
    const consoleMethod = level === 'ERROR' ? 'error' :
      level === 'WARN' ? 'warn' :
      level === 'DEBUG' ? 'debug' : 'log';

    console[consoleMethod](`[${category}]`, message, data || '');

    if (this.enabled && this.shouldLog(level)) {
      const logEntry = this.formatMessage(level, category, message, data);
      this.logQueue.push(logEntry);

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

  async testConnection() {
    console.log('[Logger] ========================================');
    console.log('[Logger] TEST CONNECTION CALLED');
    console.log('[Logger] ========================================');

    const ip = configRead('syslogServerIp') || '192.168.50.98';
    const port = configRead('syslogServerPort') || 8080;
    const url = `http://${ip}:${port}`;

    console.log('[Logger] Reading config:');
    console.log('[Logger]   IP:', ip);
    console.log('[Logger]   Port:', port);
    console.log('[Logger]   URL:', url);
    console.log('[Logger]   Enabled:', configRead('enableRemoteLogging'));
    console.log('[Logger]   Log Level:', configRead('logLevel'));

    const testLog = this.formatMessage(
      'INFO',
      'CONNECTION_TEST',
      '🧪 This is a TEST from TizenTube',
      {
        testId: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        serverIp: ip,
        serverPort: port,
        userAgent: navigator.userAgent
      }
    );

    console.log('[Logger] Test log created:', testLog);

    const payload = {
      logs: [testLog],
      source: 'TizenTube-Test',
      version: window.h5vcc?.tizentube?.GetVersion() || 'unknown'
    };

    console.log('[Logger] Test payload:', JSON.stringify(payload, null, 2));
    console.log('[Logger] About to send fetch...');

    try {
      console.log('[Logger] Calling fetch with URL:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      console.log('[Logger] Fetch completed!');
      console.log('[Logger] Response status:', response.status);
      console.log('[Logger] Response ok:', response.ok);

      if (!response.ok) {
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        console.error('[Logger] ✗ Response not OK:', errorMsg);
        this.lastError = errorMsg;
        return { success: false, error: errorMsg };
      }

      let result = null;
      try {
        const text = await response.text();
        console.log('[Logger] Response text:', text);
        result = JSON.parse(text);
      } catch (e) {
        console.log('[Logger] Response not JSON:', e);
      }

      console.log('[Logger] ========================================');
      console.log('[Logger] ✓ TEST CONNECTION SUCCESSFUL!');
      console.log('[Logger] ========================================');
      
      this.connectionTested = true;
      this.lastError = null;
      this.serverUrl = url;
      
      return { 
        success: true, 
        message: 'Connection successful! Check your PC terminal.',
        response: result
      };
    } catch (error) {
      console.log('[Logger] ========================================');
      console.log('[Logger] ✗ TEST CONNECTION FAILED');
      console.log('[Logger] ========================================');
      console.error('[Logger] Error type:', error.constructor.name);
      console.error('[Logger] Error name:', error.name);
      console.error('[Logger] Error message:', error.message);
      console.error('[Logger] Error stack:', error.stack);
      console.error('[Logger] URL attempted:', url);
      
      this.lastError = error.message;
      
      return { 
        success: false, 
        error: error.message,
        errorType: error.name,
        url: url
      };
    }
  }

  getStatus() {
    const status = {
      enabled: this.enabled,
      serverUrl: this.serverUrl,
      logLevel: this.logLevel,
      queueSize: this.logQueue.length,
      lastError: this.lastError,
      connectionTested: this.connectionTested
    };
    console.log('[Logger] Current status:', status);
    return status;
  }
}

const logger = new SyslogLogger();
export default logger;

if (typeof window !== 'undefined') {
  window.TizenLogger = logger;
  console.log('[Logger] ========================================');
  console.log('[Logger] TizenLogger exposed globally');
  console.log('[Logger] Try in console:');
  console.log('[Logger]   TizenLogger.getStatus()');
  console.log('[Logger]   TizenLogger.testConnection()');
  console.log('[Logger] ========================================');
}