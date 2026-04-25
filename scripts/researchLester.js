#!/usr/bin/env node
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.lester-labs.com';
const CACHE_DIR = path.join(__dirname, '..', '.cache', 'lester');
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
  console.log('Fetching launch page...');
  const html = (await fetch(`${BASE}/launch`)).body;
  const chunks = Array.from(new Set(html.match(/_next\/static\/chunks\/[^"'\s]+\.js/g) || []));
  console.log(`Found ${chunks.length} JS chunks`);

  let allCode = '';
  for (const c of chunks) {
    const cacheFile = path.join(CACHE_DIR, c.replace(/[^a-z0-9]/gi, '_'));
    let body;
    if (fs.existsSync(cacheFile)) {
      body = fs.readFileSync(cacheFile, 'utf8');
    } else {
      console.log(`  download ${c}`);
      body = (await fetch(BASE + '/' + c)).body;
      fs.writeFileSync(cacheFile, body);
    }
    allCode += '\n=== ' + c + ' ===\n' + body;
  }

  fs.writeFileSync(path.join(CACHE_DIR, '_combined.js'), allCode);
  console.log(`Combined: ${allCode.length} bytes`);

  // Search for LITVM (chain 4441) context
  console.log('');
  console.log('=== LITVM-related context ===');
  for (const pat of [/4441/g, /litvm/gi, /LITVM/g, /factoryAddress/gi, /tokenFactory/gi, /launchpad/gi]) {
    const m = allCode.match(pat);
    if (m && m.length > 0) {
      console.log(`  pattern ${pat} found ${m.length} times`);
      // Show first 3 contexts
      let count = 0;
      const re = new RegExp(pat.source, pat.flags);
      let mm;
      while ((mm = re.exec(allCode)) !== null && count < 2) {
        const w = allCode.slice(Math.max(0, mm.index - 100), mm.index + 400).replace(/[\r\n]+/g, ' ');
        console.log(`    >> ${w.slice(0, 500)}`);
        count++;
      }
    }
  }

  // All addresses
  console.log('');
  console.log('=== Addresses ===');
  const addrs = Array.from(new Set(allCode.match(/0x[a-fA-F0-9]{40}/g) || []));
  console.log(`Found ${addrs.length} unique`);
  console.log('Filtered (no zero/repeat):');
  const filtered = addrs.filter((a) => {
    const lower = a.toLowerCase();
    if (/^0x0+$/.test(lower)) return false;
    if (/^0x([0-9a-f])\1+$/.test(lower)) return false;
    return true;
  });
  for (const a of filtered.slice(0, 40)) console.log('  ' + a);
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
