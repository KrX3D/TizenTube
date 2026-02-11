import { configWrite } from "./config.js";

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
        
        // Newest logs are at TOP, so "older" logs are further DOWN.
        const maxScroll = Math.max(0, consoleDiv.scrollHeight - consoleDiv.clientHeight);
        const newScroll = Math.min(maxScroll, consoleDiv.scrollTop + 100);
        
        consoleDiv.scrollTop = newScroll;
        consoleDiv.scroll(0, newScroll);
        consoleDiv.scrollTo(0, newScroll);
        
        void consoleDiv.offsetHeight;
        
        window.consoleAutoScroll = false;
        updateBorder();
    };

    window.scrollConsoleDown = function() {
        if (!consoleDiv || !enabled || !consoleVisible) return;
        
        // Move back toward newer logs at the top.
        const newScroll = Math.max(0, consoleDiv.scrollTop - 100);
        
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

    window.deleteConsoleLastLog = function() {
        if (!consoleDiv || !enabled || !consoleVisible) return;
        if (logs.length === 0) return;
        logs.pop();
        consoleDiv.innerHTML = logs.join('');
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
        
        // Update config FIRST
        try {
            configWrite('enableDebugConsole', enabled);
        } catch (e) {
            console.error('[Console] Failed to save config:', e);
            try {
                const config = JSON.parse(window.localStorage[CONFIG_KEY] || '{}');
                config.enableDebugConsole = enabled;
                window.localStorage[CONFIG_KEY] = JSON.stringify(config);
            } catch (fallbackError) {
                console.error('[Console] Failed to save config fallback:', fallbackError);
            }
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
        
        // ⭐ NEW: Log after state update
        setTimeout(() => {
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
            const previousScrollTop = consoleDiv.scrollTop;
            const previousScrollHeight = consoleDiv.scrollHeight;
            consoleDiv.innerHTML = logs.join('');
            if (window.consoleAutoScroll) {
                consoleDiv.scrollTop = 0;
            } else {
                const heightDelta = consoleDiv.scrollHeight - previousScrollHeight;
                consoleDiv.scrollTop = previousScrollTop + heightDelta;
            }
        }
    }
    
    console.log('[Console] ========================================');
    console.log('[Console] Visual Console v40 - NEWEST FIRST');
    console.log('[Console] ========================================');
    console.log('[Console] ⚡ NEWEST LOGS AT TOP (scroll down for older)');
    console.log('[Console] Remote Controls:');
    console.log('[Console]   RED button - Scroll UP (older logs)');
    console.log('[Console]   GREEN button - Scroll DOWN (newer logs)');
    console.log('[Console]   YELLOW button - Delete last log line');
    console.log('[Console]   BLUE button - Toggle console ON/OFF');
    console.log('[Console]   ');
    console.log('[Console] ========================================');
    
    updateBorder();
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
