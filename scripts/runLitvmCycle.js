#!/usr/bin/env node
'use strict';
/**
 * Run 1 LitVM farming cycle (sama dengan menu -> Daily Farming -> LitVM only).
 * Bedanya: gak loop 24h, cuma 1 cycle terus exit.
 *
 * Useful untuk smoke-test menu logic tanpa interactive prompt.
 *
 * Usage:
 *   node scripts/runLitvmCycle.js
 *   node scripts/runLitvmCycle.js --reset      # hapus progress file dulu
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { runFarmOnce } = require('../src/chains/litvm/flows/farm');

const RESET = process.argv.includes('--reset');

async function main() {
  if (RESET) {
    const pf = path.join(__dirname, '..', '.progress.litvm.json');
    if (fs.existsSync(pf)) {
      fs.unlinkSync(pf);
      console.log(chalk.gray('Cleared .progress.litvm.json'));
    }
  }

  console.log(chalk.bold('═══ Single LitVM Cycle (no loop, no menu) ═══'));
  console.log('');

  const t0 = Date.now();
  try {
    const r = await runFarmOnce();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('');
    console.log(chalk.green('═══ Cycle Summary ═══'));
    console.log(`  Total wallets       : ${r.total}`);
    console.log(`  Fully OK            : ${r.fullyOk}`);
    console.log(`  Total tasks ok      : ${r.totalOk}`);
    console.log(`  Total tasks fail    : ${r.totalFail}`);
    console.log(`  Cycle duration      : ${r.cycleSecs}s (script: ${secs}s)`);
  } catch (e) {
    console.error(chalk.red('Cycle ERROR: ' + e.message));
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
  }
}

main();
