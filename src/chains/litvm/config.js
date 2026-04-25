'use strict';
require('dotenv').config();

// LitVM LiteForge testnet (Litecoin L2 EVM rollup, Arbitrum Orbit + Caldera)
// Source: OnmiFun frontend bundle (https://app.onmi.fun) - reverse-engineered
const config = {
  key: 'litvm',
  name: 'LitVM Testnet',
  rpcUrl: process.env.LITVM_RPC_URL || 'https://liteforge.rpc.caldera.xyz/http',
  wsUrl: process.env.LITVM_WS_URL || 'wss://liteforge.rpc.caldera.xyz/ws',
  chainId: Number(process.env.LITVM_CHAIN_ID || 4441),
  explorer: process.env.LITVM_EXPLORER || 'https://liteforge.explorer.caldera.xyz',
  // Native gas token: zkLTC (18 decimals)
  nativeSymbol: 'zkLTC',
  // Token contracts di testnet
  tokens: {
    // Wrapped native (WzkLTC) — ERC20 representation of zkLTC for DEX
    WzkLTC: {
      address: '0x60A84eBC3483fEFB251B76Aea5B8458026Ef4bea',
      decimals: 18,
      symbol: 'WzkLTC',
    },
  },
  // Contract addresses untuk dApps di LitVM
  contracts: {
    // OnmiFun: Uniswap V2 fork DEX + bonding curve launchpad
    onmiFun: {
      factory: '0x9ec0eFf74A188B33C29c31849e6D37CbA6E0F586',
      router: '0xe351c47c3b96844F46e9808a7D5bBa8101BfFB57',
      platform: null, // bonding curve address not used by current menu tasks
      initCodeHash: '0x8f3e81720db33e14925a307158d291bb5d812d5cb6c34e54ecf0b33c126eab3f',
    },
    multicall3: '0xFd7e84304f83e4352a200F487b1cFF949e3e9755',
    // Lester Labs: DeFi suite (their own DEX, token factory, vesting)
    // NOTE: Lester pakai WzkLTC sendiri yang BEDA dari OnmiFun
    lester: {
      tokenFactory: '0x93acc61fcdc2e3407A0c03450Adfd8aE78964948',
      dexFactory: '0x017A126A44Aaae9273F7963D4E295F0Ee2793AD8',
      dexRouter: '0xD56a623890b083d876D47c3b1c5343b7f983FA62',
      vestingFactory: '0x6EE07118D39e9330Ef0658FFA797EeDD2CB823Cf',
      wrappedZkLtc: '0xd141A5DDE1a3A373B7e9bb603362A58793AB9D97',
    },
    // TODO: Ayni lending — cari dari aynilabs.xyz
    ayniSupply: null,
    // TODO: Midas Predict — cari dari midashand.xyz
    midasPredict: null,
  },
};

module.exports = config;
