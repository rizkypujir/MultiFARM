'use strict';
const { ethers } = require('ethers');
const { shortAddr } = require('../../../shared/utils');
const { waitForArcTx } = require('./waitTx');

const MINIMAL_INIT_CODE = '0x6001600c60003960016000f300';

async function deployMinimal(wallet) {
  const nonce = ethers.hexlify(ethers.randomBytes(4)).slice(2);
  const data = MINIMAL_INIT_CODE + nonce;
  const tx = await wallet.sendTransaction({ data });
  return waitForArcTx(wallet, tx, {
    tag: 'tx:deploy',
    sent: `${shortAddr(wallet.address)} deploying minimal`,
    confirmed: (receipt) => `${shortAddr(wallet.address)} deployed -> ${shortAddr(receipt.contractAddress || '')}`,
  });
}

module.exports = { deployMinimal, MINIMAL_INIT_CODE };
