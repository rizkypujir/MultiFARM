'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

function loadPrivateKeys() {
  // Prioritas: WALLETS_FILE env > wallets.txt (default) > PRIVATE_KEYS env
  const file = process.env.WALLETS_FILE || 'wallets.txt';
  const fp = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (fs.existsSync(fp)) {
    const lines = fs
      .readFileSync(fp, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
    if (lines.length) return lines;
  }
  const env = process.env.PRIVATE_KEYS || '';
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Default `loadWallets()` (legacy): pakai Arc provider untuk backward compat.
// Caller bisa override dengan provider lain via loadWalletsWith(provider).
function loadWallets(provider) {
  const pks = loadPrivateKeys();
  if (!pks.length) {
    throw new Error('Tidak ada private key. Set PRIVATE_KEYS di .env atau isi wallets.txt');
  }
  if (!provider) {
    // Lazy require Arc provider untuk backward-compat (chain-aware code akan kasih provider)
    const { getProvider } = require('../chains/arc/provider');
    provider = getProvider();
  }
  return pks.map((pk) => {
    const key = pk.startsWith('0x') ? pk : '0x' + pk;
    return new ethers.Wallet(key, provider);
  });
}

// Chain-aware version: loads wallets attached to specified provider
function loadWalletsWith(provider) {
  return loadWallets(provider);
}

module.exports = { loadWallets, loadWalletsWith, loadPrivateKeys };
