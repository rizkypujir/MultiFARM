'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log, randomName } = require('../../../shared/utils');
const chain = require('../config');
const { litvmTxOverrides } = require('./fees');
const { waitForLitvmTx } = require('./waitTx');
const EXPLORER = chain.explorer;

const TOKEN_FACTORY_ABI = [
  'function creationFee() view returns (uint256)',
  'function createToken(string name, string symbol, uint256 totalSupply, uint8 decimals, bool mintable, bool burnable, bool pausable) payable returns (address)',
  'event TokenCreated(address indexed creator, address indexed tokenAddress, string name, string symbol)',
];

/**
 * Deploy ERC20 token via Lester Labs TokenFactory.
 * NOTE: creationFee = 0.05 zkLTC (cek on-chain). Wallet harus punya saldo cukup.
 */
async function lesterCreateToken(wallet) {
  const factoryAddr = chain.contracts.lester.tokenFactory;
  const factory = new ethers.Contract(factoryAddr, TOKEN_FACTORY_ABI, wallet);

  // Cek fee (jaga-jaga kalau berubah)
  let fee;
  try {
    fee = await factory.creationFee();
  } catch (e) {
    throw new Error('cannot read creationFee: ' + e.message);
  }

  // Cek saldo cukup (fee + gas reserve)
  const nativeBal = await wallet.provider.getBalance(wallet.address);
  const gasReserve = ethers.parseEther('0.005');
  if (nativeBal < fee + gasReserve) {
    throw new Error(`insufficient zkLTC: need ${ethers.formatEther(fee + gasReserve)}, have ${ethers.formatEther(nativeBal)}`);
  }

  const name = randomName('LIT');
  const symbol = randomName('L').slice(0, 6);
  const totalSupply = ethers.parseUnits('1000000', 18); // 1M tokens
  const decimals = 18;
  const mintable = true;
  const burnable = true;
  const pausable = false;

  const tx = await factory.createToken(
    name,
    symbol,
    totalSupply,
    decimals,
    mintable,
    burnable,
    pausable,
    await litvmTxOverrides(wallet.provider, { value: fee })
  );
  const receipt = await waitForLitvmTx(wallet, tx, { tag: 'litvm:lesterToken' });

  // Try parse event untuk dapat alamat token (best-effort, tidak fatal kalau gagal)
  let tokenAddr = null;
  for (const lg of receipt.logs || []) {
    // ERC20-style Transfer(from=0x0) menunjukkan minting awal — alamat token = lg.address (kalau bukan factory)
    if (
      lg.address.toLowerCase() !== factoryAddr.toLowerCase() &&
      lg.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && // Transfer event
      lg.topics.length >= 3
    ) {
      // from address di topics[1]; kalau zero -> mint
      const fromTopic = lg.topics[1];
      if (fromTopic === '0x' + '0'.repeat(64)) {
        tokenAddr = lg.address;
        break;
      }
    }
  }

  log(
    'litvm:lesterToken',
    shortAddr(wallet.address),
    `${name}/${symbol}`,
    '->',
    tokenAddr || '(addr unknown — check tx)',
    `fee=${ethers.formatEther(fee)} zkLTC`,
    txUrl(tx.hash, EXPLORER)
  );
  return { hash: tx.hash, address: tokenAddr, name, symbol };
}

module.exports = { lesterCreateToken };
