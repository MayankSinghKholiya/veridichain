const { ethers } = require("hardhat");
const PROXY = "0x936129F672B2754c25e569a5BEC7b689BaD174c1";

async function main() {
  // Read raw storage slots 0-9
  console.log("── Raw proxy storage slots ───────────────────────");
  for (let i = 0; i < 10; i++) {
    const val = await ethers.provider.getStorage(PROXY, i);
    console.log(`  slot[${i}]: ${val}`);
  }

  // EIP-1967 impl slot
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const impl = await ethers.provider.getStorage(PROXY, implSlot);
  console.log("\n── EIP-1967 impl slot ────────────────────────────");
  console.log("  impl:", "0x" + impl.slice(-40));

  // OZ Ownable v5 namespaced storage slot
  // keccak256("openzeppelin.storage.Ownable") - 1
  const ownableSlot = "0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300";
  const owner = await ethers.provider.getStorage(PROXY, ownableSlot);
  console.log("  OZ owner slot:", owner);

  // Try a very minimal function call 
  console.log("\n── Test minimal call ───────────────────────────");
  const abi = [
    "function STAKE_AMOUNT() view returns (uint256)",
    "function owner() view returns (address)",
    "function getTotalInstitutions() view returns (uint256)",
    "function registerInstitution(string,string,string,string) external",
  ];
  const proxy = new ethers.Contract(PROXY, abi, (await ethers.getSigners())[0]);
  
  // Estimate gas for a basic increment function - this tells us if the issue is general or specific
  console.log("  STAKE_AMOUNT:", (await proxy.STAKE_AMOUNT()).toString());
  console.log("  owner:", await proxy.owner());
  console.log("  total insts:", (await proxy.getTotalInstitutions()).toString());
}
main().catch(console.error);
