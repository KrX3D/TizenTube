// Visual Console for TV
// This creates an on-screen console you can see on your TV

(function() {
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
    let manualScrollMode = false; // Track if user is manually controlling scroll

    const positions = {
        'top-left': { top: '0', left: '0', right: '', bottom: '', transform: '' },
        'top-right': { top: '0', right: '0', left: '', bottom: '', transform: '' },
        'bottom-left': { bottom: '0', left: '0', right: '', top: '', transform: '' },
        'bottom-right': { bottom: '0', right: '0', left: '', top: '', transform: '' },
        'center': { top: '50%', left: '50%', right: '', bottom: '', transform: 'translate(-50%, -50%)' }
    };

    const consoleDiv = document.createElement('div');
    consoleDiv.id = 'tv-debug-console';
    
    const posStyles = positions[currentPosition] || positions['bottom-right'];
    consoleDiv.style.cssText = `
        position: fixed;
        width: 900px;
        height: 500px;
        background: rgba(0, 0, 0, 0.95);
        color: #0f0;
        font-family: monospace;
        font-size: 13px;
        padding: 10px;
        overflow-y: auto;
        overflow-x: hidden;
        z-index: 999999;
        border: 3px solid #0f0;
        display: ${enabled ? 'block' : 'none'};
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
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

    let logs = [];

    // SIMPLIFIED scroll function - use requestAnimationFrame for reliable scrolling
    function scrollToBottom() {
        if (!consoleDiv || manualScrollMode) return;
        
        requestAnimationFrame(() => {
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        });
    }

    // Remote control support - use color buttons
    document.addEventListener('keydown', (e) => {
        // Toggle console visibility
        if (e.key === '`' || e.key === 'F12') {
            enabled = !enabled;
            consoleDiv.style.display = enabled ? 'block' : 'none';
            if (enabled) scrollToBottom();
        }
        
        // Clear logs
        if (e.key === 'c' && enabled) {
            logs = [];
            consoleDiv.innerHTML = '';
        }

        // Remote control navigation when console is visible
        if (enabled) {
            // Samsung/Tizen remote color buttons
            // Red (403), Green (404), Yellow (405), Blue (406)
            // Or use arrow keys as fallback
            
            if (e.keyCode === 404 || e.key === 'ArrowDown') { // Green or Down
                e.preventDefault();
                manualScrollMode = true;
                consoleDiv.scrollTop += 50;
            }
            else if (e.keyCode === 405 || e.key === 'ArrowUp') { // Yellow or Up
                e.preventDefault();
                manualScrollMode = true;
                consoleDiv.scrollTop -= 50;
            }
            else if (e.keyCode === 403) { // Red - scroll to bottom
                e.preventDefault();
                manualScrollMode = false;
                scrollToBottom();
            }
            else if (e.keyCode === 406) { // Blue - scroll to top
                e.preventDefault();
                manualScrollMode = true;
                consoleDiv.scrollTop = 0;
            }
        }
    });

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

    window.toggleDebugConsole = function() {
        enabled = !enabled;
        if (consoleDiv) {
            consoleDiv.style.display = enabled ? 'block' : 'none';
            if (enabled) {
                manualScrollMode = false;
                scrollToBottom();
            }
        }
    };

    window.setDebugConsolePosition = function(pos) {
        currentPosition = pos;
        const posStyles = positions[pos] || positions['bottom-right'];
        if (consoleDiv) Object.assign(consoleDiv.style, posStyles);
    };

    const checkConfigInterval = setInterval(() => {
        try {
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            const newEnabled = config.enableDebugConsole !== false;
            if (newEnabled !== enabled) {
                enabled = newEnabled;
                if (consoleDiv) {
                    consoleDiv.style.display = enabled ? 'block' : 'none';
                    if (enabled) {
                        manualScrollMode = false;
                        scrollToBottom();
                    }
                }
            }
            const newPosition = config.debugConsolePosition || 'bottom-right';
            if (newPosition !== currentPosition) {
                currentPosition = newPosition;
                const posStyles = positions[newPosition] || positions['bottom-right'];
                if (consoleDiv) Object.assign(consoleDiv.style, posStyles);
            }
        } catch (e) {}
    }, 500);

    function addLog(message, type = 'log') {
        const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div style="color:${color};margin-bottom:5px;word-wrap:break-word;white-space:pre-wrap;">[${timestamp}] ${message}</div>`;
        
        logs.push(logEntry);
        if (logs.length > 150) logs.shift();
        
        if (consoleDiv) {
            consoleDiv.innerHTML = logs.join('');
            scrollToBottom();
        }
    }

    // USB Detection for Samsung Tizen - ENHANCED VERSION
    let lastUSBState = null;
    let usbCheckCount = 0;
    
    function getUSBMonitoringEnabled() {
        try {
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            return config.enableUSBMonitoring === true;
        } catch (e) {
            return false;
        }
    }
    
    function detectUSB() {
        if (!getUSBMonitoringEnabled()) return;
        
        usbCheckCount++;
        console.log(`[USB] Check #${usbCheckCount} - Scanning drives...`);
        
        // Try Tizen filesystem API if available
        if (window.tizen && window.tizen.filesystem) {
            try {
                console.log('[USB] Tizen filesystem API available');
                
                // List all storages
                const storages = window.tizen.filesystem.listStorages();
                console.log(`[USB] Found ${storages.length} storage(s)`);
                
                storages.forEach((storage, idx) => {
                    console.log(`[USB] Storage ${idx}: ${storage.label} (${storage.type}) - ${storage.state}`);
                    
                    // Try to resolve the storage to get its path
                    try {
                        window.tizen.filesystem.resolve(
                            storage.label,
                            function(dir) {
                                console.log(`[USB] Resolved ${storage.label}:`);
                                console.log(`[USB]   Path: ${dir.fullPath}`);
                                
                                // List contents
                                dir.listFiles(
                                    function(files) {
                                        console.log(`[USB]   Contains ${files.length} items:`);
                                        files.slice(0, 10).forEach(file => {
                                            const type = file.isDirectory ? 'DIR' : 'FILE';
                                            const size = file.isFile ? ` (${(file.fileSize / 1024).toFixed(1)}KB)` : '';
                                            console.log(`[USB]     ${type}: ${file.name}${size}`);
                                        });
                                        if (files.length > 10) {
                                            console.log(`[USB]     ... and ${files.length - 10} more`);
                                        }
                                    },
                                    function(err) {
                                        console.log(`[USB]   Error listing files: ${err.message}`);
                                    }
                                );
                            },
                            function(err) {
                                console.log(`[USB] Error resolving ${storage.label}: ${err.message}`);
                            }
                        );
                    } catch (e) {
                        console.log(`[USB] Exception resolving ${storage.label}: ${e.message}`);
                    }
                });
            } catch (e) {
                console.log('[USB] Tizen filesystem error:', e.message);
            }
        } else {
            console.log('[USB] Tizen filesystem API not available');
        }
        
        // Try reading from known USB paths
        const commonUSBPaths = [
            'usb0', 'usb1', 'usb2',
            'sdcard', 'external',
            'removable'
        ];
        
        commonUSBPaths.forEach(path => {
            if (window.tizen && window.tizen.filesystem) {
                try {
                    window.tizen.filesystem.resolve(
                        path,
                        function(dir) {
                            console.log(`[USB] Found path: ${path} -> ${dir.fullPath}`);
                        },
                        function(err) {
                            // Silently fail - path doesn't exist
                        }
                    );
                } catch (e) {}
            }
        });
        
        // Check localStorage for USB-related keys
        try {
            const keys = Object.keys(window.localStorage);
            const usbKeys = keys.filter(k => 
                k.toLowerCase().includes('usb') || 
                k.toLowerCase().includes('storage') ||
                k.toLowerCase().includes('external')
            );
            if (usbKeys.length > 0) {
                console.log('[USB] localStorage keys:', usbKeys.join(', '));
            }
        } catch (e) {}
        
        // Try navigator.storage
        try {
            if (navigator.storage && navigator.storage.estimate) {
                navigator.storage.estimate().then(function(estimate) {
                    const quotaGB = (estimate.quota / (1024*1024*1024)).toFixed(2);
                    const usageMB = (estimate.usage / (1024*1024)).toFixed(2);
                    console.log(`[USB] Storage: ${usageMB}MB used of ${quotaGB}GB`);
                }).catch(function(err) {
                    console.log('[USB] Storage check failed:', err.message);
                });
            }
        } catch (e) {}
    }
    
    // Manual USB check function
    window.checkUSB = function() {
        console.log('[USB] ========================================');
        console.log('[USB] Manual check requested');
        console.log('[USB] ========================================');
        detectUSB();
    };
    
    // Check on startup
    setTimeout(detectUSB, 1000);
    setTimeout(detectUSB, 5000);  // Check again after 5 seconds
    setTimeout(detectUSB, 20000); // And after 20 seconds

    console.log('[Console] Visual Console v93 - FIXED SCROLLING');
    console.log('[Console] Remote Controls:');
    console.log('[Console]   RED button - Auto-scroll to bottom');
    console.log('[Console]   GREEN/Down - Scroll down');
    console.log('[Console]   YELLOW/Up - Scroll up');
    console.log('[Console]   BLUE button - Jump to top');
    console.log('[Console] Position:', currentPosition);
    console.log('[Console] Enabled:', enabled);
    detectUSB();
})();

import "./features/userAgentSpoofing.js";
import "whatwg-fetch";
import 'core-js/proposals/object-getownpropertydescriptors';
import '@formatjs/intl-getcanonicallocales/polyfill.iife'
import '@formatjs/intl-locale/polyfill.iife'
import '@formatjs/intl-displaynames/polyfill.iife'
import '@formatjs/intl-displaynames/locale-data/en';

import "./domrect-polyfill";
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