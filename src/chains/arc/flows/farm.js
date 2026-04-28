'use strict';
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { ethers } = require('ethers');
const chain = require('../config');
const { loadWallets } = require('../../../shared/wallets');
const { shortAddr, randDelay, withRetry } = require('../../../shared/utils');
const { logFile: rawLogFile } = require('../../../shared/logger');
const logFile = rawLogFile.withChain('arc');
const consoleCapture = require('../../../shared/consoleCapture');
const tg = require('../../../shared/telegram');

// Progress file — supaya cycle yang terputus bisa resume tanpa ulang wallet yang udah selesai.
// Progress file per-chain (so multi-chain mode can run parallel without conflict)
const PROGRESS_FILE = path.join(__dirname, '..', '..', '..', '..', '.progress.arc.json');

function loadProgress(totalWallets) {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    // Invalidate kalau wallet count beda (wallets.txt berubah) atau umur >24 jam
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

const transfer = require('../tasks/transfer');
const approve = require('../tasks/approve');
const deploy = require('../tasks/deploy');
const { deployErc20Real } = require('../tasks/deployErc20Real');
const { deployNftReal } = require('../tasks/deployNftReal');
const zk = require('../tasks/zkcodex');

const SELF_USDC = process.env.SELF_TX_AMOUNT_USDC || '0.001';
const SELF_EURC = process.env.SELF_TX_AMOUNT_EURC || '0.001';
const DELAY_MIN = Number(process.env.DELAY_MIN_MS || 1500);
const DELAY_MAX = Number(process.env.DELAY_MAX_MS || 4000);
const COUNTER_PER_CYCLE = Number(process.env.COUNTER_PER_CYCLE || 3);
// Minimal USDC (= gas token Arc) yang harus dipunyai wallet untuk jalanin task.
// Kalau kurang, skip wallet supaya gak stuck retry di task yang butuh balance.
const MIN_USDC_FARM = process.env.MIN_USDC_FARM || '0.05';
// Jumlah wallet yang jalan bareng dalam 1 batch. Default 3 — aman untuk RPC publik (drpc).
// Naikin ke 5-10 kalau pakai RPC private (Alchemy/QuickNode) dengan rate limit tinggi.
// Note: tiap wallet jalanin task sequential, jadi batch=3 = 3 tx concurrent ke RPC saja.
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 3);
const ARC_TASK_RETRIES = Number(process.env.ARC_TASK_RETRIES || 0);
const ARC_ABORT_WALLET_ON_PENDING = String(process.env.ARC_ABORT_WALLET_ON_PENDING || 'true').toLowerCase() === 'true';
// Deadline per wallet (ms). Kalau 1 wallet jalan lebih dari ini, sisa task di-skip.
// Mencegah wallet "stuck nonce" nahan slot pool. Default 10 menit.
const WALLET_DEADLINE_MS = Number(process.env.WALLET_DEADLINE_MS || 600000);

// Urutan task waras (sequential per wallet): no self-transfer, fewer deploy-heavy calls.
const SEQUENCE = [
  { name: 'randomTransferUsdc', fn: (w) => transfer.randomTransferUsdc(w, SELF_USDC) },
  { name: 'randomTransferEurc', fn: (w) => transfer.randomTransferEurc(w, SELF_EURC) },
  // Approve StableFX
  { name: 'approveUsdcFx', fn: (w) => approve.approveUsdcFx(w) },
  { name: 'approveEurcFx', fn: (w) => approve.approveEurcFx(w) },
  // Local deploy
  { name: 'deployBasic', fn: (w) => deploy.deployMinimal(w) },
  { name: 'deployErc20', fn: (w) => deployErc20Real(w) },
  { name: 'deployNft+mint', fn: (w) => deployNftReal(w) },
  // zkCodex lightweight tasks
  { name: 'zkGm', fn: (w) => zk.zkGm(w) },
  { name: `zkCounter×${COUNTER_PER_CYCLE}`, fn: (w) => zk.zkCounterMany(w, COUNTER_PER_CYCLE) },
];

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function checkWalletFunded(wallet) {
  try {
    const usdc = new ethers.Contract(chain.tokens.USDC.address, ERC20_ABI, wallet.provider);
    const bal = await usdc.balanceOf(wallet.address);
    const min = ethers.parseUnits(MIN_USDC_FARM, 6);
    return { funded: bal >= min, balance: ethers.formatUnits(bal, 6) };
  } catch (e) {
    return { funded: true, balance: '?' };
  }
}

// Cek saldo EURC untuk decide apakah task EURC bisa dijalankan
async function getEurcBalance(wallet) {
  try {
    const eurc = new ethers.Contract(chain.tokens.EURC.address, ERC20_ABI, wallet.provider);
    const bal = await eurc.balanceOf(wallet.address);
    return bal;
  } catch {
    return 0n;
  }
}

// Parallel-safe: tidak sentuh spinner, tidak install silencer per-wallet.
// Caller (runFarmOnce) yang install silencer sekali di awal cycle.
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
    const reason = `USDC=${chk.balance} < ${MIN_USDC_FARM}`;
    logFile('wallet:skip', `${wallet.address} skipped: ${reason}`);
    issues.push(makeIssue('skip', wallet, 'wallet', reason));
    delete wallet.__farmProgress;
    return { ok: 0, fail: 0, skip: SEQUENCE.length, issues, skipped: true, secs: '0.0', addr: wallet.address, balance: chk.balance };
  }

  // EURC preflight — kalau saldo EURC < 0.002 (butuh untuk 2 transfer 0.001 + buffer),
  // skip task yang requires EURC supaya gak buang waktu retry yang pasti revert.
  const eurcBal = await getEurcBalance(wallet);
  const eurcMinNeeded = ethers.parseUnits('0.002', 6);
  const hasEurc = eurcBal >= eurcMinNeeded;
  if (!hasEurc) {
    logFile('wallet:eurc', `${wallet.address} EURC=${ethers.formatUnits(eurcBal, 6)} -> EURC tasks akan di-skip`);
  }
  const eurcRequiredTasks = new Set(['randomTransferEurc']);

  let deadlineHit = false;
  for (let i = 0; i < SEQUENCE.length; i++) {
    const t = SEQUENCE[i];

    // Cek deadline — kalau wallet udah jalan terlalu lama, skip sisa task
    if (Date.now() - t0 > WALLET_DEADLINE_MS) {
      deadlineHit = true;
      const remaining = SEQUENCE.length - i;
      const reason = `wallet deadline ${WALLET_DEADLINE_MS}ms, skipped ${remaining} remaining`;
      logFile('wallet:deadline', `${wallet.address} hit ${WALLET_DEADLINE_MS}ms deadline at task ${i + 1}/${SEQUENCE.length}, skipping ${remaining} remaining`);
      skip += remaining;
      issues.push(makeIssue('skip', wallet, t.name, reason));
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

    // Skip task yang butuh EURC kalau saldo kurang
    if (!hasEurc && eurcRequiredTasks.has(t.name)) {
      const reason = `EURC=${ethers.formatUnits(eurcBal, 6)} < 0.002`;
      skip++;
      issues.push(makeIssue('skip', wallet, t.name, reason));
      logFile('task:skip', `${wallet.address} ${t.name} (no EURC balance)`);
      emit({ event: 'task', taskStatus: 'skipped', txStatus: 'skipped', txReason: reason });
      if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
      continue;
    }

    try {
      await withRetry(() => t.fn(wallet), {
        retries: ARC_TASK_RETRIES,
        baseDelayMs: 3000,
        label: `${short}:${t.name}`,
      });
      ok++;
      logFile('task:ok', `${wallet.address} ${t.name}`);
      emit({ event: 'task', taskStatus: 'ok' });
    } catch (e) {
      const msg = e.shortMessage || e.message || '';
      if (t.name === 'zkGm' && /Wait before sending another GM/i.test(msg)) {
        skip++;
        issues.push(makeIssue('skip', wallet, t.name, 'cooldown: wait before sending another GM'));
        logFile('task:skip', `${wallet.address} ${t.name} (cooldown)`);
        emit({ event: 'task', taskStatus: 'skipped', txStatus: 'skipped', txReason: 'cooldown' });
        if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
        continue;
      }
      fail++;
      issues.push(makeIssue('fail', wallet, t.name, msg, { txHash: e.txHash || null }));
      logFile('task:fail', `${wallet.address} ${t.name} :: ${msg}`);
      emit({ event: 'task', taskStatus: 'failed', txStatus: e.txHash ? 'failed' : null, txHash: e.txHash || null, txReason: msg });
      if (ARC_ABORT_WALLET_ON_PENDING && e?.txHash && !e?.nonceCleared) {
        const remaining = SEQUENCE.length - i - 1;
        if (remaining > 0) {
          skip += remaining;
          issues.push(makeIssue('skip', wallet, 'remaining tasks', `pending tx nonce=${e.nonce ?? '?'}; skipped ${remaining} remaining`, { txHash: e.txHash }));
          logFile(
            'wallet:nonce-stuck',
            `${wallet.address} pending tx ${e.txHash} nonce=${e.nonce ?? '?'}; skipping ${remaining} remaining tasks`
          );
        }
        break;
      }
    }
    if (i < SEQUENCE.length - 1) await randDelay(DELAY_MIN, DELAY_MAX);
  }

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
      onProgress({ chain: 'arc', ...data });
    } catch {}
  };

  const wallets = loadWallets();
  const total = wallets.length;

  // Cek progress sebelumnya — resume kalau ada cycle yang belum selesai (<24h, wallet count sama)
  const prev = loadProgress(total);
  const results = prev?.results || [];
  const doneSet = new Set(results.map((r) => String(r.addr || '').toLowerCase()).filter(Boolean));
  const cycleStart = prev?.startedAt || Date.now();

  // Ambil daftar wallet yang belum diproses
  const pending = wallets
    .map((wallet, index) => ({ wallet, index }))
    .filter(({ wallet }) => !doneSet.has(wallet.address.toLowerCase()));

  emitProgress({ status: 'starting', current: 0, total: SEQUENCE.length, walletsDone: doneSet.size, walletsTotal: total });

  if (!quiet) {
    console.log('');
    if (prev && doneSet.size > 0) {
      console.log(chalk.yellow(`[Arc] Resuming cycle — ${doneSet.size}/${total} wallets already done, ${pending.length} remaining`));
    } else {
      console.log(chalk.cyan(`[Arc] Starting farming cycle — ${total} wallet(s) × ${SEQUENCE.length} tasks  |  batch=${BATCH_SIZE} parallel`));
    }
    console.log('');
  }

  if (telegramEnabled && notifyStart) {
    const msg = prev && doneSet.size > 0
      ? `♻️ <b>Arc Farm Resumed</b>\n\n👛 Done: <b>${doneSet.size}/${total}</b>\n📦 Remaining: <b>${pending.length}</b>\n🧵 Batch: <b>${BATCH_SIZE}</b>`
      : `🚀 <b>Arc Farm Started</b>\n\n👛 Wallets: <b>${total}</b>\n🧩 Tasks/wallet: <b>${SEQUENCE.length}</b>\n🧵 Batch: <b>${BATCH_SIZE}</b>\n⛽ RPC: <code>${chain.rpcUrl}</code>`;
    await tg.sendMessage(msg);
  }

  const spinner = quiet ? null : ora({ text: '[Arc] starting...' }).start();

  await consoleCapture.capture('arc', async () => {
  // Save initial progress
  saveProgress({ startedAt: cycleStart, total, done: Array.from(doneSet), results });

  // Sliding-window pool: selalu jaga BATCH_SIZE wallet jalan paralel.
  // Begitu 1 selesai, langsung mulai wallet berikutnya (gak nunggu seluruh batch).
  const liveTasks = new Map(); // addr -> { taskIdx, taskName, taskTotal }
  let completed = doneSet.size; // counter real-completed untuk display
  let nextIdx = 0; // index wallet berikutnya di `pending` yang mau di-spawn
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
      spinner.text = `[Arc] done=${completed}/${total}  pool=${liveTasks.size}/${concurrency}  active: ${live || '-'}`;
    }
  };

  const onTask = (info) => {
    const prev = liveTasks.get(info.addr) || {};
    liveTasks.set(info.addr, { ...prev, ...info });
    renderSpinner();
  };

  // Worker: ambil 1 wallet dari queue, jalanin, ulangi sampai habis
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

  // Spawn N workers paralel, tunggu semua habis
  const workers = Array.from({ length: concurrency }, () => worker());
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
      text: `[Arc] cycle done  ${fullyOk}/${active} active wallets fully ok  |  walletSkip=${skippedWallets}  ok=${totalOk} skip=${totalSkip} fail=${totalFail}  |  ${cycleSecs}s`,
    });

    console.log('');
    results.forEach((r, i) => {
      const idx = String(i + 1).padStart(2);
      let mark, line;
      if (r.skipped) {
        mark = chalk.gray('○');
        line = `  ${mark} ${idx}  ${shortAddr(r.addr)}  ${chalk.gray(`SKIPPED (USDC=${r.balance} < ${MIN_USDC_FARM})`)}`;
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
      `🏁 <b>Arc Farm Done</b>\n\n` +
        `✅ Wallets OK: <b>${fullyOk}/${active}</b>\n` +
        `👛 Wallet skipped: <b>${skippedWallets}</b>\n` +
        `🧩 Tasks: ✅${totalOk} ⚠️${totalSkip} ❌${totalFail}\n` +
        `⏱ Duration: <b>${formatSecs(cycleSecs)}</b>` +
        issueLines
    );
  }

  // Cycle selesai — bersihin progress file supaya cycle berikutnya start fresh
  clearProgress();

  return { totalOk, totalFail, totalSkip, fullyOk, total, skippedWallets, cycleSecs, issues };
}

module.exports = { runFarmOnce, SEQUENCE };
