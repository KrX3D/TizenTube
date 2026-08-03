const ncc = require('@vercel/ncc');
const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');

async function build() {
    const { code } = await ncc(path.join(__dirname, 'index.js'), {
        minify: false
    });

    const fixedCode = code.replace(
        /if\s*\(\/.*?\/i?\.exec\(urlStr\)\)\s*\{\s*urlStr\s*=\s*new\s+URL\(urlStr\)\.toString\(\);\s*\}/g,
        ''
    ).replace(
        /(method:\s*request\.method,)/,
        "$1 maxHeaderSize: 5*1024*1024,"
    ).replace(
        // adbhost's own AdbHostClient.prototype._onPacket assigns
        // `packet = this._packet;` with no declaration — a genuine bug in
        // that package, harmless in sloppy mode (silently creates an
        // implicit global) but a ReferenceError in strict mode. Confirmed
        // on-device: this crashed the ADB connection handling right after
        // the CDP-injection handoff began once the whole bundle was forced
        // strict (see the "use strict" prepend below), breaking every
        // standalone launch on Tizen 6.5.
        /\bpacket = this\._packet;/,
        'var packet = this._packet;'
    );

    // Node 4.4.3 (Tizen ~5.5's service engine) can't parse a lot of ES6+
    // syntax at all — confirmed on-device across two different SyntaxErrors
    // (block-scoped let/const/function/class outside strict mode, then a
    // second "Unexpected token {" once that was fixed) scattered somewhere
    // across express + its ~30 transitive deps + node-fetch/adbhost/
    // chrome-remote-interface, none of which were written with that engine
    // in mind. Rather than keep hunting individual constructs one at a time,
    // transpile the *already-bundled* single output file with Babel,
    // targeting Node 4.4.3 specifically. This is deliberately different from
    // the previous attempt at this (reverted — see "Known unresolved
    // issues"), which ran Babel over the whole standalone/service/ source
    // tree (including node_modules) *before* bundling: that transpiled
    // ncc's own huge internals (very slow) and crash-parsed unrelated test
    // fixtures elsewhere in node_modules. Transpiling only the final bundle
    // avoids both — it contains neither ncc's own tooling nor any test
    // fixtures, only the actual runtime code paths ncc already tree-shook
    // down to.
    const babelOutput = babel.transformSync(fixedCode, {
        presets: [['@babel/preset-env', { targets: { node: '4.4.3' } }]],
        babelrc: false,
        configFile: false,
        compact: false
    });

    // Belt and suspenders: Babel's Node-4-targeted output uses var instead
    // of let/const, so this shouldn't be load-bearing anymore, but keep it
    // — harmless, and it already caught one real bug (adbhost's own
    // undeclared `packet` assignment, patched above) by turning a silent
    // implicit-global footgun into a loud, fixable error instead of quietly
    // misbehaving.
    const strictFixedCode = '"use strict";\n' + babelOutput.code;

    const outDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    // The actual bundle (express/node-fetch/adbhost/chrome-remote-interface +
    // this app's own code) goes to bundle.js, not index.js — see bootstrap.js
    // for why. config.xml's <tizen:service> points at index.js, which is the
    // plain ES5 bootstrap, copied through unmodified (it doesn't need ncc).
    fs.writeFileSync(path.join(outDir, 'bundle.js'), strictFixedCode);
    fs.copyFileSync(path.join(__dirname, 'bootstrap.js'), path.join(outDir, 'index.js'));
}

build();