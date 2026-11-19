// Compiles built bundles with the V8 that actually runs them, without
// executing them, and fails on the first SyntaxError. CI-only, nothing here
// ends up on the TV. Run it with an old Node so its V8 is the parser under
// test (see .github/workflows/runtime-syntax-check.yml):
//
//   node --nolazy check-syntax.js --module dist/service.js   (Node 4.4.3)
//   node --nolazy --harmony_rest_parameters check-syntax.js --script dist/userScript.js   (Node 5.12)
//
// --script compiles the file as a classic script (how the userscript is
// injected into the page). --module wraps it the way require() does first,
// so the parse is the same one a service runtime does at require time.
// --nolazy makes V8 fully parse every function body up front; otherwise
// errors inside functions only surface when they are first called.
//
// Plain ES5 on purpose: this file itself has to parse on Node 4.

'use strict';

var fs = require('fs');
var vm = require('vm');
var Module = require('module');
var childProcess = require('child_process');

// process.stdout rather than console: CodeQL ties console.* here to the TV's
// console hook in mods/features/visualConsole.js and reports file data reaching
// the log senders (js/file-access-to-http), though this script never runs on
// the TV. Same fix as scripts/i18n-check/check-i18n.cjs.
function writeOut(line) {
    process.stdout.write(line + '\n');
}

var mode = null;
var failed = 0;
var checked = 0;

function compile(file, asModule) {
    var source = fs.readFileSync(file, 'utf8');
    // eslint-disable-next-line no-new
    new vm.Script(asModule ? Module.wrap(source) : source, { filename: file });
}

// Old Node keeps the position of a caught compile error to itself (the stack
// only names the caller); it prints "file:line", the source line and a caret
// only when the error goes uncaught. So compile again in a child, uncaught,
// and read the position from its stderr.
function locate(file, asModule) {
    var args = process.execArgv.concat([__filename, '--locate', asModule ? '--module' : '--script', file]);
    var result = childProcess.spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    var lines = String(result.stderr || '').split('\n');
    var head = /:(\d+)$/.exec(lines[0] || '');
    var caret = (lines[2] || '').indexOf('^');
    if (!head || caret < 0) return null;
    var line = Number(head[1]);
    if (asModule && line === 1) caret -= Module.wrapper[0].length;
    var text = fs.readFileSync(file, 'utf8').split('\n')[line - 1] || '';
    var from = Math.max(0, caret - 100);
    return 'line ' + line + ', column ' + (caret + 1) + ':\n     ' +
        text.slice(from, caret + 100) + '\n     ' + new Array(caret - from + 1).join(' ') + '^';
}

function check(file, asModule) {
    try {
        compile(file, asModule);
        checked++;
        writeOut('OK   ' + file);
    } catch (err) {
        failed++;
        writeOut('FAIL ' + file + ': ' + err);
        var where = locate(file, asModule);
        if (where) writeOut('     at ' + where);
    }
}

if (process.argv[2] === '--locate') {
    compile(process.argv[4], process.argv[3] === '--module');
    process.exit(0);
}

process.argv.slice(2).forEach(function (arg) {
    if (arg === '--script' || arg === '--module') {
        mode = arg;
        return;
    }
    if (!mode) {
        writeOut('Usage: check-syntax.js (--script|--module) file... [(--script|--module) file...]');
        process.exit(2);
    }
    check(arg, mode === '--module');
});

writeOut('Node ' + process.version + ' (V8 ' + process.versions.v8 + '): ' +
    checked + ' passed, ' + failed + ' failed');
process.exit(failed || !checked ? 1 : 0);
