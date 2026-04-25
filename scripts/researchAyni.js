#!/usr/bin/env node
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.aynilabs.xyz';
const CACHE_DIR = path.join(__dirname, '..', '.cache', 'ayni');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  const html = (await fetch(BASE)).body;
  const initialAssets = Array.from(new Set(html.match(/\/assets\/[^"'\s]+\.js/g) || []));
  console.log(`Initial assets: ${initialAssets.length}`);

  let allCode = '';
  const seen = new Set();
  const queue = [...initialAssets];
  while (queue.length) {
    const asset = queue.shift();
    if (seen.has(asset)) continue;
    seen.add(asset);
    const cacheFile = path.join(CACHE_DIR, asset.replace(/[^a-z0-9]/gi, '_'));
    let body;
    if (fs.existsSync(cacheFile)) {
      body = fs.readFileSync(cacheFile, 'utf8');
    } else {
      console.log(`  download ${asset}`);
      try {
        body = (await fetch(BASE + asset)).body;
        fs.writeFileSync(cacheFile, body);
      } catch (e) {
        console.log(`    skip (err: ${e.message})`);
        continue;
      }
    }
    allCode += '\n=== ' + asset + ' ===\n' + body;

    // Extract referenced assets (from import statements)
    const refs = body.match(/['"`](\.\.?\/)?[^"'`]*assets\/[^"'`]+\.js['"`]/g) || [];
    for (const ref of refs) {
      const clean = ref.replace(/['"`]/g, '').replace(/^\.\.?\//, '/');
      if (clean.startsWith('/assets/') && !seen.has(clean)) {
        queue.push(clean);
      }
    }
  }

  fs.writeFileSync(path.join(CACHE_DIR, '_combined.js'), allCode);
  console.log(`Combined: ${allCode.length} bytes (${seen.size} files)`);

  // Search for chain 4441 / litvm / contract addresses
  console.log('');
  for (const pat of [/4441/g, /litvm/gi, /aynilabs/gi, /supply\(/gi, /borrow\(/gi, /addressesProvider/gi, /lendingPool/gi, /AYNI/gi, /WzkLTC/gi]) {
    const m = allCode.match(pat);
    if (m && m.length > 0) {
      console.log(`pattern ${pat} found ${m.length}x`);
      const re = new RegExp(pat.source, pat.flags);
      const mm = re.exec(allCode);
      if (mm) {
        const w = allCode.slice(Math.max(0, mm.index - 100), mm.index + 400).replace(/[\r\n]+/g, ' ');
        console.log(`  >> ${w.slice(0, 500)}`);
      }
    }
  }

  console.log('');
  console.log('=== Addresses (filtered) ===');
  const addrs = Array.from(new Set(allCode.match(/0x[a-fA-F0-9]{40}/g) || []));
  const filtered = addrs.filter((a) => {
    const lower = a.toLowerCase();
    if (/^0x0+$/.test(lower)) return false;
    if (/^0x([0-9a-f])\1+$/.test(lower)) return false;
    return true;
  });
  console.log(`Total: ${filtered.length}`);
  for (const a of filtered.slice(0, 40)) console.log('  ' + a);
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
