'use strict';
const { log, shortAddr } = require('../../../shared/utils');

const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS || 90000);

function emitTx(wallet, data) {
  if (typeof wallet.__farmProgress !== 'function') return;
  try {
    wallet.__farmProgress({
      type: 'tx',
      chain: 'litvm',
      at: Date.now(),
      ...data,
    });
  } catch {}
}

async function waitForLitvmTx(wallet, tx, options = {}) {
  const timeoutMs = Number(options.timeoutMs || TX_TIMEOUT_MS);
  const tag = options.tag || 'litvm:tx';

  emitTx(wallet, { status: 'sent', hash: tx.hash, tag, nonce: tx.nonce });
  try {
    const receipt = await tx.wait(1, timeoutMs);
    emitTx(wallet, { status: 'confirmed', hash: tx.hash, tag, blockNumber: receipt.blockNumber, nonce: tx.nonce });
    return receipt;
  } catch (e) {
    const msg = e?.shortMessage || e?.message || String(e);
    const timedOut = msg.toLowerCase().includes('timeout');
    if (!timedOut) throw e;

    const receipt = await wallet.provider.getTransactionReceipt(tx.hash).catch(() => null);
    if (receipt) {
      log(tag, `${shortAddr(wallet.address)} recovered receipt ${tx.hash}`);
      emitTx(wallet, { status: 'recovered', hash: tx.hash, tag, blockNumber: receipt.blockNumber, nonce: tx.nonce });
      return receipt;
    }

    const err = new Error(`tx sent but not confirmed after ${timeoutMs}ms: ${tx.hash}`);
    err.noRetry = true;
    err.txHash = tx.hash;
    err.nonce = tx.nonce;
    emitTx(wallet, { status: 'failed', hash: tx.hash, tag, nonce: tx.nonce, reason: err.message });
    throw err;
  }
}

module.exports = { waitForLitvmTx };
