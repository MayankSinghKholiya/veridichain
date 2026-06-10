/**
 * addInstitutionAdmin.js
 * Grant institution admin rights to a wallet.
 * Admins can verify/reject/revoke institutions (NOT slash).
 *
 * Usage:
 *   ADMIN_WALLET=0x... npx hardhat run scripts/addInstitutionAdmin.js --network qie_mainnet
 */
const { ethers } = require("hardhat");

const PROXY_ADDRESS = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";

// ← Put wallet address here (or pass via env)
const ADMIN_TO_ADD = process.env.ADMIN_WALLET || "0x409B1Aa30d0B9B5E2A6a3e5d85Db2A7Cb0996df";

const ABI = [
  "function addInstitutionAdmin(address) external",
  "function institutionAdmins(address) view returns (bool)",
  "function owner() view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const registry   = new ethers.Contract(PROXY_ADDRESS, ABI, deployer);

  const owner = await registry.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error("ERROR: not the owner — aborting"); process.exit(1);
  }

  console.log(`\nAdding institution admin: ${ADMIN_TO_ADD}`);
  const tx = await registry.addInstitutionAdmin(ADMIN_TO_ADD, { gasLimit: 100_000 });
  await tx.wait();
  console.log("✓ tx:", tx.hash);

  const isAdmin = await registry.institutionAdmins(ADMIN_TO_ADD);
  console.log("institutionAdmins[wallet] =", isAdmin ? "✅ true" : "❌ false");
  if (isAdmin) console.log("\n✅ Done! Wallet can now verify/reject/revoke institutions.\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
