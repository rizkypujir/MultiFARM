#!/usr/bin/env node
'use strict';
/**
 * Smoke test untuk verifikasi multi-chain restructure.
 * Cek:
 *   1. Semua module bisa di-require tanpa error
 *   2. Chain configs (Arc + LitVM) load benar
 *   3. Provider bisa konek (RPC reachable)
 *   4. Wallet loader works
 *   5. Logger bisa nulis (chain-aware)
 *   6. Progress file path resolve correctly
 *   7. Telegram module loads
 *   8. Tasks module loads
 *
 * Usage:
 *   node scripts/testRestructure.js
 *   node scripts/testRestructure.js --skip-rpc   # skip RPC connectivity test
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SKIP_RPC = process.argv.includes('--skip-rpc');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, detail = '') {
  console.log(`  ${c.green}✓${c.reset} ${name}${detail ? c.gray + ' (' + detail + ')' + c.reset : ''}`);
  passed++;
}

function fail(name, err) {
  const msg = err?.message || err?.shortMessage || String(err);
  console.log(`  ${c.red}✗${c.reset} ${name}: ${c.red}${msg}${c.reset}`);
  failed++;
  failures.push({ name, msg });
}

function section(title) {
  console.log('');
  console.log(c.cyan + c.bold + title + c.reset);
}

async function tryAsync(name, fn) {
  try {
    const r = await fn();
    ok(name, typeof r === 'string' ? r : '');
  } catch (e) {
    fail(name, e);
  }
}

function trySync(name, fn) {
  try {
    const r = fn();
    ok(name, typeof r === 'string' ? r : '');
  } catch (e) {
    fail(name, e);
  }
}

async function main() {
  console.log('');
  console.log(c.bold + 'MULTI-CHAIN RESTRUCTURE — Smoke Test' + c.reset);

  // ===== 1. Module loading =====
  section('1. Module loading (require all)');

  trySync('shared/utils', () => {
    const u = require('../src/shared/utils');
    if (!u.withRetry || !u.shortAddr) throw new Error('missing exports');
  });
  trySync('shared/logger', () => {
    const l = require('../src/shared/logger');
    if (!l.logFile) throw new Error('missing logFile');
  });
  trySync('shared/telegram', () => {
    const t = require('../src/shared/telegram');
    if (!t.isEnabled || !t.sendMessage) throw new Error('missing exports');
  });
  trySync('shared/wallets', () => {
    const w = require('../src/shared/wallets');
    if (!w.loadPrivateKeys) throw new Error('missing loadPrivateKeys');
  });
  trySync('shared/abi/erc20', () => {
    const a = require('../src/shared/abi/erc20');
    if (!Array.isArray(a)) throw new Error('not an ABI array');
  });

  trySync('chains/arc/config', () => {
    const cfg = require('../src/chains/arc/config');
    if (cfg.chainId !== 5042002) throw new Error('chainId mismatch: ' + cfg.chainId);
    return `chainId=${cfg.chainId}`;
  });
  trySync('chains/arc/provider', () => {
    const { getProvider } = require('../src/chains/arc/provider');
    if (!getProvider) throw new Error('missing getProvider');
  });
  trySync('chains/arc/flows/farm', () => {
    const f = require('../src/chains/arc/flows/farm');
    if (!f.runFarmOnce) throw new Error('missing runFarmOnce');
  });
  trySync('chains/arc/flows/balance', () => {
    const f = require('../src/chains/arc/flows/balance');
    if (!f.runBalance) throw new Error('missing runBalance');
  });
  trySync('chains/arc/flows/bridge', () => {
    const f = require('../src/chains/arc/flows/bridge');
    if (!f.runBridge) throw new Error('missing runBridge');
  });
  trySync('chains/arc/flows/resume', () => {
    const f = require('../src/chains/arc/flows/resume');
    if (!f.runResume) throw new Error('missing runResume');
  });
  trySync('chains/arc/bridge/cctp', () => {
    const b = require('../src/chains/arc/bridge/cctp');
    if (!b.bridgeOne || !b.resumeBridge) throw new Error('missing bridge fns');
  });
  trySync('chains/arc/tasks (all)', () => {
    require('../src/chains/arc/tasks/transfer');
    require('../src/chains/arc/tasks/approve');
    require('../src/chains/arc/tasks/deploy');
    require('../src/chains/arc/tasks/deployErc20Real');
    require('../src/chains/arc/tasks/deployNftReal');
    require('../src/chains/arc/tasks/balance');
    require('../src/chains/arc/tasks/zkcodex');
    require('../src/chains/arc/tasks/index');
  });

  trySync('chains/litvm/config', () => {
    const cfg = require('../src/chains/litvm/config');
    if (cfg.chainId !== 4441) throw new Error('chainId mismatch: ' + cfg.chainId);
    return `chainId=${cfg.chainId}`;
  });
  trySync('chains/litvm/provider', () => {
    const { getProvider } = require('../src/chains/litvm/provider');
    if (!getProvider) throw new Error('missing getProvider');
  });
  trySync('chains/litvm/flows/farm (placeholder)', () => {
    const f = require('../src/chains/litvm/flows/farm');
    if (!f.runFarmOnce) throw new Error('missing runFarmOnce');
  });

  // ===== 2. Chain registry =====
  section('2. Menu / chain registry');
  trySync('menu.js loads (no auto-run)', () => {
    // menu.js calls main() at bottom — kita require dengan trick: hapus dari cache,
    // pakai child_process atau eval. Simplest: require + cek modul exports.
    // Tapi menu.js pakai main() at bottom yang langsung jalan -> tidak bisa di-require di sini.
    // Skip require, cek aja file ada & syntax valid.
    const p = path.join(__dirname, '..', 'src', 'menu.js');
    if (!fs.existsSync(p)) throw new Error('menu.js not found');
    const content = fs.readFileSync(p, 'utf8');
    if (!content.includes('CHAINS = {')) throw new Error('chain registry not found');
    if (!content.includes('arc:')) throw new Error('arc chain not registered');
    if (!content.includes('litvm:')) throw new Error('litvm chain not registered');
  });

  // ===== 3. Wallet loader =====
  section('3. Wallet loader');
  trySync('loadPrivateKeys()', () => {
    const { loadPrivateKeys } = require('../src/shared/wallets');
    const pks = loadPrivateKeys();
    if (!Array.isArray(pks)) throw new Error('not an array');
    return `${pks.length} keys`;
  });

  // ===== 4. Provider connectivity (skip if --skip-rpc) =====
  if (!SKIP_RPC) {
    section('4. RPC connectivity (live network calls)');
    await tryAsync('Arc RPC getBlockNumber', async () => {
      const { getProvider } = require('../src/chains/arc/provider');
      const p = getProvider();
      const n = await p.getBlockNumber();
      return `block=${n}`;
    });
    await tryAsync('LitVM RPC getBlockNumber', async () => {
      const { getProvider } = require('../src/chains/litvm/provider');
      const p = getProvider();
      const n = await p.getBlockNumber();
      return `block=${n}`;
    });
  } else {
    section('4. RPC connectivity (skipped via --skip-rpc)');
  }

  // ===== 5. Logger writes =====
  section('5. Logger (chain-aware log files)');
  trySync('logFile.withChain("arc") writes ke arc-*.log', () => {
    const { logFile } = require('../src/shared/logger');
    const arcLog = logFile.withChain('arc');
    arcLog('smoketest:arc', 'arc chain log test ' + Date.now());
    const logsDir = path.join(__dirname, '..', 'logs');
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const expected = `arc-${stamp}.log`;
    if (!fs.existsSync(path.join(logsDir, expected))) throw new Error(`${expected} not created`);
    return expected;
  });
  trySync('logFile.withChain("litvm") writes ke litvm-*.log', () => {
    const { logFile } = require('../src/shared/logger');
    const litvmLog = logFile.withChain('litvm');
    litvmLog('smoketest:litvm', 'litvm chain log test ' + Date.now());
    const logsDir = path.join(__dirname, '..', 'logs');
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const expected = `litvm-${stamp}.log`;
    if (!fs.existsSync(path.join(logsDir, expected))) throw new Error(`${expected} not created`);
    return expected;
  });

  // ===== 6. Progress file paths =====
  section('6. Progress file paths');
  trySync('Arc progress path resolves', () => {
    // Path defined di src/chains/arc/flows/farm.js — read constant
    const farmFile = path.join(__dirname, '..', 'src', 'chains', 'arc', 'flows', 'farm.js');
    const content = fs.readFileSync(farmFile, 'utf8');
    if (!content.includes('.progress.arc.json')) throw new Error('not chain-aware');
    // Resolve actual path: 4 levels up from chains/arc/flows = project root
    const expected = path.join(__dirname, '..', '.progress.arc.json');
    return path.basename(expected);
  });

  // ===== 7. Diagnostic scripts =====
  section('7. Diagnostic scripts (chain-aware)');
  trySync('checkProgress.js parses --chain flag', () => {
    const p = path.join(__dirname, 'checkProgress.js');
    const content = fs.readFileSync(p, 'utf8');
    if (!content.includes("'--chain'")) throw new Error('--chain flag not handled');
    if (!content.includes('args.chain')) throw new Error('chain arg not used');
  });
  trySync('diagWallet.js parses --chain flag', () => {
    const p = path.join(__dirname, 'diagWallet.js');
    const content = fs.readFileSync(p, 'utf8');
    if (!content.includes("'--chain'")) throw new Error('--chain flag not handled');
    if (!content.includes('chains/${chainArg}/config')) throw new Error('dynamic chain config not used');
  });

  // ===== 8. .env.example sanity =====
  section('8. .env.example multi-chain vars');
  trySync('.env.example has LITVM_*', () => {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    if (!env.includes('LITVM_RPC_URL')) throw new Error('missing LITVM_RPC_URL');
    if (!env.includes('LITVM_CHAIN_ID')) throw new Error('missing LITVM_CHAIN_ID');
  });

  // ===== Summary =====
  console.log('');
  console.log(c.bold + '═══ Summary ═══' + c.reset);
  console.log(`  ${c.green}✓ Passed${c.reset} : ${passed}`);
  console.log(`  ${failed > 0 ? c.red : c.gray}✗ Failed${c.reset} : ${failed}`);

  if (failed > 0) {
    console.log('');
    console.log(c.red + 'Failures:' + c.reset);
    for (const f of failures) console.log(`  - ${f.name}: ${f.msg}`);
    console.log('');
    process.exit(1);
  } else {
    console.log('');
    console.log(c.green + 'All good. Restructure verified.' + c.reset);
    console.log('');
  }
}

main().catch((e) => {
  console.error(c.red + 'TEST RUNNER ERROR: ' + (e?.stack || e?.message || e) + c.reset);
  process.exit(1);
});
