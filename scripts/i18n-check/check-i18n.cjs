#!/usr/bin/env node
// Checks that the English and German translations stay in step.
// Plain Node, no dependencies, so it runs in any CI job that has actions/checkout.
//
// Usage:
//   node scripts/check-i18n.cjs --en <en.json> --de <de.json> [--src <dir>]... [--go <file.go>]
//
// Fails on:
//   - a key in one language file but not the other (nested JSON is flattened to a.b.c)
//   - a placeholder ({n}, {{name}}, %s, %d) present in one language but not the other
//   - a key used in code (t('key'), data-i18n="key") that is in neither file
//   - with --go: the same checks for a Go map of the form  "en": { "key": "..." }, "de": {...}
//     plus i18n.T(lang, "key") calls in all Go sources under the current directory
// Keys built at runtime (t('state.' + x)) are skipped, they cannot be checked statically.
// Keys starting with "__" (metadata such as __contributors) are ignored.

'use strict';
const fs = require('fs');
const path = require('path');

const args = { src: [] };
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i].replace(/^--/, '');
  const value = process.argv[i + 1];
  if (value === undefined) usage(`missing value for --${name}`);
  if (name === 'src') args.src.push(value);
  else if (['en', 'de', 'go'].includes(name)) args[name] = value;
  else usage(`unknown option --${name}`);
}
if (!args.en || !args.de) usage('--en and --de are required');

function usage(msg) {
  console.error(`check-i18n: ${msg}`);
  console.error('usage: check-i18n.cjs --en <en.json> --de <de.json> [--src <dir>]... [--go <file.go>]');
  process.exit(2);
}

const errors = [];

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('__')) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function readJson(file) {
  try {
    return flatten(JSON.parse(fs.readFileSync(file, 'utf8')), '', {});
  } catch (e) {
    errors.push(`${file}: cannot read: ${e.message}`);
    return {};
  }
}

const PLACEHOLDER = /\{\{\s*\w+\s*\}\}|\{\w+\}|%[sdvqf]/g;
const placeholders = (s) => (typeof s === 'string' ? (s.match(PLACEHOLDER) || []).sort().join(' ') : '');

function compare(label, en, de) {
  for (const k of Object.keys(en)) if (!(k in de)) errors.push(`${label}: "${k}" is in en but missing in de`);
  for (const k of Object.keys(de)) if (!(k in en)) errors.push(`${label}: "${k}" is in de but missing in en`);
  for (const k of Object.keys(en)) {
    if (!(k in de)) continue;
    const a = placeholders(en[k]);
    const b = placeholders(de[k]);
    if (a !== b) errors.push(`${label}: "${k}" placeholders differ: en [${a}] vs de [${b}]`);
  }
}

function walk(dir, exts, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function checkUsage(label, roots, exts, pattern, known) {
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      errors.push(`${label}: source directory ${root} does not exist`);
      continue;
    }
    for (const file of walk(root, exts, [])) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(pattern)) {
        const key = m.groups.key;
        // Prefixes completed at runtime, e.g. t('state.' + x).
        if (key.endsWith('.') || key.endsWith('_')) continue;
        if (!(key in known)) {
          const line = text.slice(0, m.index).split('\n').length;
          errors.push(`${file}:${line}: "${key}" is used but not in ${label}`);
        }
      }
    }
  }
}

// --- JSON dictionaries
const en = readJson(args.en);
const de = readJson(args.de);
compare(`${args.en} / ${args.de}`, en, de);

// Only dotted keys count as translation keys, so t('x') from unrelated helpers is not flagged.
const JS_USE = /(?:\bt\(\s*|\bdata-i18n[\w-]*=)(['"`])(?<key>[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]*)\1/g;
checkUsage(
  'the translation files',
  args.src,
  ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.vue', '.svelte'],
  JS_USE,
  en,
);

// --- Go map
if (args.go) {
  const maps = {};
  let lang = null;
  for (const line of fs.readFileSync(args.go, 'utf8').split('\n')) {
    const open = line.match(/^\s*"(en|de)":\s*\{\s*$/);
    if (open) { lang = open[1]; maps[lang] = {}; continue; }
    if (lang && /^\s*\},?\s*$/.test(line)) { lang = null; continue; }
    const entry = lang && line.match(/^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/);
    if (entry) maps[lang][entry[1]] = entry[2];
  }
  if (!maps.en || !maps.de) errors.push(`${args.go}: could not find both "en" and "de" maps`);
  else {
    compare(args.go, maps.en, maps.de);
    const GO_USE = /\bi18n\.T\([^,()]+,\s*"(?<key>[^"]+)"/g;
    checkUsage(args.go, ['.'], ['.go'], GO_USE, maps.en);
  }
}

if (errors.length) {
  console.error(`check-i18n: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`check-i18n: ok (${Object.keys(en).length} keys${args.go ? ' + Go map' : ''})`);
