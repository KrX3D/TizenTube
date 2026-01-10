// Visual Console for TV
// This creates an on-screen console you can see on your TV

(function() {
    // Create console overlay
    const consoleDiv = document.createElement('div');
    consoleDiv.id = 'tv-debug-console';
    consoleDiv.style.cssText = `
        position: fixed;
        bottom: 0;
        right: 0;
        width: 600px;
        height: 400px;
        background: rgba(0, 0, 0, 0.9);
        color: #0f0;
        font-family: monospace;
        font-size: 14px;
        padding: 10px;
        overflow-y: auto;
        z-index: 999999;
        border: 2px solid #0f0;
        display: block;
    `;
    document.body.appendChild(consoleDiv);

    // Store original console methods
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    // Console state
    let visible = false;
    let logs = [];

    // Add log to visual console
    function addLog(message, type = 'log') {
        const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div style="color:${color};margin-bottom:5px;">[${timestamp}] ${message}</div>`;
        
        logs.push(logEntry);
        if (logs.length > 50) logs.shift(); // Keep last 50 logs
        
        consoleDiv.innerHTML = logs.join('');
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }

    // Override console methods
    console.log = function(...args) {
        originalLog.apply(console, args);
        addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'log');
    };

    console.error = function(...args) {
        originalError.apply(console, args);
        addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'error');
    };

    console.warn = function(...args) {
        originalWarn.apply(console, args);
        addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'warn');
    };

    // Toggle console with keyboard shortcut
    document.addEventListener('keydown', (e) => {
        // Press ` (backtick) or F12 to toggle
        if (e.key === '`' || e.key === 'F12') {
            visible = !visible;
            consoleDiv.style.display = visible ? 'block' : 'none';
        }
        // Press C to clear
        if (e.key === 'c' && visible) {
            logs = [];
            consoleDiv.innerHTML = '';
        }
    });

    console.log('[Visual Console] Initialized - Press ` or F12 to toggle, C to clear');
    
    // Expose globally
    window.toggleDebugConsole = function() {
        visible = !visible;
        consoleDiv.style.display = visible ? 'block' : 'none';
    };
    console.log('[Visual Console] Initialized - Press ` or F12 to toggle');
    
    // ADD THESE TEST LOGS:
    console.log('TEST LOG - If you see this, console is working!');
    console.error('TEST ERROR - Red text');
    console.warn('TEST WARN - Yellow text');
})();

import "./features/userAgentSpoofing.js";
import "whatwg-fetch";
import 'core-js/proposals/object-getownpropertydescriptors';
import '@formatjs/intl-getcanonicallocales/polyfill.iife'
import '@formatjs/intl-locale/polyfill.iife'
import '@formatjs/intl-displaynames/polyfill.iife'
import '@formatjs/intl-displaynames/locale-data/en';

import "./domrect-polyfill";
import "./utils/logger.js";
import "./features/adblock.js";
import "./features/sponsorblock.js";
import "./ui/ui.js";
import "./ui/speedUI.js";
import "./ui/theme.js";
import "./ui/settings.js";
import "./ui/disableWhosWatching.js";
import "./features/moreSubtitles.js";
import "./features/updater.js";
import "./features/pictureInPicture.js";
import "./features/preferredVideoQuality.js";
import "./features/videoQueuing.js";
import "./features/enableFeatures.js";
import "./ui/customUI.js";
import "./ui/customGuideAction.js";