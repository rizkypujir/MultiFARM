#!/usr/bin/env node
'use strict';
/**
 * Verify OnmiFun contracts di LitVM:
 *   - Router  : ada code? cek factory() + WETH() / WzkLTC()
 *   - Factory : cek pair zkLTC/USDC (getPair)
 *   - WzkLTC  : ERC20 standard? deposit() works?
 *   - USDC    : ERC20 standard? totalSupply
 *   - Pair    : reserves
 */
require('dotenv').config();
const { ethers } = require('ethers');
const chain = require('../src/chains/litvm/config');

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function ok(name, info = '') {
  console.log(`  ${c.green}✓${c.reset} ${name}${info ? ' ' + c.gray + info + c.reset : ''}`);
}
function fail(name, err) {
  console.log(`  ${c.red}✗${c.reset} ${name}: ${c.red}${err.message || err}${c.reset}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl, {
    name: chain.name,
    chainId: chain.chainId,
  });

  console.log('');
  console.log(c.cyan + 'OnmiFun (LitVM) — Contract verification' + c.reset);
  console.log('');

  // 1. Check code presence
  console.log('1. Contract code check:');
  for (const [name, addr] of [
    ['Router', chain.contracts.onmiFun.router],
    ['Factory', chain.contracts.onmiFun.factory],
    ['Platform', chain.contracts.onmiFun.platform],
    ['WzkLTC', chain.tokens.WzkLTC.address],
    ['USDC', chain.tokens.USDC.address],
    ['Multicall3', chain.contracts.multicall3],
  ]) {
    try {
      const code = await provider.getCode(addr);
      if (code === '0x' || code === '0x0') {
        fail(name, new Error('NO CODE at ' + addr));
      } else {
        ok(name, `${addr.slice(0, 10)}.. (${(code.length - 2) / 2} bytes)`);
      }
    } catch (e) {
      fail(name, e);
    }
  }

  // 2. Router introspection
  console.log('');
  console.log('2. Router introspection:');
  const ROUTER_ABI = [
    'function factory() view returns (address)',
    'function WETH() view returns (address)',
    'function getAmountsOut(uint256, address[]) view returns (uint256[])',
  ];
  try {
    const router = new ethers.Contract(chain.contracts.onmiFun.router, ROUTER_ABI, provider);
    const factoryFromRouter = await router.factory();
    if (factoryFromRouter.toLowerCase() === chain.contracts.onmiFun.factory.toLowerCase()) {
      ok('router.factory()', `matches config (${factoryFromRouter})`);
    } else {
      fail('router.factory()', new Error(`mismatch! got=${factoryFromRouter}, config=${chain.contracts.onmiFun.factory}`));
    }
  } catch (e) {
    fail('router.factory()', e);
  }

  try {
    const router = new ethers.Contract(chain.contracts.onmiFun.router, ROUTER_ABI, provider);
    const wzkltc = await router.WETH();
    if (wzkltc.toLowerCase() === chain.tokens.WzkLTC.address.toLowerCase()) {
      ok('router.WETH() = WzkLTC', wzkltc);
    } else {
      fail('router.WETH()', new Error(`mismatch! got=${wzkltc}, config=${chain.tokens.WzkLTC.address}`));
    }
  } catch (e) {
    fail('router.WETH()', e);
  }

  // 3. Factory: getPair WzkLTC/USDC
  console.log('');
  console.log('3. Factory getPair(WzkLTC, USDC):');
  const FACTORY_ABI = ['function getPair(address, address) view returns (address)'];
  let pairAddr;
  try {
    const factory = new ethers.Contract(chain.contracts.onmiFun.factory, FACTORY_ABI, provider);
    pairAddr = await factory.getPair(chain.tokens.WzkLTC.address, chain.tokens.USDC.address);
    if (pairAddr === ethers.ZeroAddress) {
      fail('getPair', new Error('pair does not exist (zero address)'));
    } else {
      ok('getPair WzkLTC/USDC', pairAddr);
    }
  } catch (e) {
    fail('getPair', e);
  }

  // 4. Pair reserves
  if (pairAddr && pairAddr !== ethers.ZeroAddress) {
    console.log('');
    console.log('4. Pair reserves:');
    const PAIR_ABI = [
      'function getReserves() view returns (uint112, uint112, uint32)',
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'function totalSupply() view returns (uint256)',
    ];
    try {
      const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
      const [r0, r1, ts] = await pair.getReserves();
      const t0 = await pair.token0();
      const t1 = await pair.token1();
      const totalSupply = await pair.totalSupply();
      const wzlIsToken0 = t0.toLowerCase() === chain.tokens.WzkLTC.address.toLowerCase();
      console.log(`  token0      : ${t0} ${wzlIsToken0 ? '(WzkLTC)' : '(USDC)'}`);
      console.log(`  token1      : ${t1} ${wzlIsToken0 ? '(USDC)' : '(WzkLTC)'}`);
      console.log(`  reserve0    : ${ethers.formatUnits(r0, wzlIsToken0 ? 18 : 6)}`);
      console.log(`  reserve1    : ${ethers.formatUnits(r1, wzlIsToken0 ? 6 : 18)}`);
      console.log(`  total LP    : ${ethers.formatUnits(totalSupply, 18)}`);
      console.log(`  last sync   : ${new Date(Number(ts) * 1000).toISOString()}`);
      ok('reserves', '');
    } catch (e) {
      fail('reserves', e);
    }
  }

  // 5. Token sanity
  console.log('');
  console.log('5. Token sanity:');
  const ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
  ];
  for (const [label, t] of [
    ['WzkLTC', chain.tokens.WzkLTC],
    ['USDC', chain.tokens.USDC],
  ]) {
    try {
      const tok = new ethers.Contract(t.address, ERC20_ABI, provider);
      const [name, symbol, decimals, ts] = await Promise.all([
        tok.name().catch(() => '?'),
        tok.symbol().catch(() => '?'),
        tok.decimals().catch(() => 18),
        tok.totalSupply().catch(() => 0n),
      ]);
      ok(label, `${symbol} (${name}) dec=${decimals} supply=${ethers.formatUnits(ts, decimals)}`);
    } catch (e) {
      fail(label, e);
    }
  }

  // 6. Try getAmountsOut for sanity (1 zkLTC -> USDC)
  console.log('');
  console.log('6. Quote 0.01 WzkLTC -> USDC (getAmountsOut):');
  try {
    const router = new ethers.Contract(chain.contracts.onmiFun.router, ROUTER_ABI, provider);
    const path = [chain.tokens.WzkLTC.address, chain.tokens.USDC.address];
    const amounts = await router.getAmountsOut(ethers.parseEther('0.01'), path);
    console.log(`  in=0.01 WzkLTC -> out=${ethers.formatUnits(amounts[1], 6)} USDC`);
    ok('quote works', '');
  } catch (e) {
    fail('quote', e);
  }

  console.log('');
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
