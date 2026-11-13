// Smart Hub Preview: TizenTube's row on the TV home bar.
//
// The row is built in the page by mods/features/homeBarPreview.js (latest
// unfinished history entry, latest playlists, subscriptions) and stored by
// StandaloneService in tt-home-bar-preview.json. This service only publishes
// that file with webapis.preview.setPreviewData() and exits, as Samsung's
// sample does; a preview service that does not exit is ended after five
// minutes, which is also why this is not part of StandaloneService.
//
// Started by the system about every ten minutes, by index.html on every app
// start, and by StandaloneService right after the row changes.
//
// Samsung shows these rows on TVs up to 2021. Confirmed on the 5.0 TV; the
// 6.5 TV accepts the data and shows nothing, as it does for every app.
//
// Plain ES5 on purpose: the 5.0 TV runs services on Node 4.4.3, and this file
// is copied as-is (nothing bundles or transpiles it).

var http = require('http');
var fs = require('fs');
var path = require('path');

var PREVIEW_FILE = 'tt-home-bar-preview.json';
// When this last published and what. Samsung takes one setPreviewData every
// ten minutes and drops the rest without an error, so a repeat of the same row
// is skipped and a changed one waits; StandaloneService starts this service
// again once the ten minutes are up.
var STATE_FILE = 'tt-home-bar-preview-published.json';
var MIN_GAP_MS = 10 * 60 * 1000;

// Lines land in the syslog through StandaloneService, when it is running.
function report(level, message) {
    try {
        var body = JSON.stringify({ level: level, message: '[PreviewService] ' + message });
        var req = http.request({
            host: '127.0.0.1',
            port: 8099,
            path: '/tizentube/previewEvent',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        });
        req.on('error', function () {});
        req.setTimeout(3000, function () { req.abort(); });
        req.end(body);
    } catch (e) {}
}

// The same places StandaloneService tries (storeCandidates in
// service/index.js), derived the same way: /opt/usr/apps/<pkgId>/res/wgt/...
function candidates() {
    var parts = String(__dirname).split(String.fromCharCode(92)).join('/').split('/');
    var i = parts.indexOf('apps');
    var pkg = (i !== -1 && parts[i + 1]) ? parts[i + 1] : '';
    if (!pkg) return [];
    var out = [];
    if (process.env.HOME) out.push(path.join(process.env.HOME, 'apps_rw', pkg, 'data', PREVIEW_FILE));
    out.push(path.join('/opt/usr/home/owner/apps_rw', pkg, 'data', PREVIEW_FILE));
    out.push(path.join('/home/owner/apps_rw', pkg, 'data', PREVIEW_FILE));
    out.push(path.join('/opt/usr/apps', pkg, 'data', PREVIEW_FILE));
    return out;
}

function readPreview() {
    var list = candidates();
    for (var i = 0; i < list.length; i++) {
        try {
            var raw = fs.readFileSync(list[i], 'utf8');
            var data = JSON.parse(raw);
            if (data && data.sections && data.sections.length !== undefined) return { data: data, raw: raw, file: list[i] };
        } catch (e) {}
    }
    return null;
}

function exitSoon() {
    // Give the report a moment to leave before the process goes.
    setTimeout(function () {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    }, 1500);
}

function readState(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')) || {}; } catch (e) { return {}; }
}

function writeState(dir, raw) {
    try { fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ at: Date.now(), raw: raw })); } catch (e) {}
}

// The 4:3 thumbnail form the test build proved, for a TV that refuses the
// 16:9 mqdefault images (smaller than Samsung's documented minimum).
function fallbackRaw(raw) {
    return raw.split('/mqdefault.jpg').join('/hqdefault.jpg').split('"16by9"').join('"4by3"');
}

function publish(trigger) {
    var hasPreview = typeof webapis !== 'undefined' && webapis && webapis.preview
        && typeof webapis.preview.setPreviewData === 'function';
    if (!hasPreview) {
        report('ERROR', 'webapis.preview is not available (trigger ' + trigger + ')');
        exitSoon();
        return;
    }
    var stored = readPreview();
    if (!stored) {
        // Nothing built yet: TizenTube has not run long enough since install.
        report('INFO', 'no home bar row stored yet (trigger ' + trigger + ')');
        exitSoon();
        return;
    }
    var tiles = 0;
    for (var i = 0; i < stored.data.sections.length; i++) tiles += (stored.data.sections[i].tiles || []).length;
    var dir = path.dirname(stored.file);
    var state = readState(dir);
    var sinceMs = Date.now() - Number(state.at || 0);
    if (state.raw === stored.raw && trigger === 'app') {
        // Already showing this row; publishing it again would only use up the
        // one update Samsung allows per ten minutes.
        exitSoon();
        return;
    }
    if (sinceMs >= 0 && sinceMs < MIN_GAP_MS) {
        report('INFO', 'row changed, waiting ' + Math.round((MIN_GAP_MS - sinceMs) / 1000) + ' s: Samsung allows one update per 10 min (trigger ' + trigger + ')');
        exitSoon();
        return;
    }
    var attempt = function (raw, label, onFail) {
        try {
            webapis.preview.setPreviewData(raw, function () {
                writeState(dir, stored.raw);
                report('INFO', 'published ' + stored.data.sections.length + ' sections, ' + tiles + ' tiles' + label + ' (trigger ' + trigger + ')');
                exitSoon();
            }, function (err) {
                report('ERROR', 'setPreviewData failed' + label + ' (trigger ' + trigger + '): ' + (err && (err.name + ': ' + err.message) || err));
                if (onFail) onFail(); else exitSoon();
            });
        } catch (e) {
            report('ERROR', 'setPreviewData threw' + label + ' (trigger ' + trigger + '): ' + (e && e.message || e));
            if (onFail) onFail(); else exitSoon();
        }
    };
    var fallback = fallbackRaw(stored.raw);
    attempt(stored.raw, '', fallback !== stored.raw ? function () { attempt(fallback, ' with 4:3 thumbnails', null); } : null);
}

module.exports.onStart = function () {};

module.exports.onRequest = function () {
    var trigger = 'system';
    try {
        var req = tizen.application.getCurrentApplication().getRequestedAppControl();
        var data = req && req.appControl && req.appControl.data || [];
        for (var i = 0; i < data.length; i++) {
            if (data[i].key === 'caller' && data[i].value && data[i].value[0] === 'ForegroundApp') trigger = 'app';
        }
    } catch (e) {}
    publish(trigger);
};

module.exports.onExit = function () {};
