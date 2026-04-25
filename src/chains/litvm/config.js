'use strict';
require('dotenv').config();

// LitVM LiteForge testnet (Litecoin L2 EVM rollup, Arbitrum Orbit + Caldera)
const config = {
  key: 'litvm',
  name: 'LitVM Testnet',
  rpcUrl: process.env.LITVM_RPC_URL || 'https://liteforge.rpc.caldera.xyz/http',
  wsUrl: process.env.LITVM_WS_URL || 'wss://liteforge.rpc.caldera.xyz/ws',
  chainId: Number(process.env.LITVM_CHAIN_ID || 4441),
  explorer: process.env.LITVM_EXPLORER || 'https://liteforge.explorer.caldera.xyz',
  // Native gas token: zkLTC (18 decimals)
  nativeSymbol: 'zkLTC',
  // Token contracts di testnet (akan di-fill saat task LitVM ready)
  tokens: {
    // Contoh dari OmniFun pair:
    USDC: { address: '0xFC73cdB75F37B0da829c4e54511f410D525B76b2', decimals: 6 },
  },
  // Contract addresses untuk dApps
  contracts: {
    // OmniFun DEX router/factory — TODO: cari address dari frontend
    omniFun: null,
    // Lester Labs token factory — TODO
    lesterFactory: null,
    // Ayni lending — TODO
    ayniSupply: null,
  },
};

module.exports = config;
