import { string } from 'rollup-plugin-string';
import terser from '@rollup/plugin-terser';
import getBabelOutputPlugin from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
    input: "userScript.js",
    output: { file: "../dist/userScript.js", format: "iife" },
    plugins: [
        string({
            include: "**/*.css",
        }),
        nodeResolve({
            browser: true,
            preferBuiltins: false,
        }),
        json(),
        commonjs({
            include: [/node_modules/, /mods/],
            transformMixedEsModules: true,
        }),
        getBabelOutputPlugin({
            babelHelpers: 'bundled',
            presets: [
                ['@babel/preset-env', {
                    // Updated target: Tizen 2016+ TVs support Chrome 56+
                    // This enables modern features like fetch, Promise, async/await
                    targets: {
                        chrome: '56'  // Changed from 47 to 56
                    },
                    // Keep polyfills for safety
                    useBuiltIns: false,
                    // Don't transform modules (Rollup handles that)
                    modules: false
                }],
            ],
        }),
        terser({
            ecma: 2016, // Changed from '5' to 2016 (ES7)
            mangle: true,
            // Keep WebSocket and other important globals
            compress: {
                pure_getters: true,
                unsafe: false,
                unsafe_comps: false,
                warnings: false
            }
        }),
    ]
};