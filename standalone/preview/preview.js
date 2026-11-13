// Smart Hub Preview: TEST BUILD.
//
// Asked for: a row of TizenTube content on the TV's home bar when the app
// is highlighted, the way Emby shows one. That is Samsung's Smart Hub
// Preview: a background service hands a JSON description of the row to
// webapis.preview.setPreviewData(). This first version only answers whether
// the row appears on these TVs at all, so it publishes three fixed tiles.
// Real rows (Continue Watching, new from subscriptions) come after.
//
// A service of its own rather than part of StandaloneService: Samsung's
// sample calls exit() right after setPreviewData, and a preview service that
// does not exit is terminated after five minutes. StandaloneService has to
// keep running for the proxy and the injector.
//
// Plain ES5 on purpose. The 5.0 TV runs services on Node 4.4.3, and this
// file is copied as-is (nothing bundles or transpiles it).
//
// The system launches this service by itself roughly every ten minutes;
// index.html also launches it on every start (the operation and caller data
// match Samsung's BackgroundServiceLocal sample).

var http = require('http');

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

function tile(videoId, title, subtitle) {
    return {
        title: title,
        subtitle: subtitle,
        // hqdefault is 480x360, inside Samsung's 4:3 limits (333x250 to
        // 480x360) and well under the 360 KB cap.
        image_url: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg',
        image_ratio: '4by3',
        action_data: JSON.stringify({ videoId: videoId }),
        is_playable: true
    };
}

var PREVIEW = {
    sections: [{
        title: 'TizenTube (Test)',
        tiles: [
            tile('aqz-KE-bpKQ', 'Big Buck Bunny', 'Test tile 1'),
            tile('eRsGyueVLvQ', 'Sintel', 'Test tile 2'),
            tile('R6MlUcmOul8', 'Tears of Steel', 'Test tile 3')
        ]
    }]
};

var started = Date.now();

function exitSoon() {
    // Give the report a moment to leave before the process goes.
    setTimeout(function () {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    }, 1500);
}

function publish(trigger) {
    var hasPreview = typeof webapis !== 'undefined' && webapis && webapis.preview
        && typeof webapis.preview.setPreviewData === 'function';
    if (!hasPreview) {
        report('ERROR', 'webapis.preview is not available in this service (trigger ' + trigger
            + ', webapis ' + (typeof webapis) + ')');
        exitSoon();
        return;
    }
    var version = '';
    try { version = webapis.preview.getVersion(); } catch (e) { version = 'n/a'; }
    try {
        webapis.preview.setPreviewData(JSON.stringify(PREVIEW), function () {
            report('INFO', 'setPreviewData succeeded (trigger ' + trigger + ', preview API ' + version
                + ', ' + (Date.now() - started) + ' ms after start)');
            exitSoon();
        }, function (err) {
            report('ERROR', 'setPreviewData failed (trigger ' + trigger + '): '
                + (err && (err.name + ': ' + err.message) || err));
            exitSoon();
        });
    } catch (e) {
        report('ERROR', 'setPreviewData threw (trigger ' + trigger + '): ' + (e && e.message || e));
        exitSoon();
    }
}

module.exports.onStart = function () {
    report('INFO', 'onStart');
};

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
