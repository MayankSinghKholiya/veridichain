/**
 * fixStakeAmount.js
 * ─────────────────
 * Upgrades InstitutionRegistry to add setStakeAmount(),
 * then calls setStakeAmount(0) so registration works without QIEUSD.
 *
 * Run:
 *   npx hardhat run scripts/fixStakeAmount.js --network qie_testnet
 */

const { ethers, upgrades } = require("hardhat");

const INSTITUTION_REGISTRY_PROXY = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Upgrading with:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "QIE\n"
  );

  // ── 1. Compile & upgrade proxy to new implementation ──────────────────────
  console.log("1. Upgrading InstitutionRegistry proxy...");
  const InstitutionRegistry = await ethers.getContractFactory("InstitutionRegistry");
  const upgraded = await upgrades.upgradeProxy(INSTITUTION_REGISTRY_PROXY, InstitutionRegistry, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();
  console.log("   Proxy upgraded ✓  (proxy address unchanged:", INSTITUTION_REGISTRY_PROXY, ")");

  // ── 2. Call setStakeAmount(0) ──────────────────────────────────────────────
  console.log("\n2. Setting STAKE_AMOUNT to 0 (free testnet registration)...");
  const tx = await upgraded.setStakeAmount(0);
  await tx.wait();
  console.log("   setStakeAmount(0) confirmed ✓  tx:", tx.hash);

  // ── 3. Verify ────────────────────────────────────────────────────────────
  const newAmount = await upgraded.STAKE_AMOUNT();
  console.log("\n3. STAKE_AMOUNT is now:", newAmount.toString(), "(should be 0)");
  console.log("\n✅ Done — institution registration now works without stablecoin stake.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
