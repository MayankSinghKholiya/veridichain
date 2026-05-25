# VeridiChain — Decentralized Credential Verification on QIE Blockchain

> QIE Hackathon 2026 | Track: Social & Community

## Quick Start

```bash
# 1. Clone / unzip this project
# 2. Install all dependencies
npm run install:all

# 3. Copy env files and fill values
cp contracts/.env.example contracts/.env
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env

# 4. Start local blockchain
cd contracts && npx hardhat node

# 5. Deploy contracts locally
npx hardhat run scripts/deploy.js --network localhost

# 6. Start backend
cd ../backend && npm run dev

# 7. Start frontend
cd ../frontend && npm run dev
```

## Project Structure

```
veridichain/
├── contracts/          — Solidity smart contracts (Hardhat)
│   ├── contracts/      — .sol files
│   ├── scripts/        — deploy scripts
│   └── test/           — contract tests
├── frontend/           — Next.js 14 app
│   ├── app/            — App Router pages
│   ├── components/     — Reusable UI components
│   └── lib/            — ethers.js, wagmi config, utils
└── backend/            — Node.js + Express API
    ├── src/            — routes, middleware, services
    └── prisma/         — DB schema
```

## QIE Integration Points

| Component | Where Used | Depth |
|---|---|---|
| QIE Chain | All contracts deployed here | Foundation |
| QIE Wallet | Primary auth connector | Core |
| QIE Pass | Institution identity check (onchain modifier) | Core |
| QIE Stable Coin | Institution staking + slash logic | Core |
| QIE DEX | Slash treasury → liquidity pool | Core |

## Deployed Contracts (Testnet)

> Fill these after deployment

- InstitutionRegistry: `0x...`
- CredentialRegistry: `0x...`
- CredentialNFT: `0x...`
- TreasuryManager: `0x...`

## Tech Stack

- **Contracts**: Solidity 0.8.20, Hardhat, OpenZeppelin UUPS
- **Frontend**: Next.js 14, Tailwind CSS, ethers.js v6, wagmi v2
- **Backend**: Node.js, Express, PostgreSQL, Prisma, JWT
- **Storage**: IPFS via Pinata (offchain encrypted data)
- **Chain**: QIE Testnet (Chain ID: 1983)
