'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const { logFile } = require('./logger');

const storage = new AsyncLocalStorage();
let activeCaptures = 0;
let original = null;

function stringify(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function line(args) {
  return args.map(stringify).join(' ');
}

function patchConsole() {
  if (original) return;
  original = { log: console.log, error: console.error };

  console.log = (...args) => {
    const ctx = storage.getStore();
    if (ctx && ctx.chain) {
      logFile.withChain(ctx.chain)(ctx.tag || 'task', line(args));
      return;
    }
    original.log(...args);
  };

  console.error = (...args) => {
    const ctx = storage.getStore();
    if (ctx && ctx.chain) {
      logFile.withChain(ctx.chain)(ctx.errTag || `${ctx.tag || 'task'}:err`, line(args));
      return;
    }
    original.error(...args);
  };
}

function unpatchConsole() {
  if (!original) return;
  console.log = original.log;
  console.error = original.error;
  original = null;
}

async function capture(chain, tag, fn) {
  if (typeof tag === 'function') {
    fn = tag;
    tag = 'task';
  }
  activeCaptures++;
  patchConsole();
  try {
    return await storage.run({ chain, tag, errTag: `${tag}:err` }, fn);
  } finally {
    activeCaptures--;
    if (activeCaptures <= 0) {
      activeCaptures = 0;
      unpatchConsole();
    }
  }
}

module.exports = { capture };
