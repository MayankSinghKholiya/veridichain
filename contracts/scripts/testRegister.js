/**
 * testRegister.js — send real tx with manual gasLimit to bypass QIE eth_call bug
 */
const { ethers } = require("hardhat");

const PROXY    = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";
const CRED_REG = "0xEaa3AEAc66A3533B2adF57c92bA5c7B1c2A2B094";

const INST_ABI = [
  "function STAKE_AMOUNT() view returns (uint256)",
  "function getTotalInstitutions() view returns (uint256)",
  "function registerInstitution(string,string,string,string) external",
  "function verifyInstitution(address) external",
  "function isVerified(address) view returns (bool)",
  "function owner() view returns (address)",
];

const CRED_ABI = [
  "function issueCredential(address,bytes32,string,string) external returns (bytes32)",
  "function getCredentialsByCandidate(address) view returns (bytes32[])",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("══════════════════════════════════════════");
  console.log("Tester  :", deployer.address);
  console.log("Balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "QIE");

  const proxy = new ethers.Contract(PROXY, INST_ABI, deployer);
  const cred  = new ethers.Contract(CRED_REG, CRED_ABI, deployer);

  console.log("\n── STEP 1: Check contract state ───────────────");
  console.log("STAKE_AMOUNT   :", (await proxy.STAKE_AMOUNT()).toString(), "(should be 0)");
  console.log("Total insts    :", (await proxy.getTotalInstitutions()).toString());

  // ── STEP 2: Register institution with manual gasLimit (bypass broken estimator) ──
  console.log("\n── STEP 2: Register institution (gasLimit: 500000) ────");
  let registered = false;
  try {
    const tx = await proxy.registerInstitution(
      "IIT Delhi Test",
      "iitd-test.ac.in",
      "IN",
      "https://iitd.ac.in",
      { gasLimit: 500_000 }
    );
    console.log("  tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("  ✅ Confirmed! Block:", receipt.blockNumber, "| Gas used:", receipt.gasUsed.toString());
    registered = true;
  } catch(e) {
    console.log("  ❌ FAILED:", e.reason || e.shortMessage || e.message?.slice(0, 200));
  }

  // ── STEP 3: Verify as admin ─────────────────────────────────────────────
  if (registered) {
    console.log("\n── STEP 3: Self-verify (deployer IS owner) ─────────────");
    try {
      const tx = await proxy.verifyInstitution(deployer.address, { gasLimit: 200_000 });
      console.log("  tx sent:", tx.hash);
      const receipt = await tx.wait();
      console.log("  ✅ Verified! Block:", receipt.blockNumber);
      const isVerified = await proxy.isVerified(deployer.address);
      console.log("  isVerified:", isVerified);
    } catch(e) {
      console.log("  ❌ FAILED:", e.reason || e.shortMessage || e.message?.slice(0, 200));
    }
  }

  console.log("\n── STEP 4: Issue credential to self (Tier 1 upgrade) ───");
  if (registered) {
    const credHash = ethers.keccak256(ethers.toUtf8Bytes("BSc CS IIT Delhi 2024 CGPA 9.2"));
    try {
      const tx = await cred.issueCredential(
        deployer.address,
        credHash,
        "QmTestIPFSCID000000000000000",
        "",
        { gasLimit: 500_000 }
      );
      console.log("  tx sent:", tx.hash);
      const receipt = await tx.wait();
      console.log("  ✅ Credential issued! Block:", receipt.blockNumber);
    } catch(e) {
      console.log("  ❌ FAILED:", e.reason || e.shortMessage || e.message?.slice(0, 200));
    }
  }

  console.log("\n══════════════════════════════════════════");
  console.log("Total institutions:", (await proxy.getTotalInstitutions()).toString());
}

main().catch(console.error);
