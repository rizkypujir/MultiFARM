'use strict';
/**
 * Diagnostic 1 wallet — cek balance, nonce, pending tx.
 * Usage: node scripts/diagWallet.js <full_address_or_prefix>
 *   node scripts/diagWallet.js 0xe7d0
 *   node scripts/diagWallet.js 0xe7d0123...full
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Default ke Arc, override pakai --chain litvm
const chainArg = process.argv.includes('--chain') ? process.argv[process.argv.indexOf('--chain') + 1] : 'arc';
const chain = require(`../src/chains/${chainArg}/config`);

async function main() {
  const arg = (process.argv[2] || '').toLowerCase();
  if (!arg) {
    console.error('Usage: node scripts/diagWallet.js <address-or-prefix>');
    process.exit(1);
  }

  // Resolve full address dari wallets.addresses.txt
  let target = arg;
  if (!/^0x[0-9a-f]{40}$/.test(arg)) {
    const fp = path.join(__dirname, '..', 'wallets.addresses.txt');
    if (fs.existsSync(fp)) {
      // Extract address from each line (file may have "1. 0xabc..." format)
      const list = fs.readFileSync(fp, 'utf8')
        .split(/\r?\n/)
        .map((s) => {
          const m = s.match(/0x[0-9a-fA-F]{40}/);
          return m ? m[0] : null;
        })
        .filter(Boolean);
      const matches = list.filter((a) => a.toLowerCase().includes(arg.replace(/^0x/, '')));
      if (matches.length === 0) {
        console.error(`No wallet matches "${arg}" in wallets.addresses.txt`);
        process.exit(1);
      }
      if (matches.length > 1) {
        console.error(`Ambiguous "${arg}", matches:`);
        matches.forEach((m) => console.error('  ' + m));
        process.exit(1);
      }
      target = matches[0];
    }
  }

  // staticNetwork supaya ethers gak coba ENS resolution
  const network = new ethers.Network('arc-testnet', chain.chainId);
  const p = new ethers.JsonRpcProvider(chain.rpcUrl, network, { staticNetwork: network });
  target = ethers.getAddress(target);
  const erc20 = ['function balanceOf(address) view returns (uint256)'];

  const baseQueries = [
    p.getBalance(target),
    p.getTransactionCount(target, 'latest'),
    p.getTransactionCount(target, 'pending'),
  ];
  const tokenEntries = Object.entries(chain.tokens || {});
  const tokenQueries = tokenEntries.map(([, t]) =>
    new ethers.Contract(t.address, erc20, p).balanceOf(target).catch(() => 0n)
  );
  const results = await Promise.all([...baseQueries, ...tokenQueries]);
  const native = results[0];
  const latNonce = results[1];
  const penNonce = results[2];
  const tokenBalances = results.slice(3);
  const stuck = penNonce - latNonce;

  console.log('');
  console.log(`═══ Wallet diagnostic — ${chain.name || chainArg} ═══`);
  console.log(`address     : ${target}`);
  console.log(`native bal  : ${ethers.formatEther(native)} (${chain.nativeSymbol || 'native'})`);
  tokenEntries.forEach(([sym, t], i) => {
    console.log(`${sym.padEnd(12)}: ${ethers.formatUnits(tokenBalances[i], t.decimals || 18)}`);
  });
  console.log(`nonce latest: ${latNonce}`);
  console.log(`nonce pend  : ${penNonce}`);
  console.log(`stuck tx    : ${stuck}  ${stuck > 0 ? '⚠️  TX PENDING DI MEMPOOL' : 'ok'}`);

  if (stuck > 0) {
    console.log('');
    console.log('Cara unstuck: kirim self-tx dengan gas price tinggi pakai nonce stuck.');
    console.log(`Pakai: node scripts/cancelStuck.js ${target}  (kalau script ada)`);
    console.log('Atau MetaMask: import wallet -> Settings -> Advanced -> Reset account.');
  }
  console.log('');
}

main().catch((e) => {
  console.error('error:', e.shortMessage || e.message);
  process.exit(1);
});
