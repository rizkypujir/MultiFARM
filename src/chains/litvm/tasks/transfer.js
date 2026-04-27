'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../../../shared/utils');
const { litvmTxOverrides } = require('./fees');
const { waitForLitvmTx } = require('./waitTx');

function randomAddress() {
  return ethers.Wallet.createRandom().address;
}

// Self transfer zkLTC (native gas token)
async function selfTransferZkLTC(wallet, amountStr) {
  return randomTransferZkLTC(wallet, amountStr);
}

// Random transfer zkLTC
async function randomTransferZkLTC(wallet, amountStr) {
  const amount = ethers.parseEther(String(amountStr || '0.0001'));
  const to = randomAddress();
  const tx = await wallet.sendTransaction({
    to,
    value: amount,
    ...(await litvmTxOverrides(wallet.provider)),
  });
  await waitForLitvmTx(wallet, tx, { tag: 'litvm:randomTx' });
  log('litvm:randomTx', shortAddr(wallet.address), '->', shortAddr(to), `${amountStr} zkLTC`, txUrl(tx.hash, 'https://liteforge.explorer.caldera.xyz'));
  return tx.hash;
}

module.exports = { selfTransferZkLTC, randomTransferZkLTC, randomAddress };
