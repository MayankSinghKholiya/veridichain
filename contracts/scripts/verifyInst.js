const { ethers } = require("hardhat");
const INST_REG = "0xd20B0b3b663239f4A2Ce05C7d0a9dD734098f90F";
const DEPLOYER = "0x7CE48362Ab16ba673E1f9D63044c9e43B68c290C";

async function main() {
  const [admin] = await ethers.getSigners();
  const inst = new ethers.Contract(INST_REG, [
    "function verifyInstitution(address) external",
    "function isVerified(address) view returns (bool)",
    "function getInstitution(address) view returns (tuple(string name,string domain,string country,string website,string passportDID,uint256 stakedAmount,uint256 registeredAt,bool isVerified,bool isSlashed))",
    "function getTotalInstitutions() view returns (uint256)",
  ], admin);

  // First check what's registered
  const total = await inst.getTotalInstitutions();
  console.log("Total institutions registered:", total.toString());
  
  try {
    const info = await inst.getInstitution(DEPLOYER);
    if (info.registeredAt > 0n) {
      console.log("Institution found:", info.name, "| domain:", info.domain);
      console.log("Already verified?", info.isVerified);
      
      if (!info.isVerified) {
        console.log("\nVerifying institution...");
        const tx = await inst.verifyInstitution(DEPLOYER, { gasLimit: 200_000 });
        const r = await tx.wait();
        console.log("✅ VERIFIED! tx:", tx.hash);
        console.log("Gas used:", r.gasUsed.toString());
      } else {
        console.log("✅ Already verified!");
      }
    } else {
      console.log("❌ No institution registered for this address yet.");
      console.log("Please register first on the frontend, then run this script again.");
    }
  } catch(e) {
    console.log("Error reading institution (QIE eth_call limitation for structs)");
    console.log("Trying to verify directly...");
    try {
      const tx = await inst.verifyInstitution(DEPLOYER, { gasLimit: 200_000 });
      const r = await tx.wait();
      console.log("✅ VERIFIED! tx:", tx.hash);
    } catch(e2) {
      console.log("❌ Failed:", e2.reason || e2.shortMessage || e2.message?.slice(0,150));
    }
  }
  
  console.log("\nisVerified:", await inst.isVerified(DEPLOYER));
}
main().catch(console.error);
