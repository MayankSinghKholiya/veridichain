const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ManualVerificationRegistry with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "QIE");

  const Factory = await ethers.getContractFactory("ManualVerificationRegistry");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log("\n✅ ManualVerificationRegistry deployed to:", addr);
  console.log("\nAdd to .env.local:");
  console.log(`NEXT_PUBLIC_MANUAL_VERIFICATION_REGISTRY=${addr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
