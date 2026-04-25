# Multi Testnet Farm

Multi-wallet farming and transaction generator for:

- Arc Testnet
- LitVM / LiteForge Testnet

The bot supports balance checks, Arc CCTP bridge/resume, daily 24h farming loops, per-chain logs, and optional Telegram notifications.

## Safety

Do not commit private wallet files or runtime secrets. The repo ignores:

- `.env`
- `wallets.txt`
- `wallets.addresses.txt`
- `test-wallet.txt`
- `logs/`
- `.cache/`
- `artifacts/`
- `cache/`
- `node_modules/`

Only `.env.example` should be committed as the public config reference.

## Setup

```bash
git clone https://github.com/rizkypujir/FARM.git
cd FARM
npm install
npm run compile
cp .env.example .env
```

Edit `.env` if needed. The current example is tuned for the default public/testnet setup:

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
```

## Wallets

Recommended: use `wallets.txt`, one private key per line.

```bash
node scripts/generateWallets.js 10
```

You can also set `PRIVATE_KEYS` in `.env`, comma-separated, but `wallets.txt` is easier for multi-wallet runs.

## Run

```bash
npm start
```

Menu:

- Check balance for Arc, LitVM, or all chains
- Bridge Sepolia USDC to Arc
- Resume Arc CCTP bridge by burn tx hash
- Start daily farming loop every 24 hours
- Configure or test Telegram notifications

In `ALL` daily mode, Arc and LitVM run in parallel. The terminal shows a single dashboard line such as:

```text
[/] Arc 3/14   LitVM 5/11
```

## Chain Notes

### Arc Testnet

- Chain ID: `5042002`
- Gas token: native USDC
- Default RPC in `.env.example`: `https://rpc.drpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`

Arc farming tasks include USDC/EURC transfers, approvals, contract deploys, NFT minting, and zkCodex calls.

### LitVM Testnet

- Chain ID: `4441`
- Gas token: zkLTC
- Wrapped token: WzkLTC
- Default RPC: `https://liteforge.rpc.caldera.xyz/http`
- Explorer: `https://liteforge.explorer.caldera.xyz`

LitVM farming tasks use zkLTC/WzkLTC, OnmiFun swap/liquidity tasks, and contract deploys. LitVM does not use USDC in the active farming flow.

## Useful Scripts

```bash
npm run compile
node scripts/testRestructure.js
node scripts/verifyOnmiFun.js
node scripts/testLitvm.js --task balance --wallet 0
```

## VPS

```bash
screen -S farm
npm start
# detach: Ctrl+A then D
# attach: screen -r farm
```

## Logs

Runtime logs are written under `logs/` and are ignored by git:

- `logs/arc-YYYYMMDD.log`
- `logs/litvm-YYYYMMDD.log`

If a task fails, check the matching chain log first. Some Arc testnet RPC errors are transient and the bot retries automatically.
