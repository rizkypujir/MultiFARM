# MultiFARM

Bot multi-wallet untuk farming testnet Arc dan LitVM / LiteForge.

## Install

```bash
git clone https://github.com/rizkypujir/MultiFARM.git
cd MultiFARM
npm install
npm run compile
```

Copy config:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

## Setup Wallet

Isi `wallets.txt` dengan private key, satu wallet per baris:

```text
0xabc...
0xdef...
```

Atau isi langsung di `.env`:

```env
PRIVATE_KEYS=0xabc...,0xdef...
```

Kalau mau generate wallet baru:

```bash
node scripts/generateWallets.js 10
```

Gunakan wallet testnet/burner. Jangan pakai wallet utama.

## Config Utama

Edit `.env` sesuai kebutuhan.

```env
# Arc Testnet
RPC_URL=https://rpc.drpc.testnet.arc.network
CHAIN_ID=5042002
EXPLORER=https://testnet.arcscan.app

# LitVM / LiteForge Testnet
LITVM_RPC_URL=https://liteforge.rpc.caldera.xyz/http
LITVM_WS_URL=wss://liteforge.rpc.caldera.xyz/ws
LITVM_CHAIN_ID=4441
LITVM_EXPLORER=https://liteforge.explorer.caldera.xyz

# Wallet
WALLETS_FILE=wallets.txt
PRIVATE_KEYS=

# Speed / batch
DELAY_MIN_MS=100
DELAY_MAX_MS=500
BATCH_SIZE=2
LITVM_BATCH_SIZE=2
ARC_TASK_RETRIES=0
TASK_TIMEOUT_MS=180000

# Arc minimum balance
MIN_USDC_FARM=0.05

# LitVM minimum balance
LITVM_MIN_ZKLTC_FARM=0.01
```

Catatan token:

- Arc pakai USDC native.
- LitVM pakai zkLTC dan WzkLTC, tidak perlu USDC.

## Jalankan

```bash
npm start
```

Pilih menu yang dibutuhkan:

- Check balance Arc
- Check balance LitVM
- Check semua chain
- Bridge Sepolia USDC ke Arc
- Resume bridge Arc pakai burn tx hash
- Daily farming Arc
- Daily farming LitVM
- Daily farming semua chain
- Telegram config / test

Mode semua chain menjalankan Arc dan LitVM bareng:

```text
[/] Arc 3/9   LitVM 5/10
```

## VPS

```bash
screen -S multifarm
npm start
```

Detach:

```text
Ctrl+A lalu D
```

Masuk lagi:

```bash
screen -r multifarm
```

## Perintah Berguna

```bash
npm start
npm run compile
node scripts/testRestructure.js
node scripts/verifyOnmiFun.js
node scripts/testLitvm.js --task balance --wallet 0
```

## Kalau Macet

| Masalah | Solusi cepat |
| --- | --- |
| Arc lama | Ganti `RPC_URL` ke RPC yang lebih bagus atau turunkan `BATCH_SIZE`. |
| LitVM skip | Cek saldo zkLTC dan nilai `LITVM_MIN_ZKLTC_FARM`. |
| Task timeout | Naikkan `TASK_TIMEOUT_MS`. |
| Terlalu cepat kena rate limit | Naikkan `DELAY_MAX_MS` atau kecilkan batch. |
| Telegram gagal | Cek `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID`. |
