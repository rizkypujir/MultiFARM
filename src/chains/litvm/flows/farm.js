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

function makeIssue(type, wallet, taskName, reason, extra = {}) {
  return {
    type,
    wallet: wallet.address,
    task: taskName || 'wallet',
    reason: String(reason || '').slice(0, 220),
    ...extra,
  };
}

function formatIssue(issue) {
  const mark = issue.type === 'fail' ? '❌' : '⚠️';
  return `${mark} ${shortAddr(issue.wallet)} | ${issue.task} | ${issue.reason}`;
}

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatIssueHtml(issue) {
  const mark = issue.type === 'fail' ? '❌' : '⚠️';
  return `${mark} <code>${escapeHtml(shortAddr(issue.wallet))}</code> | <b>${escapeHtml(issue.task)}</b> | ${escapeHtml(issue.reason)}`;
}

function topIssues(results, limit = 8) {
  return results.flatMap((r) => r.issues || []).slice(0, limit);
}

function formatSecs(secs) {
  const n = Math.round(Number(secs) || 0);
  const m = Math.floor(n / 60);
  const s = n % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
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
      const r = await liquidity.addLiquidityZkLTC(w, st.tokenAddr);
      walletSwapState.set(w.address.toLowerCase(), { ...st, lpAdded: true, pairAddr: r.pairAddr });
      return r;
    },
  },

  // 5. Remove liquidity (burn 50% LP, get back zkLTC + token)
  {
    name: 'removeLiquidityLP',
    fn: async (w) => {
      const st = walletSwapState.get(w.address.toLowerCase());
      if (!st || !st.tokenAddr) throw new Error('no swap-state token for removeLP');
      if (!st.lpAdded) {
        const err = new Error('addLiquidityLP not confirmed in this cycle; skip removeLP');
        err.skipTask = true;
        throw err;
      }
      const r = await liquidity.removeLiquidityZkLTC(w, st.tokenAddr);
      walletSwapState.set(w.address.toLowerCase(), { ...st, lpRemoved: true });
      return r;
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

async function runWallet(wallet, onTask, meta = {}) {
  const short = shortAddr(wallet.address);
  let ok = 0;
  let fail = 0;
  let skip = 0;
  const issues = [];
  const t0 = Date.now();
  let currentTask = null;

  const emit = (data) => {
    if (!onTask) return;
    onTask({
      addr: wallet.address,
      walletIndex: meta.walletIndex,
      walletTotal: meta.walletTotal,
      ok,
      fail,
      skip,
      elapsedMs: Date.now() - t0,
      ...(currentTask || {}),
      ...data,
    });
  };

  wallet.__farmProgress = (event) => {
    emit({
      event: event.type || 'tx',
      txStatus: event.status,
      txHash: event.hash,
      txTag: event.tag,
      txNonce: event.nonce,
      txBlock: event.blockNumber,
      txReason: event.reason,
      txAt: event.at || Date.now(),
    });
  };

  const chk = await checkWalletFunded(wallet);
  if (!chk.funded) {
    const reason = `zkLTC=${chk.balance} < ${MIN_ZKLTC_FARM}`;
    logFile('wallet:skip', `${wallet.address} skipped: ${reason}`);
    issues.push(makeIssue('skip', wallet, 'wallet', reason));
    delete wallet.__farmProgress;
    return { ok: 0, fail: 0, skip: SEQUENCE.length, issues, skipped: true, secs: '0.0', addr: wallet.address, balance: chk.balance };
  }

  let deadlineHit = false;
  for (let i = 0; i < SEQUENCE.length; i++) {
    const t = SEQUENCE[i];

    if (Date.now() - t0 > WALLET_DEADLINE_MS) {
      deadlineHit = true;
      const remaining = SEQUENCE.length - i;
      logFile('wallet:deadline', `${wallet.address} hit ${WALLET_DEADLINE_MS}ms deadline at ${i + 1}/${SEQUENCE.length}, skip ${remaining} remaining`);
      skip += remaining;
      issues.push(makeIssue('skip', wallet, t.name, `wallet deadline ${WALLET_DEADLINE_MS}ms, skipped ${remaining} remaining`));
      break;
    }

    currentTask = {
      taskIdx: i + 1,
      taskTotal: SEQUENCE.length,
      taskName: t.name,
      taskStartedAt: Date.now(),
      taskStatus: 'running',
    };
    emit({ event: 'task', taskStatus: 'running', txStatus: null, txHash: null });

    try {
      await withRetry(() => t.fn(wallet), { retries: 3, baseDelayMs: 3000, label: `${short}:${t.name}` });
      ok++;
      logFile('task:ok', `${wallet.address} ${t.name}`);
      emit({ event: 'task', taskStatus: 'ok' });
    } catch (e) {
      const reason = e.shortMessage || e.message || String(e);
      if (e.skipTask) {
        skip++;
        issues.push(makeIssue('skip', wallet, t.name, reason));
        logFile('task:skip', `${wallet.address} ${t.name} :: ${reason}`);
        emit({ event: 'task', taskStatus: 'skipped', txStatus: 'skipped', txReason: reason });
        if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
        continue;
      }
      fail++;
      issues.push(makeIssue('fail', wallet, t.name, reason, { txHash: e.txHash || null }));
      logFile('task:fail', `${wallet.address} ${t.name} :: ${reason}`);
      emit({ event: 'task', taskStatus: 'failed', txStatus: e.txHash ? 'failed' : null, txHash: e.txHash || null, txReason: reason });
    }
    if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
  }

  // Cleanup wallet swap state
  walletSwapState.delete(wallet.address.toLowerCase());

  delete wallet.__farmProgress;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  return { ok, fail, skip, issues, secs, addr: wallet.address, deadlineHit };
}

async function runFarmOnce(options = {}) {
  const quiet = Boolean(options.quiet);
  const telegramEnabled = options.telegram !== false && tg.isEnabled();
  const notifyStart = String(process.env.TELEGRAM_NOTIFY_START || 'false').toLowerCase() === 'true';
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

  const pending = wallets
    .map((wallet, index) => ({ wallet, index }))
    .filter(({ wallet }) => !doneSet.has(wallet.address.toLowerCase()));

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

  if (telegramEnabled && notifyStart) {
    const msg = prev && doneSet.size > 0
      ? `♻️ <b>LitVM Farm Resumed</b>\n\n👛 Done: <b>${doneSet.size}/${total}</b>\n📦 Remaining: <b>${pending.length}</b>\n🧵 Batch: <b>${BATCH_SIZE}</b>`
      : `⚡ <b>LitVM Farm Started</b>\n\n👛 Wallets: <b>${total}</b>\n🧩 Tasks/wallet: <b>${SEQUENCE.length}</b>\n🧵 Batch: <b>${BATCH_SIZE}</b>\n⛽ RPC: <code>${chain.rpcUrl}</code>`;
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
    const active = [...liveTasks.entries()].map(([addr, t]) => ({ addr, ...t }));
    const live = active
      .map((t) => {
        const tx = t.txHash ? ` ${t.txStatus || 'tx'}:${shortAddr(t.txHash)}` : '';
        return `${shortAddr(t.addr)}[${t.taskIdx}/${t.taskTotal} ${t.taskName || '-'}${tx}]`;
      })
      .join(' ');
    const current = active.length
      ? Math.max(...active.map((t) => t.taskIdx))
      : completed >= total ? SEQUENCE.length : 0;
    const ok = results.reduce((a, r) => a + (r.ok || 0), 0);
    const fail = results.reduce((a, r) => a + (r.fail || 0), 0);
    const skip = results.reduce((a, r) => a + (r.skip || 0), 0);
    emitProgress({
      status: completed >= total ? 'done' : 'running',
      current,
      total: SEQUENCE.length,
      walletsDone: completed,
      walletsTotal: total,
      activeWallets: liveTasks.size,
      active,
      ok,
      fail,
      skip,
      elapsedMs: Date.now() - cycleStart,
    });
    if (spinner) {
      spinner.text = `[LitVM] done=${completed}/${total}  pool=${liveTasks.size}/${concurrency}  active: ${live || '-'}`;
    }
  };

  const onTask = (info) => {
    const prev = liveTasks.get(info.addr) || {};
    liveTasks.set(info.addr, { ...prev, ...info });
    renderSpinner();
  };

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= pending.length) return;
      const item = pending[i];
      const w = item.wallet;

      try {
        const r = await runWallet(w, onTask, { walletIndex: item.index + 1, walletTotal: total });
        results.push(r);
      } catch (e) {
        const reason = e?.message || String(e);
        results.push({
          addr: w.address,
          ok: 0,
          fail: SEQUENCE.length,
          skip: 0,
          issues: [makeIssue('fail', w, 'wallet', reason)],
          secs: '0',
          error: reason,
        });
        logFile('wallet:err', `${w.address} :: ${reason}`);
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
  const totalSkip = results.reduce((a, r) => a + (r.skip || 0), 0);
  const skippedWallets = results.filter((r) => r.skipped).length;
  const active = total - skippedWallets;
  const cycleSecs = ((Date.now() - cycleStart) / 1000).toFixed(1);
  const fullyOk = results.filter((r) => !r.skipped && r.fail === 0 && (r.skip || 0) === 0).length;
  const issues = topIssues(results, 10);

  emitProgress({
    status: 'done',
    current: SEQUENCE.length,
    total: SEQUENCE.length,
    walletsDone: total,
    walletsTotal: total,
    activeWallets: 0,
    ok: totalOk,
    fail: totalFail,
    skip: totalSkip,
    active: [],
    issues,
    elapsedMs: Date.now() - cycleStart,
  });

  if (!quiet) {
    spinner.stopAndPersist({
      symbol: totalFail === 0 && totalSkip === 0 ? chalk.green('✔') : chalk.yellow('!'),
      text: `[LitVM] cycle done  ${fullyOk}/${active} active wallets fully ok  |  walletSkip=${skippedWallets}  ok=${totalOk} skip=${totalSkip} fail=${totalFail}  |  ${cycleSecs}s`,
    });

    console.log('');
    results.forEach((r, i) => {
      const idx = String(i + 1).padStart(2);
      let mark, line;
      if (r.skipped) {
        mark = chalk.gray('○');
        line = `  ${mark} ${idx}  ${shortAddr(r.addr)}  ${chalk.gray(`SKIPPED (zkLTC=${r.balance} < ${MIN_ZKLTC_FARM})`)}`;
      } else {
        mark = r.fail === 0 && (r.skip || 0) === 0 ? chalk.green('✔') : chalk.yellow('!');
        line = `  ${mark} ${idx}  ${shortAddr(r.addr)}  ok=${r.ok} skip=${r.skip || 0} fail=${r.fail}  (${r.secs}s)`;
      }
      console.log(line);
    });
    if (issues.length) {
      console.log(chalk.bold('  Skipped / Failed:'));
      issues.forEach((issue) => console.log('  ' + formatIssue(issue)));
    }
    console.log('');
  }

  if (telegramEnabled) {
    const issueLines = issues.length
      ? '\n\n📋 <b>Skipped / Failed</b>\n' + issues.map(formatIssueHtml).join('\n')
      : '';
    await tg.sendMessage(
      `🏁 <b>LitVM Farm Done</b>\n\n` +
        `✅ Wallets OK: <b>${fullyOk}/${active}</b>\n` +
        `👛 Wallet skipped: <b>${skippedWallets}</b>\n` +
        `🧩 Tasks: ✅${totalOk} ⚠️${totalSkip} ❌${totalFail}\n` +
        `⏱ Duration: <b>${formatSecs(cycleSecs)}</b>` +
        issueLines
    );
  }

  clearProgress();
  return { totalOk, totalFail, totalSkip, fullyOk, total, skippedWallets, cycleSecs, issues };
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
