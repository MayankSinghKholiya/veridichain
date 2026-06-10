// UUPS upgrade script for InstitutionRegistry
// Usage: npx hardhat run scripts/upgradeInstitutionRegistry.js --network qie_mainnet

const { ethers, upgrades } = require("hardhat");

const PROXY_ADDRESS   = process.env.NEXT_PUBLIC_INSTITUTION_REGISTRY
  || "0x936129F672B2754c25e569a5BEC7b689BaD174c1";

const WQIE_ADDRESS    = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
const QUSDC_ADDRESS   = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const DEX_ROUTER      = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";

const WQIE_STAKE_AMOUNT = ethers.parseEther("1");
const QUSDC_FEE_AMOUNT  = 1_000_000n;  // 1 QUSDC (6 decimals)

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer :", deployer.address);
  console.log("Proxy    :", PROXY_ADDRESS);

  // Check QUSDC decimals before setting fee
  let qusdcDecimals = 6n;
  try {
    const erc20 = await ethers.getContractAt(
      ["function decimals() view returns (uint8)"],
      QUSDC_ADDRESS
    );
    qusdcDecimals = BigInt(await erc20.decimals());
    console.log("QUSDC decimals:", qusdcDecimals.toString());
  } catch {
    console.log("Could not fetch QUSDC decimals — assuming 6");
  }
  const feeAmount = 10n ** qusdcDecimals;
  console.log("QUSDC fee :", feeAmount.toString(), "(1 QUSDC)");
  console.log("WQIE stake:", ethers.formatEther(WQIE_STAKE_AMOUNT), "WQIE");

  console.log("\n[1/4] Upgrading implementation...");
  const InstitutionRegistry = await ethers.getContractFactory("InstitutionRegistry");
  const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, InstitutionRegistry, {
    kind: "uups",
    unsafeAllow: ["constructor"],
  });
  await upgraded.waitForDeployment();
  const newImpl = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log("      new implementation:", newImpl);
  console.log("      proxy unchanged   :", PROXY_ADDRESS);

  console.log("\n[2/4] Setting WQIE token...");
  let tx = await upgraded.setWqieToken(WQIE_ADDRESS);
  await tx.wait();

  console.log("\n[3/4] Setting QUSDC (registration fee token)...");
  tx = await upgraded.setQieStableCoin(QUSDC_ADDRESS);
  await tx.wait();

  console.log("\n[4/4] Setting amounts + DEX router...");
  tx = await upgraded.setStakeAmount(WQIE_STAKE_AMOUNT);
  await tx.wait();

  tx = await upgraded.setRegistrationFee(feeAmount);
  await tx.wait();

  tx = await upgraded.setQieDex(DEX_ROUTER);
  await tx.wait();

  // Verify on-chain state
  console.log("\nVerifying on-chain state...");
  const wqie     = await upgraded.wqieToken();
  const qusdc    = await upgraded.qieStableCoin();
  const stake    = await upgraded.STAKE_AMOUNT();
  const fee      = await upgraded.REGISTRATION_FEE();
  const dex      = await upgraded.qieDex();
  const treasury = await upgraded.TREASURY();

  console.log("  wqieToken        :", wqie);
  console.log("  qieStableCoin    :", qusdc);
  console.log("  STAKE_AMOUNT     :", ethers.formatEther(stake), "WQIE");
  console.log("  REGISTRATION_FEE :", fee.toString(), "QUSDC units");
  console.log("  qieDex           :", dex);
  console.log("  TREASURY         :", treasury);

  console.log("\nDone. Proxy address unchanged — no .env updates needed.");
}

main().catch((error) => {
  console.error("Upgrade failed:", error.message);
  process.exitCode = 1;
});
