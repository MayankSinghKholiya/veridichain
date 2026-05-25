# VeridiChain

**Decentralized credential verification built on the QIE blockchain.**

Candidates self-attest their academic and professional credentials on-chain.
Institutions issue and counter-sign them. Anyone can verify instantly — no middleman, no PDFs, no trust required.

> Built for QIE Hackathon 2026

---

## Live Demo (QIE Testnet)

| Contract | Address |
|---|---|
| InstitutionRegistry | `0xd20B0b3b663239f4A2Ce05C7d0a9dD734098f90F` |
| CredentialRegistry | `0x4F446C17F438BF545C6991e0b3BBF27Af5Ad35C0` |
| CredentialNFT | `0x01ee46CD8B14a58690b971CC5B6DC0EE353d4D28` |
| ManualVerificationRegistry | `0x006FfB80584F718119021a0477359d4334bB8fD0` |

Chain: **QIE Testnet · Chain ID 1983** · Explorer: https://testnet.qie.digital

---

## How It Works

```
Candidate               Institution              Verifier (Anyone)
──────────              ───────────              ─────────────────
1. KYC via QIE Pass     1. KYC via QIE Pass      1. Paste Credential ID
2. Self-attest cred     2. Register + stake       2. Instant on-chain lookup
3. Request upgrade      3. Get admin-verified     3. See full trust chain:
4. NFT minted on-chain  4. Issue / revoke creds      Institutional › KYC › Self
```

**Verification trust levels** (highest → lowest):
- 🏛️ **Institutional Verified** — upgraded on-chain by a verified institution
- 🔍 **Team Verified** — manually reviewed by VeridiChain team
- ✅ **KYC Verified** — candidate identity linked to a QIE Pass DID
- ✍️ **Self-Attested** — candidate submitted on-chain (base layer, always present)

---

## Tech Stack

| Layer | Tech |
|---|---|
| Blockchain | QIE Testnet (Chain ID 1983) |
| Smart Contracts | Solidity 0.8.20, Hardhat, OpenZeppelin UUPS proxies |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Wallet | wagmi v2, viem, MetaMask / injected wallet |
| Identity | QIE Pass API (HMAC-SHA256, DID-based KYC) |
| Storage | IPFS via Pinata (AES-256-GCM encrypted metadata) |
| NFT | Soulbound ERC-721 (CredentialNFT) |

---

## Prerequisites

Make sure you have these installed before starting:

| Tool | Version | Install |
|---|---|---|
| Node.js | v18 or v20 | https://nodejs.org |
| npm | v9+ | comes with Node |
| Git | any | https://git-scm.com |
| MetaMask | latest | browser extension |

> **No PostgreSQL needed** — the frontend is fully self-contained (no separate backend required to run).

---

## Setup — Step by Step

### 1. Clone the repo

```bash
git clone https://github.com/MayankSinghKholiya/veridichain.git
cd veridichain
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Now open `frontend/.env.local` and fill in the values (see **Environment Variables** section below).

### 4. Add QIE Testnet to MetaMask

| Field | Value |
|---|---|
| Network Name | QIE Testnet |
| RPC URL | `https://rpc1testnet.qie.digital/` |
| Chain ID | `1983` |
| Currency Symbol | `QIE` |
| Block Explorer | `https://testnet.qie.digital` |

### 5. Start the dev server

```bash
cd frontend
npm run dev
```

Open **http://localhost:3000** 🚀

---

## Environment Variables

Copy `frontend/.env.example` → `frontend/.env.local` and fill these in:

```env
# ── QIE Chain (no changes needed) ─────────────────────────────
NEXT_PUBLIC_QIE_RPC_URL=https://rpc1testnet.qie.digital/
NEXT_PUBLIC_QIE_CHAIN_ID=1983
NEXT_PUBLIC_QIE_EXPLORER_URL=https://testnet.qie.digital

# ── Contract Addresses (already deployed — copy as-is) ────────
NEXT_PUBLIC_INSTITUTION_REGISTRY=0xd20B0b3b663239f4A2Ce05C7d0a9dD734098f90F
NEXT_PUBLIC_CREDENTIAL_REGISTRY=0x4F446C17F438BF545C6991e0b3BBF27Af5Ad35C0
NEXT_PUBLIC_CREDENTIAL_NFT=0x01ee46CD8B14a58690b971CC5B6DC0EE353d4D28
NEXT_PUBLIC_MANUAL_VERIFICATION_REGISTRY=0x006FfB80584F718119021a0477359d4334bB8fD0

# ── QIE Ecosystem (testnet placeholders — leave as zero) ───────
NEXT_PUBLIC_QIE_PASS_ADDRESS=0x0000000000000000000000000000000000000000
NEXT_PUBLIC_QIE_STABLE_COIN_ADDRESS=0x0000000000000000000000000000000000000000
NEXT_PUBLIC_QIE_DEX_ADDRESS=0x0000000000000000000000000000000000000000

# ── QIE Pass API (SERVER-SIDE ONLY) ───────────────────────────
# Get from: https://pass-api.qie.digital → partner dashboard
QIEPASS_BASE_URL=https://pass-api.qie.digital
QIEPASS_PUBLIC_KEY=pk_live_...
QIEPASS_SECRET_KEY=sk_live_...

# ── Pinata IPFS (SERVER-SIDE ONLY) ────────────────────────────
# Get from: https://app.pinata.cloud → API Keys → New Key (Admin scope)
PINATA_JWT=eyJhbGci...

# ── Credential metadata encryption (SERVER-SIDE ONLY) ─────────
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
METADATA_ENC_KEY=<64-char hex string>

# ── Admin wallet whitelist (comma-separated, case-insensitive) ─
# These wallets get full admin access on the /admin page
NEXT_PUBLIC_ADMIN_WALLETS=0xYourWalletAddress

# ── Misc ───────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs/
NEXT_PUBLIC_QIEPASS_PUBLIC_KEY=pk_live_...
```

### Where to get each key

| Key | How to get |
|---|---|
| `QIEPASS_PUBLIC_KEY` / `QIEPASS_SECRET_KEY` | Apply for QIE Pass partner access at https://pass-api.qie.digital |
| `PINATA_JWT` | Sign up free at https://app.pinata.cloud → API Keys → New Key → Admin scope |
| `METADATA_ENC_KEY` | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_ADMIN_WALLETS` | Your own MetaMask wallet address |

> **Note:** Keys prefixed with `NEXT_PUBLIC_` are exposed to the browser. Keys without that prefix are server-side only and never sent to the client.

---

## Project Structure

```
veridichain/
│
├── frontend/                          — Next.js 14 app (main codebase)
│   ├── app/
│   │   ├── page.tsx                   — Landing page
│   │   ├── candidate/page.tsx         — Candidate dashboard (KYC + attest)
│   │   ├── institution/page.tsx       — Institution dashboard (register + issue)
│   │   ├── verify/page.tsx            — Public credential verifier
│   │   ├── admin/page.tsx             — Admin panel (team verification, institutions)
│   │   └── api/
│   │       ├── verify/[credId]/       — Server-side credential lookup (cached)
│   │       ├── qiepass/               — QIE Pass KYC flow (request, claim, verify)
│   │       ├── metadata/              — IPFS encrypt / decrypt endpoints
│   │       └── share-token/           — Shareable credential link tokens
│   │
│   ├── components/shared/
│   │   ├── Navbar.tsx                 — Top nav with wallet connect + role badge
│   │   ├── QIEPassVerify.tsx          — One-time KYC verification component
│   │   └── Toast.tsx                  — Global toast notification system
│   │
│   └── lib/
│       ├── contracts.ts               — All ABIs + deployed contract addresses
│       ├── getLogs.ts                 — Paginated eth_getLogs (QIE 10k block limit)
│       ├── qiepassApi.ts              — QIE Pass API client (HMAC-SHA256 auth)
│       └── wagmi.ts                   — wagmi v2 config for QIE Testnet
│
├── contracts/                         — Solidity smart contracts (Hardhat)
│   ├── contracts/
│   │   ├── InstitutionRegistry.sol    — Institution register, stake, verify, slash
│   │   ├── CredentialRegistry.sol     — Issue, upgrade, revoke credentials
│   │   ├── CredentialNFT.sol          — Soulbound ERC-721 NFT per credential
│   │   └── ManualVerificationRegistry.sol — Team verification request/approve flow
│   └── scripts/
│       ├── deploy.js                  — Deploy all contracts to QIE testnet
│       └── deployManualVerification.js — Deploy ManualVerificationRegistry
│
└── backend/                           — Node.js Express API (optional, not required for frontend)
    └── src/routes/                    — credential, institution, ipfs, auth routes
```

---

## Re-deploying Contracts (optional)

If you want to deploy your own contract instances:

```bash
# 1. Install contract deps
cd contracts && npm install

# 2. Set your deployer private key
cp .env.example .env
# Edit .env: PRIVATE_KEY=your_wallet_private_key_without_0x

# 3. Deploy to QIE Testnet
npx hardhat run scripts/deploy.js --network qie_testnet

# 4. Copy the printed addresses into frontend/.env.local
```

> Make sure your deployer wallet has QIE testnet tokens.
> Faucet: https://www.qie.digital/faucet

---

## Key Features

- **One-time KYC** — QIE Pass identity verification, permanent and non-transferable
- **Role exclusivity** — a wallet can be either candidate OR institution, not both
- **Soulbound NFTs** — credentials are non-transferable ERC-721 tokens
- **IPFS encryption** — credential details encrypted with AES-256-GCM, only unlockable via share link
- **Smart cache** — verify API reads directly from contract storage (no event scan bugs), 90s TTL with live revoke validation
- **Badge hierarchy** — 🏛️ Institutional › 🔍 Team › ✅ KYC › ✍️ Self-Attested (all layers visible)
- **Revoke-aware** — revoked credentials never show "Valid" even from cache

---

## QIE Integration Points

| Feature | QIE Component |
|---|---|
| User identity / KYC | QIE Pass API (HMAC-SHA256, DID-based) |
| Credential storage | QIE Testnet smart contracts |
| NFT minting | QIE Testnet (Chain ID 1983) |
| Transaction explorer | https://testnet.qie.digital |
| Wallet connection | Any injected EIP-1193 wallet (MetaMask etc.) on QIE chain |

---

## Contributing / Running locally after changes

```bash
# Make your changes, then:
cd /path/to/veridichain
git add -A
git commit -m "your message"
git push
```

The `frontend/.env.local` file is gitignored — it will never be pushed. Always keep a backup of your keys.
