// Visual Console for TV
// This creates an on-screen console you can see on your TV

(function() {
    // Read position from config (default: bottom-right)
    const getConsolePosition = () => {
        try {
            const CONFIG_KEY = 'ytaf-configuration';
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            return config.debugConsolePosition || 'bottom-right';
        } catch (e) {
            return 'bottom-right';
        }
    };

    const getConsoleEnabled = () => {
        try {
            const CONFIG_KEY = 'ytaf-configuration';
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            return config.enableDebugConsole !== false; // Default to true
        } catch (e) {
            return true;
        }
    };

    const position = getConsolePosition();
    const enabled = getConsoleEnabled();

    // Position styles based on config
    const positions = {
        'top-left': 'top: 0; left: 0;',
        'top-right': 'top: 0; right: 0;',
        'bottom-left': 'bottom: 0; left: 0;',
        'bottom-right': 'bottom: 0; right: 0;',
        'center': 'top: 50%; left: 50%; transform: translate(-50%, -50%);'
    };

    const consoleDiv = document.createElement('div');
    consoleDiv.id = 'tv-debug-console';
    consoleDiv.style.cssText = `
        position: fixed;
        ${positions[position] || positions['bottom-right']}
        width: 900px;
        height: 500px;
        background: rgba(0, 0, 0, 0.95);
        color: #0f0;
        font-family: monospace;
        font-size: 13px;
        padding: 10px;
        overflow-y: auto;
        z-index: 999999;
        border: 3px solid #0f0;
        display: ${enabled ? 'block' : 'none'};
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
    `;

    // Wait for DOM
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

    let visible = enabled;
    let logs = [];

    function addLog(message, type = 'log') {
        const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div style="color:${color};margin-bottom:5px;word-wrap:break-word;white-space:pre-wrap;">[${timestamp}] ${message}</div>`;

        logs.push(logEntry);
        if (logs.length > 100) logs.shift(); // Keep last 100

        if (consoleDiv) {
            consoleDiv.innerHTML = logs.join('');
            // AUTO-SCROLL TO BOTTOM
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }
    }

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

    // Keyboard toggle (if keyboard available)
    document.addEventListener('keydown', (e) => {
        if (e.key === '`' || e.key === 'F12') {
            visible = !visible;
            consoleDiv.style.display = visible ? 'block' : 'none';
        }
        if (e.key === 'c' && visible) {
            logs = [];
            consoleDiv.innerHTML = '';
        }
    });

    // Global toggle function
    window.toggleDebugConsole = function() {
        visible = !visible;
        if (consoleDiv) {
            consoleDiv.style.display = visible ? 'block' : 'none';
        }
        
        // Save state to config
        try {
            const CONFIG_KEY = 'ytaf-configuration';
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            config.enableDebugConsole = visible;
            window.localStorage[CONFIG_KEY] = JSON.stringify(config);
        } catch (e) {
            // ignore
        }
    };

    // Update position function
    window.setDebugConsolePosition = function(pos) {
        const positionStyle = positions[pos] || positions['bottom-right'];
        if (consoleDiv) {
            // Remove all position styles
            consoleDiv.style.top = '';
            consoleDiv.style.right = '';
            consoleDiv.style.bottom = '';
            consoleDiv.style.left = '';
            consoleDiv.style.transform = '';
            
            // Apply new position
            const styles = positionStyle.split(';').filter(s => s.trim());
            styles.forEach(style => {
                const [prop, value] = style.split(':').map(s => s.trim());
                if (prop && value) {
                    consoleDiv.style[prop] = value;
                }
            });
        }
        
        // Save to config
        try {
            const CONFIG_KEY = 'ytaf-configuration';
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            config.debugConsolePosition = pos;
            window.localStorage[CONFIG_KEY] = JSON.stringify(config);
        } catch (e) {
            // ignore
        }
    };

    console.log('[Visual Console] Initialized');
    console.log('[Visual Console] Position: ' + position);
    console.log('[Visual Console] Enabled: ' + enabled);
})();

import "./utils/debugBridge.js";
import "./utils/debugServer.js";
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