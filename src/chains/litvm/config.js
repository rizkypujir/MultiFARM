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
    // USDC stable token (verified from OnmiFun bundle)
    USDC: {
      address: '0x76f7747568e7c5c110230ab4e45af90cffcc0753',
      decimals: 6,
      symbol: 'USDC',
    },
  },
  // Contract addresses untuk dApps di LitVM
  contracts: {
    // OnmiFun: Uniswap V2 fork DEX + bonding curve launchpad
    onmiFun: {
      factory: '0x9ec0eFf74A188B33C29c31849e6D37CbA6E0F586',
      router: '0xe351c47c3b96844F46e9808a7D5bBa8101BfFB57',
      platform: '0x174F8a75F9acf9c2DBb4aD20482Ab4bC4c41828C', // bonding curve
      initCodeHash: '0x8f3e81720db33e14925a307158d291bb5d812d5cb6c34e54ecf0b33c126eab3f',
    },
    multicall3: '0xFd7e84304f83e4352a200F487b1cFF949e3e9755',
    // TODO: Lester Labs token factory — cari dari lester-labs.com
    lesterFactory: null,
    // TODO: Ayni lending — cari dari aynilabs.xyz
    ayniSupply: null,
    // TODO: Midas Predict — cari dari midashand.xyz
    midasPredict: null,
  },
};

module.exports = config;
