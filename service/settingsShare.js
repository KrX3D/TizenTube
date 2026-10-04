const http = require('http');
const ssdp = require('@patrickkfkan/peer-ssdp');

/**
 * settingsShare.js — moving settings from one TV to another, over the LAN.
 *
 * Mounted on the DIAL service's express app, which is the only server this
 * project runs that is reachable from the network and already announces itself
 * over SSDP. It also runs in both modes — standalone and TizenBrew-injected —
 * so putting the routes here means one implementation rather than one per
 * mode.
 *
 * The page holds the settings (they live in localStorage), so it hands them
 * here when you open the export screen, and this serves them to the other TV.
 *
 * What is shared is held in memory, never written to disk, and only while the
 * export screen is open: `/tizentube/settings` answers nothing otherwise. That
 * is the whole of the protection and it is deliberate — the alternative was a
 * code to type in, which costs a step on every transfer to guard preference
 * data on a home network. Sharing is opened by a deliberate act on the sending
 * TV and closes with the screen, so there is no window anyone has to remember
 * to shut.
 */

const SHARE_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_MS = 2500;
const PROBE_TIMEOUT_MS = 1200;
const PEER_PORT = 8085;
const DIAL_SERVICE_TYPE = 'urn:dial-multiscreen-org:service:dial:1';

let shared = null;

function sharingIsOpen() {
    if (!shared) return false;
    if (Date.now() > shared.until) {
        shared = null;
        return false;
    }
    return true;
}

function allowCrossOrigin(res) {
    // The page asking is served from a different port on this same TV (the
    // standalone proxy on 8099, or youtube.com itself), so every one of these
    // is cross-origin even when it never leaves the machine.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** GET http://<host>:8085<path>, parsed as JSON. */
function getJson(host, path, timeoutMs, callback) {
    let done = false;
    const finish = (err, value) => {
        if (done) return;
        done = true;
        callback(err, value);
    };
    let request;
    try {
        request = http.get({ host: host, port: PEER_PORT, path: path, timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return finish(new Error('HTTP ' + res.statusCode));
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
                // A peer that answers this route with something enormous is
                // not one of ours; stop reading rather than buffering it.
                if (body.length > 512 * 1024) {
                    request.destroy();
                    finish(new Error('response too large'));
                }
            });
            res.on('end', () => {
                try {
                    finish(null, JSON.parse(body));
                } catch (err) {
                    finish(err);
                }
            });
        });
    } catch (err) {
        return finish(err);
    }
    request.on('error', finish);
    request.on('timeout', () => {
        request.destroy();
        finish(new Error('timed out'));
    });
    setTimeout(() => finish(new Error('timed out')), timeoutMs + 250);
}

/**
 * Who else on this network is running TizenTube.
 *
 * SSDP finds DIAL devices, which on most networks includes things that are not
 * this app at all, so every answer is then asked whether it is one of ours.
 * The list is built from what answers, not from what the announcement claims.
 *
 * A second SSDP peer alongside the DIAL server's own is safe: both sockets are
 * opened with reuseAddr, and the searching socket binds its own random port.
 */
function discoverPeers(callback) {
    const candidates = {};
    let peer;
    try {
        peer = ssdp.createPeer();
    } catch (err) {
        return callback(err, []);
    }

    const finish = () => {
        try { peer.close(); } catch (e) { /* closing a closed peer is not a failure */ }
        const hosts = Object.keys(candidates);
        if (!hosts.length) return callback(null, []);

        const found = [];
        let outstanding = hosts.length;
        const oneDone = () => {
            outstanding--;
            if (outstanding === 0) callback(null, found);
        };
        for (const host of hosts) {
            getJson(host, '/tizentube/settings/hello', PROBE_TIMEOUT_MS, (err, value) => {
                if (!err && value && value.app === 'TizenTube') {
                    found.push({ host: host, name: value.name || host, version: value.version || null, sharing: !!value.sharing });
                }
                oneDone();
            });
        }
    };

    peer.on('found', (headers, address) => {
        if (address && address.address) candidates[address.address] = true;
    });
    peer.on('ready', () => {
        try {
            peer.search({ ST: DIAL_SERVICE_TYPE });
        } catch (err) {
            // Nothing to do but let the timer finish with whatever arrived.
        }
    });
    peer.on('error', () => { /* a failed search is an empty list, not a crash */ });

    try {
        peer.start();
    } catch (err) {
        return callback(err, []);
    }
    setTimeout(finish, DISCOVERY_MS);
}

/**
 * @param {object} app      the express app the DIAL server is already on
 * @param {object} options  { name, version } describing this TV
 */
function mountSettingsShare(app, options) {
    const describe = options || {};
    const json = require('express').json({ limit: '512kb' });

    // Asked of a candidate found over SSDP, to see whether it is one of ours.
    // Says whether it is sharing, so the other TV can say "open Export there
    // first" instead of just failing.
    app.get('/tizentube/settings/hello', (req, res) => {
        allowCrossOrigin(res);
        res.json({
            app: 'TizenTube',
            name: describe.name || 'TizenTube',
            version: describe.version || null,
            sharing: sharingIsOpen(),
        });
    });

    // Opened by the export screen on this TV.
    const share = (req, res) => {
        allowCrossOrigin(res);
        const body = req.body || {};
        if (!body.payload || typeof body.payload !== 'object') {
            return res.status(400).json({ ok: false, error: 'no payload' });
        }
        shared = { payload: body.payload, until: Date.now() + SHARE_TTL_MS };
        res.json({ ok: true, until: shared.until });
    };
    app.post('/tizentube/settings/share', json, share);

    app.post('/tizentube/settings/stop', (req, res) => {
        allowCrossOrigin(res);
        shared = null;
        res.json({ ok: true });
    });

    // The one route another TV reads. Closed unless the export screen is open.
    app.get('/tizentube/settings', (req, res) => {
        allowCrossOrigin(res);
        if (!sharingIsOpen()) return res.status(404).json({ ok: false, error: 'not sharing' });
        res.json({ ok: true, name: describe.name || 'TizenTube', payload: shared.payload });
    });

    // Both asked by the importing TV's own page, which cannot reach the other
    // TV itself: on the injected path it is an https page and anything http is
    // blocked, so all of this happens here instead.
    app.get('/tizentube/settings/peers', (req, res) => {
        allowCrossOrigin(res);
        discoverPeers((err, peers) => {
            res.json({ ok: !err, peers: peers || [], error: err ? String(err.message || err) : null });
        });
    });

    app.get('/tizentube/settings/peer', (req, res) => {
        allowCrossOrigin(res);
        const host = String(req.query.host || '');
        if (!/^[0-9a-zA-Z.:-]{3,64}$/.test(host)) {
            return res.status(400).json({ ok: false, error: 'bad host' });
        }
        getJson(host, '/tizentube/settings', 4000, (err, value) => {
            if (err || !value || !value.payload) {
                return res.status(502).json({ ok: false, error: err ? String(err.message || err) : 'not sharing' });
            }
            res.json({ ok: true, name: value.name || host, payload: value.payload });
        });
    });
}

module.exports = mountSettingsShare;
module.exports.mountSettingsShare = mountSettingsShare;
