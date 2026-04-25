'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../../../shared/utils');
const chain = require('../config');
const wzkLtcAbi = require('../abi/wzkLtc');

const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || 90000);
const EXPLORER = chain.explorer;

function withWaitTimeout(tx, label = 'tx') {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} confirm timeout ${TX_TIMEOUT_MS}ms`)), TX_TIMEOUT_MS);
  });
  return Promise.race([tx.wait(), timeout]).finally(() => clearTimeout(timer));
}

// Wrap zkLTC -> WzkLTC (deposit)
async function wrapZkLTC(wallet, amountStr) {
  const amount = ethers.parseEther(String(amountStr || '0.001'));
  const wzl = new ethers.Contract(chain.tokens.WzkLTC.address, wzkLtcAbi, wallet);
  const tx = await wzl.deposit({ value: amount });
  await withWaitTimeout(tx, 'wrapZkLTC');
  log('litvm:wrap', shortAddr(wallet.address), `${amountStr} zkLTC -> WzkLTC`, txUrl(tx.hash, EXPLORER));
  return tx.hash;
}

// Unwrap WzkLTC -> zkLTC (withdraw). Cek saldo WzkLTC dulu, kalau 0 skip.
async function unwrapZkLTC(wallet, amountStr) {
  const wzl = new ethers.Contract(chain.tokens.WzkLTC.address, wzkLtcAbi, wallet);
  const balance = await wzl.balanceOf(wallet.address);
  if (balance === 0n) {
    throw new Error('no WzkLTC balance to unwrap');
  }
  // Withdraw partial: minimum dari amountStr atau balance
  let amount = ethers.parseEther(String(amountStr || '0.0005'));
  if (amount > balance) amount = balance;

  const tx = await wzl.withdraw(amount);
  await withWaitTimeout(tx, 'unwrapZkLTC');
  log('litvm:unwrap', shortAddr(wallet.address), `${ethers.formatEther(amount)} WzkLTC -> zkLTC`, txUrl(tx.hash, EXPLORER));
  return tx.hash;
}

module.exports = { wrapZkLTC, unwrapZkLTC };
