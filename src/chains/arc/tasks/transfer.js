'use strict';
const { ethers } = require('ethers');
const chain = require('../config');
const erc20Abi = require('../../../shared/abi/erc20');
const { shortAddr } = require('../../../shared/utils');
const { waitForArcTx } = require('./waitTx');

function randomAddress() {
  return ethers.Wallet.createRandom().address;
}

const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || 90000);

async function transferToken(wallet, tokenKey, to, amount) {
  const token = chain.tokens[tokenKey];
  const c = new ethers.Contract(token.address, erc20Abi, wallet);
  const value = ethers.parseUnits(String(amount), token.decimals);
  const tx = await c.transfer(to, value);
  const detail = `${shortAddr(wallet.address)} -> ${shortAddr(to)}  ${amount} ${token.symbol}`;
  return waitForArcTx(wallet, tx, {
    timeoutMs: TX_TIMEOUT_MS,
    tag: `tx:${tokenKey}`,
    sent: detail,
    confirmed: detail,
  });
}

async function selfTransferUsdc(wallet, amount) {
  return randomTransferUsdc(wallet, amount);
}
async function selfTransferEurc(wallet, amount) {
  return randomTransferEurc(wallet, amount);
}
async function randomTransferUsdc(wallet, amount) {
  return transferToken(wallet, 'USDC', randomAddress(), amount);
}
async function randomTransferEurc(wallet, amount) {
  return transferToken(wallet, 'EURC', randomAddress(), amount);
}

module.exports = {
  transferToken,
  selfTransferUsdc,
  selfTransferEurc,
  randomTransferUsdc,
  randomTransferEurc,
  randomAddress,
};
