#!/usr/bin/env node
'use strict';
/**
 * Research OnmiFun (LitVM) contract addresses dari JS bundle.
 * Download semua chunk JS, grep address & known patterns.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://app.onmi.fun';
const CACHE_DIR = path.join(__dirname, '..', '.cache', 'onmifun');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching swap page...');
  const html = (await fetch(`${BASE}/swap?chain=LITVM`)).body;

  const chunkRegex = /\/_next\/static\/chunks\/[^"'\s]+\.js/g;
  const chunks = Array.from(new Set(html.match(chunkRegex) || []));
  console.log(`Found ${chunks.length} JS chunks`);

  let allCode = '';
  for (const c of chunks) {
    const cacheFile = path.join(CACHE_DIR, c.replace(/[^a-z0-9]/gi, '_'));
    let body;
    if (fs.existsSync(cacheFile)) {
      body = fs.readFileSync(cacheFile, 'utf8');
    } else {
      console.log(`  download ${c}`);
      body = (await fetch(BASE + c)).body;
      fs.writeFileSync(cacheFile, body);
    }
    allCode += '\n=== ' + c + ' ===\n' + body;
  }

  console.log('');
  console.log('=== Address candidates ===');
  // Find all unique 0x addresses (40 hex chars)
  const addrs = Array.from(new Set(allCode.match(/0x[a-fA-F0-9]{40}/g) || []));
  console.log(`Found ${addrs.length} unique addresses (raw)`);

  // Filter out common zero / boilerplate
  const filtered = addrs.filter((a) => {
    const lower = a.toLowerCase();
    if (/^0x0+$/.test(lower)) return false;
    if (/^0x([0-9a-f])\1+$/.test(lower)) return false;
    return true;
  });
  console.log(`Filtered: ${filtered.length}`);

  // Also search for chainId 4441 patterns
  console.log('');
  console.log('=== Searching for "4441" context (LitVM chainId) ===');
  const idx = allCode.indexOf('4441');
  if (idx >= 0) {
    const window = allCode.slice(Math.max(0, idx - 200), idx + 800);
    console.log(window.replace(/[\r\n]+/g, ' ').slice(0, 1500));
  } else {
    console.log('  no "4441" literal found');
  }

  // Search for LITVM string context
  console.log('');
  console.log('=== Searching for "LITVM" or "litvm" context ===');
  const re = /(LITVM|litvm)/g;
  let m;
  let count = 0;
  while ((m = re.exec(allCode)) !== null && count < 10) {
    const w = allCode.slice(Math.max(0, m.index - 150), m.index + 600);
    console.log(`--- match ${++count} at pos ${m.index} ---`);
    console.log(w.replace(/[\r\n]+/g, ' ').slice(0, 800));
    console.log('');
  }

  // Save full code for manual grep
  fs.writeFileSync(path.join(CACHE_DIR, '_combined.js'), allCode);
  console.log('');
  console.log('Combined code saved to .cache/onmifun/_combined.js');
  console.log('');
  console.log('=== Top address candidates ===');
  for (const a of filtered.slice(0, 30)) console.log('  ' + a);
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
