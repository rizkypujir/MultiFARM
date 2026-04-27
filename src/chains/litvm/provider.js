'use strict';
const { ethers } = require('ethers');
const chain = require('./config');

let _provider;
function getProvider() {
  if (!_provider) {
    const network = ethers.Network.from(chain.chainId);
    _provider = new ethers.JsonRpcProvider(chain.rpcUrl, network, { staticNetwork: network });
  }
  return _provider;
}

function makeWallet(pk) {
  const key = pk.startsWith('0x') ? pk : '0x' + pk;
  return new ethers.Wallet(key, getProvider());
}

module.exports = { getProvider, makeWallet };
