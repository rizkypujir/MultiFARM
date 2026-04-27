'use strict';
const { ethers } = require('ethers');

function parseGwei(name, fallback) {
  const raw = process.env[name];
  const value = raw == null || String(raw).trim() === '' ? fallback : String(raw).trim();
  return ethers.parseUnits(value, 'gwei');
}

async function litvmTxOverrides(provider, extra = {}) {
  const minGasPrice = parseGwei('LITVM_GAS_PRICE_GWEI', '0.02');
  let feeData = {};

  try {
    feeData = await provider.getFeeData();
  } catch (_) {
    feeData = {};
  }

  const gasPrice = feeData.gasPrice && feeData.gasPrice > minGasPrice
    ? feeData.gasPrice
    : minGasPrice;

  return { gasPrice, ...extra };
}

module.exports = { litvmTxOverrides, parseGwei };
