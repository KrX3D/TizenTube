#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get version from command line (semantic versioning required for Tizen)
const version = process.argv[2];

if (!version) {
  console.error('❌ Version argument required!');
  console.error('   Usage: node scripts/update-version.js <version>');
  console.error('   Example: node scripts/update-version.js 1.0.0');
  console.error('   Tizen requires x.y.z format where x,y ≤ 255 and z ≤ 65535');
  process.exit(1);
}

// Validate Tizen version format (x.y.z where x,y ≤ 255, z ≤ 65535)
const versionRegex = /^(\d+)\.(\d+)\.(\d+)$/;
const match = version.match(versionRegex);

if (!match) {
  console.error('❌ Invalid version format!');
  console.error('   Tizen requires x.y.z format (e.g., 1.0.0)');
  process.exit(1);
}

const [, x, y, z] = match.map(Number);
if (x > 255 || y > 255 || z > 65535) {
  console.error('❌ Version numbers exceed Tizen limits!');
  console.error('   x and y must be ≤ 255, z must be ≤ 65535');
  console.error(`   Got: x=${x}, y=${y}, z=${z}`);
  process.exit(1);
}

console.log(`🔖 Updating TizenTube to version: ${version}`);

// Update package.json
const packagePath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

// Update config.xml
const configPath = path.join(__dirname, '../standalone/src/config.xml');
let configXml = fs.readFileSync(configPath, 'utf8');

// Replace only the widget version attribute
configXml = configXml.replace(
  /(<widget[^>]*version=")[^"]*(")/,
  `$1${version}$2`
);

fs.writeFileSync(configPath, configXml);

console.log('✅ Updated version in:');
console.log('   - package.json');
console.log('   - standalone/src/config.xml');
console.log('');
console.log('📋 Current versions:');
console.log(`   package.json: ${version}`);
console.log(`   config.xml: ${version}`);