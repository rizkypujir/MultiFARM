#!/usr/bin/env node
'use strict';
/**
 * Test LitVM tasks individually (dry-run mode + live execution).
 *
 * Usage:
 *   node scripts/testLitvm.js --task transfer            # selfTransferZkLTC
 *   node scripts/testLitvm.js --task wrap                # wrapZkLTC
 *   node scripts/testLitvm.js --task unwrap              # unwrapZkLTC
 *   node scripts/testLitvm.js --task swap                # swapZkLTCForToken
 *   node scripts/testLitvm.js --task swapBack <token>    # swap back to zkLTC
 *   node scripts/testLitvm.js --task deploy              # deployMinimal
 *   node scripts/testLitvm.js --task all                 # full SEQUENCE end-to-end
 *   node scripts/testLitvm.js --task balance             # just check balance
 *
 * Default wallet = wallet #0 di wallets.txt. Override pakai --wallet <index>.
 * Default amount kecil2 (0.0001 zkLTC) supaya gas hemat.
 */

require('dotenv').config();
const { ethers } = require('ethers');
const { loadPrivateKeys } = require('../src/shared/wallets');
const chain = require('../src/chains/litvm/config');
const { getProvider } = require('../src/chains/litvm/provider');

const transfer = require('../src/chains/litvm/tasks/transfer');
const wrap = require('../src/chains/litvm/tasks/wrap');
const swap = require('../src/chains/litvm/tasks/swap');
const deploy = require('../src/chains/litvm/tasks/deploy');
const liquidity = require('../src/chains/litvm/tasks/liquidity');
const lester = require('../src/chains/litvm/tasks/lester');

const c = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { task: null, walletIdx: 0, amount: null, tokenAddr: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task') args.task = argv[++i];
    else if (argv[i] === '--wallet') args.walletIdx = parseInt(argv[++i], 10);
    else if (argv[i] === '--amount') args.amount = argv[++i];
    else if (argv[i] === '--token') args.tokenAddr = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  if (!args.task) {
    console.log('Usage: node scripts/testLitvm.js --task <transfer|wrap|unwrap|swap|swapBack|deploy|all|balance>');
    process.exit(1);
  }

  const pks = loadPrivateKeys();
  if (args.walletIdx >= pks.length) {
    console.error(`Wallet index ${args.walletIdx} out of range (have ${pks.length})`);
    process.exit(1);
  }
  const pk = pks[args.walletIdx];
  const provider = getProvider();
  const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider);

  console.log('');
  console.log(c.cyan + `LitVM Task Test — wallet[${args.walletIdx}] = ${wallet.address}` + c.reset);
  console.log(c.gray + `RPC: ${chain.rpcUrl}` + c.reset);

  // Pre-check balance
  const native = await provider.getBalance(wallet.address);
  console.log(c.gray + `zkLTC balance: ${ethers.formatEther(native)}` + c.reset);
  if (native < ethers.parseEther('0.001') && args.task !== 'balance') {
    console.log(c.red + 'WARNING: balance very low, task may fail. Faucet first.' + c.reset);
  }
  console.log('');

  try {
    if (args.task === 'balance') {
      const wzlAbi = ['function balanceOf(address) view returns (uint256)'];
      const wzl = new ethers.Contract(chain.tokens.WzkLTC.address, wzlAbi, provider);
      const wzlBal = await wzl.balanceOf(wallet.address);
      console.log(`  Native zkLTC : ${ethers.formatEther(native)}`);
      console.log(`  WzkLTC       : ${ethers.formatEther(wzlBal)}`);
    } else if (args.task === 'transfer') {
      console.log(c.yellow + 'Running selfTransferZkLTC...' + c.reset);
      await transfer.selfTransferZkLTC(wallet, args.amount || '0.0001');
    } else if (args.task === 'randomTransfer') {
      console.log(c.yellow + 'Running randomTransferZkLTC...' + c.reset);
      await transfer.randomTransferZkLTC(wallet, args.amount || '0.0001');
    } else if (args.task === 'wrap') {
      console.log(c.yellow + 'Running wrapZkLTC...' + c.reset);
      await wrap.wrapZkLTC(wallet, args.amount || '0.001');
    } else if (args.task === 'unwrap') {
      console.log(c.yellow + 'Running unwrapZkLTC...' + c.reset);
      await wrap.unwrapZkLTC(wallet, args.amount || '0.0005');
    } else if (args.task === 'swap') {
      console.log(c.yellow + 'Running swapZkLTCForToken...' + c.reset);
      const r = await swap.swapZkLTCForToken(wallet, args.amount || '0.0005');
      console.log(c.green + `Swapped! token=${r.token}` + c.reset);
      console.log(c.gray + `Use this for swapBack: --task swapBack --token ${r.token}` + c.reset);
    } else if (args.task === 'swapBack') {
      if (!args.tokenAddr) throw new Error('--token <address> required for swapBack');
      console.log(c.yellow + `Running swapTokenForZkLTC (${args.tokenAddr})...` + c.reset);
      await swap.swapTokenForZkLTC(wallet, args.tokenAddr);
    } else if (args.task === 'deploy') {
      console.log(c.yellow + 'Running deployMinimal...' + c.reset);
      const r = await deploy.deployMinimal(wallet);
      console.log(c.green + `Deployed at ${r.address}` + c.reset);
    } else if (args.task === 'addLP') {
      if (!args.tokenAddr) throw new Error('--token <address> required for addLP');
      console.log(c.yellow + `Running addLiquidityZkLTC (${args.tokenAddr})...` + c.reset);
      const r = await liquidity.addLiquidityZkLTC(wallet, args.tokenAddr);
      console.log(c.green + `LP added! pair=${r.pairAddr}` + c.reset);
    } else if (args.task === 'removeLP') {
      if (!args.tokenAddr) throw new Error('--token <address> required for removeLP');
      console.log(c.yellow + `Running removeLiquidityZkLTC (${args.tokenAddr})...` + c.reset);
      await liquidity.removeLiquidityZkLTC(wallet, args.tokenAddr);
    } else if (args.task === 'lester') {
      console.log(c.yellow + 'Running lesterCreateToken (fee 0.05 zkLTC)...' + c.reset);
      const r = await lester.lesterCreateToken(wallet);
      console.log(c.green + `Token deployed at ${r.address}` + c.reset);
    } else if (args.task === 'all') {
      // Run all in sequence (simulasi farm) — mirror SEQUENCE in farm.js
      console.log(c.yellow + '[1/11] selfTransferZkLTC' + c.reset);
      await transfer.selfTransferZkLTC(wallet, '0.0001');
      console.log(c.yellow + '[2/11] randomTransferZkLTC' + c.reset);
      await transfer.randomTransferZkLTC(wallet, '0.0001');
      console.log(c.yellow + '[3/11] wrapZkLTC 0.001' + c.reset);
      await wrap.wrapZkLTC(wallet, '0.001');
      console.log(c.yellow + '[4/11] swapZkLTCForToken 0.001' + c.reset);
      const sw = await swap.swapZkLTCForToken(wallet, '0.001');
      console.log(c.yellow + '[5/11] addLiquidityLP' + c.reset);
      try { await liquidity.addLiquidityZkLTC(wallet, sw.token); } catch (e) { console.log(c.red + 'addLP failed: ' + e.message + c.reset); }
      console.log(c.yellow + '[6/11] removeLiquidityLP' + c.reset);
      try { await liquidity.removeLiquidityZkLTC(wallet, sw.token); } catch (e) { console.log(c.red + 'removeLP failed: ' + e.message + c.reset); }
      console.log(c.yellow + '[7/11] swapTokenForZkLTC' + c.reset);
      try { await swap.swapTokenForZkLTC(wallet, sw.token); } catch (e) { console.log(c.red + 'swapBack failed: ' + e.message + c.reset); }
      console.log(c.yellow + '[8/11] unwrapZkLTC 0.0005' + c.reset);
      await wrap.unwrapZkLTC(wallet, '0.0005');
      console.log(c.yellow + '[9/11] deployMinimal' + c.reset);
      await deploy.deployMinimal(wallet);
      console.log(c.yellow + '[10/11] deployErc20Real (fallback minimal)' + c.reset);
      const { deployErc20Real } = require('../src/chains/litvm/tasks/deployErc20Real');
      await deployErc20Real(wallet);
      console.log(c.yellow + '[11/11] wrapZkLTC #2' + c.reset);
      await wrap.wrapZkLTC(wallet, '0.001');
    } else {
      console.error(c.red + 'Unknown task: ' + args.task + c.reset);
      process.exit(1);
    }
    console.log('');
    console.log(c.green + '✓ Done.' + c.reset);
  } catch (e) {
    console.log('');
    console.error(c.red + '✗ Error: ' + (e.shortMessage || e.message) + c.reset);
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
  }
}

main();
