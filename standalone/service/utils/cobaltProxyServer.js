"use strict";

const fs = require('fs');
const http = require('http');
const ogHttps = require('https');
const https = require('./https.js');
const os = require('os');
const net = require('net');
const tls = require('tls');
const forge = require('node-forge');
const url = require('url');

const proxyPort = 8101;

function startServer() {
    const caCertificate = forge.pki.certificateFromPem(
        fs.readFileSync('/home/owner/share/tizentube-ca.crt', 'utf8')
    );

    const caPrivateKey = forge.pki.privateKeyFromPem(
        fs.readFileSync('/home/owner/share/tizentube-ca.key', 'utf8')
    );

    function createHostCertificate(hostname) {
        const keys = forge.pki.rsa.generateKeyPair(2048);
        const certificate = forge.pki.createCertificate();

        certificate.publicKey = keys.publicKey;
        certificate.serialNumber = Date.now().toString(16);
        certificate.validity.notBefore = new Date();
        certificate.validity.notAfter = new Date();
        certificate.validity.notAfter = new Date(
            certificate.validity.notBefore.getTime() + 397 * 24 * 60 * 60 * 1000
        );

        certificate.setSubject([{ name: 'commonName', value: hostname }]);
        certificate.setIssuer(caCertificate.subject.attributes);
        certificate.setExtensions([
            { name: 'basicConstraints', cA: false, critical: true },
            {
                name: 'keyUsage',
                digitalSignature: true,
                keyEncipherment: true,
                critical: true
            },
            { name: 'extKeyUsage', serverAuth: true },
            {
                name: 'subjectAltName',
                altNames: [{ type: 2, value: hostname }]
            },
            { name: 'subjectKeyIdentifier' },
            {
                name: 'authorityKeyIdentifier',
                keyIdentifier: caCertificate.generateSubjectKeyIdentifier().getBytes()
            }
        ]);

        certificate.sign(caPrivateKey, forge.md.sha256.create());

        return {
            key: forge.pki.privateKeyToPem(keys.privateKey),
            cert: forge.pki.certificateToPem(certificate) + forge.pki.certificateToPem(caCertificate)
        };
    }

    function tunnel(hostname, port, clientSocket, initialData) {
        const targetSocket = net.connect(port, hostname, () => {
            clientSocket.write(
                'HTTP/1.1 200 Connection Established\r\n\r\n'
            );

            if (initialData.length) {
                targetSocket.write(initialData);
            }

            clientSocket.pipe(targetSocket);
            targetSocket.pipe(clientSocket);
        });

        targetSocket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => targetSocket.destroy());
    }

    // Generated once at startup rather than per connection. Each call is an
    // RSA-2048 keygen, which on TV hardware is seconds of CPU — and it was
    // being paid again for every CONNECT the page made, before any byte of
    // the response could move. Only two hostnames are ever intercepted, so
    // there is nothing to cache dynamically.
    const ytCertWww = createHostCertificate('www.youtube.com');
    const ytCert = createHostCertificate('youtube.com');

    function mitm(hostname, port, clientSocket, initialData) {
        clientSocket.write(
            'HTTP/1.1 200 Connection Established\r\n\r\n'
        );

        const tlsServer = new tls.Server(
            hostname === 'www.youtube.com' ? ytCertWww : ytCert
        );

        tlsServer.on('secureConnection', clientTlsSocket => {
            const httpServer = http.createServer(
                (request, response) => {
                    const isTvPath =
                        request.url === '/tv' ||
                        request.url.startsWith('/tv?');

                    const reqHeaders = Object.assign({}, request.headers);

                    if (isTvPath) reqHeaders['accept-encoding'] = 'identity';

                    const httpsModule = parseInt(process.version.split('.')[0].replace('v', '')) >= 13 ? ogHttps : https;

                    const targetRequest = httpsModule.request({
                        hostname,
                        port,
                        method: request.method,
                        path: request.url,
                        headers: reqHeaders,
                        servername: hostname,
                        rejectUnauthorized: true,
                        maxHeaderSize: 1024 * 1024
                    }, targetResponse => {
                        const headers = Object.assign({}, targetResponse.headers);

                        if (!isTvPath) {
                            response.writeHead(
                                targetResponse.statusCode,
                                headers
                            );

                            return targetResponse.pipe(response);
                        }

                        delete headers['content-security-policy'];
                        delete headers['content-security-policy-report-only'];
                        headers['content-security-policy'] = [
                            "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
                            'img-src * https://dearrow-thumb.ajay.app data: blob:',
                            'media-src * data: blob:',
                            "script-src * https://cdn.jsdelivr.net https://sponsor.ajay.app data: blob: 'unsafe-inline' 'unsafe-eval'",
                            "style-src * data: blob: 'unsafe-inline'",
                            'connect-src * https://cdn.jsdelivr.net https://sponsor.ajay.app https://dearrow-thumb.ajay.app',
                            'font-src * data:'
                        ].join('; ');

                        const chunks = [];

                        targetResponse.on('data', chunk => chunks.push(chunk));

                        targetResponse.on('end', () => {
                            let body = Buffer.concat(chunks).toString('utf8');

                            delete headers['content-length'];
                            delete headers['transfer-encoding'];
                            delete headers['content-encoding'];
                            delete headers['connection'];

                            body = body.replace(
                                /<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy(?:-Report-Only)?["'][^>]*>/gi,
                                ''
                            );

                            // At the end of the document, not the start: injected
                            // right after <body> the script ran before the page's own
                            // scripts had defined anything it hooks.
                            //
                            // The query string is what stops jsDelivr handing back a
                            // copy it cached before the last publish — the same stale
                            // bundle problem the module/app version mismatch turned out
                            // to be.
                            //
                            // This fork's package, not upstream's: the port carried
                            // @foxreis/tizentube over verbatim, so a Cobalt build would
                            // have loaded upstream's mod rather than this one.
                            body = body.replace('</body>', `<script src="https://cdn.jsdelivr.net/npm/@krx3d/tizentube2/dist/userScript.js?ver=${Date.now()}"></script></body>`);

                            headers['content-length'] = Buffer.byteLength(body, 'utf8');
                            headers['connection'] = 'close';
                            headers['content-encoding'] = 'identity';

                            response.writeHead(
                                targetResponse.statusCode,
                                headers
                            );

                            response.end(body);
                        });
                    });

                    targetRequest.on('error', error => {
                        response.destroy();
                    });

                    request.pipe(targetRequest);
                }
            );

            httpServer.emit('connection', clientTlsSocket);
        });

        tlsServer.on('tlsClientError', () => {
            clientSocket.destroy();
        });

        if (initialData && initialData.length) {
            clientSocket.unshift(initialData);
        }

        tlsServer.emit('connection', clientSocket);
    }

    // Binding to every interface is what lets the Cobalt build address this by
    // hostname instead of 127.0.0.2 — but this proxy tunnels any CONNECT it is
    // given, YouTube or not, so on 0.0.0.0 alone it is an open forward proxy
    // for everyone on the network, with the TV's address on the traffic.
    //
    // The connection still always comes FROM the TV; only the address it is
    // addressed TO changes. So accept the machine's own addresses and refuse
    // the rest, which keeps the hostname build working and closes the relay.
    const localAddresses = new Set(['127.0.0.1', '::1']);
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const entry of (interfaces[name] || [])) {
                if (entry && entry.address) localAddresses.add(String(entry.address));
            }
        }
    } catch (e) { }

    // 127.0.0.0/8 is entirely loopback and cannot be reached from another
    // machine, so it is local whether or not the alias appears in the interface
    // list. That matters here: the default Cobalt build addresses this proxy as
    // 127.0.0.2, which os.networkInterfaces() does not report.
    //
    // Checked as four numbers rather than by prefix. remoteAddress is always
    // numeric so it makes no practical difference, but a prefix test also
    // accepts anything merely starting with those characters, and this is the
    // check standing between the TV and being an open relay.
    function isLoopback(address) {
        const parts = address.split('.');
        if (parts.length !== 4 || parts[0] !== '127') return false;
        for (const part of parts) {
            if (!/^[0-9]{1,3}$/.test(part)) return false;
            if (Number(part) > 255) return false;
        }
        return true;
    }

    function isLocalClient(socket) {
        let address = String((socket && socket.remoteAddress) || '');
        // ::ffff:192.168.1.5 is the same host as 192.168.1.5; a dual-stack
        // listener reports the mapped form and a plain compare would miss it.
        if (address.indexOf('::ffff:') === 0) address = address.slice(7);
        // A scope id on a link-local v6 address is not part of the address.
        const scope = address.indexOf('%');
        if (scope !== -1) address = address.slice(0, scope);
        if (isLoopback(address)) return true;
        return localAddresses.has(address);
    }

    const proxyServer = http.createServer((request, response) => {
        if (!isLocalClient(request.socket)) { response.destroy(); return; }
        const targetUrl = url.parse(request.url);

        const targetRequest = http.request({
            hostname: targetUrl.hostname,
            port: targetUrl.port || 80,
            method: request.method,
            path: targetUrl.pathname + targetUrl.search,
            headers: request.headers
        }, targetResponse => {
            response.writeHead(
                targetResponse.statusCode,
                targetResponse.headers
            );

            targetResponse.pipe(response);
        });

        targetRequest.on('error', () => response.destroy());
        request.pipe(targetRequest);
    });

    proxyServer.on('connect', (request, clientSocket, initialData) => {
        if (!isLocalClient(clientSocket)) { clientSocket.destroy(); return; }
        const reqUrl = request.url.split(':');
        const hostname = reqUrl[0];
        const port = reqUrl[1] || 443;

        if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) {
            return tunnel(
                hostname,
                Number(port),
                clientSocket,
                initialData
            );
        }

        mitm(
            hostname,
            Number(port),
            clientSocket,
            initialData
        );
    });

    // 127.0.0.2 is reachable only from the TV itself, and only if that alias
    // exists. Binding everywhere is what lets the Cobalt build be pointed at a
    // hostname instead, which is upstream's second package variant.
    proxyServer.listen(proxyPort, '0.0.0.0');
}

module.exports = startServer;