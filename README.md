# VeridiChain

Credential verification on the QIE Blockchain. Institutions register, issue Soulbound NFTs to candidates, and anyone can verify in seconds — no login, no fee.

**Live:** [veridichain.vercel.app](https://veridichain.vercel.app)

---

## What it does

Institutions pay a small registration fee (0.1 QUSDC) and stake 0.1 WQIE as collateral. Once approved, they can issue credentials to candidates. Each credential is encrypted with AES-256-GCM client-side, stored on IPFS, and minted as a Soulbound NFT — non-transferable, permanent.

Candidates share a link. Anyone opening it can verify the credential in under 2 seconds, fully on-chain.

If an institution commits fraud, their WQIE stake gets slashed — 50% burned, 50% goes to treasury.

---

## Project structure

```
frontend/   — Next.js 14 app
contracts/  — Solidity contracts (UUPS upgradeable)
backend/    — QIE Pass API helpers
```

---

## Contracts — QIE Mainnet (Chain ID 1990)

| Contract | Address |
|---|---|
| InstitutionRegistry (proxy) | `0x936129F672B2754c25e569a5BEC7b689BaD174c1` |
| CredentialRegistry | deploy via `scripts/deploy.js` |
| CredentialNFT | deploy via `scripts/deploy.js` |
| ManualVerificationRegistry | deploy via `scripts/deploy.js` |

InstitutionRegistry is UUPS upgradeable. The proxy address stays the same across upgrades.

Implementation history:

| Version | Address |
|---|---|
| v1 | `0x0871B918046A6B8c1D69Cd12d47dC062a90B5287` |
| v2 | `0x95DB795710F8f3D9efA5454E135c10b80Fd08570` |
| v3 | `0x3f242E0f2bD71a9305454a6979CA292D8a5730e8` |
| v4 | `0x675C039262Cdc1eD3A65336d592c01f6BbbA1fb5` |
| v5 (current) | `0x0c7269882048f85143f16b9f1cf64b3841147bec` |

---

## Running locally

You need Node 18+, MetaMask on QIE Mainnet (Chain ID 1990, RPC: `https://rpc1mainnet.qie.digital/`), and a Pinata account for IPFS.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

Open `.env.local` and fill in the values. The `NEXT_PUBLIC_INSTITUTION_REGISTRY` is already set to the live mainnet proxy. For the other contract addresses, either deploy your own or reach out.

A few things you'll need to get yourself:
- `PINATA_JWT` — from [app.pinata.cloud](https://app.pinata.cloud) → API Keys → New Key
- `QIEPASS_PUBLIC_KEY` / `QIEPASS_SECRET_KEY` — from the QIE Pass partner portal. **Note: this project currently uses the QIE Pass Sandbox** (`https://did-stapi.qie.digital`) because the mainnet QIE Pass requires a paid partner plan. Set `QIEPASS_BASE_URL=https://did-stapi.qie.digital` and use sandbox keys (`pk_test_...` / `sk_test_...`). To switch to mainnet, change `QIEPASS_BASE_URL` to `https://pass-api.qie.digital` and replace with live keys.
- `METADATA_ENC_KEY` — generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

```bash
npm run dev
```

### Contracts

```bash
cd contracts
npm install
cp .env.example .env
# add your PRIVATE_KEY to .env
npx hardhat compile
npx hardhat run scripts/deploy.js --network qie_mainnet
```

---

## Updating fees (owner only)

Edit `contracts/scripts/updateFees.js`:

```js
const NEW_FEE   = 100_000n;          // 0.1 QUSDC (6 decimals)
const NEW_STAKE = parseEther("0.1"); // 0.1 WQIE
```

Then run:

```bash
cd contracts
npx hardhat run scripts/updateFees.js --network qie_mainnet
```

---

## Stake mechanics

When an institution is rejected while still pending, their WQIE is returned. Same if they're revoked after verification or leave voluntarily. If they get slashed for fraud, 50% of the stake is burned to the dead address and 50% goes to treasury.

---

## Credential tiers

**Tier 1** — Soulbound NFT issued by a registered institution. Higher trust, backed by their staked WQIE.

**Tier 2** — On-chain hash only, no NFT. Cheaper, used for self-attestation or lower-stakes use cases.

---

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind
- Wagmi v2, Viem
- Solidity 0.8.28, OpenZeppelin 4.9.3 (UUPS proxies)
- IPFS via Pinata
- AES-256-GCM encryption (client-side, before upload)
- QIE Pass for KYC / identity (currently **Sandbox** — mainnet was paid, so we switched to sandbox)

---

## Known gaps / TODO

- Institutions can't browse all credentials they've issued — needs a dedicated tab
- Batch credential issuance (upload CSV → one transaction) — not built yet
- Credential revocation UI — contract supports it, frontend doesn't expose it yet
- QIE Pass state is in localStorage — breaks across devices/browsers
- Smart contract verification on QIE explorer is broken server-side (Blockscout Rust verifier doesn't complete jobs for multi-file contracts). Bytecode matches exactly — see `contracts/CONTRACTS.md`.
- No WalletConnect yet, so mobile users are out

---

## License

MIT
