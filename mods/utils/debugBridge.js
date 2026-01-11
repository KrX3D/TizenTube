// Debug Bridge using localStorage
// Add to mods/utils/debugBridge.js

class DebugBridge {
  constructor() {
    this.logs = [];
    this.maxLogs = 200;
    this.storageKey = 'tizentube_debug_logs';
    
    console.log('[DebugBridge] Initializing...');
    
    // Load existing logs
    this.loadLogs();
    
    // Intercept console
    this.interceptConsole();
    
    // Periodic save
    setInterval(() => this.saveLogs(), 2000);
    
    console.log('[DebugBridge] Ready - logs stored in localStorage');
  }

  loadLogs() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        this.logs = data.logs || [];
      }
    } catch (e) {
      console.error('[DebugBridge] Failed to load logs:', e);
      this.logs = [];
    }
  }

  saveLogs() {
    try {
      const data = {
        logs: this.logs.slice(-this.maxLogs), // Keep last 200
        lastUpdate: new Date().toISOString(),
        device: window.h5vcc?.tizentube?.GetVersion() || 'TizenTube',
        userAgent: navigator.userAgent
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      // localStorage full - clear old logs
      this.logs = this.logs.slice(-50);
      try {
        localStorage.setItem(this.storageKey, JSON.stringify({
          logs: this.logs,
          lastUpdate: new Date().toISOString()
        }));
      } catch (e2) {
        console.error('[DebugBridge] Cannot save logs:', e2);
      }
    }
  }

  interceptConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

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
  }

  addLog(level, args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
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

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  getLogs() {
    return this.logs;
  }

  clearLogs() {
    this.logs = [];
    localStorage.removeItem(this.storageKey);
    console.log('[DebugBridge] Logs cleared');
  }

  exportLogs() {
    return {
      logs: this.logs,
      exported: new Date().toISOString(),
      device: window.h5vcc?.tizentube?.GetVersion() || 'TizenTube',
      userAgent: navigator.userAgent
    };
  }
}

const debugBridge = new DebugBridge();

if (typeof window !== 'undefined') {
  window.TizenDebugBridge = debugBridge;
}

export default debugBridge;