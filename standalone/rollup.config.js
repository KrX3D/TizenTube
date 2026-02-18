import copy from 'rollup-plugin-copy';

// AIDEV-NOTE: Simplified standalone build - just copy files and pre-built userScript.js
// The userScript.js is built separately by the mods build process
export default {
    input: "src/js/launcher.js", // Build launcher only
    output: { 
        file: "dist/js/launcher.js", 
        format: "iife",
        name: "TizenTubeLauncher"
    },
    plugins: [
        // AIDEV-NOTE: Copy all necessary files for WGT package structure
        copy({
            targets: [
                // Core Tizen app files
                { src: 'src/config.xml', dest: 'dist/' },
                { src: 'src/index.html', dest: 'dist/' },
                
                // Pre-built user scripts (built by mods build)
                { src: '../dist/userScript.js', dest: 'dist/js/' },
                
                // Assets (will need icons)
                { src: 'src/assets/**/*', dest: 'dist/assets/' },
            ],
            hook: 'writeBundle'
        })
    ]
};