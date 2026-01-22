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
    let isUserScrolling = false;
    let scrollTimeout = null;

    // Detect if user manually scrolls
    consoleDiv.addEventListener('wheel', () => {
        isUserScrolling = true;
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            isUserScrolling = false;
        }, 2000); // Reset after 2 seconds of no scrolling
    });

    function forceScrollToBottom() {
        if (!consoleDiv || isUserScrolling) return;
        
        // Use MutationObserver approach - scroll AFTER DOM updates
        const maxScroll = consoleDiv.scrollHeight - consoleDiv.clientHeight;
        consoleDiv.scrollTop = maxScroll;
        
        // Also scroll last element into view
        const lastDiv = consoleDiv.lastElementChild;
        if (lastDiv) {
            lastDiv.scrollIntoView({ behavior: 'instant', block: 'end', inline: 'nearest' });
        }
    }

    function addLog(message, type = 'log') {
        const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div style="color:${color};margin-bottom:5px;word-wrap:break-word;white-space:pre-wrap;">[${timestamp}] ${message}</div>`;
        logs.push(logEntry);
        if (logs.length > 150) logs.shift(); // Increased buffer
        if (consoleDiv) {
            consoleDiv.innerHTML = logs.join('');
            // Force scroll after content is added
            setTimeout(forceScrollToBottom, 0);
            setTimeout(forceScrollToBottom, 50);
            setTimeout(forceScrollToBottom, 100);
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

    document.addEventListener('keydown', (e) => {
        if (e.key === '`' || e.key === 'F12') {
            enabled = !enabled;
            consoleDiv.style.display = enabled ? 'block' : 'none';
        }
        if (e.key === 'c' && enabled) {
            logs = [];
            consoleDiv.innerHTML = '';
        }
    });

    window.toggleDebugConsole = function() {
        enabled = !enabled;
        if (consoleDiv) {
            consoleDiv.style.display = enabled ? 'block' : 'none';
            
            // CRITICAL: Force scroll after showing the console
            if (enabled) {
                // Use setTimeout to wait for CSS display change to complete
                setTimeout(() => {
                    const maxScroll = consoleDiv.scrollHeight - consoleDiv.clientHeight;
                    consoleDiv.scrollTop = maxScroll;
                    
                    // Also use scrollIntoView
                    const lastDiv = consoleDiv.lastElementChild;
                    if (lastDiv) {
                        lastDiv.scrollIntoView({ behavior: 'auto', block: 'end' });
                    }
                }, 50);
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
                    
                    // CRITICAL: Force scroll when console becomes visible
                    if (enabled) {
                        setTimeout(() => {
                            const maxScroll = consoleDiv.scrollHeight - consoleDiv.clientHeight;
                            consoleDiv.scrollTop = maxScroll;
                            
                            const lastDiv = consoleDiv.lastElementChild;
                            if (lastDiv) {
                                lastDiv.scrollIntoView({ behavior: 'auto', block: 'end' });
                            }
                        }, 50);
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

    // USB Detection for Samsung Tizen with Monitoring
    let lastUSBState = null;
    
    function detectUSB() {
        console.log('[USB] Checking storage...');
        
        // Method 1: Tizen Filesystem API
        try {
            if (typeof tizen !== 'undefined' && tizen.filesystem) {
                tizen.filesystem.listStorages(
                    function(storages) {
                        const usbStorages = storages.filter(s => s.type === 'REMOVABLE');
                        const currentState = JSON.stringify(usbStorages.map(s => ({l: s.label, s: s.state})));
                        
                        if (currentState !== lastUSBState) {
                            console.log(`[USB] ${storages.length} storage(s) detected`);
                            storages.forEach(function(storage, index) {
                                console.log(`[USB] ${index}: ${storage.label} | ${storage.type} | ${storage.state}`);
                            });
                            
                            if (usbStorages.length > 0) {
                                console.log(`[USB] ✓ ${usbStorages.length} USB drive(s) connected`);
                            } else {
                                console.log('[USB] No USB drives connected');
                            }
                            
                            lastUSBState = currentState;
                        }
                    },
                    function(error) {
                        console.log('[USB] Tizen error: ' + error.message);
                    }
                );
            } else {
                console.log('[USB] Tizen filesystem API not available');
            }
        } catch (e) {
            console.log('[USB] Tizen error: ' + e.message);
        }
        
        // Method 2: h5vcc (webOS check)
        try {
            if (window.h5vcc && window.h5vcc.storage) {
                const info = window.h5vcc.storage.getStorageInfo();
                console.log('[USB] h5vcc: ' + JSON.stringify(info));
            } else {
                console.log('[USB] h5vcc not available (expected on Tizen)');
            }
        } catch (e) {
            console.log('[USB] h5vcc check failed');
        }
        
        // Method 3: Navigator storage
        try {
            if (navigator.storage && navigator.storage.estimate) {
                navigator.storage.estimate().then(function(estimate) {
                    const quotaGB = (estimate.quota / (1024*1024*1024)).toFixed(2);
                    const usageMB = (estimate.usage / (1024*1024)).toFixed(2);
                    console.log(`[USB] Browser storage: ${quotaGB}GB quota, ${usageMB}MB used`);
                }).catch(function(err) {
                    console.log('[USB] Navigator error: ' + err.message);
                });
            } else {
                console.log('[USB] Navigator.storage not available');
            }
        } catch (e) {
            console.log('[USB] Navigator check failed');
        }
    }
    
    // Monitor USB changes every 5 seconds
    setInterval(detectUSB, 5000);

    console.log('[Console] Visual Console v8');
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