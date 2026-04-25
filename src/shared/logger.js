'use strict';
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function stamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

function dateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// Chain inference: tag berformat "<chain>:<event>" (mis. "arc:tx") atau pakai LOG_CHAIN env.
// Kalau tidak ada match, default "farm" (legacy backward-compat).
function inferChain(tag) {
  if (typeof tag === 'string' && tag.includes(':')) {
    const prefix = tag.split(':')[0].toLowerCase();
    if (['arc', 'litvm'].includes(prefix)) return prefix;
  }
  return process.env.LOG_CHAIN || 'farm';
}

function todayFile(chain) {
  const c = chain || process.env.LOG_CHAIN || 'farm';
  return path.join(LOG_DIR, `${c}-${dateStamp()}.log`);
}

function write(tag, msg, chainOverride) {
  const chain = chainOverride || inferChain(tag);
  const line = `[${stamp()}] [${tag}] ${msg}\n`;
  try {
    fs.appendFileSync(todayFile(chain), line);
  } catch (_) {}
}

// logFile(tag, ...parts) — tag bisa pakai prefix "arc:" / "litvm:" untuk chain routing.
// Atau pakai logFile.withChain('arc') untuk dapat logger chain-bound.
function logFile(tag, ...parts) {
  const msg = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  write(tag, msg);
}

logFile.withChain = function (chain) {
  return function (tag, ...parts) {
    const msg = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    write(tag, msg, chain);
  };
};

module.exports = { logFile, todayFile, LOG_DIR };
