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

var DEFAULT_LOG_HOST = "192.168.50.57";
var DEFAULT_LOG_PORT = 3030;

function relayLog(level, message) {
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

try {
    require("./bundle.js");
    relayLog("INFO", "bundle.js required successfully");
} catch (err) {
    relayLog("ERROR", "require('./bundle.js') FAILED: " + (err && err.stack ? err.stack : String(err)));
}
