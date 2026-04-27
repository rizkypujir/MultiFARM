'use strict';
const { ethers } = require('ethers');
const { loadArtifact, hasArtifact } = require('../../../shared/artifacts');
const { deployMinimal } = require('./deploy');
const { shortAddr, txUrl, log, randomName } = require('../../../shared/utils');
const chain = require('../config');
const { litvmTxOverrides } = require('./fees');
const { waitForLitvmTx } = require('./waitTx');
const EXPLORER = chain.explorer;

async function deployErc20Real(wallet) {
  // Fallback ke deployMinimal kalau artifact belum ada (npm run compile belum dijalankan)
  if (!hasArtifact('SimpleERC20')) {
    return deployMinimal(wallet);
  }
  const { abi, bytecode } = loadArtifact('SimpleERC20');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const name = randomName('LIT');
  const symbol = randomName('L').slice(0, 6);
  const decimals = 18;
  const supply = ethers.parseUnits('1000000', 18);
  const contract = await factory.deploy(name, symbol, decimals, supply, await litvmTxOverrides(wallet.provider));
  await waitForLitvmTx(wallet, contract.deploymentTransaction(), { tag: 'litvm:deployErc20' });
  const addr = await contract.getAddress();
  log('litvm:deployErc20', shortAddr(wallet.address), `${name}/${symbol}`, '->', addr, txUrl(contract.deploymentTransaction().hash, EXPLORER));
  return { hash: contract.deploymentTransaction().hash, address: addr, name, symbol };
}

module.exports = { deployErc20Real };
