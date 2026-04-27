'use strict';
const { log, shortAddr } = require('../../../shared/utils');

const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || 90000);

async function waitForLitvmTx(wallet, tx, options = {}) {
  const timeoutMs = Number(options.timeoutMs || TX_TIMEOUT_MS);
  const tag = options.tag || 'litvm:tx';

  try {
    return await tx.wait(1, timeoutMs);
  } catch (e) {
    const msg = e?.shortMessage || e?.message || String(e);
    const timedOut = msg.toLowerCase().includes('timeout');
    if (!timedOut) throw e;

    const receipt = await wallet.provider.getTransactionReceipt(tx.hash).catch(() => null);
    if (receipt) {
      log(tag, `${shortAddr(wallet.address)} recovered receipt ${tx.hash}`);
      return receipt;
    }

    const err = new Error(`tx sent but not confirmed after ${timeoutMs}ms: ${tx.hash}`);
    err.noRetry = true;
    err.txHash = tx.hash;
    throw err;
  }
}

module.exports = { waitForLitvmTx };
