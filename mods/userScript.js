// Visual Console for TV - FIXED VERSION v10
// This creates an on-screen console you can see on your TV
// With WORKING auto-scroll and keyboard controls

// Visual Console for TV - NEWEST FIRST
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

    const positions = {
        'top-left': { top: '0', left: '0', right: '', bottom: '', transform: '' },
        'top-right': { top: '0', right: '0', left: '', bottom: '', transform: '' },
        'bottom-left': { bottom: '0', left: '0', right: '', top: '', transform: '' },
        'bottom-right': { bottom: '0', right: '0', left: '', top: '', transform: '' },
        'center': { top: '50%', left: '50%', right: '', bottom: '', transform: 'translate(-50%, -50%)' }
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

    let logs = [];
    window.consoleAutoScroll = true;

    // Scroll functions with EXTENSIVE debugging
    window.scrollConsoleUp = function() {
        console.log('[Scroll] === UP function called ===');
        if (!consoleDiv) {
            console.log('[Scroll] ERROR: No console div!');
            return;
        }
        
        console.log('[Scroll] Before - scrollTop:', consoleDiv.scrollTop, 'scrollHeight:', consoleDiv.scrollHeight, 'clientHeight:', consoleDiv.clientHeight);
        
        const before = consoleDiv.scrollTop;
        const newScroll = Math.max(0, consoleDiv.scrollTop - 100);
        
        // Try multiple methods to force scroll
        consoleDiv.scrollTop = newScroll;
        consoleDiv.scroll(0, newScroll);
        consoleDiv.scrollTo(0, newScroll);
        
        // Force a reflow
        void consoleDiv.offsetHeight;
        
        const after = consoleDiv.scrollTop;
        console.log('[Scroll] After - scrollTop:', after, '| Changed by:', (before - after));
        
        if (before === after && before > 0) {
            console.log('[Scroll] FAILED to scroll! Trying direct DOM manipulation...');
            // Last resort: try to force it
            try {
                Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop').set.call(consoleDiv, newScroll);
                console.log('[Scroll] Direct manipulation result:', consoleDiv.scrollTop);
            } catch (e) {
                console.log('[Scroll] Direct manipulation failed:', e.message);
            }
        }
        
        window.consoleAutoScroll = false;
        updateBorder();
    };

    window.scrollConsoleDown = function() {
        console.log('[Scroll] === DOWN function called ===');
        if (!consoleDiv) {
            console.log('[Scroll] ERROR: No console div!');
            return;
        }
        
        console.log('[Scroll] Before - scrollTop:', consoleDiv.scrollTop, 'scrollHeight:', consoleDiv.scrollHeight, 'clientHeight:', consoleDiv.clientHeight);
        
        const before = consoleDiv.scrollTop;
        const maxScroll = consoleDiv.scrollHeight - consoleDiv.clientHeight;
        const newScroll = Math.min(maxScroll, consoleDiv.scrollTop + 100);
        
        console.log('[Scroll] Attempting to scroll to:', newScroll, '(max:', maxScroll + ')');
        
        // Try multiple methods to force scroll
        consoleDiv.scrollTop = newScroll;
        consoleDiv.scroll(0, newScroll);
        consoleDiv.scrollTo(0, newScroll);
        
        // Force a reflow
        void consoleDiv.offsetHeight;
        
        const after = consoleDiv.scrollTop;
        console.log('[Scroll] After - scrollTop:', after, '| Changed by:', (after - before));
        
        if (before === after && before < maxScroll) {
            console.log('[Scroll] FAILED to scroll! Trying direct DOM manipulation...');
            try {
                Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop').set.call(consoleDiv, newScroll);
                console.log('[Scroll] Direct manipulation result:', consoleDiv.scrollTop);
            } catch (e) {
                console.log('[Scroll] Direct manipulation failed:', e.message);
            }
        }
        
        window.consoleAutoScroll = false;
        updateBorder();
    };

    window.enableConsoleAutoScroll = function() {
        console.log('[Scroll] === AUTO-SCROLL TO TOP ===');
        window.consoleAutoScroll = true;
        updateBorder();
        if (consoleDiv) {
            consoleDiv.scrollTop = 0;
            consoleDiv.scroll(0, 0);
            consoleDiv.scrollTo(0, 0);
            console.log('[Scroll] Jumped to top, scrollTop now:', consoleDiv.scrollTop);
        }
    };

    function updateBorder() {
        if (consoleDiv) {
            consoleDiv.style.borderColor = window.consoleAutoScroll ? '#0f0' : '#f80';
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

    window.toggleDebugConsole = function() {
        enabled = !enabled;
        if (consoleDiv) {
            consoleDiv.style.display = enabled ? 'block' : 'none';
            if (enabled) {
                window.consoleAutoScroll = true;
                updateBorder();
                consoleDiv.scrollTop = 0;
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
                        window.consoleAutoScroll = true;
                        updateBorder();
                        consoleDiv.scrollTop = 0;
                    }
                }
            }
            const newPosition = config.debugConsolePosition || 'bottom-right';
            if (newPosition !== currentPosition) {
                currentPosition = newPosition;
                const posStyles = positions[newPosition] || positions['bottom-right'];
                if (consoleDiv) Object.assign(consoleDiv.style, posStyles);
            }
            const newHeight = config.debugConsoleHeight || '500';
            if (newHeight !== currentHeight) {
                currentHeight = newHeight;
                if (consoleDiv) consoleDiv.style.height = newHeight + 'px';
            }
        } catch (e) {}
    }, 500);

    function addLog(message, type = 'log') {
        const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div style="color:${color};margin-bottom:5px;word-wrap:break-word;white-space:pre-wrap;">[${timestamp}] ${message}</div>`;
        
        logs.unshift(logEntry); // Add to BEGINNING (newest first)
        if (logs.length > 150) logs.pop();
        
        if (consoleDiv && enabled) {
            consoleDiv.innerHTML = logs.join('');
            if (window.consoleAutoScroll) {
                consoleDiv.scrollTop = 0; // Keep at top for newest
            }
        }
    }

    // USB Detection code stays the same...
    
    function getUSBMonitoringEnabled() {
        try {
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            return config.enableUSBMonitoring === true;
        } catch (e) {
            return false;
        }
    }
    
    function detectUSB() {
        if (!getUSBMonitoringEnabled()) {
            console.log('[USB] Monitoring disabled in settings');
            return;
        }
        
        usbCheckCount++;
        console.log('[USB] ======== Check #' + usbCheckCount + ' ========');
        
        // Check 1: Tizen native API (WebOS TV)
        if (typeof tizen !== 'undefined' && tizen.filesystem) {
            console.log('[USB] Using Tizen native filesystem API');
            try {
                const storages = tizen.filesystem.listStorages();
                console.log('[USB] Found', storages.length, 'storage(s)');
                
                storages.forEach((storage, idx) => {
                    console.log('[USB] Storage', (idx + 1) + ':', storage.label, '|', storage.type, '|', storage.state);
                    
                    if (storage.type === 'EXTERNAL' && storage.state === 'MOUNTED') {
                        tizen.filesystem.resolve(
                            storage.label,
                            function(dir) {
                                console.log('[USB] ✓ Mounted at:', dir.fullPath);
                                dir.listFiles(
                                    function(files) {
                                        console.log('[USB] ✓ Contains', files.length, 'items');
                                        files.slice(0, 5).forEach(f => {
                                            console.log('[USB]  ', f.isDirectory ? '📁' : '📄', f.name);
                                        });
                                        if (files.length > 5) console.log('[USB]   ... +' + (files.length - 5) + ' more');
                                    },
                                    function(err) { console.log('[USB] ✗ List failed:', err.message); }
                                );
                            },
                            function(err) { console.log('[USB] ✗ Resolve failed:', err.message); }
                        );
                    }
                });
                return;
            } catch (e) {
                console.log('[USB] Tizen API error:', e.message);
            }
        }
        
        // Check 2: Cobalt h5vcc API (TizenBrew)
        if (window.h5vcc && window.h5vcc.storage) {
            console.log('[USB] Using Cobalt h5vcc storage API');
            try {
                const storageInfo = window.h5vcc.storage.getStorageInfo();
                console.log('[USB] Storage info:', JSON.stringify(storageInfo));
                return;
            } catch (e) {
                console.log('[USB] h5vcc error:', e.message);
            }
        }
        
        // Check 3: Try to read TizenBrew config (we're in the browser context)
        if (window.localStorage) {
            console.log('[USB] Attempting localStorage check for TizenBrew data');
            try {
                const keys = Object.keys(window.localStorage);
                console.log('[USB] Found', keys.length, 'localStorage keys');
                
                const tizenKeys = keys.filter(k => k.toLowerCase().includes('tizen') || k.toLowerCase().includes('brew'));
                if (tizenKeys.length > 0) {
                    console.log('[USB] TizenBrew-related keys:', tizenKeys.join(', '));
                }
            } catch (e) {
                console.log('[USB] localStorage error:', e.message);
            }
        }
        
        // Check 4: File System Access API (modern browsers, won't work on TV but worth checking)
        if ('showDirectoryPicker' in window) {
            console.log('[USB] File System Access API available (not supported on TV)');
        }
        
        console.log('[USB] ✗ No supported USB detection method available');
        console.log('[USB] Available APIs:', {
            tizen: typeof tizen !== 'undefined',
            h5vcc: typeof window.h5vcc !== 'undefined',
            cobalt: typeof window.h5vcc?.tizentube !== 'undefined'
        });
        console.log('[USB] ========================================');
    }
    
    let usbCheckCount = 0;
    window.checkUSB = function() {
        console.log('[USB] 🔍 MANUAL CHECK REQUESTED');
        detectUSB();
    };
    
    console.log('[Console] ========================================');
    console.log('[Console] Visual Console v140 - NEWEST FIRST');
    console.log('[Console] ========================================');
    console.log('[Console] ⚡ NEWEST LOGS AT TOP (scroll down for older)');
    console.log('[Console] Remote Controls:');
    console.log('[Console]   RED button - Scroll UP (older logs)');
    console.log('[Console]   GREEN button - Scroll DOWN (newer logs)');
    console.log('[Console]   YELLOW button - Jump to TOP (newest)');
    console.log('[Console]   BLUE button - Toggle console ON/OFF');
    console.log('[Console]   ');
    console.log('[Console]   Border colors:');
    console.log('[Console]     GREEN = Showing newest logs');
    console.log('[Console]     ORANGE = Manual scroll mode');
    console.log('[Console] Position:', currentPosition);
    console.log('[Console] Enabled:', enabled);
    console.log('[Console] ========================================');
    
    updateBorder();
    if (enabled) detectUSB();
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