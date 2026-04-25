#!/usr/bin/env node
'use strict';
/**
 * Test menu header rendering tanpa interactive prompts.
 * Boot quick simulation header + scope picker preview.
 */
require('dotenv').config();
const chalk = require('chalk');
const arcChain = require('../src/chains/arc/config');
const litvmChain = require('../src/chains/litvm/config');
const { loadPrivateKeys } = require('../src/shared/wallets');
const tg = require('../src/shared/telegram');

const CHAINS = {
  arc: { name: 'Arc Testnet', config: arcChain, hasBridge: true, hasResume: true },
  litvm: { name: 'LitVM Testnet', config: litvmChain, hasBridge: false, hasResume: false },
};

function header() {
  const wallets = loadPrivateKeys().length;
  const tgStat = tg.isEnabled() ? chalk.green('ON') : chalk.gray('OFF');
  const W = 56;
  const line = (s) => {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, W - visible.length);
    return chalk.cyan('║ ') + s + ' '.repeat(pad) + chalk.cyan(' ║');
  };
  const chainLines = Object.values(CHAINS).map((c) => `${c.name.padEnd(16)} chainId=${c.config.chainId}`);
  console.log('');
  console.log(chalk.cyan('╔') + '═'.repeat(W + 2) + chalk.cyan('╗'));
  console.log(line(chalk.bold.white('LIST TESTNET FARM')));
  console.log(chalk.cyan('╠') + '═'.repeat(W + 2) + chalk.cyan('╣'));
  for (const cl of chainLines) console.log(line(cl));
  console.log(line(`Wallets: ${wallets}     Telegram: ${tgStat}`));
  console.log(line(`Daily:   ${chalk.gray('IDLE')}`));
  console.log(chalk.cyan('╚') + '═'.repeat(W + 2) + chalk.cyan('╝'));
  console.log('');
}

header();

console.log(chalk.bold('--- Main menu choices ---'));
console.log('  📊  Check balance all wallets');
console.log('  🚀  Bridge wallets (Sepolia → testnet)');
console.log('  ⚡  Resume bridge (Arc CCTP — pakai burn tx hash)');
console.log('  🔥  Start daily farming (auto loop 24h)');
console.log('  🔔  Telegram bot (setup / test)');
console.log('  ❌  Exit');
console.log('');

console.log(chalk.bold('--- Daily farming → scope picker ---'));
console.log('  🌐  ALL — daily farming di semua chain (paralel)');
console.log('  ⚡  Arc Testnet only');
console.log('  ⚡  LitVM Testnet only');
console.log('  ← Back');
console.log('');

console.log(chalk.bold('--- Balance → scope picker ---'));
console.log('  🌐  ALL — check balance di semua chain (paralel)');
console.log('  ⚡  Arc Testnet only');
console.log('  ⚡  LitVM Testnet only');
console.log('  ← Back');
console.log('');

console.log(chalk.bold('--- Bridge → chain picker (filter hasBridge) ---'));
const bridgeChains = Object.entries(CHAINS).filter(([, c]) => c.hasBridge);
for (const [, c] of bridgeChains) console.log(`  🚀  ${c.name}`);
console.log('  ← Back');
console.log(chalk.gray('  (LitVM tidak punya bridge \u2192 tidak muncul)'));
console.log('');
