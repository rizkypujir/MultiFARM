# MultiFARM

MultiFARM is a multi-wallet testnet farming helper for Arc Testnet and
LitVM / LiteForge Testnet.

It is made for repeated testnet activity: balance checks, small transfers,
approvals, contract deploys, Arc CCTP bridge/resume, LitVM OnmiFun tasks, and
daily 24 hour farming loops.

> Testnet only. Use burner wallets. Never use mainnet private keys.

## What It Supports

| Network | Chain ID | Gas token | Notes |
| --- | ---: | --- | --- |
| Arc Testnet | `5042002` | USDC | Uses native USDC on Arc. |
| LitVM / LiteForge | `4441` | zkLTC | Uses zkLTC and WzkLTC. No USDC is needed for LitVM farming. |

## Features

- Multi-wallet runner from `wallets.txt` or `PRIVATE_KEYS`
- Arc-only, LitVM-only, or all-chain mode
- Parallel Arc + LitVM daily farming with one clean terminal dashboard
- Arc CCTP bridge from Sepolia and resume by burn transaction hash
- LitVM zkLTC/WzkLTC farming tasks
- Per-chain logs under `logs/`
- Optional Telegram notifications
- Git ignore rules for private keys, local env files, logs, and runtime cache

## Quick Start

```bash
git clone https://github.com/rizkypujir/MultiFARM.git
cd MultiFARM
npm install
npm run compile
cp .env.example .env
npm start
```

On Windows PowerShell, copy the example env file with:

```powershell
Copy-Item .env.example .env
```

After copying, open `.env` and adjust only what you need.

## Wallet Setup

Recommended setup: put one private key per line in `wallets.txt`.

```text
0xabc...
0xdef...
```

You can generate burner wallets with:

```bash
node scripts/generateWallets.js 10
```

The generated private keys go to `wallets.txt`, and public addresses go to
`wallets.addresses.txt`. Both files are ignored by git.

You can also put comma-separated private keys in `.env`:

```env
PRIVATE_KEYS=0xabc...,0xdef...
```

For public use, `wallets.txt` is usually easier to manage.

## Configuration

The public reference config is `.env.example`. Your real local config should be
`.env`, and `.env` must stay private.

Important defaults:

```env
RPC_URL=https://rpc.drpc.testnet.arc.network
CHAIN_ID=5042002
EXPLORER=https://testnet.arcscan.app

LITVM_RPC_URL=https://liteforge.rpc.caldera.xyz/http
LITVM_CHAIN_ID=4441
LITVM_EXPLORER=https://liteforge.explorer.caldera.xyz

DELAY_MIN_MS=100
DELAY_MAX_MS=500
BATCH_SIZE=2
LITVM_BATCH_SIZE=2
COUNTER_PER_CYCLE=1
TASK_TIMEOUT_MS=180000
```

If the public Arc RPC feels slow or unstable, use your own RPC endpoint and set
it in `RPC_URL`.

## Run

```bash
npm start
```

The menu includes:

- Check Arc balance
- Check LitVM balance
- Check all balances
- Bridge Sepolia USDC to Arc
- Resume Arc CCTP bridge by burn transaction hash
- Run Arc daily farming
- Run LitVM daily farming
- Run all supported chains in parallel
- Configure or test Telegram notifications

In all-chain daily mode, Arc and LitVM run together. The terminal uses one
dashboard line so the output stays readable:

```text
[/] Arc 3/14   LitVM 5/11
```

## Arc Notes

Arc uses native USDC as its gas token.

Common Arc tasks include:

- USDC and EURC transfers
- Token approvals
- Contract deploys
- NFT minting
- zkCodex calls
- CCTP bridge/resume flow

Arc testnet RPC errors can happen during busy periods. The bot retries many
transient failures, but a private or higher quality RPC usually gives smoother
runs.

## LitVM Notes

LitVM / LiteForge uses zkLTC as gas and WzkLTC for wrapped-token tasks.

Common LitVM tasks include:

- zkLTC balance checks
- WzkLTC wrap/unwrap related activity
- OnmiFun swap and liquidity tasks
- Contract deploys

LitVM farming does not require USDC in the active flow.

## Useful Scripts

```bash
npm run compile
node scripts/testRestructure.js
node scripts/verifyOnmiFun.js
node scripts/testLitvm.js --task balance --wallet 0
```

## Running On A VPS

```bash
screen -S multifarm
npm start
```

Detach from screen:

```text
Ctrl+A then D
```

Attach again:

```bash
screen -r multifarm
```

## Logs

Runtime logs are written under `logs/`:

```text
logs/arc-YYYYMMDD.log
logs/litvm-YYYYMMDD.log
```

If something fails, check the matching chain log first. Logs are ignored by git.

## Security Checklist

Before pushing your own fork, make sure these files are not committed:

- `.env`
- `wallets.txt`
- `wallets.addresses.txt`
- `test-wallet.txt`
- `logs/`
- `.cache/`
- `artifacts/`
- `cache/`
- `node_modules/`

Only commit `.env.example` as the public config reference.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Arc feels slow | Use a better RPC in `RPC_URL`, lower `BATCH_SIZE`, or wait for RPC congestion to clear. |
| LitVM skips tasks | Check zkLTC balance and the LitVM log file. |
| All-chain mode looks stuck | Arc and LitVM run in parallel; check each chain counter and logs. |
| Bridge is pending | Use the resume menu with the Arc CCTP burn transaction hash. |
| Telegram does not send | Recheck `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and run the test notification menu. |

## Disclaimer

This project is for testnet automation and learning. Testnet networks, RPCs,
contracts, faucets, and dApps can change at any time, so always review config
and task behavior before running many wallets.
