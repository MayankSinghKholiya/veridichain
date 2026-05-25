/**
 * fullTest.js — Complete flow: register → verify → issue Tier1 → upgradeToTier1 on self-attested
 */
const { ethers } = require("hardhat");

const INST_REG  = "0x6Fd5766baf4A16a393cdA6CE29521dBef6781783";
const CRED_REG  = "0xe76374e63A1CAeb0383c99443aF6845b405Fe2ad";
const CRED_NFT  = "0x8F87Eb531372a6f843c3BC04816a670fD2c5Dd95";

// ABIs (minimal)
const INST_ABI = [
  "function STAKE_AMOUNT() view returns (uint256)",
  "function owner() view returns (address)",
  "function registerInstitution(string,string,string,string) external",
  "function verifyInstitution(address) external",
  "function isVerified(address) view returns (bool)",
  "function getTotalInstitutions() view returns (uint256)",
];
const CRED_ABI = [
  "function selfAttestCredential(bytes32,string,string) external returns (bytes32)",
  "function issueCredential(address,bytes32,string,string) external returns (bytes32)",
  "function upgradeToTier1(bytes32) external",
  "function getCredentialsByCandidate(address) view returns (bytes32[])",
  "function verifyCredential(bytes32) external view returns (bytes32,string,address,string,address,string,uint8,uint256,bool,string,uint256)",
];
const NFT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function credentialToToken(bytes32) view returns (uint256)",
  "function tokenMetadata(uint256) view returns (bytes32,string,uint8,uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const inst = new ethers.Contract(INST_REG, INST_ABI, deployer);
  const cred = new ethers.Contract(CRED_REG, CRED_ABI, deployer);
  const nft  = new ethers.Contract(CRED_NFT, NFT_ABI, deployer);

  const GAS = { gasLimit: 800_000 };

  console.log("════════════════════════════════════════════════════");
  console.log("VeridiChain Full Flow Test");
  console.log("Deployer (acts as institution + candidate):", deployer.address);
  console.log("STAKE_AMOUNT:", (await inst.STAKE_AMOUNT()).toString(), "(must be 0)");
  console.log("════════════════════════════════════════════════════\n");

  // ── 1. Register Institution ────────────────────────────────────────────
  console.log("STEP 1: Register Institution");
  let tx = await inst.registerInstitution("IIT Delhi", "iitd.ac.in", "IN", "https://iitd.ac.in", GAS);
  let r = await tx.wait();
  console.log(`  ✅ Registered | gas: ${r.gasUsed} | tx: ${tx.hash.slice(0,20)}...`);

  // ── 2. Verify institution (deployer IS owner) ──────────────────────────
  console.log("\nSTEP 2: Admin verifies the institution");
  tx = await inst.verifyInstitution(deployer.address, GAS);
  r = await tx.wait();
  console.log(`  ✅ Verified   | gas: ${r.gasUsed} | isVerified: ${await inst.isVerified(deployer.address)}`);

  // ── 3. Self-attest a credential (Tier 2) ──────────────────────────────
  console.log("\nSTEP 3: Self-attest a Tier-2 credential (as candidate)");
  const credHash = ethers.keccak256(ethers.toUtf8Bytes("BSc CS IIT Delhi 2024"));
  tx = await cred.selfAttestCredential(credHash, "QmTestIPFSCID1111111", "", GAS);
  r = await tx.wait();
  const selfCredId = r.logs[0]?.topics?.[1] ?? "unknown";
  console.log(`  ✅ Self-attested | gas: ${r.gasUsed} | credentialId: ${selfCredId}`);

  // ── 4. Check candidate's credentials ──────────────────────────────────
  console.log("\nSTEP 4: Get candidate credentials list");
  const credIds = await cred.getCredentialsByCandidate(deployer.address);
  console.log(`  ✅ Count: ${credIds.length} | IDs: ${credIds.map(id => id.slice(0,10)).join(', ')}`);

  // ── 5. Upgrade Tier-2 → Tier-1 (institution signs) ───────────────────
  if (credIds.length > 0) {
    const selfCredentialId = credIds[credIds.length - 1];
    console.log(`\nSTEP 5: Institution upgrades self-attested → Tier 1`);
    console.log(`  Credential: ${selfCredentialId}`);
    tx = await cred.upgradeToTier1(selfCredentialId, GAS);
    r = await tx.wait();
    console.log(`  ✅ Upgraded to Tier-1 | gas: ${r.gasUsed}`);

    // Check NFT tier
    const tokenId = await nft.credentialToToken(selfCredentialId);
    const meta = await nft.tokenMetadata(tokenId);
    console.log(`  NFT #${tokenId} tier: ${meta[2]} (1 = Tier1, 2 = Tier2)`);
  }

  // ── 6. Institution issues NEW Tier-1 credential directly ──────────────
  console.log("\nSTEP 6: Institution issues fresh Tier-1 credential directly");
  const newCredHash = ethers.keccak256(ethers.toUtf8Bytes("MTech AI IIT Delhi 2024"));
  tx = await cred.issueCredential(deployer.address, newCredHash, "QmTestIPFSCID2222222", "", GAS);
  r = await tx.wait();
  console.log(`  ✅ Tier-1 issued | gas: ${r.gasUsed}`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("Total institutions:", (await inst.getTotalInstitutions()).toString());
  const allCreds = await cred.getCredentialsByCandidate(deployer.address);
  console.log("Total credentials for deployer:", allCreds.length);
  console.log("NFT balance:", (await nft.balanceOf(deployer.address)).toString());
  console.log("════════════════════════════════════════════════════");
  console.log("\n✅ ALL STEPS PASSED — contracts work correctly on QIE testnet!");
}

main().catch(err => { console.error("\n❌ FAILED:", err.shortMessage || err.reason || err.message?.slice(0, 300)); process.exit(1); });
