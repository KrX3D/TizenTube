const ncc = require('@vercel/ncc');
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
    );

    // Node 4.4.3 (Tizen ~5.5's service engine) rejects block-scoped let/const/
    // function/class declarations *outside* strict mode with a SyntaxError —
    // confirmed on-device. Only some bundled dependencies declare their own
    // "use strict" (ncc wraps each one in its own function, so one module's
    // directive doesn't cover another's), so force it for the whole bundle by
    // prepending it as the file's very first line: nested functions lexically
    // inherit strict mode from their enclosing scope, so this one directive
    // covers every bundled module, not just this app's own code.
    const strictFixedCode = '"use strict";\n' + fixedCode;

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