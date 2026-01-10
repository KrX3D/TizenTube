// TizenTube Debug Web Server

class DebugServer {
  constructor() {
    this.logs = [];
    this.maxLogs = 500;
    this.serverPort = 3123;
    this.serverRunning = false;
    
    console.log('[DebugServer] Initializing...');
    
    // Intercept console methods
    this.interceptConsole();
    
    // Check if we can start a server
    this.checkServerCapability();
  }

  interceptConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalDebug = console.debug;

    const self = this;

    console.log = function(...args) {
      originalLog.apply(console, args);
      self.addLog('LOG', args);
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      self.addLog('ERROR', args);
    };

    console.warn = function(...args) {
      originalWarn.apply(console, args);
      self.addLog('WARN', args);
    };

    console.debug = function(...args) {
      originalDebug.apply(console, args);
      self.addLog('DEBUG', args);
    };

    console.log('[DebugServer] Console intercepted');
  }

  addLog(level, args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    this.logs.push({
      timestamp,
      level,
      message
    });

    // Keep only last N logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  checkServerCapability() {
    // Samsung TVs don't allow creating HTTP servers from browser JavaScript
    // But we can use localStorage to share logs between the TV and a separate server
    
    console.log('[DebugServer] TV browsers cannot create HTTP servers');
    console.log('[DebugServer] Using localStorage bridge instead');
    
    // Store logs in localStorage so external server can read them
    this.startLogSync();
  }

  startLogSync() {
    // Update localStorage every second with latest logs
    setInterval(() => {
      try {
        localStorage.setItem('tizentube_debug_logs', JSON.stringify({
          logs: this.logs,
          lastUpdate: new Date().toISOString()
        }));
      } catch (e) {
        // localStorage might be full, clear old logs
        this.logs = this.logs.slice(-100);
      }
    }, 1000);

    console.log('[DebugServer] Log sync started (localStorage)');
  }

  getLogs() {
    return this.logs;
  }

  clearLogs() {
    this.logs = [];
    localStorage.removeItem('tizentube_debug_logs');
    console.log('[DebugServer] Logs cleared');
  }

  getStatus() {
    return {
      totalLogs: this.logs.length,
      maxLogs: this.maxLogs,
      lastLog: this.logs[this.logs.length - 1] || null
    };
  }
}

// Create global instance
const debugServer = new DebugServer();

// Expose globally
if (typeof window !== 'undefined') {
  window.TizenDebugServer = debugServer;
  console.log('[DebugServer] Available globally as window.TizenDebugServer');
}

export default debugServer;