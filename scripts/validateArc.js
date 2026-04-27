'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const chain = require('../src/chains/arc/config');
const { getProvider } = require('../src/chains/arc/provider');
const { SEQUENCE } = require('../src/chains/arc/flows/farm');
const { arcTxOverrides, parseGwei } = require('../src/chains/arc/tasks/fees');

async function main() {
  const provider = getProvider();
  const [network, block, feeData, overrides] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
    provider.getFeeData(),
    arcTxOverrides(provider),
  ]);

  const minArcBaseFee = parseGwei('ARC_MIN_BASE_FEE_GWEI', '160');
  const maxFeeOk = overrides.maxFeePerGas >= minArcBaseFee;
  const chainOk = Number(network.chainId) === chain.chainId;
  const taskOk = SEQUENCE.length === 9;

  console.log('Arc Doctor');
  console.log(`RPC        : ${chain.rpcUrl}`);
  console.log(`Chain ID   : ${network.chainId.toString()} ${chainOk ? 'OK' : 'ERR'}`);
  console.log(`Block      : ${block}`);
  console.log(`RPC fee    : ${feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : '?'} gwei`);
  console.log(`Script fee : ${ethers.formatUnits(overrides.maxFeePerGas, 'gwei')} gwei max / ${ethers.formatUnits(overrides.maxPriorityFeePerGas, 'gwei')} gwei priority ${maxFeeOk ? 'OK' : 'ERR'}`);
  console.log(`Tasks      : ${SEQUENCE.length} ${taskOk ? 'OK' : 'ERR'}`);
  console.log(`Sequence   : ${SEQUENCE.map((task) => task.name).join(' -> ')}`);

  if (!chainOk || !maxFeeOk || !taskOk) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Arc Doctor ERR:', e.shortMessage || e.message);
  process.exit(1);
});
