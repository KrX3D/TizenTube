"use strict";

// TizenTube Standalone service

// ── Logging infrastructure comes first, before anything that might throw ───
// On Tizen 5.5 nothing ever reached the PC receiver at all — which is
// consistent with one of the require()s below throwing synchronously before
// any logging existed to catch it. http is a Node core module (always safe),
// so everything logging-related is set up before requiring anything else,
// and each require below is wrapped individually so we can see exactly which
// one fails, if any.
const http = require('http');

const DEFAULT_LOG_HOST = '192.168.50.57';
const DEFAULT_LOG_PORT = 3030;

// Relays one entry to the PC receiver TizenBrew's own remoteLogger.js targets
// (same /tv-log path and JSON shape), so the existing PS1 receiver script
// needs no changes.
function relayLog(entry, host, port) {
    try {
        const body = JSON.stringify({
            _formatted: entry._formatted || `[${entry.ts}] [${entry.level || 'INFO'}] [${entry.context || 'TizenTube'}] ${entry.message || ''}`,
            app: 'TizenTube Standalone',
            ts: entry.ts,
            level: entry.level,
            context: entry.context,
            message: entry.message,
        });
        const req = http.request({
            hostname: host || DEFAULT_LOG_HOST,
            port: Number(port) || DEFAULT_LOG_PORT,
            path: '/tv-log',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, () => { });
        req.on('error', () => { });
        req.write(body);
        req.end();
    } catch (e) { }
}

function logServiceEvent(level, message) {
    relayLog({ ts: new Date().toISOString(), level, context: 'StandaloneService', message });
}

process.on('uncaughtException', (err) => {
    logServiceEvent('ERROR', `Uncaught exception: ${err && err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
    logServiceEvent('ERROR', `Unhandled rejection: ${reason && reason.stack || reason}`);
});
logServiceEvent('INFO', `Standalone service process starting (node ${process.version})`);

// ── Now the requires that previously ran before any of the above existed ──
function safeRequire(name, path) {
    try {
        const mod = require(path);
        logServiceEvent('INFO', `require('${name}') OK`);
        return mod;
    } catch (err) {
        logServiceEvent('ERROR', `require('${name}') FAILED: ${err && err.stack || err}`);
        throw err;
    }
}

const express = safeRequire('express', 'express');
const app = express();
const PORT = 8099;
const fetch = safeRequire('node-fetch', 'node-fetch');
const URL = safeRequire('url', 'url');
const injector = safeRequire('./injector.js', './injector.js');

const TIZENTUBE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@krx3d/tizentube2/dist/userScript.js';
const TIZENTUBE_CDN_FALLBACK_URL = 'https://unpkg.com/@krx3d/tizentube2/dist/userScript.js';

// This proxy exists to bypass CORS for YouTube/Google resources only — never
// forward it to an arbitrary host, or it becomes an open proxy for anything
// running on the device.
const ALLOWED_PROXY_HOSTS = ['googlevideo.com', 'youtube.com', 'gstatic.com', 'google.com', 'googleapis.com', 'googleusercontent.com', 'ggpht.com'];
function isAllowedProxyHost(hostname) {
    if (!hostname) return false;
    return ALLOWED_PROXY_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

app.get('/tizentube/getState', (req, res) => {
    injector.canConnectToDaemon().then(r => {
        logServiceEvent('INFO', `getState → ${JSON.stringify(r)}`);
        res.json(r);
    }).catch((err) => {
        logServiceEvent('ERROR', `getState failed: ${err && err.stack || err}`);
        res.status(500).json({ error: String(err) });
    });
});

app.get('/tizentube/debugger', (req, res) => {
    const args = req.originalUrl.split('?')[1] || '';
    const interval = setInterval(() => {
        tizen.application.getAppsContext((appsContext) => {
            const packageId = tizen.application.getAppInfo().packageId;
            const app = appsContext.find(app => app.appId === `${packageId}.TizenTubeStandalone`);
            if (!app) {
                injector.startDebugger(args);
                clearInterval(interval)
            }
        });
    }, 50);
});

// host/port come from the request body when the page has them configured;
// falls back to DEFAULT_LOG_HOST/PORT otherwise (see relayLog above).
app.post('/tizentube/log', express.json(), (req, res) => {
    const { host, port, entry } = req.body || {};
    if (!entry) return res.status(400).end();
    relayLog(entry, host, port);
    res.status(204).end();
});

app.all('*', (req, res) => {
    if (req.path === '/tv') {
        logServiceEvent('INFO', `Received ${req.method} ${req.path} — page is reaching the proxy`);
    }

    const isCorsBypass = req.path.indexOf('/cors-bypass/') === 0;

    let targetUrl;
    if (isCorsBypass) {
        const rawTarget = req.url.substring('/cors-bypass/'.length);
        targetUrl = rawTarget.indexOf('http') === 0 ? rawTarget : `https://${rawTarget}`;
    } else {
        targetUrl = `https://www.youtube.com${req.url}`;
    }

    let targetHostname;
    try {
        targetHostname = URL.parse(targetUrl).hostname;
    } catch (e) {
        targetHostname = null;
    }
    if (!isAllowedProxyHost(targetHostname)) {
        return res.status(403).send('Blocked: target host not allowed');
    }

    const headers = {};
    for (const key in req.headers) {
        if (Object.prototype.hasOwnProperty.call(req.headers, key)) {
            if (key === 'cookie') {
                headers[key] = req.headers[key]
                    .replace(/__LocalSecure-/g, '__Secure-')
                    .replace(/__LocalHost-/g, '__Host-');
                continue;
            }
            headers[key] = req.headers[key];
        }
    }

    try {
        const parsedUrl = URL.parse(targetUrl);
        headers['host'] = parsedUrl.host;
    } catch (e) {
        headers['host'] = isCorsBypass ? 'www.youtube.com' : 'www.youtube.com';
    }

    headers['origin'] = 'https://www.youtube.com';
    if (headers['referer']) {
        headers['referer'] = 'https://www.youtube.com/tv';
    }

    headers['accept-encoding'] = 'gzip, deflate';

    const hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;
    const fetchOptions = {
        method: req.method,
        headers: headers,
        body: hasBody ? req : undefined,
        redirect: 'manual'
    };

    fetch(targetUrl, fetchOptions)
        .then((response) => {
            if (req.method === 'OPTIONS') {
                res.status(200);
            } else {
                res.status(response.status);
            }

            const headerKeys = response.headers.raw();
            for (const key in headerKeys) {
                if (Object.prototype.hasOwnProperty.call(headerKeys, key)) {
                    const lowerKey = key.toLowerCase();
                    const skipHeaders = ['content-encoding', 'content-length', 'transfer-encoding', 'content-security-policy', 'alt-svc'];
                    if (isCorsBypass) skipHeaders.push('access-control-allow-origin');

                    if (skipHeaders.indexOf(lowerKey) !== -1) continue;

                    const value = response.headers.get(key);
                    if (lowerKey === 'set-cookie') {
                        const rawCookies = headerKeys[key];
                        if (Array.isArray(rawCookies)) {
                            const modifiedCookies = rawCookies.map(cookieStr => {
                                return cookieStr
                                    .replace(/^__Secure-/i, '__LocalSecure-')
                                    .replace(/^__Host-/i, '__LocalHost-')
                                    .replace(/Domain=[^;]+/i, 'Domain=localhost')
                                    .replace(/;\s*Secure/i, '')
                                    .replace(/;\s*SameSite=None/i, '')
                                    .replace(/;\s*;/g, ';')
                                    .replace(/;\s*$/, '');
                            });
                            res.setHeader('Set-Cookie', modifiedCookies);
                            continue;
                        }
                    }

                    res.setHeader(key, value);
                }
            }

            res.setHeader('Access-Control-Allow-Origin', '*');

            const contentType = response.headers.get('content-type') || '';

            if (contentType.indexOf('text/html') !== -1 ||
                contentType.indexOf('application/json') !== -1 ||
                contentType.indexOf('javascript') !== -1 ||
                contentType.indexOf('text/css') !== -1) {

                return response.text().then((text) => {
                    if (contentType.indexOf('text/html') !== -1 && req.path === '/tv') {
                        // Must run before YouTube parses its initial player data — the ad
                        // blocker patches JSON.parse to strip ad placements from it. Appending
                        // the script at the end of the document (the previous approach) ran it
                        // too late; inserting right after <body> opens ensures it executes
                        // before YouTube's own scripts do. Falls back to a second CDN if the
                        // primary one is unreachable.
                        const userScript = `<script src="${TIZENTUBE_CDN_URL}?ver=${Date.now()}" onerror="this.onerror=null;this.src='${TIZENTUBE_CDN_FALLBACK_URL}'"></script>`;
                        if (/<body[^>]*>/i.test(text)) {
                            text = text.replace(/<body[^>]*>/i, (bodyTag) => `${bodyTag}${userScript}`);
                        } else {
                            text = userScript + text;
                        }
                    }

                    const proxyPrefix = `http://localhost:${PORT}/cors-bypass/`;

                    // Rewrite rules for replacing URLs so CORS and presumably YT is happy.
                    text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `${proxyPrefix}https://$1.googlevideo.com`);
                    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `http:\\\/\\\/localhost:${PORT}\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com`);
                    text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, `"${proxyPrefix}https://$1.googlevideo.com`);

                    text = text.replace(/https:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/http:\/\/www\.gstatic\.com/g, `${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/"\/\/www\.gstatic\.com/g, `"${proxyPrefix}https://www.gstatic.com`);
                    text = text.replace(/\(\/\/www\.gstatic\.com/g, `(${proxyPrefix}https://www.gstatic.com`);

                    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, `${proxyPrefix}https://yt3.ggpht.com`);

                    text = text.replace(/https:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/http:\/\/clients1\.google\.com/g, `${proxyPrefix}https://clients1.google.com`);
                    text = text.replace(/"\/\/clients1\.google\.com/g, `"${proxyPrefix}https://clients1.google.com`);

                    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');
                    text = text.replace(/:document\.location\.toString\(\)/g, ':document.location.toString().replace("http://localhost:8099", "https://www.youtube.com")');
                    text = text.replace(/euri:[^,]+,/g, 'euri:document.location.toString().replace("http://localhost:8099", "https://www.youtube.com"),')
                    text = text.replace(/https:\/\/s\.youtube\.com/g, `${proxyPrefix}https://s.youtube.com`);
                    text = text.replace(/redirector\.googlevideo\.com/g, `${proxyPrefix}https://redirector.googlevideo.com`);
                    text = text.replace(/this.scheme="https"/, 'this.scheme="http"');
                    text = text.replace(/https:\/\/jnn-pa\.googleapis\.com/g, `${proxyPrefix}https://jnn-pa.googleapis.com`);
                    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, `${proxyPrefix}https://yt3.googleusercontent.com`);
                    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, `"${proxyPrefix}https://yt3.googleusercontent.com`);

                    // In order to fix history not working
                    text = text.replace(/=window\.location\.href;/, '=window.location.href.replace("http://localhost:8099", "https://www.youtube.com");')
                    text = text.replace(/=document\.location\.href/, '=document.location.href.replace("http://localhost:8099", "https://www.youtube.com")')

                    res.send(text);
                });
            } else {
                if (response.body) {
                    response.body.pipe(res);
                } else {
                    res.end();
                }
            }
        })
        .catch((error) => {
            const safeUrl = String(targetUrl).replace(/[\r\n]/g, '');
            console.error(`Proxy Error for [${safeUrl}]: ${error}`);
            console.error(error.stack);
            logServiceEvent('ERROR', `Proxy error for [${safeUrl}]: ${error && error.stack || error}`);
            if (!res.headersSent) {
                res.status(500).send('Proxy Connection Broken');
            }
        });
});

const server = app.listen(PORT, "127.0.0.1", () => {
    logServiceEvent('INFO', `Standalone service listening on 127.0.0.1:${PORT}`);
});
server.on('error', (err) => {
    logServiceEvent('ERROR', `app.listen failed: ${err && err.stack || err}`);
});

// dist/service.js's DIAL server generates UUIDs via the 'uuid' package, and
// on-device logs showed it resolving to uuid's browser-targeted rng (needs
// Web Crypto's crypto.getRandomValues, which Tizen's old Node service
// runtime doesn't have) instead of the Node-targeted one (crypto.randomBytes)
// — throwing "crypto.getRandomValues() not supported" during DIALServer
// construction. That left the module never finishing its setup, so Tizen's
// own service runner then called app.onRequest on every incoming message
// and got "app.onRequest is not a function", repeatedly — the likely actual
// cause of the crash-loop, since each of those was an uncaught exception.
// Polyfilling getRandomValues with Node's own crypto.randomBytes covers this
// regardless of which rng implementation actually got bundled.
if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') {
    const nodeCrypto = require('crypto');
    global.crypto = Object.assign({}, global.crypto, {
        getRandomValues: function (typedArray) {
            const bytes = nodeCrypto.randomBytes(typedArray.length);
            typedArray.set(bytes);
            return typedArray;
        }
    });
}

// Start the DIAL server
global.isTizenTube = true;
try {
    require('../../dist/service.js');
    logServiceEvent('INFO', 'DIAL service (dist/service.js) loaded');
} catch (err) {
    logServiceEvent('ERROR', `DIAL service (dist/service.js) failed to load: ${err && err.stack || err}`);
}