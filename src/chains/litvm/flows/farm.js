'use strict';
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { ethers } = require('ethers');
const chain = require('../config');
const { loadPrivateKeys } = require('../../../shared/wallets');
const { getProvider } = require('../provider');
const { shortAddr, randDelay, withRetry } = require('../../../shared/utils');
const { logFile: rawLogFile } = require('../../../shared/logger');
const logFile = rawLogFile.withChain('litvm');
const consoleCapture = require('../../../shared/consoleCapture');
const tg = require('../../../shared/telegram');

// Tasks
const transfer = require('../tasks/transfer');
const wrap = require('../tasks/wrap');
const swap = require('../tasks/swap');
const deploy = require('../tasks/deploy');
const { deployErc20Real } = require('../tasks/deployErc20Real');
const liquidity = require('../tasks/liquidity');
const lester = require('../tasks/lester');

// Progress file per-chain
const PROGRESS_FILE = path.join(__dirname, '..', '..', '..', '..', '.progress.litvm.json');

function loadProgress(totalWallets) {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    const ageH = (Date.now() - (p.startedAt || 0)) / 3600000;
    if (p.total !== totalWallets || ageH > 24) return null;
    return p;
  } catch {
    return null;
  }
}

function saveProgress(p) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
  } catch (e) {
    logFile('progress:err', 'save failed: ' + e.message);
  }
}

function clearProgress() {
  try { fs.unlinkSync(PROGRESS_FILE); } catch {}
}

// Load wallets bound ke LitVM provider
function loadLitvmWallets() {
  const pks = loadPrivateKeys();
  if (!pks.length) throw new Error('Tidak ada private key.');
  const provider = getProvider();
  return pks.map((pk) => {
    const key = pk.startsWith('0x') ? pk : '0x' + pk;
    return new ethers.Wallet(key, provider);
  });
}

// === Task amounts (env-tunable) ===
const SELF_ZKLTC = process.env.LITVM_SELF_TX_AMOUNT || '0.0001';
const WRAP_AMOUNT = process.env.LITVM_WRAP_AMOUNT || '0.001';
const UNWRAP_AMOUNT = process.env.LITVM_UNWRAP_AMOUNT || '0.0005';
const SWAP_AMOUNT = process.env.LITVM_SWAP_AMOUNT || '0.0005';
const DELAY_MIN = Number(process.env.DELAY_MIN_MS || 1500);
const DELAY_MAX = Number(process.env.DELAY_MAX_MS || 4000);
// Min native balance to farm (zkLTC). Each wallet needs ~0.01 zkLTC for full sequence.
const MIN_ZKLTC_FARM = process.env.LITVM_MIN_ZKLTC_FARM || '0.01';
const BATCH_SIZE = Number(process.env.LITVM_BATCH_SIZE || process.env.BATCH_SIZE || 3);
const WALLET_DEADLINE_MS = Number(process.env.WALLET_DEADLINE_MS || 600000);

// Shared state across wallet (per-cycle): swap target token cache (untuk LP/swapBack reuse)
const walletSwapState = new Map(); // addr -> { tokenAddr } (last bought token)

// Optional task toggles
const INCLUDE_LESTER = String(process.env.LITVM_INCLUDE_LESTER || 'false').toLowerCase() === 'true';

// SEQUENCE — task per wallet, sequential
// Default ~10 tasks (~0.005 zkLTC per wallet per cycle without Lester)
// With LITVM_INCLUDE_LESTER=true: +1 task (lesterCreateToken, +0.05 zkLTC fee)
const SEQUENCE = [
  // 1. Native transfer to a random address (no self-transfer)
  { name: 'randomTransferZkLTC', fn: (w) => transfer.randomTransferZkLTC(w, SELF_ZKLTC) },

  // 2. Wrap zkLTC -> WzkLTC
  { name: 'wrapZkLTC', fn: (w) => wrap.wrapZkLTC(w, WRAP_AMOUNT) },

  // 3. Swap zkLTC -> random memecoin via OnmiFun router (cache token for next tasks)
  {
    name: 'swapZkLTCForToken',
    fn: async (w) => {
      const r = await swap.swapZkLTCForToken(w, SWAP_AMOUNT);
      walletSwapState.set(w.address.toLowerCase(), { tokenAddr: r.token });
      return r;
    },
  },

  // 4. Add liquidity (use 50% token balance + matching zkLTC)
  {
    name: 'addLiquidityLP',
    fn: async (w) => {
      const st = walletSwapState.get(w.address.toLowerCase());
      if (!st || !st.tokenAddr) throw new Error('no swap-state token for addLP');
      return liquidity.addLiquidityZkLTC(w, st.tokenAddr);
    },
  },

  // 5. Remove liquidity (burn 50% LP, get back zkLTC + token)
  {
    name: 'removeLiquidityLP',
    fn: async (w) => {
      const st = walletSwapState.get(w.address.toLowerCase());
      if (!st || !st.tokenAddr) throw new Error('no swap-state token for removeLP');
      return liquidity.removeLiquidityZkLTC(w, st.tokenAddr);
    },
  },

  // 6. Swap remaining token back to zkLTC
  {
    name: 'swapTokenBack',
    fn: async (w) => {
      const st = walletSwapState.get(w.address.toLowerCase());
      if (!st || !st.tokenAddr) throw new Error('no swap-state token for swapBack');
      return swap.swapTokenForZkLTC(w, st.tokenAddr);
    },
  },

  // 7. Unwrap setelah ada saldo WzkLTC
  { name: 'unwrapZkLTC', fn: (w) => wrap.unwrapZkLTC(w, UNWRAP_AMOUNT) },

  // 8. Deploy minimal contract
  { name: 'deployMinimal', fn: (w) => deploy.deployMinimal(w) },

  // 9. Deploy ERC20 (fallback ke minimal kalau artifact gak ada)
  { name: 'deployErc20', fn: (w) => deployErc20Real(w) },

  // 10. Wrap lagi (extra volume)
  { name: 'wrapZkLTC#2', fn: (w) => wrap.wrapZkLTC(w, WRAP_AMOUNT) },

  // 11. (optional) Lester Labs token deploy fee 0.05 zkLTC
  ...(INCLUDE_LESTER ? [{ name: 'lesterCreateToken', fn: (w) => lester.lesterCreateToken(w) }] : []),
];

async function checkWalletFunded(wallet) {
  try {
    const bal = await wallet.provider.getBalance(wallet.address);
    const min = ethers.parseEther(MIN_ZKLTC_FARM);
    return { funded: bal >= min, balance: ethers.formatEther(bal) };
  } catch {
    return { funded: true, balance: '?' };
  }
}

async function runWallet(wallet, onTask) {
  const short = shortAddr(wallet.address);
  let ok = 0;
  let fail = 0;
  const t0 = Date.now();

  const chk = await checkWalletFunded(wallet);
  if (!chk.funded) {
    logFile('wallet:skip', `${wallet.address} skipped: zkLTC=${chk.balance} < ${MIN_ZKLTC_FARM}`);
    return { ok: 0, fail: 0, skipped: true, secs: '0.0', addr: wallet.address, balance: chk.balance };
  }

  let deadlineHit = false;
  for (let i = 0; i < SEQUENCE.length; i++) {
    const t = SEQUENCE[i];

    if (Date.now() - t0 > WALLET_DEADLINE_MS) {
      deadlineHit = true;
      const remaining = SEQUENCE.length - i;
      logFile('wallet:deadline', `${wallet.address} hit ${WALLET_DEADLINE_MS}ms deadline at ${i + 1}/${SEQUENCE.length}, skip ${remaining} remaining`);
      fail += remaining;
      break;
    }

    if (onTask) onTask({ addr: wallet.address, taskIdx: i + 1, taskTotal: SEQUENCE.length, taskName: t.name });

    try {
      await withRetry(() => t.fn(wallet), { retries: 3, baseDelayMs: 3000, label: `${short}:${t.name}` });
      ok++;
      logFile('task:ok', `${wallet.address} ${t.name}`);
    } catch (e) {
      fail++;
      logFile('task:fail', `${wallet.address} ${t.name} :: ${e.shortMessage || e.message}`);
    }
    if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
  }

  // Cleanup wallet swap state
  walletSwapState.delete(wallet.address.toLowerCase());

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  return { ok, fail, secs, addr: wallet.address, deadlineHit };
}

async function runFarmOnce(options = {}) {
  const quiet = Boolean(options.quiet);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const emitProgress = (data) => {
    if (!onProgress) return;
    try {
      onProgress({ chain: 'litvm', ...data });
    } catch {}
  };

  const wallets = loadLitvmWallets();
  const total = wallets.length;

  const prev = loadProgress(total);
  const results = prev?.results || [];
  const doneSet = new Set(results.map((r) => String(r.addr || '').toLowerCase()).filter(Boolean));
  const cycleStart = prev?.startedAt || Date.now();

  const pending = wallets.filter((w) => !doneSet.has(w.address.toLowerCase()));

  emitProgress({ status: 'starting', current: 0, total: SEQUENCE.length, walletsDone: doneSet.size, walletsTotal: total });

  if (!quiet) {
    console.log('');
    if (prev && doneSet.size > 0) {
      console.log(chalk.yellow(`[LitVM] Resuming cycle — ${doneSet.size}/${total} done, ${pending.length} remaining`));
    } else {
      console.log(chalk.cyan(`[LitVM] Starting cycle — ${total} wallet(s) × ${SEQUENCE.length} tasks  |  batch=${BATCH_SIZE}`));
    }
    console.log('');
  }

  if (tg.isEnabled()) {
    const msg = prev && doneSet.size > 0
      ? `♻️ <b>LitVM Farm cycle resumed</b>\nDone: ${doneSet.size}/${total} | Remaining: ${pending.length}`
      : `🚀 <b>LitVM Farm cycle started</b>\nWallets: ${total} | Tasks/wallet: ${SEQUENCE.length} | Batch: ${BATCH_SIZE}`;
    await tg.sendMessage(msg);
  }

  const spinner = quiet ? null : ora({ text: '[LitVM] starting...' }).start();

  await consoleCapture.capture('litvm', async () => {
  saveProgress({ startedAt: cycleStart, total, done: Array.from(doneSet), results });

  const liveTasks = new Map();
  let completed = doneSet.size;
  let nextIdx = 0;
  const concurrency = Math.min(BATCH_SIZE, pending.length);

  const renderSpinner = () => {
    const live = [...liveTasks.entries()]
      .map(([addr, t]) => `${shortAddr(addr)}[${t.taskIdx}/${t.taskTotal}]`)
      .join(' ');
    const activeTasks = [...liveTasks.values()];
    const current = activeTasks.length
      ? Math.max(...activeTasks.map((t) => t.taskIdx))
      : completed >= total ? SEQUENCE.length : 0;
    emitProgress({
      status: completed >= total ? 'done' : 'running',
      current,
      total: SEQUENCE.length,
      walletsDone: completed,
      walletsTotal: total,
      activeWallets: liveTasks.size,
    });
    if (spinner) {
      spinner.text = `[LitVM] done=${completed}/${total}  pool=${liveTasks.size}/${concurrency}  active: ${live || '-'}`;
    }
  };

  const onTask = (info) => {
    liveTasks.set(info.addr, info);
    renderSpinner();
  };

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= pending.length) return;
      const w = pending[i];

      try {
        const r = await runWallet(w, onTask);
        results.push(r);
      } catch (e) {
        results.push({ addr: w.address, ok: 0, fail: SEQUENCE.length, secs: '0', error: e?.message });
        logFile('wallet:err', `${w.address} :: ${e?.message}`);
      } finally {
        doneSet.add(w.address.toLowerCase());
        liveTasks.delete(w.address);
        completed++;
        renderSpinner();
        saveProgress({ startedAt: cycleStart, total, done: Array.from(doneSet), results });
      }
    }
  }

  const workers = Array.from({ length: concurrency || 1 }, () => worker());
  await Promise.all(workers);
  });

  const totalOk = results.reduce((a, r) => a + r.ok, 0);
  const totalFail = results.reduce((a, r) => a + r.fail, 0);
  const skipped = results.filter((r) => r.skipped).length;
  const active = total - skipped;
  const cycleSecs = ((Date.now() - cycleStart) / 1000).toFixed(1);
  const fullyOk = results.filter((r) => !r.skipped && r.fail === 0).length;

  emitProgress({
    status: 'done',
    current: SEQUENCE.length,
    total: SEQUENCE.length,
    walletsDone: total,
    walletsTotal: total,
    activeWallets: 0,
    ok: totalOk,
    fail: totalFail,
  });

  if (!quiet) {
    spinner.stopAndPersist({
      symbol: totalFail === 0 ? chalk.green('✔') : chalk.yellow('!'),
      text: `[LitVM] cycle done  ${fullyOk}/${active} fully ok  |  skipped=${skipped}  ok=${totalOk} fail=${totalFail}  |  ${cycleSecs}s`,
    });

    console.log('');
    results.forEach((r, i) => {
      const idx = String(i + 1).padStart(2);
      let mark, line;
      if (r.skipped) {
        mark = chalk.gray('○');
        line = `  ${mark} ${idx}  ${shortAddr(r.addr)}  ${chalk.gray(`SKIPPED (zkLTC=${r.balance} < ${MIN_ZKLTC_FARM})`)}`;
      } else {
        mark = r.fail === 0 ? chalk.green('✔') : chalk.yellow('!');
        line = `  ${mark} ${idx}  ${shortAddr(r.addr)}  ok=${r.ok} fail=${r.fail}  (${r.secs}s)`;
      }
      console.log(line);
    });
    console.log('');
  }

  if (tg.isEnabled()) {
    await tg.sendMessage(
      `🏁 <b>LitVM Farm cycle done</b>\n` +
        `${fullyOk}/${active} wallets fully ok\n` +
        `Skipped (low balance): ${skipped}\n` +
        `Total ok: ${totalOk} | fail: ${totalFail}\n` +
        `Duration: ${cycleSecs}s`
    );
  }

  clearProgress();
  return { totalOk, totalFail, fullyOk, total, cycleSecs };
}

// Balance check: native zkLTC + WzkLTC
async function runBalance() {
  const wallets = loadLitvmWallets();
  const provider = getProvider();
  const ERC20 = ['function balanceOf(address) view returns (uint256)'];
  const wzl = new ethers.Contract(chain.tokens.WzkLTC.address, ERC20, provider);

  const spinner = ora(`[LitVM] checking ${wallets.length} wallets...`).start();
  const rows = [];
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    spinner.text = `[LitVM] checking ${i + 1}/${wallets.length}  ${shortAddr(w.address)}`;
    try {
      const [native, wzlBal] = await Promise.all([
        provider.getBalance(w.address),
        wzl.balanceOf(w.address),
      ]);
      rows.push({
        addr: w.address,
        native: ethers.formatEther(native),
        wzkltc: ethers.formatEther(wzlBal),
      });
    } catch (e) {
      rows.push({ addr: w.address, error: e.message });
    }
  }
  spinner.stop();

  console.log('');
  console.log(chalk.bold('LitVM Balances:'));
  rows.forEach((r, i) => {
    const idx = String(i + 1).padStart(2);
    if (r.error) {
      console.log(`  ${idx}  ${shortAddr(r.addr)}  ${chalk.red('ERR: ' + r.error)}`);
    } else {
      console.log(`  ${idx}  ${shortAddr(r.addr)}  zkLTC=${r.native}  WzkLTC=${r.wzkltc}`);
    }
  });
  console.log('');
}

module.exports = { runFarmOnce, runBalance, SEQUENCE };
