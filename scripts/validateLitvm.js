'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const chain = require('../src/chains/litvm/config');
const { getProvider } = require('../src/chains/litvm/provider');
const { SEQUENCE } = require('../src/chains/litvm/flows/farm');
const { litvmTxOverrides } = require('../src/chains/litvm/tasks/fees');
const { pickSwapTarget } = require('../src/chains/litvm/tasks/swap');

async function main() {
  const provider = getProvider();
  const [network, block, feeData, overrides, swapTarget] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
    provider.getFeeData(),
    litvmTxOverrides(provider),
    pickSwapTarget(provider).catch((e) => ({ error: e.shortMessage || e.message })),
  ]);

  const chainOk = Number(network.chainId) === chain.chainId;
  const taskOk = SEQUENCE.length === 10 || SEQUENCE.length === 11;
  const gasOk = Boolean(overrides.gasPrice && overrides.gasPrice > 0n);
  const swapOk = !swapTarget.error;

  console.log('LitVM Doctor');
  console.log(`RPC        : ${chain.rpcUrl}`);
  console.log(`Chain ID   : ${network.chainId.toString()} ${chainOk ? 'OK' : 'ERR'}`);
  console.log(`Block      : ${block}`);
  console.log(`RPC fee    : ${feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : '?'} gwei`);
  console.log(`Script fee : ${ethers.formatUnits(overrides.gasPrice, 'gwei')} gwei gasPrice ${gasOk ? 'OK' : 'ERR'}`);
  console.log(`Tasks      : ${SEQUENCE.length} ${taskOk ? 'OK' : 'ERR'}`);
  console.log(`Sequence   : ${SEQUENCE.map((task) => task.name).join(' -> ')}`);
  console.log(`Swap target: ${swapOk ? `${swapTarget.token} reserve=${swapTarget.reserve} zkLTC` : `ERR ${swapTarget.error}`}`);

  if (!chainOk || !taskOk || !gasOk || !swapOk) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('LitVM Doctor ERR:', e.shortMessage || e.message);
  process.exit(1);
});
