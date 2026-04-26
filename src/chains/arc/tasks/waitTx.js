'use strict';
const { txUrl, log } = require('../../../shared/utils');

function makeSentButUnconfirmedError(tx, timeoutMs, cause) {
  const err = new Error(`tx sent but not confirmed after ${timeoutMs}ms: ${tx.hash}`);
  err.noRetry = true;
  err.txHash = tx.hash;
  err.cause = cause;
  return err;
}

async function waitForArcTx(wallet, tx, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.TX_TIMEOUT_MS || 90000);
  const tag = options.tag || 'tx';
  const sent = options.sent || tx.hash;
  const confirmed = options.confirmed || sent;

  log(`${tag}:sent`, `${sent}  ${txUrl(tx.hash)}`);

  try {
    const receipt = await tx.wait(1, timeoutMs);
    const msg = typeof confirmed === 'function' ? confirmed(receipt) : confirmed;
    log(tag, `${msg}  ${txUrl(tx.hash)}  block=${receipt.blockNumber}`);
    return receipt;
  } catch (err) {
    const receipt = await wallet.provider.getTransactionReceipt(tx.hash).catch(() => null);
    if (receipt) {
      const msg = typeof confirmed === 'function' ? confirmed(receipt) : confirmed;
      log(`${tag}:recovered`, `${msg}  ${txUrl(tx.hash)}  block=${receipt.blockNumber}`);
      return receipt;
    }
    throw makeSentButUnconfirmedError(tx, timeoutMs, err);
  }
}

module.exports = { waitForArcTx };
