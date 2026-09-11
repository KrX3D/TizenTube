"use strict";

// Deliberately plain ES5 (var/function, no arrow functions, no template
// literals, no const/let, no destructuring) so this file itself is
// parseable on essentially any Node version, including whatever Tizen 5.5
// and older ship. bundle.js (everything else — express, node-fetch,
// adbhost, chrome-remote-interface, and this app's own code, all bundled
// together by ncc) is NOT guaranteed to be that old-safe, since it includes
// third-party code never written with that constraint in mind. A
// require('./bundle.js') call IS wrapped in try/catch here even though the
// try/catch inside bundle.js itself isn't enough — a SyntaxError while
// Node is still parsing bundle.js happens before any of that file's own
// code (including its own try/catch) ever runs, but require() surfaces
// that same SyntaxError to ITS caller (this file) as a normal catchable
// exception. Without this split, a parse failure in bundle.js would be a
// silent, total, unlogged failure — this is what was actually happening on
// Tizen 5.5: index.html's own logs showed it retrying forever with nothing
// ever listening on port 8099, and not even the very first line of
// bundle.js's own logging ever fired.

var http = require("http");

// Blank rather than a baked-in LAN address; relayLog below skips sending
// when no host has been configured.
var DEFAULT_LOG_HOST = "";
var DEFAULT_LOG_PORT = 3030;

function relayLog(level, message) {
    // bootstrap.js runs before bundle.js exists, so there is no way to know the
    // receiver address here — the page has not been in touch yet. Rather than
    // drop these lines (they are where load failures show up) they are parked
    // on a global that index.js flushes once the page tells it where to send.
    if (!DEFAULT_LOG_HOST) {
        try {
            if (!global.__ttPendingServiceLogs) global.__ttPendingServiceLogs = [];
            if (global.__ttPendingServiceLogs.length < 50) {
                global.__ttPendingServiceLogs.push({
                    ts: new Date().toISOString(),
                    level: level,
                    context: "StandaloneBootstrap",
                    message: message
                });
            }
        } catch (e) { }
        return;
    }
    try {
        var ts = new Date().toISOString();
        var body = JSON.stringify({
            _formatted: "[" + ts + "] [" + level + "] [StandaloneBootstrap] " + message,
            app: "TizenTube Standalone",
            ts: ts,
            level: level,
            context: "StandaloneBootstrap",
            message: message
        });
        var req = http.request({
            hostname: DEFAULT_LOG_HOST,
            port: DEFAULT_LOG_PORT,
            path: "/tv-log",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
        }, function () {});
        req.on("error", function () {});
        req.write(body);
        req.end();
    } catch (e) {
        // Nothing further we can do if even this fails.
    }
}

relayLog("INFO", "bootstrap.js starting, node " + process.version);

var loaded = {};
try {
    loaded = require("./bundle.js") || {};
    relayLog("INFO", "bundle.js required successfully");
} catch (err) {
    relayLog("ERROR", "require('./bundle.js') FAILED: " + (err && err.stack ? err.stack : String(err)));
}

// Tizen's service runner does `app = require(<entry>)` and then calls
// app.onStart / app.onRequest / app.onStop on every lifecycle message.
// config.xml points <tizen:service> at THIS file, so the handlers have to be
// exported here — putting them on index.js only placed them on bundle.js's
// exports, which the runner never looks at. That is why
//
//     TypeError: app.onRequest is not a function
//         at MessagePort.<anonymous> (/usr/share/wrt/app/service/service_runner.js:152)
//
// kept repeating as an uncaught exception after they were added: right module,
// wrong file.
//
// Everything the service does happens while bundle.js is required above, so
// these only need to exist. Handlers the bundle exports are preferred; these
// are the fallback, which also means a bundle that failed to load degrades to
// a quiet service instead of a crash loop.
module.exports.onStart = typeof loaded.onStart === "function" ? loaded.onStart : function () { };
module.exports.onStop = typeof loaded.onStop === "function" ? loaded.onStop : function () { };
module.exports.onRequest = typeof loaded.onRequest === "function" ? loaded.onRequest : function () { };
