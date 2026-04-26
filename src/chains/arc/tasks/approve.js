'use strict';
const { ethers } = require('ethers');
const chain = require('../config');
const erc20Abi = require('../../../shared/abi/erc20');
const { shortAddr, randInt } = require('../../../shared/utils');
const { waitForArcTx } = require('./waitTx');

async function approveToken(wallet, tokenKey, spender, amount) {
  const token = chain.tokens[tokenKey];
  const c = new ethers.Contract(token.address, erc20Abi, wallet);
  const value = amount === 'max'
    ? ethers.MaxUint256
    : ethers.parseUnits(String(amount), token.decimals);
  const tx = await c.approve(spender, value);
  const detail = `${shortAddr(wallet.address)} approve ${token.symbol} spender=${shortAddr(spender)}`;
  return waitForArcTx(wallet, tx, {
    tag: 'tx:approve',
    sent: detail,
    confirmed: detail,
  });
}

async function approveUsdcFx(wallet) {
  const amt = (randInt(1, 50) / 10).toFixed(2);
  return approveToken(wallet, 'USDC', chain.contracts.stableFX, amt);
}
async function approveEurcFx(wallet) {
  const amt = (randInt(1, 50) / 10).toFixed(2);
  return approveToken(wallet, 'EURC', chain.contracts.stableFX, amt);
}

module.exports = { approveToken, approveUsdcFx, approveEurcFx };
