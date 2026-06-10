/**
 * updateFees.js
 * Update registration fee + stake amount on InstitutionRegistry proxy.
 *
 * Usage:
 *   npx hardhat run scripts/updateFees.js --network qie_mainnet
 */
const { ethers } = require("hardhat");

const PROXY_ADDRESS = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";

const ABI = [
  "function setRegistrationFee(uint256) external",
  "function setStakeAmount(uint256) external",
  "function REGISTRATION_FEE() view returns (uint256)",
  "function STAKE_AMOUNT() view returns (uint256)",
  "function owner() view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const registry   = new ethers.Contract(PROXY_ADDRESS, ABI, deployer);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  Update InstitutionRegistry Fees");
  console.log("═══════════════════════════════════════════════");
  console.log("Deployer :", deployer.address);

  const owner = await registry.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error("ERROR: not the owner — aborting"); process.exit(1);
  }

  // 0.1 QUSDC = 100_000 units (6 decimals)
  const NEW_FEE = 100_000n;
  // 0.1 WQIE = 0.1e18 units (18 decimals)
  const NEW_STAKE = ethers.parseEther("0.1");

  console.log("\nSetting REGISTRATION_FEE → 0.01 QUSDC (10000 units)…");
  const tx1 = await registry.setRegistrationFee(NEW_FEE, { gasLimit: 100_000 });
  await tx1.wait();
  console.log("✓ tx:", tx1.hash);

  console.log("Setting STAKE_AMOUNT → 0.1 WQIE…");
  const tx2 = await registry.setStakeAmount(NEW_STAKE, { gasLimit: 100_000 });
  await tx2.wait();
  console.log("✓ tx:", tx2.hash);

  console.log("\n── Verification ──────────────────────────────────");
  const fee   = await registry.REGISTRATION_FEE();
  const stake = await registry.STAKE_AMOUNT();
  console.log("  REGISTRATION_FEE :", fee.toString(), "units →", Number(fee) / 1e6, "QUSDC");
  console.log("  STAKE_AMOUNT     :", ethers.formatEther(stake), "WQIE");
  console.log("\n  ✅ Done!\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
