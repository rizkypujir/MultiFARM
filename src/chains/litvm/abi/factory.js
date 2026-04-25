'use strict';
// UniswapV2Factory-compatible (OnmiFun)
module.exports = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
  'function allPairs(uint256) view returns (address pair)',
  'function allPairsLength() view returns (uint256)',
  'function createPair(address tokenA, address tokenB) returns (address pair)',
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint256)',
];
