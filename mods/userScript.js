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

    function forceScrollToBottom() {
        if (!consoleDiv) return;
        
        // Force scroll multiple ways for maximum compatibility
        const maxScroll = consoleDiv.scrollHeight - consoleDiv.clientHeight;
        
        // Method 1: Direct assignment
        consoleDiv.scrollTop = maxScroll;
        
        // Method 2: requestAnimationFrame (for rendering)
        requestAnimationFrame(() => {
            consoleDiv.scrollTop = maxScroll;
            
            // Method 3: Double RAF for safety
            requestAnimationFrame(() => {
                consoleDiv.scrollTop = maxScroll;
                
                // Method 4: One more after a tiny delay
                setTimeout(() => {
                    consoleDiv.scrollTop = maxScroll;
                }, 10);
            });
        });
        
        // Method 5: scrollIntoView on last element
        const lastDiv = consoleDiv.lastElementChild;
        if (lastDiv) {
            lastDiv.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
    }

    function addLog(message, type = 'log') {
        const color = type === 'error' ? '#f00' : type === 'warn' ? '#ff0' : '#0f0';
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div style="color:${color};margin-bottom:5px;word-wrap:break-word;white-space:pre-wrap;">[${timestamp}] ${message}</div>`;
        logs.push(logEntry);
        if (logs.length > 100) logs.shift();
        if (consoleDiv) {
            consoleDiv.innerHTML = logs.join('');
            forceScrollToBottom();
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

    // USB Detection for Samsung Tizen
    function detectUSB() {
        console.log('[USB] === USB Detection Started ===');
        
        // Method 1: Tizen Filesystem API
        try {
            if (typeof tizen !== 'undefined' && tizen.filesystem) {
                console.log('[USB] Tizen filesystem API available');
                tizen.filesystem.listStorages(
                    function(storages) {
                        console.log('[USB] Found ' + storages.length + ' storage(s)');
                        storages.forEach(function(storage, index) {
                            console.log('[USB] Storage ' + index + ':');
                            console.log('[USB]   label: ' + storage.label);
                            console.log('[USB]   type: ' + storage.type);
                            console.log('[USB]   state: ' + storage.state);
                        });
                    },
                    function(error) {
                        console.log('[USB] Tizen listStorages error: ' + error.message);
                    }
                );
            } else {
                console.log('[USB] Tizen filesystem API not available');
            }
        } catch (e) {
            console.log('[USB] Tizen filesystem error: ' + e.message);
        }
        
        // Method 2: webOS h5vcc (for comparison)
        try {
            if (window.h5vcc && window.h5vcc.storage) {
                console.log('[USB] h5vcc.storage available (webOS)');
                const info = window.h5vcc.storage.getStorageInfo();
                console.log('[USB] Storage info: ' + JSON.stringify(info));
            } else {
                console.log('[USB] h5vcc.storage not available (expected on Tizen)');
            }
        } catch (e) {
            console.log('[USB] h5vcc error: ' + e.message);
        }
        
        // Method 3: Navigator storage (experimental)
        try {
            if (navigator.storage && navigator.storage.estimate) {
                navigator.storage.estimate().then(function(estimate) {
                    console.log('[USB] Navigator storage estimate:');
                    console.log('[USB]   quota: ' + (estimate.quota / (1024*1024*1024)).toFixed(2) + ' GB');
                    console.log('[USB]   usage: ' + (estimate.usage / (1024*1024)).toFixed(2) + ' MB');
                }).catch(function(err) {
                    console.log('[USB] Navigator storage error: ' + err.message);
                });
            } else {
                console.log('[USB] Navigator.storage.estimate not available');
            }
        } catch (e) {
            console.log('[USB] Navigator storage error: ' + e.message);
        }
        
        console.log('[USB] === USB Detection Complete ===');
    }

    console.log('[Console] Visual Console v7');
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