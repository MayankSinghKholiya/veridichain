const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const proxy = new ethers.Contract(
    "0x936129F672B2754c25e569a5BEC7b689BaD174c1",
    ["function owner() view returns (address)", "function STAKE_AMOUNT() view returns (uint256)"],
    deployer
  );
  console.log("deployer:", deployer.address);
  console.log("owner:", await proxy.owner());
  console.log("STAKE_AMOUNT:", (await proxy.STAKE_AMOUNT()).toString());
}
main().catch(console.error);
