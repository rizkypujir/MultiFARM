'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../../../shared/utils');
const chain = require('../config');
const { litvmTxOverrides } = require('./fees');
const { waitForLitvmTx } = require('./waitTx');
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

async function deployMinimal(wallet) {
  const tx = await wallet.sendTransaction({
    data: MIN_INIT_CODE,
    ...(await litvmTxOverrides(wallet.provider)),
  });
  const rec = await waitForLitvmTx(wallet, tx, { tag: 'litvm:deploy' });
  log('litvm:deploy', shortAddr(wallet.address), '->', rec.contractAddress, txUrl(tx.hash, EXPLORER));
  return { hash: tx.hash, address: rec.contractAddress };
}

module.exports = { deployMinimal };
