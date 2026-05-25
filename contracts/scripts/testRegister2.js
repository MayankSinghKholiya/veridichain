const { ethers } = require("hardhat");
const PROXY = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";
const INST_ABI = [
  "function registerInstitution(string,string,string,string) external",
  "function getTotalInstitutions() view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const proxy = new ethers.Contract(PROXY, INST_ABI, deployer);

  console.log("Trying with gasLimit: 2,000,000...");
  try {
    const tx = await proxy.registerInstitution(
      "IIT Delhi Test", "iitd-test2.ac.in", "IN", "https://iitd.ac.in",
      { gasLimit: 2_000_000 }
    );
    console.log("tx sent:", tx.hash);
    const r = await tx.wait();
    console.log("✅ Status:", r.status, "| Gas used:", r.gasUsed.toString());
  } catch(e) {
    console.log("❌ Error:", e.reason || e.shortMessage || e.message?.slice(0, 300));
  }

  // Also check what implementation the proxy points to now
  // EIP-1967 implementation slot
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const implRaw = await ethers.provider.getStorage(PROXY, implSlot);
  console.log("Current impl:", "0x" + implRaw.slice(-40));
}
main().catch(console.error);
