'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../../../shared/utils');

const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || 90000);

function withWaitTimeout(tx, label = 'tx') {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} confirm timeout ${TX_TIMEOUT_MS}ms`)), TX_TIMEOUT_MS);
  });
  return Promise.race([tx.wait(), timeout]).finally(() => clearTimeout(timer));
}

function randomAddress() {
  return ethers.Wallet.createRandom().address;
}

// Self transfer zkLTC (native gas token)
async function selfTransferZkLTC(wallet, amountStr) {
  const amount = ethers.parseEther(String(amountStr || '0.0001'));
  const tx = await wallet.sendTransaction({ to: wallet.address, value: amount });
  await withWaitTimeout(tx, 'selfTransferZkLTC');
  log('litvm:selfTx', shortAddr(wallet.address), `${amountStr} zkLTC`, txUrl(tx.hash, 'https://liteforge.explorer.caldera.xyz'));
  return tx.hash;
}

// Random transfer zkLTC
async function randomTransferZkLTC(wallet, amountStr) {
  const amount = ethers.parseEther(String(amountStr || '0.0001'));
  const to = randomAddress();
  const tx = await wallet.sendTransaction({ to, value: amount });
  await withWaitTimeout(tx, 'randomTransferZkLTC');
  log('litvm:randomTx', shortAddr(wallet.address), '->', shortAddr(to), `${amountStr} zkLTC`, txUrl(tx.hash, 'https://liteforge.explorer.caldera.xyz'));
  return tx.hash;
}

module.exports = { selfTransferZkLTC, randomTransferZkLTC, randomAddress };
