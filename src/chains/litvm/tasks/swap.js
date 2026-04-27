'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log, pick } = require('../../../shared/utils');
const chain = require('../config');
const routerAbi = require('../abi/router');
const factoryAbi = require('../abi/factory');
const pairAbi = require('../abi/pair');
const wzkLtcAbi = require('../abi/wzkLtc');
const { litvmTxOverrides } = require('./fees');
const { waitForLitvmTx } = require('./waitTx');
const EXPLORER = chain.explorer;
const SLIPPAGE_BPS = Number(process.env.LITVM_SLIPPAGE_BPS || 500); // 5% default
const DEADLINE_SECS = 600; // 10 minutes

// Cache: pair list, token list. Refresh sekali per session.
let _cachedPairs = null;
async function getPairs(provider) {
  if (_cachedPairs) return _cachedPairs;
  const factory = new ethers.Contract(chain.contracts.onmiFun.factory, factoryAbi, provider);
  const total = Number(await factory.allPairsLength());
  // Limit ke 30 pair pertama (cukup variasi, hindari pair sampah/empty)
  const max = Math.min(total, 30);
  const pairs = [];
  for (let i = 0; i < max; i++) {
    try {
      const addr = await factory.allPairs(i);
      pairs.push(addr);
    } catch {}
  }
  _cachedPairs = pairs;
  return pairs;
}

// Cari token "swappable" (pair dengan WzkLTC, reserves > minimum) — return random pick
async function pickSwapTarget(provider, minReserveZkLTC = 0.05) {
  const pairs = await getPairs(provider);
  const wzl = chain.tokens.WzkLTC.address.toLowerCase();
  const candidates = [];
  for (const pairAddr of pairs) {
    try {
      const pair = new ethers.Contract(pairAddr, pairAbi, provider);
      const [t0, t1, reserves] = await Promise.all([
        pair.token0(),
        pair.token1(),
        pair.getReserves(),
      ]);
      const wzlIs0 = t0.toLowerCase() === wzl;
      const otherToken = wzlIs0 ? t1 : t0;
      const wzlReserve = wzlIs0 ? reserves[0] : reserves[1];
      const reserveEth = parseFloat(ethers.formatEther(wzlReserve));
      if (reserveEth >= minReserveZkLTC) {
        candidates.push({ pair: pairAddr, token: otherToken, reserve: reserveEth });
      }
    } catch {}
  }
  if (!candidates.length) throw new Error('no swappable pairs found (insufficient reserves)');
  return pick(candidates);
}

// Swap exact zkLTC (native) for some random token via router
async function swapZkLTCForToken(wallet, amountStr) {
  const amount = ethers.parseEther(String(amountStr || '0.001'));
  const target = await pickSwapTarget(wallet.provider);
  const router = new ethers.Contract(chain.contracts.onmiFun.router, routerAbi, wallet);
  const path = [chain.tokens.WzkLTC.address, target.token];
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECS;

  // Quote + slippage
  const amountsOut = await router.getAmountsOut(amount, path);
  const expectedOut = amountsOut[1];
  const minOut = (expectedOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;

  // Use SupportingFeeOnTransferTokens (memecoins often have transfer fees)
  const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
    minOut,
    path,
    wallet.address,
    deadline,
    await litvmTxOverrides(wallet.provider, { value: amount })
  );
  await waitForLitvmTx(wallet, tx, { tag: 'litvm:swap' });
  log(
    'litvm:swap',
    shortAddr(wallet.address),
    `${amountStr} zkLTC -> ~${ethers.formatUnits(expectedOut, 18)} ${target.token.slice(0, 10)}..`,
    txUrl(tx.hash, EXPLORER)
  );
  return { hash: tx.hash, token: target.token };
}

// Swap back: token (whatever held) -> zkLTC. Cek balance ke `token` yang dipakai sebelumnya.
async function swapTokenForZkLTC(wallet, tokenAddr) {
  if (!tokenAddr) {
    throw new Error('tokenAddr is required (must be a token wallet holds)');
  }
  // ERC20 balance + approval
  const erc20Abi = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ];
  const token = new ethers.Contract(tokenAddr, erc20Abi, wallet);
  const balance = await token.balanceOf(wallet.address);
  if (balance === 0n) throw new Error(`no balance of token ${tokenAddr.slice(0, 10)} to swap back`);

  // Approve router (kalau allowance < balance)
  const allowance = await token.allowance(wallet.address, chain.contracts.onmiFun.router);
  if (allowance < balance) {
    const approveTx = await token.approve(
      chain.contracts.onmiFun.router,
      ethers.MaxUint256,
      await litvmTxOverrides(wallet.provider)
    );
    await waitForLitvmTx(wallet, approveTx, { tag: 'litvm:approve' });
  }

  const router = new ethers.Contract(chain.contracts.onmiFun.router, routerAbi, wallet);
  const path = [tokenAddr, chain.tokens.WzkLTC.address];
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECS;

  // Sell 50% of balance (jangan all in case ada error/lock)
  const sellAmount = balance / 2n;
  if (sellAmount === 0n) throw new Error('balance too small to swap back');

  const amountsOut = await router.getAmountsOut(sellAmount, path);
  const expectedOut = amountsOut[1];
  const minOut = (expectedOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;

  const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
    sellAmount,
    minOut,
    path,
    wallet.address,
    deadline,
    await litvmTxOverrides(wallet.provider)
  );
  await waitForLitvmTx(wallet, tx, { tag: 'litvm:swapBack' });
  const sym = await token.symbol().catch(() => '?');
  log(
    'litvm:swapBack',
    shortAddr(wallet.address),
    `${sym} -> ~${ethers.formatEther(expectedOut)} zkLTC`,
    txUrl(tx.hash, EXPLORER)
  );
  return tx.hash;
}

module.exports = { swapZkLTCForToken, swapTokenForZkLTC, pickSwapTarget, getPairs };
