'use strict';
const { ethers } = require('ethers');
const { shortAddr, txUrl, log } = require('../../../shared/utils');
const chain = require('../config');
const routerAbi = require('../abi/router');
const factoryAbi = require('../abi/factory');
const pairAbi = require('../abi/pair');
const { litvmTxOverrides } = require('./fees');
const { waitForLitvmTx } = require('./waitTx');
const EXPLORER = chain.explorer;
// LP di OnmiFun sering kena token tax / reserve berubah. Default 0 = permissive untuk testnet farming.
const LP_MIN_BPS = Number(process.env.LITVM_LP_MIN_BPS || 0);
const DEADLINE_SECS = 600;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

/**
 * Add liquidity ke pool zkLTC/token (V2 router addLiquidityETH).
 * Asumsi: wallet udah punya saldo `tokenAddr`. Pakai balance/2 untuk sisain swap-back.
 * Hitung amountETH dari current pool ratio (biar gak dump price).
 */
async function addLiquidityZkLTC(wallet, tokenAddr) {
  if (!tokenAddr) throw new Error('tokenAddr required');

  const router = new ethers.Contract(chain.contracts.onmiFun.router, routerAbi, wallet);
  const factory = new ethers.Contract(chain.contracts.onmiFun.factory, factoryAbi, wallet);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);

  // Cek balance token
  const balance = await token.balanceOf(wallet.address);
  if (balance === 0n) throw new Error('no token balance to add LP');

  // Pakai 50% balance, sisain buat swap back / future
  const amountTokenDesired = balance / 2n;
  if (amountTokenDesired === 0n) throw new Error('balance too small for LP');

  // Get current reserves untuk hitung amountETH yang sesuai dengan ratio
  const pairAddr = await factory.getPair(tokenAddr, chain.tokens.WzkLTC.address);
  if (pairAddr === ethers.ZeroAddress) throw new Error('pair does not exist for ' + tokenAddr.slice(0, 10));

  const pair = new ethers.Contract(pairAddr, pairAbi, wallet.provider);
  const [r0, r1] = await pair.getReserves();
  const t0 = await pair.token0();
  const tokenIs0 = t0.toLowerCase() === tokenAddr.toLowerCase();
  const reserveToken = tokenIs0 ? r0 : r1;
  const reserveEth = tokenIs0 ? r1 : r0;

  // amountETH = amountTokenDesired * reserveEth / reserveToken
  if (reserveToken === 0n) throw new Error('zero reserve');
  let amountETH = (amountTokenDesired * reserveEth) / reserveToken;
  // Add small safety margin (1%) supaya quoteRatio gak miss
  amountETH = (amountETH * 101n) / 100n;

  // Cek wallet ada cukup zkLTC
  const nativeBal = await wallet.provider.getBalance(wallet.address);
  // Reserve 0.005 zkLTC for gas
  const gasReserve = ethers.parseEther('0.005');
  if (nativeBal < amountETH + gasReserve) {
    throw new Error(`insufficient zkLTC: need ${ethers.formatEther(amountETH + gasReserve)}, have ${ethers.formatEther(nativeBal)}`);
  }

  // Approve router untuk spend token (kalau allowance kurang)
  const allowance = await token.allowance(wallet.address, chain.contracts.onmiFun.router);
  if (allowance < amountTokenDesired) {
    const approveTx = await token.approve(
      chain.contracts.onmiFun.router,
      ethers.MaxUint256,
      await litvmTxOverrides(wallet.provider)
    );
    await waitForLitvmTx(wallet, approveTx, { tag: 'litvm:approveLPToken' });
  }

  // Slippage/min tolerance. Default 0 supaya token random/tax token tidak gampang revert.
  const amountTokenMin = (amountTokenDesired * BigInt(Math.max(0, LP_MIN_BPS))) / 10000n;
  const amountETHMin = (amountETH * BigInt(Math.max(0, LP_MIN_BPS))) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECS;

  const tx = await router.addLiquidityETH(
    tokenAddr,
    amountTokenDesired,
    amountTokenMin,
    amountETHMin,
    wallet.address,
    deadline,
    await litvmTxOverrides(wallet.provider, { value: amountETH })
  );
  await waitForLitvmTx(wallet, tx, { tag: 'litvm:addLP' });

  const sym = await token.symbol().catch(() => '?');
  log(
    'litvm:addLP',
    shortAddr(wallet.address),
    `${ethers.formatEther(amountETH)} zkLTC + ${sym} -> LP`,
    txUrl(tx.hash, EXPLORER)
  );
  return { hash: tx.hash, pairAddr, tokenAddr };
}

/**
 * Remove liquidity dari pool zkLTC/token (V2 router removeLiquidityETH).
 * Asumsi: wallet punya LP token (pair). Burn 50% LP, sisain.
 */
async function removeLiquidityZkLTC(wallet, tokenAddr) {
  if (!tokenAddr) throw new Error('tokenAddr required');

  const router = new ethers.Contract(chain.contracts.onmiFun.router, routerAbi, wallet);
  const factory = new ethers.Contract(chain.contracts.onmiFun.factory, factoryAbi, wallet);

  const pairAddr = await factory.getPair(tokenAddr, chain.tokens.WzkLTC.address);
  if (pairAddr === ethers.ZeroAddress) throw new Error('pair does not exist');

  const pair = new ethers.Contract(pairAddr, [...pairAbi, ...ERC20_ABI], wallet);
  const lpBalance = await pair.balanceOf(wallet.address);
  if (lpBalance === 0n) throw new Error('no LP token balance');

  // Burn 50% LP, sisain
  const liquidity = lpBalance / 2n;
  if (liquidity === 0n) throw new Error('LP balance too small');

  // Approve router for LP token
  const allowance = await pair.allowance(wallet.address, chain.contracts.onmiFun.router);
  if (allowance < liquidity) {
    const approveTx = await pair.approve(
      chain.contracts.onmiFun.router,
      ethers.MaxUint256,
      await litvmTxOverrides(wallet.provider)
    );
    await waitForLitvmTx(wallet, approveTx, { tag: 'litvm:approveLP' });
  }

  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECS;
  // Use 0 mins (slippage acceptable for testnet)
  const tx = await router.removeLiquidityETH(
    tokenAddr,
    liquidity,
    0,
    0,
    wallet.address,
    deadline,
    await litvmTxOverrides(wallet.provider)
  );
  await waitForLitvmTx(wallet, tx, { tag: 'litvm:removeLP' });

  const tokenC = new ethers.Contract(tokenAddr, ERC20_ABI, wallet.provider);
  const sym = await tokenC.symbol().catch(() => '?');
  log(
    'litvm:removeLP',
    shortAddr(wallet.address),
    `${ethers.formatEther(liquidity)} LP (${sym}/zkLTC) -> burned`,
    txUrl(tx.hash, EXPLORER)
  );
  return { hash: tx.hash, pairAddr };
}

module.exports = { addLiquidityZkLTC, removeLiquidityZkLTC };
