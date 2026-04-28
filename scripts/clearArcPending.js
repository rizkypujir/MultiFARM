'use strict';
require('dotenv').config();
const { ethers } = require('ethers');
const { loadWallets } = require('../src/shared/wallets');
const { txUrl } = require('../src/shared/utils');

function argValue(names) {
  for (let i = 2; i < process.argv.length; i++) {
    if (names.includes(process.argv[i])) return process.argv[i + 1];
  }
  return null;
}

function parseGwei(name, fallback) {
  const raw = process.env[name];
  const value = raw == null || String(raw).trim() === '' ? fallback : String(raw).trim();
  return ethers.parseUnits(value, 'gwei');
}

async function main() {
  const wallets = loadWallets();
  const walletNo = argValue(['--wallet', '-w']);
  const addr = argValue(['--addr', '-a']);
  let wallet;

  if (walletNo) {
    const idx = Number(walletNo) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= wallets.length) {
      throw new Error(`wallet number invalid: ${walletNo}`);
    }
    wallet = wallets[idx];
  } else if (addr) {
    wallet = wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase());
    if (!wallet) throw new Error(`address tidak ada di wallets.txt: ${addr}`);
  } else {
    throw new Error('pakai --wallet <nomor> atau --addr <address>');
  }

  const provider = wallet.provider;
  const latest = await provider.getTransactionCount(wallet.address, 'latest');
  const pending = await provider.getTransactionCount(wallet.address, 'pending');
  console.log(`Wallet : ${wallet.address}`);
  console.log(`Nonce  : latest=${latest} pending=${pending}`);

  if (pending <= latest) {
    console.log('Tidak ada pending nonce.');
    return;
  }

  const maxFeePerGas = parseGwei('ARC_REPLACEMENT_MAX_FEE_GWEI', '260');
  const maxPriorityFeePerGas = parseGwei('ARC_REPLACEMENT_PRIORITY_FEE_GWEI', '5');
  const timeoutMs = Number(process.env.TX_TIMEOUT_MS || 30000);

  for (let nonce = latest; nonce < pending; nonce++) {
    const liveLatest = await provider.getTransactionCount(wallet.address, 'latest');
    if (nonce < liveLatest) {
      console.log(`Skip nonce ${nonce}, already mined/replaced.`);
      continue;
    }
    console.log(`Cancel nonce ${nonce}...`);
    try {
      const tx = await wallet.sendTransaction({
        to: wallet.address,
        value: 0n,
        nonce,
        gasLimit: 21000n,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
      console.log(`  sent ${txUrl(tx.hash)}`);
      const receipt = await tx.wait(1, timeoutMs);
      console.log(`  ok block=${receipt.blockNumber}`);
    } catch (e) {
      const msg = e.shortMessage || e.message || String(e);
      if (/nonce|already known|replacement|underpriced/i.test(msg)) {
        console.log(`  skip/refresh: ${msg}`);
        continue;
      }
      throw e;
    }
  }

  const afterLatest = await provider.getTransactionCount(wallet.address, 'latest');
  const afterPending = await provider.getTransactionCount(wallet.address, 'pending');
  console.log(`Done. Nonce latest=${afterLatest} pending=${afterPending}`);
}

main().catch((e) => {
  console.error('clearArcPending ERR:', e.shortMessage || e.message);
  process.exit(1);
});
