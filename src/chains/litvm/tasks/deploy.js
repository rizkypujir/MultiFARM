'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../../../shared/utils');
const chain = require('../config');

const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || 90000);
const EXPLORER = chain.explorer;

// Minimal init code: deploy contract with runtime code = 1 byte STOP (0x00).
// Same pattern as Arc deploy.js — chain-agnostic minimal deploy.
const MIN_INIT_CODE = '0x600160005260206000F3';
//  PUSH1 0x01    // size = 1 byte
//  PUSH1 0x00    // mem offset
//  MSTORE
//  PUSH1 0x20
//  PUSH1 0x00
//  RETURN

function withWaitTimeout(tx, label = 'tx') {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} confirm timeout ${TX_TIMEOUT_MS}ms`)), TX_TIMEOUT_MS);
  });
  return Promise.race([tx.wait(), timeout]).finally(() => clearTimeout(timer));
}

async function deployMinimal(wallet) {
  const tx = await wallet.sendTransaction({ data: MIN_INIT_CODE });
  const rec = await withWaitTimeout(tx, 'deployMinimal');
  log('litvm:deploy', shortAddr(wallet.address), '->', rec.contractAddress, txUrl(tx.hash, EXPLORER));
  return { hash: tx.hash, address: rec.contractAddress };
}

module.exports = { deployMinimal };
