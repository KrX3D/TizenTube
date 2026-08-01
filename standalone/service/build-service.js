const ncc = require('@vercel/ncc');
const fs = require('fs');
const path = require('path');

async function build() {
    // index.js is transpiled to transpiled/index.js by the "babel" step in
    // npm run build (see package.json) before this runs, so older Tizen TVs
    // (Tizen ~5.5 and below run Node v4.4.3 for the JS service engine) get
    // syntax their runtime can actually parse instead of failing to load the
    // service entirely.
    const { code } = await ncc(path.join(__dirname, 'transpiled', 'index.js'), {
        minify: false
    });

    const fixedCode = code.replace(
        /if\s*\(\/.*?\/i?\.exec\(urlStr\)\)\s*\{\s*urlStr\s*=\s*new\s+URL\(urlStr\)\.toString\(\);\s*\}/g,
        ''
    ).replace(
        /(method:\s*request\.method,)/,
        "$1 maxHeaderSize: 5*1024*1024,"
    );

    const outDir = path.join(__dirname, 'dist');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

    fs.writeFileSync(path.join(outDir, 'index.js'), fixedCode);
}

build();