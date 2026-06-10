/**
 * configureInstitutionRegistry.js
 * Run AFTER upgradeInstitutionRegistry.js succeeds.
 * Configures WQIE, QUSDC, DEX, amounts on the already-upgraded proxy.
 *
 * Usage:
 *   npx hardhat run scripts/configureInstitutionRegistry.js --network qie_mainnet
 */
const { ethers } = require("hardhat");

const PROXY_ADDRESS = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";
const WQIE_ADDRESS  = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
const QUSDC_ADDRESS = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const DEX_ROUTER    = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";

const ABI = [
  "function setWqieToken(address) external",
  "function setQieStableCoin(address) external",
  "function setRegistrationFee(uint256) external",
  "function setStakeAmount(uint256) external",
  "function setQieDex(address) external",
  "function wqieToken() view returns (address)",
  "function qieStableCoin() view returns (address)",
  "function REGISTRATION_FEE() view returns (uint256)",
  "function STAKE_AMOUNT() view returns (uint256)",
  "function qieDex() view returns (address)",
  "function TREASURY() view returns (address)",
  "function owner() view returns (address)",
];

async function send(contract, fn, args, label) {
  process.stdout.write(`  ${label}... `);
  try {
    const tx = await contract[fn](...args, { gasLimit: 200_000 });
    await tx.wait();
    console.log("✓  tx:", tx.hash);
  } catch (e) {
    console.log("✗  ERROR:", e.message.slice(0, 120));
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const registry   = new ethers.Contract(PROXY_ADDRESS, ABI, deployer);

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Configure InstitutionRegistry v2");
  console.log("═══════════════════════════════════════════════════");
  console.log("Deployer  :", deployer.address);
  console.log("Proxy     :", PROXY_ADDRESS);

  // Confirm ownership
  const owner = await registry.owner();
  console.log("Owner     :", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error("ERROR: deployer is not the owner — aborting");
    process.exit(1);
  }

  // QUSDC decimals
  let feeAmount = 1_000_000n; // default 6 decimals
  try {
    const erc20 = new ethers.Contract(QUSDC_ADDRESS,
      ["function decimals() view returns (uint8)"], deployer);
    const dec = BigInt(await erc20.decimals());
    feeAmount = 10n ** dec;
    console.log("QUSDC decimals:", dec.toString(), "=> fee:", feeAmount.toString());
  } catch { console.log("QUSDC decimals check failed, using 1000000"); }

  await send(registry, "setWqieToken",       [WQIE_ADDRESS],                 "setWqieToken");
  await send(registry, "setQieStableCoin",   [QUSDC_ADDRESS],                "setQieStableCoin");
  await send(registry, "setStakeAmount",     [ethers.parseEther("1")],       "setStakeAmount (1 WQIE)");
  await send(registry, "setRegistrationFee", [feeAmount],                    "setRegistrationFee (1 QUSDC)");
  await send(registry, "setQieDex",          [DEX_ROUTER],                   "setQieDex");

  // Final verification
  console.log("\n── Final state ──────────────────────────────────────");
  console.log("  wqieToken        :", await registry.wqieToken());
  console.log("  qieStableCoin    :", await registry.qieStableCoin());
  console.log("  STAKE_AMOUNT     :", ethers.formatEther(await registry.STAKE_AMOUNT()), "WQIE");
  console.log("  REGISTRATION_FEE :", (await registry.REGISTRATION_FEE()).toString(), "QUSDC units");
  console.log("  qieDex           :", await registry.qieDex());
  console.log("  TREASURY         :", await registry.TREASURY());
  console.log("\n  ✅ Configuration complete!\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
