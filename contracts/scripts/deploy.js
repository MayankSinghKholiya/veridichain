const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "QIE");

  // ─── Config (update these with real QIE addresses) ──────────────────────
  const QIE_PASS_ADDRESS        = process.env.QIE_PASS_CONTRACT        || ethers.ZeroAddress;
  const QIE_STABLE_COIN_ADDRESS = process.env.QIE_STABLE_COIN_CONTRACT || ethers.ZeroAddress;
  const QIE_DEX_ADDRESS         = process.env.QIE_DEX_CONTRACT         || ethers.ZeroAddress;
  const QIE_TOKEN_ADDRESS       = process.env.QIE_TOKEN_ADDRESS         || ethers.ZeroAddress;
  const TREASURY                = deployer.address; // Change to multisig in production
  const STAKE_AMOUNT            = process.env.STAKE_AMOUNT || ethers.parseEther("100").toString();

  // ─── 1. Deploy CredentialNFT ─────────────────────────────────────────────
  console.log("\n1. Deploying CredentialNFT (Soulbound ERC-721)...");
  const CredentialNFT = await ethers.getContractFactory("CredentialNFT");
  const credentialNFT = await CredentialNFT.deploy();
  await credentialNFT.waitForDeployment();
  console.log("   CredentialNFT:", await credentialNFT.getAddress());

  // ─── 2. Deploy InstitutionRegistry (UUPS proxy) ──────────────────────────
  console.log("\n2. Deploying InstitutionRegistry (UUPS proxy)...");
  const InstitutionRegistry = await ethers.getContractFactory("InstitutionRegistry");
  const institutionRegistry = await upgrades.deployProxy(
    InstitutionRegistry,
    [
      QIE_PASS_ADDRESS,
      QIE_STABLE_COIN_ADDRESS,
      QIE_DEX_ADDRESS,
      QIE_TOKEN_ADDRESS,
      TREASURY,
      STAKE_AMOUNT,
    ],
    { kind: "uups" }
  );
  await institutionRegistry.waitForDeployment();
  console.log("   InstitutionRegistry:", await institutionRegistry.getAddress());

  // ─── 3. Deploy CredentialRegistry (UUPS proxy) ───────────────────────────
  console.log("\n3. Deploying CredentialRegistry (UUPS proxy)...");
  const CredentialRegistry = await ethers.getContractFactory("CredentialRegistry");
  const credentialRegistry = await upgrades.deployProxy(
    CredentialRegistry,
    [await institutionRegistry.getAddress(), await credentialNFT.getAddress()],
    { kind: "uups" }
  );
  await credentialRegistry.waitForDeployment();
  console.log("   CredentialRegistry:", await credentialRegistry.getAddress());

  // ─── 4. Wire up: set registry in NFT contract ────────────────────────────
  console.log("\n4. Wiring contracts...");
  await credentialNFT.setRegistry(await credentialRegistry.getAddress());
  console.log("   NFT registry set to CredentialRegistry");

  // ─── 5. Print summary ────────────────────────────────────────────────────
  const summary = {
    network:             (await ethers.provider.getNetwork()).name,
    chainId:             (await ethers.provider.getNetwork()).chainId.toString(),
    deployer:            deployer.address,
    CredentialNFT:       await credentialNFT.getAddress(),
    InstitutionRegistry: await institutionRegistry.getAddress(),
    CredentialRegistry:  await credentialRegistry.getAddress(),
  };

  console.log("\n─── Deployment Summary ─────────────────────────────");
  console.log(JSON.stringify(summary, null, 2));
  console.log("─────────────────────────────────────────────────────");
  console.log("\nNext steps:");
  console.log("1. Copy these addresses to frontend/.env.local");
  console.log("2. Copy these addresses to backend/.env");
  console.log("3. Verify: npx hardhat verify --network qie_testnet <ADDRESS>");
  console.log("4. Paste contract addresses in README.md");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
