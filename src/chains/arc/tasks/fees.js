'use strict';
const { ethers } = require('ethers');

function parseGwei(name, fallback) {
  const raw = process.env[name];
  const value = raw == null || String(raw).trim() === '' ? fallback : String(raw).trim();
  return ethers.parseUnits(value, 'gwei');
}

async function arcTxOverrides(provider, extra = {}) {
  const minMaxFee = parseGwei('ARC_MAX_FEE_GWEI', '200');
  const minPriorityFee = parseGwei('ARC_PRIORITY_FEE_GWEI', '2');
  let feeData = {};

  try {
    feeData = await provider.getFeeData();
  } catch (_) {
    feeData = {};
  }

  const maxFeePerGas = feeData.maxFeePerGas && feeData.maxFeePerGas > minMaxFee
    ? feeData.maxFeePerGas
    : minMaxFee;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > minPriorityFee
    ? feeData.maxPriorityFeePerGas
    : minPriorityFee;

  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
    ...extra,
  };
}

module.exports = { arcTxOverrides, parseGwei };
