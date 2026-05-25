/**
 * fixDirect.js — bypass upgrades plugin, call upgradeTo manually
 */
const { ethers } = require("hardhat");

const PROXY = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);
  console.log("balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "QIE\n");

  // 1. Deploy new implementation (bare, not proxy)
  console.log("1. Deploying new implementation...");
  const Factory = await ethers.getContractFactory("InstitutionRegistry");
  const impl = await Factory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("   New impl deployed:", implAddr);

  // 2. Call upgradeTo on the PROXY (delegates to current impl which has _authorizeUpgrade)
  console.log("\n2. Calling upgradeTo on proxy...");
  const proxy = new ethers.Contract(PROXY, [
    "function upgradeTo(address newImplementation) external",
    "function upgradeToAndCall(address newImplementation, bytes calldata data) external payable",
    "function owner() view returns (address)",
    "function STAKE_AMOUNT() view returns (uint256)",
    "function setStakeAmount(uint256 _amount) external",
  ], deployer);

  // Try upgradeToAndCall with empty data first
  const tx = await proxy.upgradeToAndCall(implAddr, "0x");
  await tx.wait();
  console.log("   upgradeTo confirmed:", tx.hash);

  // 3. Call setStakeAmount(0)
  console.log("\n3. Setting STAKE_AMOUNT to 0...");
  const tx2 = await proxy.setStakeAmount(0);
  await tx2.wait();
  console.log("   setStakeAmount(0) confirmed:", tx2.hash);

  // 4. Verify
  const newStake = await proxy.STAKE_AMOUNT();
  console.log("\n4. STAKE_AMOUNT is now:", newStake.toString(), "(should be 0)");
  console.log("\n✅ Done! Institution registration now works without QIEUSD stake.");
}

main().catch(console.error);
