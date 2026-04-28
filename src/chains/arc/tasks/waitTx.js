'use strict';
const { ethers } = require('ethers');
const { txUrl, log } = require('../../../shared/utils');

function makeSentButUnconfirmedError(tx, timeoutMs, cause) {
  const err = new Error(`tx sent but not confirmed after ${timeoutMs}ms: ${tx.hash}`);
  err.noRetry = true;
  err.txHash = tx.hash;
  err.nonce = tx.nonce;
  err.cause = cause;
  return err;
}

function emitTx(wallet, data) {
  if (typeof wallet.__farmProgress !== 'function') return;
  try {
    wallet.__farmProgress({
      type: 'tx',
      chain: 'arc',
      at: Date.now(),
      ...data,
    });
  } catch {}
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function parseGwei(name, fallback) {
  const raw = process.env[name];
  const value = raw == null || String(raw).trim() === '' ? fallback : String(raw).trim();
  return ethers.parseUnits(value, 'gwei');
}

function bump(value, percent) {
  return (BigInt(value) * BigInt(100 + percent)) / 100n;
}

async function cancelStuckTx(wallet, tx, timeoutMs) {
  if (!envBool('ARC_CANCEL_STUCK_TX', false)) return null;

  const bumpPercent = Number(process.env.ARC_REPLACEMENT_BUMP_PERCENT || 30);
  const minMaxFee = parseGwei('ARC_REPLACEMENT_MAX_FEE_GWEI', '260');
  const minPriorityFee = parseGwei('ARC_REPLACEMENT_PRIORITY_FEE_GWEI', '5');
  const originalMaxFee = tx.maxFeePerGas || tx.gasPrice || minMaxFee;
  const originalPriorityFee = tx.maxPriorityFeePerGas || minPriorityFee;
  const maxFeePerGas = bump(originalMaxFee, bumpPercent) > minMaxFee
    ? bump(originalMaxFee, bumpPercent)
    : minMaxFee;
  const maxPriorityFeePerGas = bump(originalPriorityFee, bumpPercent) > minPriorityFee
    ? bump(originalPriorityFee, bumpPercent)
    : minPriorityFee;

  log('tx:cancel:try', `nonce=${tx.nonce} original=${tx.hash}`);
  emitTx(wallet, { status: 'canceling', hash: tx.hash, nonce: tx.nonce });
  const cancelTx = await wallet.sendTransaction({
    to: wallet.address,
    value: 0n,
    nonce: tx.nonce,
    gasLimit: 21000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });
  log('tx:cancel:sent', `nonce=${tx.nonce} ${txUrl(cancelTx.hash)}`);
  emitTx(wallet, { status: 'cancel-sent', hash: cancelTx.hash, nonce: tx.nonce });
  const receipt = await cancelTx.wait(1, timeoutMs);
  log('tx:cancel', `nonce=${tx.nonce} cleared ${txUrl(cancelTx.hash)} block=${receipt.blockNumber}`);
  emitTx(wallet, { status: 'cancel-confirmed', hash: cancelTx.hash, blockNumber: receipt.blockNumber, nonce: tx.nonce });
  return { hash: cancelTx.hash, receipt };
}

async function recoverIfNonceAdvanced(wallet, tx, confirmed) {
  const receipt = await wallet.provider.getTransactionReceipt(tx.hash).catch(() => null);
  if (receipt) {
    const msg = typeof confirmed === 'function' ? confirmed(receipt) : confirmed;
    log('tx:recovered', `${msg}  ${txUrl(tx.hash)}  block=${receipt.blockNumber}`);
    emitTx(wallet, { status: 'recovered', hash: tx.hash, blockNumber: receipt.blockNumber, nonce: tx.nonce });
    return receipt;
  }

  const latest = await wallet.provider.getTransactionCount(wallet.address, 'latest').catch(() => null);
  if (latest != null && tx.nonce != null && latest > tx.nonce) {
    log('tx:nonce-used', `${tx.hash} nonce=${tx.nonce} already used; treating as recovered`);
    emitTx(wallet, { status: 'nonce-used', hash: tx.hash, nonce: tx.nonce });
    return { hash: tx.hash, blockNumber: 'nonce-used', status: 1 };
  }

  return null;
}

async function waitForArcTx(wallet, tx, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.TX_TIMEOUT_MS || 90000);
  const tag = options.tag || 'tx';
  const sent = options.sent || tx.hash;
  const confirmed = options.confirmed || sent;

  log(`${tag}:sent`, `${sent}  ${txUrl(tx.hash)}`);
  emitTx(wallet, { status: 'sent', hash: tx.hash, tag, nonce: tx.nonce, label: sent });

  try {
    const receipt = await tx.wait(1, timeoutMs);
    const msg = typeof confirmed === 'function' ? confirmed(receipt) : confirmed;
    log(tag, `${msg}  ${txUrl(tx.hash)}  block=${receipt.blockNumber}`);
    emitTx(wallet, { status: 'confirmed', hash: tx.hash, tag, blockNumber: receipt.blockNumber, nonce: tx.nonce, label: msg });
    return receipt;
  } catch (err) {
    const receipt = await recoverIfNonceAdvanced(wallet, tx, confirmed);
    if (receipt) {
      return receipt;
    }
    const pendingErr = makeSentButUnconfirmedError(tx, timeoutMs, err);
    try {
      const cancel = await cancelStuckTx(wallet, tx, timeoutMs);
      if (cancel) {
        pendingErr.nonceCleared = true;
        pendingErr.cancelHash = cancel.hash;
      }
    } catch (cancelErr) {
      const recovered = await recoverIfNonceAdvanced(wallet, tx, confirmed);
      if (recovered) return recovered;
      pendingErr.cancelError = cancelErr.shortMessage || cancelErr.message;
      log('tx:cancel:fail', `nonce=${tx.nonce} ${pendingErr.cancelError}`);
    }
    emitTx(wallet, { status: 'failed', hash: tx.hash, tag, nonce: tx.nonce, reason: pendingErr.shortMessage || pendingErr.message });
    throw pendingErr;
  }
}

module.exports = { waitForArcTx };
