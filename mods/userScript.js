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
    let consoleVisible = enabled;

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

    // Scroll functions
    window.scrollConsoleUp = function() {
        if (!consoleDiv || !enabled || !consoleVisible) return;
        
        const before = consoleDiv.scrollTop;
        const newScroll = Math.max(0, consoleDiv.scrollTop - 100);
        
        consoleDiv.scrollTop = newScroll;
        consoleDiv.scroll(0, newScroll);
        consoleDiv.scrollTo(0, newScroll);
        
        void consoleDiv.offsetHeight;
        
        window.consoleAutoScroll = false;
        updateBorder();
    };

    window.scrollConsoleDown = function() {
        if (!consoleDiv || !enabled || !consoleVisible) return;
        
        const before = consoleDiv.scrollTop;
        const maxScroll = consoleDiv.scrollHeight - consoleDiv.clientHeight;
        const newScroll = Math.min(maxScroll, consoleDiv.scrollTop + 100);
        
        consoleDiv.scrollTop = newScroll;
        consoleDiv.scroll(0, newScroll);
        consoleDiv.scrollTo(0, newScroll);
        
        void consoleDiv.offsetHeight;
        
        window.consoleAutoScroll = false;
        updateBorder();
    };

    window.enableConsoleAutoScroll = function() {
        if (!consoleDiv || !enabled || !consoleVisible) return;
        
        window.consoleAutoScroll = true;
        updateBorder();
        consoleDiv.scrollTop = 0;
        consoleDiv.scroll(0, 0);
        consoleDiv.scrollTo(0, 0);
    };

    function updateBorder() {
        if (consoleDiv) {
            consoleDiv.style.borderColor = window.consoleAutoScroll ? '#0f0' : '#f80';
        }
    }

    console.log = function(...args) {
        originalLog.apply(console, args);
        // Only add to logs if console is enabled
        if (enabled) {
            addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'log');
        }
    };

    console.error = function(...args) {
        originalError.apply(console, args);
        // Only add to logs if console is enabled
        if (enabled) {
            addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'error');
        }
    };

    console.warn = function(...args) {
        originalWarn.apply(console, args);
        // Only add to logs if console is enabled
        if (enabled) {
            addLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), 'warn');
        }
    };

    let lastToggleTime = 0;
    
    window.toggleDebugConsole = function() {
        const now = Date.now();
        if (now - lastToggleTime < 500) {
            return; // Debounce
        }
        lastToggleTime = now;
        
        // Toggle state
        enabled = !enabled;
        consoleVisible = enabled;
        
        // Update localStorage FIRST
        try {
            const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
            config.enableDebugConsole = enabled;
            window.localStorage[CONFIG_KEY] = JSON.stringify(config);
        } catch (e) {
            console.error('[Console] Failed to save config:', e);
        }
        
        // Update UI
        if (consoleDiv) {
            consoleDiv.style.display = consoleVisible ? 'block' : 'none';
            if (consoleVisible) {
                window.consoleAutoScroll = true;
                updateBorder();
                consoleDiv.scrollTop = 0;
                if (logs.length > 0) {
                    consoleDiv.innerHTML = logs.join('');
                }
            }
        }
        
        // ⭐ NEW: Dispatch event AFTER localStorage is updated
        setTimeout(() => {
            if (window.configChangeEmitter) {
                window.configChangeEmitter.dispatchEvent(
                    new CustomEvent('configChange', { 
                        detail: { 
                            key: 'enableDebugConsole', 
                            value: enabled 
                        } 
                    })
                );
            }
            
            // ⭐ NEW: Log to help user understand what happened
            console.log('[Console] Console ' + (enabled ? 'ENABLED ✓' : 'DISABLED ✗') + ' via BLUE button');
            console.log('[Console] Settings UI will update next time you open it');
        }, 100);
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
                consoleVisible = newEnabled;
                if (consoleDiv) {
                    consoleDiv.style.display = consoleVisible ? 'block' : 'none';
                    if (consoleVisible) {
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
        // Don't process logs if console is disabled
        if (!enabled) return;
        
        const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div style="color:${color};margin-bottom:5px;word-wrap:break-word;white-space:pre-wrap;">[${timestamp}] ${message}</div>`;
        
        logs.unshift(logEntry);
        if (logs.length > 150) logs.pop();
        
        // Only update DOM if console is visible
        if (consoleDiv && consoleVisible) {
            consoleDiv.innerHTML = logs.join('');
            if (window.consoleAutoScroll) {
                consoleDiv.scrollTop = 0;
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
    
    // Method 1: Try Tizen Web API for filesystem access
    function checkUSBWithTizenAPI() {
        // ⭐ Changed: Don't check at top, try the code and handle errors
        try {
            console.log('[USB] Method 1: Trying Tizen filesystem API...');
            
            // Check if available
            if (typeof tizen === 'undefined' || !tizen.filesystem) {
                console.log('[USB] Method 1: ✗ Tizen filesystem API not available');
                return false;
            }
            
            const storages = tizen.filesystem.listStorages();
            console.log('[USB] Method 1: Found', storages.length, 'storage devices');
            
            let foundUSB = false;
            storages.forEach((storage, index) => {
                console.log('[USB] Storage ' + index + ':');
                console.log('[USB]   - Type:', storage.type);
                console.log('[USB]   - Label:', storage.label);
                console.log('[USB]   - State:', storage.state);
                
                if (storage.type === 'USB_HOST' && storage.state === 'MOUNTED') {
                    console.log('[USB]   ✓ USB Drive detected!');
                    foundUSB = true;
                    
                    try {
                        tizen.filesystem.resolve(
                            storage.label,
                            function(dir) {
                                dir.listFiles(
                                    function(files) {
                                        console.log('[USB]   - Files found:', files.length);
                                        files.slice(0, 10).forEach(function(file) {
                                            console.log('[USB]     * ' + file.name + ' (' + file.fileSize + ' bytes)');
                                        });
                                    },
                                    function(error) {
                                        console.log('[USB]   - List files error:', error.message);
                                    }
                                );
                            },
                            function(error) {
                                console.log('[USB]   - Resolve error:', error.message);
                            }
                        );
                    } catch (e) {
                        console.log('[USB]   - Access error:', e.message);
                    }
                }
            });
            
            if (foundUSB) {
                console.log('[USB] Method 1: ✓ SUCCESS - USB drive(s) detected');
            } else {
                console.log('[USB] Method 1: ✗ No USB drives found (but API works)');
            }
            return foundUSB;
            
        } catch (error) {
            console.log('[USB] Method 1: ✗ Error:', error.message);
            return false;
        }
    }

    // Method 2: Try Cobalt's h5vcc storage API
    function checkUSBWithCobalt() {
        try {
            console.log('[USB] Method 2: Trying Cobalt storage API...');
            
            if (typeof window.h5vcc === 'undefined' || !window.h5vcc.storage) {
                console.log('[USB] Method 2: ✗ Cobalt storage API not available');
                return false;
            }
            
            const storageInfo = window.h5vcc.storage.getStorageInfo();
            console.log('[USB] Method 2: ✓ Got storage info:', JSON.stringify(storageInfo, null, 2));
            return true;
            
        } catch (error) {
            console.log('[USB] Method 2: ✗ Error:', error.message);
            return false;
        }
    }

    // Method 3: Try reading TizenBrew config via file:// URL
    function tryReadTizenBrewConfig() {
        console.log('[USB] Method 3: Trying to read TizenBrew config...');
        
        const xhr = new XMLHttpRequest();
        xhr.onload = function() {
            console.log('[USB] Method 3: ✓ Config read success!');
            try {
                const config = JSON.parse(this.responseText);
                console.log('[USB] Method 3: Config:', JSON.stringify(config, null, 2));
            } catch (e) {
                console.log('[USB] Method 3: Config parse error:', e.message);
            }
        };
        xhr.onerror = function() {
            console.log('[USB] Method 3: ✗ Config read failed');
            console.log('[USB] Method 3: (Expected on web browsers - file:// URLs blocked)');
        };
        
        try {
            xhr.open('GET', 'file:///home/owner/share/tizenbrewConfig.json', true);
            xhr.send();
        } catch (e) {
            console.log('[USB] Method 3: ✗ Cannot access file:// URLs:', e.message);
            console.log('[USB] Method 3: (Expected on web browsers)');
        }
    }

    function detectUSB() {
    if (!getUSBMonitoringEnabled() || !enabled) {
        return;
    }
    
    usbCheckCount++;
    console.log('[USB] === Check #' + usbCheckCount + ' ===');
    
    // Check available APIs first
    const apis = {
        tizen: typeof tizen !== 'undefined',
        'tizen.filesystem': typeof tizen !== 'undefined' && tizen.filesystem,
        h5vcc: typeof window.h5vcc !== 'undefined',
        'h5vcc.storage': typeof window.h5vcc !== 'undefined' && window.h5vcc.storage,
        'h5vcc.tizentube': typeof window.h5vcc !== 'undefined' && window.h5vcc.tizentube,
        cobalt: typeof window.h5vcc?.tizentube !== 'undefined'
    };
    
    console.log('[USB] APIs available:', JSON.stringify(apis, null, 2));
    
    // ⭐ NEW: Better messaging, but DON'T return!
    if (!apis.tizen && !apis.h5vcc) {
        console.log('[USB] ========================================');
        console.log('[USB] ⚠️  PRIMARY PLATFORM DETECTION');
        console.log('[USB] ========================================');
        console.log('[USB] Status: No Tizen/Cobalt APIs detected');
        console.log('[USB] ');
        console.log('[USB] This likely means:');
        console.log('[USB]   • Running in web browser (not Tizen TV)');
        console.log('[USB]   • Testing on PC/Mac/Linux');
        console.log('[USB] ');
        console.log('[USB] ℹ️  Will still attempt 3 detection methods:');
        console.log('[USB]   1. Tizen filesystem API');
        console.log('[USB]   2. Cobalt storage API');  
        console.log('[USB]   3. File system access (file://)');
        console.log('[USB] ========================================');
        // ⭐ NO return here! Keep going!
    } else {
        console.log('[USB] ========================================');
        console.log('[USB] ✓ Platform APIs detected');
        console.log('[USB] ========================================');
    }
    
    console.log('[USB] ---');
    console.log('[USB] Attempting 3 different detection methods:');
    console.log('[USB] ---');
    
    // ⭐ Try all three methods (this now always runs!)
    let method1Result = checkUSBWithTizenAPI();
    console.log('[USB] ---');
    
    let method2Result = checkUSBWithCobalt();
    console.log('[USB] ---');
    
    tryReadTizenBrewConfig();
    console.log('[USB] ---');
    
    // Check localStorage for TizenBrew data
    if (window.localStorage) {
        try {
            console.log('[USB] Checking localStorage for TizenBrew data...');
            const keys = Object.keys(window.localStorage);
            console.log('[USB] localStorage: ' + keys.length + ' keys total');
            
            const tizenKeys = keys.filter(k => k.toLowerCase().includes('tizen') || k.toLowerCase().includes('brew'));
            if (tizenKeys.length > 0) {
                console.log('[USB] TizenBrew keys found:', tizenKeys.length);
                tizenKeys.forEach(key => {
                    const value = window.localStorage[key];
                    if (value.length < 200) {
                        console.log('[USB]   ' + key + ':', value.substring(0, 100));
                    } else {
                        console.log('[USB]   ' + key + ': (' + value.length + ' chars)');
                    }
                });
            } else {
                console.log('[USB] No TizenBrew-related keys found');
            }
        } catch (e) {
            console.log('[USB] localStorage error:', e.message);
        }
    }
    
    console.log('[USB] =========================');
    console.log('[USB] Results summary:');
    console.log('[USB]   Method 1 (Tizen API): ' + (method1Result ? 'SUCCESS ✓' : 'FAILED ✗'));
    console.log('[USB]   Method 2 (Cobalt API): ' + (method2Result ? 'SUCCESS ✓' : 'FAILED ✗'));
    console.log('[USB]   Method 3 (file://): Check logs above');
    console.log('[USB] =========================');
}
    
    let usbCheckCount = 0;
    window.checkUSB = function() {
        console.log('[USB] 🔍 MANUAL CHECK REQUESTED');
        detectUSB();
    };
    
    console.log('[Console] ========================================');
    console.log('[Console] Visual Console v210 - NEWEST FIRST');
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