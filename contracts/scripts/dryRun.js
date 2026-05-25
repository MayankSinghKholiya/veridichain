/**
 * Full dry-run: simulate registerInstitution to see if it passes
 */
const { ethers } = require("hardhat");

const PROXY = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";
const CRED_REG = "0xEaa3AEAc66A3533B2adF57c92bA5c7B1c2A2B094";

const INST_ABI = [
  "function STAKE_AMOUNT() view returns (uint256)",
  "function qiePass() view returns (address)",
  "function qieStableCoin() view returns (address)",
  "function owner() view returns (address)",
  "function isVerified(address) view returns (bool)",
  "function getInstitution(address) view returns (tuple(string name, string domain, string country, string website, string passportDID, uint256 stakedAmount, uint256 registeredAt, bool isVerified, bool isSlashed))",
  "function registerInstitution(string,string,string,string) external",
  "function verifyInstitution(address) external",
  "function getTotalInstitutions() view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const proxy = new ethers.Contract(PROXY, INST_ABI, deployer);

  console.log("═══ Contract State ═══════════════════════════════");
  console.log("Deployer/Owner :", deployer.address);
  console.log("STAKE_AMOUNT   :", (await proxy.STAKE_AMOUNT()).toString());
  console.log("qiePass        :", await proxy.qiePass());
  console.log("qieStableCoin  :", await proxy.qieStableCoin());
  console.log("Total Insts    :", (await proxy.getTotalInstitutions()).toString());

  // ── Check if deployer is already registered ─────────────────────────────
  try {
    const inst = await proxy.getInstitution(deployer.address);
    if (inst.registeredAt > 0n) {
      console.log("\n⚠️  Deployer already registered as:", inst.name, "| verified:", inst.isVerified);
    } else {
      console.log("\nℹ️  Deployer NOT yet registered.");
    }
  } catch(e) { console.log("getInstitution error:", e.message?.slice(0,80)); }

  // ── Simulate registerInstitution (static call = no tx) ──────────────────
  console.log("\n═══ Simulating registerInstitution ═══════════════");
  try {
    await proxy.registerInstitution.staticCall("IIT Delhi (Test)", "iitd.ac.in", "IN", "https://iitd.ac.in");
    console.log("✅ SIMULATION PASSED — registerInstitution will succeed!");
  } catch(e) {
    console.log("❌ SIMULATION REVERTED:", e.reason || e.message?.slice(0, 200));
  }

  // ── Also estimate gas ────────────────────────────────────────────────────
  console.log("\n═══ Gas Estimate ══════════════════════════════════");
  try {
    const gas = await proxy.registerInstitution.estimateGas("IIT Delhi (Test)", "iitd.ac.in", "IN", "https://iitd.ac.in");
    console.log("✅ Estimated gas:", gas.toString());
  } catch(e) {
    console.log("❌ Gas estimation failed:", e.reason || e.message?.slice(0, 200));
  }
}

main().catch(console.error);
