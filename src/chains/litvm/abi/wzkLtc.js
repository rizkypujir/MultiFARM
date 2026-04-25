'use strict';
// WzkLTC = wrapped native zkLTC (WETH-style ERC20)
// 0x60A84eBC3483fEFB251B76Aea5B8458026Ef4bea on LitVM testnet
module.exports = [
  // Standard ERC20
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  // WETH-specific
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'event Deposit(address indexed dst, uint256 wad)',
  'event Withdrawal(address indexed src, uint256 wad)',
];
