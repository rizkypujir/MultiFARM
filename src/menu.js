'use strict';
require('dotenv').config();
const chalk = require('chalk');
const { ethers } = require('ethers');
const arcChain = require('./chains/arc/config');
const litvmChain = require('./chains/litvm/config');
const { loadPrivateKeys } = require('./shared/wallets');
const { runBalance: runArcBalance } = require('./chains/arc/flows/balance');
const { runBridge: runArcBridge } = require('./chains/arc/flows/bridge');
const { runResume: runArcResume } = require('./chains/arc/flows/resume');
const { runFarmOnce: runArcFarmOnce, SEQUENCE: arcFarmSequence } = require('./chains/arc/flows/farm');
const { runFarmOnce: runLitvmFarmOnce, runBalance: runLitvmBalance, SEQUENCE: litvmFarmSequence } = require('./chains/litvm/flows/farm');
const tg = require('./shared/telegram');
const { sleep } = require('./shared/utils');

// Chain registry — daftar chain yang tersedia
const CHAINS = {
  arc: {
    name: 'Arc Testnet',
    config: arcChain,
    runFarmOnce: runArcFarmOnce,
    taskTotal: arcFarmSequence.length,
    runBalance: runArcBalance,
    runBridge: runArcBridge,
    runResume: runArcResume,
    hasBridge: true,
    hasResume: true,
  },
  litvm: {
    name: 'LitVM Testnet',
    config: litvmChain,
    runFarmOnce: runLitvmFarmOnce,
    taskTotal: litvmFarmSequence.length,
    runBalance: runLitvmBalance,
    runBridge: null,
    runResume: null,
    hasBridge: false, // TODO: implement Caldera bridge
    hasResume: false,
  },
};

// @inquirer/prompts v7 adalah ESM. Pakai dynamic import di CJS.
let _prompts = null;
async function prompts() {
  if (!_prompts) {
    _prompts = await import('@inquirer/prompts');
  }
  return _prompts;
}

const DAY_MS = 24 * 60 * 60 * 1000;

let dailyState = { running: false, nextAt: null, cycle: 0 };

function nextImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

const DASHBOARD_FRAMES = ['[|]', '[/]', '[-]', '[\\]'];

function shortChainName(target) {
  if (target.key === 'arc') return 'Arc';
  if (target.key === 'litvm') return 'LitVM';
  return target.chain.name.replace(/\s*Testnet\s*/i, '').trim();
}

function createParallelDashboard(targets) {
  const states = new Map(
    targets.map((target) => [
      target.key,
      {
        label: shortChainName(target),
        current: 0,
        total: target.chain.taskTotal || '?',
        status: 'queued',
      },
    ])
  );
  let frame = 0;
  let lastLen = 0;
  let timer = null;

  const render = (done = false) => {
    const spin = done ? '[done]' : DASHBOARD_FRAMES[frame++ % DASHBOARD_FRAMES.length];
    const parts = [...states.values()].map((s) => {
      const suffix = s.status === 'done' ? ' done' : '';
      return `${s.label} ${s.current}/${s.total}${suffix}`;
    });
    const line = `${spin} ${parts.join('   ')}`;
    process.stdout.write('\r' + line.padEnd(lastLen));
    lastLen = Math.max(lastLen, line.length);
  };

  return {
    start() {
      render();
      timer = setInterval(render, 180);
    },
    update(key, progress) {
      const state = states.get(key);
      if (!state) return;
      state.current = progress.current ?? state.current;
      state.total = progress.total ?? state.total;
      state.status = progress.status || state.status;
      render();
    },
    stop() {
      if (timer) clearInterval(timer);
      render(true);
      process.stdout.write('\n');
    },
  };
}

function header() {
  console.clear();
  const wallets = loadPrivateKeys().length;
  const tgStat = tg.isEnabled() ? chalk.green('ON') : chalk.gray('OFF');
  const dailyStat = dailyState.running
    ? chalk.green(`RUNNING (cycle #${dailyState.cycle})`)
    : chalk.gray('IDLE');
  // Width 56 chars antara ║ ... ║ (44 sebelumnya terlalu sempit untuk 2 chain)
  const W = 56;
  const line = (s) => {
    // Strip color codes for length calculation
    const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, W - visible.length);
    return chalk.cyan('║ ') + s + ' '.repeat(pad) + chalk.cyan(' ║');
  };
  // Per-chain status (1 line per chain)
  const chainLines = Object.values(CHAINS).map((c) => `${c.name.padEnd(16)} chainId=${c.config.chainId}`);

  console.log('');
  console.log(chalk.cyan('╔') + '═'.repeat(W + 2) + chalk.cyan('╗'));
  console.log(line(chalk.bold.white('LIST TESTNET FARM')));
  console.log(chalk.cyan('╠') + '═'.repeat(W + 2) + chalk.cyan('╣'));
  for (const cl of chainLines) console.log(line(cl));
  console.log(line(`Wallets: ${wallets}     Telegram: ${tgStat}`));
  console.log(line(`Daily:   ${dailyStat}`));
  console.log(chalk.cyan('╚') + '═'.repeat(W + 2) + chalk.cyan('╝'));
  console.log('');
}

// Helper: tanya scope (all / specific chain)
async function pickScope(actionLabel) {
  const { select } = await prompts();
  const choices = [];
  const chainKeys = Object.keys(CHAINS);
  if (chainKeys.length > 1) {
    choices.push({ name: `🌐  ALL — ${actionLabel} di semua chain (paralel)`, value: 'all' });
  }
  for (const k of chainKeys) {
    const c = CHAINS[k];
    choices.push({ name: `⚡  ${c.name} only`, value: k });
  }
  choices.push({ name: '← Back', value: 'back' });
  return select({ message: `Pilih scope ${actionLabel}:`, choices, loop: false });
}

async function menuBalance() {
  header();
  const scope = await pickScope('check balance');
  if (scope === 'back') return;
  try {
    if (scope === 'all') {
      const tasks = Object.values(CHAINS).map((c) => c.runBalance().catch((e) => console.log(chalk.red(`[${c.name}] ${e.message}`))));
      await Promise.all(tasks);
    } else {
      await CHAINS[scope].runBalance();
    }
  } catch (e) {
    console.log(chalk.red('Error: ' + e.message));
  }
  await pause();
}

async function menuBridge() {
  header();
  // Filter chain yang punya bridge
  const bridgeChains = Object.fromEntries(Object.entries(CHAINS).filter(([, c]) => c.hasBridge));
  if (Object.keys(bridgeChains).length === 0) {
    console.log(chalk.gray('Tidak ada chain dengan bridge.'));
    await pause();
    return;
  }
  const { input, confirm, select } = await prompts();

  // Pilih chain (kalau lebih dari 1)
  let chainKey;
  if (Object.keys(bridgeChains).length === 1) {
    chainKey = Object.keys(bridgeChains)[0];
  } else {
    chainKey = await select({
      message: 'Pilih chain tujuan bridge:',
      choices: [
        ...Object.entries(bridgeChains).map(([k, c]) => ({ name: `🚀  ${c.name}`, value: k })),
        { name: '← Back', value: 'back' },
      ],
      loop: false,
    });
    if (chainKey === 'back') return;
  }
  const sel = bridgeChains[chainKey];

  const amount = await input({
    message: `Amount to bridge per wallet:`,
    default: process.env.BRIDGE_AMOUNT_USDC || '1',
    validate: (v) => (!isNaN(Number(v)) && Number(v) > 0) || 'Masukkan angka > 0',
  });
  const dest = await input({
    message: `Destination address di ${sel.name} (kosongkan = self):`,
    default: '',
    validate: (v) => {
      const trimmed = v.trim();
      return !trimmed || ethers.isAddress(trimmed) || 'Alamat tujuan invalid';
    },
  });
  const parallel = await confirm({
    message: 'Jalankan semua wallet PARALEL? (lebih cepat, recommended)',
    default: true,
  });
  const ok = await confirm({ message: `Bridge ${amount} ke ${sel.name} untuk SEMUA wallet?`, default: false });
  if (!ok) return;
  try {
    await sel.runBridge({ amountUsdc: amount, destAddress: dest || null, parallel });
  } catch (e) {
    console.log(chalk.red('Error: ' + e.message));
  }
  await pause();
}

async function menuResume() {
  const { input, select } = await prompts();
  header();
  console.log(chalk.yellow('Resume bridge: lanjutin mint di Arc untuk burn tx yang udah sukses di Sepolia.'));
  console.log(chalk.yellow('Berguna kalau koneksi putus / ISP intercept di tengah bridge sebelumnya.'));
  console.log('');

  const burnTxHash = await input({
    message: 'Burn tx hash (dari Sepolia):',
    validate: (v) => /^0x[0-9a-fA-F]{64}$/.test(v.trim()) || 'Format tx hash invalid (harus 0x + 64 hex)',
  });

  const pks = loadPrivateKeys();
  if (!pks.length) {
    console.log(chalk.red('Tidak ada wallet. Isi wallets.txt atau PRIVATE_KEYS dulu.'));
    await pause();
    return;
  }
  const choices = pks.map((pk, i) => {
    const addr = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk).address;
    return { name: `${i + 1}. ${addr}`, value: i };
  });
  const walletIndex = await select({
    message: 'Wallet mana yang submit mint tx di Arc? (butuh sedikit USDC di Arc untuk gas)',
    choices,
  });

  // Resume hanya untuk Arc (CCTP) sekarang
  try {
    await CHAINS.arc.runResume({ burnTxHash: burnTxHash.trim(), walletIndex });
  } catch (e) {
    console.log(chalk.red('Error: ' + (e.shortMessage || e.message)));
  }
  await pause();
}

async function menuDailyFarm() {
  const { confirm } = await prompts();
  header();
  console.log(chalk.yellow('Mode: Auto loop setiap 24 jam.'));
  console.log(chalk.yellow('Round pertama jalan SEKARANG, lalu tunggu 24 jam, ulang, dst.'));
  console.log(chalk.yellow('Tekan Ctrl+C untuk stop.'));
  console.log('');

  const scope = await pickScope('daily farming');
  if (scope === 'back') return;

  const ok = await confirm({ message: 'Mulai daily farming?', default: true });
  if (!ok) return;

  dailyState.running = true;
  dailyState.cycle = 0;

  // Resolve target chain(s)
  const targets = scope === 'all'
    ? Object.entries(CHAINS).map(([k, c]) => ({ key: k, chain: c }))
    : [{ key: scope, chain: CHAINS[scope] }];

  try {
    while (dailyState.running) {
      dailyState.cycle++;
      header();
      const scopeLabel = scope === 'all' ? 'ALL TESTNETS' : CHAINS[scope].name;
      console.log(chalk.bold(`═══ Cycle #${dailyState.cycle} — ${scopeLabel} — ${new Date().toISOString()} ═══`));
      try {
        if (targets.length === 1) {
          await targets[0].chain.runFarmOnce();
        } else {
          const dashboard = createParallelDashboard(targets);
          dashboard.start();
          const outcomes = await Promise.all(
            targets.map((t) =>
              nextImmediate()
                .then(() =>
                  t.chain.runFarmOnce({
                    quiet: true,
                    onProgress: (progress) => dashboard.update(t.key, progress),
                  })
                )
                .then((result) => ({ target: t, result }))
                .catch((e) => ({ target: t, error: e }))
            )
          );
          dashboard.stop();
          outcomes.forEach(({ target, result, error }) => {
            if (error) {
              console.log(chalk.red(`[${target.chain.name}] cycle error: ${error.message}`));
              return;
            }
            const fail = result.totalFail || 0;
            const mark = fail === 0 ? chalk.green('OK') : chalk.yellow('WARN');
            console.log(
              `${mark} ${target.chain.name}: ok=${result.totalOk} fail=${fail} wallets=${result.fullyOk}/${result.total} duration=${result.cycleSecs}s`
            );
          });
        }
      } catch (e) {
        console.log(chalk.red('Cycle error: ' + e.message));
      }
      dailyState.nextAt = new Date(Date.now() + DAY_MS);
      if (tg.isEnabled()) {
        await tg.sendMessage(
          `⏳ Next cycle: ${dailyState.nextAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`
        );
      }
      await countdown(DAY_MS);
    }
  } finally {
    dailyState.running = false;
    dailyState.nextAt = null;
  }
}

async function countdown(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const left = end - Date.now();
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    process.stdout.write(
      `\r${chalk.gray('⏳ Sleeping')} — next cycle in ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}   `
    );
    await sleep(1000);
  }
  process.stdout.write('\n');
}

async function menuTelegram() {
  const { input, confirm, select } = await prompts();
  header();
  const cur = tg.getConfig();
  console.log(`Current token : ${cur.token ? cur.token.slice(0, 10) + '...' : chalk.gray('(not set)')}`);
  console.log(`Current chatId: ${cur.chatId || chalk.gray('(not set)')}`);
  console.log('');
  console.log(chalk.gray('Cara dapat Bot Token: chat @BotFather, /newbot, copy token.'));
  console.log(chalk.gray('Cara dapat Chat ID  : chat ke bot kamu, lalu buka'));
  console.log(chalk.gray('  https://api.telegram.org/bot<TOKEN>/getUpdates'));
  console.log('');

  const action = await select({
    message: 'Pilih aksi:',
    choices: [
      { name: 'Setup / update credentials', value: 'setup' },
      { name: 'Send test message', value: 'test' },
      { name: 'Disable (clear credentials)', value: 'clear' },
      { name: 'Back', value: 'back' },
    ],
  });

  if (action === 'back') return;

  if (action === 'clear') {
    const ok = await confirm({ message: 'Clear Telegram credentials?', default: false });
    if (ok) {
      tg.saveCreds('', '');
      console.log(chalk.green('Cleared.'));
    }
  } else if (action === 'setup') {
    const token = await input({ message: 'Bot Token:', default: cur.token });
    const chatId = await input({ message: 'Chat ID:', default: cur.chatId });
    const r = await tg.testConnection(token, chatId);
    if (r.ok) {
      tg.saveCreds(token, chatId);
      console.log(chalk.green('✔ Connected & saved to .env'));
    } else {
      console.log(chalk.red('✖ Failed: ' + JSON.stringify(r.data || r.error || {})));
    }
  } else if (action === 'test') {
    if (!tg.isEnabled()) {
      console.log(chalk.red('Belum setup. Pilih "Setup" dulu.'));
    } else {
      const r = await tg.sendMessage('🧪 Test message from Arc Farm');
      console.log(r.ok ? chalk.green('✔ Sent') : chalk.red('✖ Failed: ' + JSON.stringify(r.data || {})));
    }
  }
  await pause();
}

async function pause() {
  const { input } = await prompts();
  await input({ message: chalk.gray('Tekan Enter untuk kembali ke menu...'), default: '' });
}

async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    header();
    const { select } = await prompts();
    const choice = await select({
      message: 'Pilih menu:',
      choices: [
        { name: '📊  Check balance all wallets', value: 'balance' },
        { name: '🚀  Bridge wallets (Sepolia → testnet)', value: 'bridge' },
        { name: '⚡  Resume bridge (Arc CCTP — pakai burn tx hash)', value: 'resume' },
        { name: '🔥  Start daily farming (auto loop 24h)', value: 'daily' },
        { name: '🔔  Telegram bot (setup / test)', value: 'tg' },
        { name: '❌  Exit', value: 'exit' },
      ],
      loop: false,
    });
    if (choice === 'exit') {
      console.log(chalk.gray('Bye.'));
      process.exit(0);
    }
    try {
      if (choice === 'balance') await menuBalance();
      else if (choice === 'bridge') await menuBridge();
      else if (choice === 'resume') await menuResume();
      else if (choice === 'daily') await menuDailyFarm();
      else if (choice === 'tg') await menuTelegram();
    } catch (e) {
      if (e && (e.name === 'ExitPromptError' || e.message?.includes('force closed'))) {
        console.log(chalk.gray('\nInterrupted.'));
        process.exit(0);
      }
      console.log(chalk.red('Menu error: ' + e.message));
      await pause();
    }
  }
}

process.on('SIGINT', () => {
  console.log(chalk.gray('\nStopped.'));
  process.exit(0);
});

// Jangan biarkan error socket/TLS transient (ECONNRESET dll) bikin crash process.
// Log ringkas ke stderr, biarkan loop farming lanjut / retry internal yg handle.
process.on('uncaughtException', (err) => {
  const transient = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'socket hang up'];
  const msg = err?.message || String(err);
  if (transient.some((p) => msg.includes(p))) {
    // silent: RPC/TG hiccup, biasanya sudah di-retry di level task
    return;
  }
  console.error(chalk.red('\n[uncaughtException] ' + msg));
});
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  const transient = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'socket hang up'];
  if (transient.some((p) => msg.includes(p))) return;
  console.error(chalk.red('\n[unhandledRejection] ' + msg));
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
