import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';
import fs from 'fs';

// Custom Rollup plugin to inject XML content
function injectXmlContent() {
    return {
        name: 'inject-xml-content',
        renderChunk(code) {

            // The fs import's suffix is assigned by Rollup and shifts whenever
            // the dependency graph changes — it is fs$2 now, was fs$3 before.
            // Hardcoding it meant this silently stopped matching, the templates
            // were never inlined, and the DIAL service died at runtime with
            //   ENOENT ... open '.../service/dist/../xml/device-desc.xml'
            // because xml/ is not shipped in the .wgt. Matching any identifier
            // keeps it working across future graph changes.
            const pattern = /var\s+(\w+)_TEMPLATE\s+=\s+[\w$]+\.readFileSync\(__dirname\s+\+\s+'\/\.\.\/xml\/([^']+)'\s*,\s*'utf8'\);/g;

            const modifiedCode = code.replace(pattern, (match, varName, fileName) => {
                const xmlContent = fs.readFileSync(`node_modules/@patrickkfkan/peer-dial/xml/${fileName}`, 'utf8');
                return `var ${varName}_TEMPLATE = ${JSON.stringify(xmlContent)};`;
            });

            return { code: modifiedCode, map: null };
        }
    };
}

// Tizen 6.5's service runtime is Node v12.16.3, which cannot resolve the
// "node:" scheme for core modules — that arrived in Node 14.18/16. A captured
// session showed the DIAL service failing to load outright:
//
//     DIAL service (dist/service.js) failed to load:
//         Error: Cannot find module 'node:zlib'
//
// The bundle pulls in eight of them (zlib, events, path, fs, http,
// querystring, buffer, net) from dependencies, so the first one throws and the
// whole module is lost. Stripping the prefix is safe: bare 'zlib' resolves to
// the same core module on every Node version this ever runs on.
//
// Only require() calls are rewritten, so the prefixed spellings inside
// dependency doc-comments are left alone.
function stripNodeProtocol() {
    return {
        name: 'strip-node-protocol',
        renderChunk(code) {
            return {
                code: code.replace(/require\(['"]node:([a-z_]+)['"]\)/g, "require('$1')"),
                map: null,
            };
        }
    };
}

export default {
    input: 'service.js',
    output: {
        file: '../dist/service.js',
        format: 'cjs'
    },
    plugins: [
        injectXmlContent(),
        stripNodeProtocol(),
        replace({
            'Gate.prototype.await = function await(callback)': 'Gate.prototype.await = function(callback)',
            'Async.prototype.await = function await(callback)': 'Async.prototype.await = function (callback)',
            delimiters: ['', ''],
        }),
        resolve(),
        json(),
        commonjs(),
        babel({
            babelHelpers: 'bundled',
            presets: ['@babel/preset-env']
        })
    ]
};