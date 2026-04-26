'use strict';
const { ethers } = require('ethers');
const { loadArtifact, hasArtifact } = require('../../../shared/artifacts');
const { deployMinimal } = require('./deploy');
const { shortAddr, log, randomName } = require('../../../shared/utils');
const { waitForArcTx } = require('./waitTx');

async function deployNftReal(wallet) {
  if (!hasArtifact('SimpleNFT')) {
    log('tx:deployNft', 'artifact belum ada -> fallback deployMinimal. Jalankan "npm run compile" untuk deploy NFT real.');
    return deployMinimal(wallet);
  }
  const { abi, bytecode } = loadArtifact('SimpleNFT');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  const name = `FarmNFT${randomName('N')}`;
  const symbol = randomName('FN').slice(0, 6);

  const contract = await factory.deploy(name, symbol);
  const deployTx = contract.deploymentTransaction();
  const addr = await contract.getAddress();
  await waitForArcTx(wallet, deployTx, {
    tag: 'tx:deployNft',
    sent: `${shortAddr(wallet.address)} deploy ${symbol} (${name})`,
    confirmed: `${shortAddr(wallet.address)} deploy ${symbol} (${name}) -> ${shortAddr(addr)}`,
  });

  // mint 1 NFT ke wallet sendiri biar tx-nya lebih padat
  try {
    const mintTx = await contract.mint(wallet.address);
    await waitForArcTx(wallet, mintTx, {
      tag: 'tx:mintNft',
      sent: `${shortAddr(wallet.address)} mint #1 on ${shortAddr(addr)}`,
      confirmed: `${shortAddr(wallet.address)} mint #1 on ${shortAddr(addr)}`,
    });
  } catch (e) {
    log('tx:mintNft', `mint ERR: ${e.message}`);
  }

  return { contract, address: addr, hash: deployTx.hash };
}

async function main() {
  const { loadWallets } = require('../../../shared/wallets');
  const wallets = loadWallets();
  for (const w of wallets) {
    try {
      await deployNftReal(w);
    } catch (e) {
      log('tx:deployNft', `ERR ${shortAddr(w.address)}: ${e.message}`);
    }
  }
}

module.exports = { deployNftReal };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
