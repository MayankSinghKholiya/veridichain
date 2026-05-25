# VeridiChain — Complete Setup Guide

## Prerequisites
- Node.js v18+ 
- PostgreSQL (local or Railway)
- MetaMask browser extension
- Git

---

## Step 1 — Install Dependencies

```bash
npm run install:all
```

---

## Step 2 — Environment Setup

```bash
# Contracts
cp contracts/.env.example contracts/.env

# Frontend  
cp frontend/.env.example frontend/.env.local

# Backend
cp backend/.env.example backend/.env
```

Fill in each .env file. Key values needed:
- `PRIVATE_KEY` — your deployer wallet private key
- `DATABASE_URL` — PostgreSQL connection string  
- `PINATA_API_KEY` — from pinata.cloud (free account)
- `RESEND_API_KEY` — from resend.com (free account, 3000 emails/month)
- `JWT_SECRET` — any long random string
- `ENCRYPTION_KEY` — exactly 32 characters

---

## Step 3 — Get Testnet QIE Tokens

1. Add QIE Testnet to MetaMask:
   - Network: QIE Testnet
   - Chain ID: 1983
   - RPC: https://rpc1testnet.qie.digital/
   - Symbol: QIE

2. Get testnet tokens:
   - Visit: https://www.qie.digital/faucet
   - Connect MetaMask
   - Request test tokens

---

## Step 4 — Database Setup

```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
```

---

## Step 5 — Deploy Contracts

### Local testing first:
```bash
# Terminal 1: Start local blockchain
cd contracts && npx hardhat node

# Terminal 2: Deploy
npx hardhat run scripts/deploy.js --network localhost
```

### QIE Testnet deploy:
```bash
cd contracts
npx hardhat run scripts/deploy.js --network qie_testnet
```

Copy the deployed contract addresses to:
- `frontend/.env.local`
- `backend/.env`

---

## Step 6 — Verify Contracts on Explorer

```bash
# Replace with actual addresses
npx hardhat verify --network qie_testnet CREDENTIAL_NFT_ADDRESS
npx hardhat verify --network qie_testnet INSTITUTION_REGISTRY_PROXY_ADDRESS
npx hardhat verify --network qie_testnet CREDENTIAL_REGISTRY_PROXY_ADDRESS
```

---

## Step 7 — Start All Services

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend  
cd frontend && npm run dev
```

Open: http://localhost:3000

---

## Step 8 — Run Contract Tests

```bash
cd contracts && npx hardhat test
```

Expected: 10 passing tests ✓

---

## QIE Ecosystem Addresses (fill from docs.qie.digital)

Before mainnet, you need actual QIE ecosystem contract addresses:
- QIE Pass contract address
- QIE Stable Coin (QIEUSD) contract address  
- QIE DEX contract address

Check: https://docs.qie.digital

---

## Project Structure

```
veridichain/
├── contracts/
│   ├── contracts/
│   │   ├── IQIEPass.sol          — QIE Pass interface
│   │   ├── IQIEDex.sol           — QIE DEX interface  
│   │   ├── InstitutionRegistry.sol — Institution logic + staking
│   │   ├── CredentialRegistry.sol  — Credential issue/verify/revoke
│   │   └── CredentialNFT.sol       — Soulbound ERC-721
│   ├── scripts/deploy.js         — Deployment script
│   ├── test/VeridiChain.test.js  — 10 comprehensive tests
│   └── hardhat.config.js         — QIE testnet config
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx              — Landing page (TODO)
│   │   ├── institution/          — Institution dashboard (TODO)
│   │   ├── candidate/            — Candidate profile (TODO)
│   │   └── verify/               — Public verifier page (TODO)
│   ├── lib/
│   │   ├── wagmi.ts              — QIE chain + wallet config
│   │   └── contracts.ts          — ABIs + addresses
│   └── components/               — UI components (TODO)
│
└── backend/
    ├── src/
    │   ├── routes/
    │   │   ├── auth.js           — Email OTP + JWT
    │   │   ├── ipfs.js           — Pinata upload/decrypt
    │   │   ├── credential.js     — Credential cache + logs
    │   │   └── institution.js    — Institution metadata
    │   └── index.js              — Express server
    └── prisma/schema.prisma      — DB schema
```

---

## What's TODO (Build during hackathon)

- [ ] Frontend pages (Next.js components)
- [ ] QIE Wallet official connector (when SDK is available)
- [ ] QIE Pass actual contract interface verification
- [ ] QIE Stable Coin (QIEUSD) actual contract address
- [ ] QIE DEX actual addLiquidity interface
- [ ] Live activity dashboard (ethers.js event listening)
- [ ] Credential share page
- [ ] Admin panel for institution verification

---

## Submission Checklist (Jun 15-19)

- [ ] GitHub repo public with clean README
- [ ] Contracts deployed and verified on QIE testnet
- [ ] Frontend deployed on Vercel
- [ ] Backend deployed on Railway
- [ ] Working demo video recorded
- [ ] Submission form filled at hackathon.qie.digital
