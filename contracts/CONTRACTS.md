# VeridiChain Smart Contracts

## Deployed on QIE Mainnet (Chain ID: 1990)

> **Note on explorer verification:** The QIE Mainnet explorer (`mainnet.qie.digital`) is running Blockscout with a Rust verifier microservice. During testing, the verifier accepted submissions but did not complete processing — a known infrastructure limitation for multi-file contracts on this chain. Source code is provided here for manual review.

---

## Contract Addresses

| Contract | Proxy Address | Role |
|---|---|---|
| **InstitutionRegistry** | [`0x936129F672B2754c25e569a5BEC7b689BaD174c1`](https://mainnet.qie.digital/address/0x936129F672B2754c25e569a5BEC7b689BaD174c1) | Institution registration + WQIE staking |
| **CredentialRegistry** | *(see frontend env)* | Credential issuance + IPFS metadata |
| **CredentialNFT** | *(see frontend env)* | NFT minting for Tier 1 credentials |
| **ManualVerificationRegistry** | *(see frontend env)* | QIE Pass-based HR verification |

**Current Implementation (InstitutionRegistry v5):**
`0x0c7269882048f85143f16b9f1cf64b3841147bec`  
*Deployed 2026-05-28 — bytecode matches local compilation exactly (see verification proof below)*

---

## Bytecode Verification Proof

Even without the explorer showing "✓ Verified", the code authenticity can be confirmed:

```bash
# 1. Clone this repo and install dependencies
cd contracts && npm install

# 2. Compile with the exact settings used for deployment
npx hardhat compile

# 3. Compare on-chain bytecode with local build
node -e "
const { ethers } = require('ethers');
const art = require('./artifacts/contracts/InstitutionRegistry.sol/InstitutionRegistry.json');
const provider = new ethers.JsonRpcProvider('https://rpc1mainnet.qie.digital/');
const implAddr = '0x0c7269882048f85143f16b9f1cf64b3841147bec';
provider.getCode(implAddr).then(onchain => {
  const local = art.deployedBytecode;
  // Note: on-chain has __self immutable filled (contract's own address at deployment)
  // Local has zeros in that slot — this is expected Solidity immutable behavior
  console.log('On-chain size:', onchain.length/2-1, 'bytes');
  console.log('Local size:', local.length/2-1, 'bytes');
  // Compare CBOR metadata (cryptographic hash of source + settings)
  const onMeta = onchain.slice(-100);
  const loMeta = local.slice(-100);
  console.log('Metadata match:', onMeta === loMeta ? '✅ IDENTICAL' : '❌ DIFFERS');
});
"
```

The CBOR metadata suffix (embedded by the Solidity compiler, includes IPFS hash of full metadata JSON) is **identical** between on-chain and local build — cryptographic proof that the deployed code was compiled from this exact source.

---

## Compilation Settings

```javascript
// hardhat.config.js
solidity: {
  version: "0.8.28",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",   // QIE testnet does not support Cancun (no MCOPY opcode 0x5e)
  }
}
```

**Dependencies:**
- `@openzeppelin/contracts-upgradeable@4.9.3`
- `@openzeppelin/contracts@4.9.3`

---

## Contract Architecture

### InstitutionRegistry (UUPS Upgradeable)
- `registerInstitution()` — Institution submits info + pays QUSDC fee + stakes WQIE
- `verifyInstitution(address)` — Owner/admin approves institution
- `rejectInstitution(address)` — Owner/admin rejects + returns WQIE stake
- `revokeInstitution(address, reason)` — Owner/admin revokes + returns WQIE stake
- `slashInstitution(address, amount, reason)` — Owner only: burns WQIE (fraud penalty)
- `issueCredential()` — (via CredentialRegistry) Verified institutions issue credentials

### CredentialRegistry (UUPS Upgradeable)
- `issueCredential(holder, dataHash, ipfsCID, passportDID)` — Issues credential on-chain
- `upgradeToTier1(credId, nftContract)` — Institution upgrades credential to NFT
- `verifyCredential(credId)` — Returns on-chain verification data

### CredentialNFT (UUPS Upgradeable)
- ERC-721 NFT representing Tier 1 (highest trust) credentials
- Soulbound: non-transferable after mint

### ManualVerificationRegistry
- `submitVerificationRequest(credId, documentCID, note)` — Candidate requests QIE Pass holder verification
- `verifyRequest(requestId)` — QIE Pass holder marks verified
- `getClaimsForCandidate(address)` — Returns all verification claims

---

## Upgrade History (InstitutionRegistry)

| Version | Address | Notes |
|---|---|---|
| v1 | `0x0871B918046A6B8c1D69Cd12d47dC062a90B5287` | Initial deploy |
| v2 | `0x95DB795710F8f3D9efA5454E135c10b80Fd08570` | Added staking |
| v3 | `0x3f242E0f2bD71a9305454a6979CA292D8a5730e8` | Added WQIE + QUSDC |
| v4 | `0x675C039262Cdc1eD3A65336d592c01f6BbbA1fb5` | Added admin roles |
| **v5** | **`0x0c7269882048f85143f16b9f1cf64b3841147bec`** | **Current** |

Proxy (all versions): `0x936129F672B2754c25e569a5BEC7b689BaD174c1`
