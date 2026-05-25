const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("VeridiChain Contracts", function () {
  let institutionRegistry, credentialRegistry, credentialNFT;
  let owner, institution, candidate, verifier, attacker;

  beforeEach(async () => {
    [owner, institution, candidate, verifier, attacker] = await ethers.getSigners();

    // Deploy NFT
    const NFT = await ethers.getContractFactory("CredentialNFT");
    credentialNFT = await NFT.deploy();

    // Deploy InstitutionRegistry with zero addresses (no QIE ecosystem in local test)
    const IR = await ethers.getContractFactory("InstitutionRegistry");
    institutionRegistry = await upgrades.deployProxy(IR, [
      ethers.ZeroAddress, // QIE Pass (skipped in local test)
      ethers.ZeroAddress, // QIE Stable Coin (skipped)
      ethers.ZeroAddress, // QIE DEX (skipped)
      ethers.ZeroAddress, // QIE Token
      owner.address,      // treasury
      0,                  // stake = 0 for local tests
    ], { kind: "uups" });

    // Deploy CredentialRegistry
    const CR = await ethers.getContractFactory("CredentialRegistry");
    credentialRegistry = await upgrades.deployProxy(CR, [
      await institutionRegistry.getAddress(),
      await credentialNFT.getAddress(),
    ], { kind: "uups" });

    // Wire NFT
    await credentialNFT.setRegistry(await credentialRegistry.getAddress());
  });

  // ─── Institution tests ──────────────────────────────────────────────────

  describe("InstitutionRegistry", () => {
    it("allows institution to register", async () => {
      await institutionRegistry.connect(institution).registerInstitution(
        "Test University", "testuniversity.edu", "US", "https://testuniversity.edu"
      );
      const inst = await institutionRegistry.getInstitution(institution.address);
      expect(inst.name).to.equal("Test University");
      expect(inst.isVerified).to.equal(false); // not yet verified by admin
    });

    it("admin can verify institution", async () => {
      await institutionRegistry.connect(institution).registerInstitution(
        "Test University", "testuniversity.edu", "US", "https://testuniversity.edu"
      );
      await institutionRegistry.connect(owner).verifyInstitution(institution.address);
      expect(await institutionRegistry.isVerified(institution.address)).to.equal(true);
    });

    it("blocks duplicate domain registration", async () => {
      await institutionRegistry.connect(institution).registerInstitution(
        "Test University", "testuniversity.edu", "US", "https://testuniversity.edu"
      );
      await expect(
        institutionRegistry.connect(attacker).registerInstitution(
          "Fake University", "testuniversity.edu", "XX", "https://fake.edu"
        )
      ).to.be.revertedWith("Domain already registered");
    });

    it("non-admin cannot verify institution", async () => {
      await institutionRegistry.connect(institution).registerInstitution(
        "Test University", "testuniversity.edu", "US", "https://testuniversity.edu"
      );
      await expect(
        institutionRegistry.connect(attacker).verifyInstitution(institution.address)
      ).to.be.reverted;
    });

    it("admin can slash institution", async () => {
      await institutionRegistry.connect(institution).registerInstitution(
        "Bad University", "baduniversity.edu", "XX", "https://bad.edu"
      );
      await institutionRegistry.connect(owner).verifyInstitution(institution.address);
      await institutionRegistry.connect(owner).slashInstitution(institution.address, "Issuing fake credentials");

      const inst = await institutionRegistry.getInstitution(institution.address);
      expect(inst.isSlashed).to.equal(true);
      expect(await institutionRegistry.isVerified(institution.address)).to.equal(false);
    });
  });

  // ─── Credential tests ───────────────────────────────────────────────────

  describe("CredentialRegistry", () => {
    beforeEach(async () => {
      // Register and verify institution
      await institutionRegistry.connect(institution).registerInstitution(
        "Test University", "testuniversity.edu", "US", "https://testuniversity.edu"
      );
      await institutionRegistry.connect(owner).verifyInstitution(institution.address);
    });

    it("verified institution can issue Tier 1 credential", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("degree_data"));
      const cid  = "QmTest123";

      const tx = await credentialRegistry.connect(institution).issueCredential(
        candidate.address, hash, cid, ""
      );
      const receipt = await tx.wait();

      // Check event emitted
      const events = receipt.logs.filter(l => l.fragment?.name === "CredentialIssued");
      expect(events.length).to.equal(1);
    });

    it("unverified institution cannot issue credential", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("degree_data"));
      await expect(
        credentialRegistry.connect(attacker).issueCredential(candidate.address, hash, "QmTest", "")
      ).to.be.revertedWith("Caller is not a verified institution");
    });

    it("candidate can self-attest Tier 2 credential", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("my_old_degree"));
      const tx = await credentialRegistry.connect(candidate).selfAttestCredential(hash, "QmSelfTest", "");
      await tx.wait();

      const credentials = await credentialRegistry.getCredentialsByCandidate(candidate.address);
      expect(credentials.length).to.equal(1);
    });

    it("institution can upgrade Tier 2 to Tier 1", async () => {
      // Candidate self-attests
      const hash = ethers.keccak256(ethers.toUtf8Bytes("my_old_degree"));
      await credentialRegistry.connect(candidate).selfAttestCredential(hash, "QmSelf", "");
      const credentials = await credentialRegistry.getCredentialsByCandidate(candidate.address);
      const credId = credentials[0];

      // Verify it's Tier 2
      let result = await credentialRegistry.verifyCredential(credId);
      expect(result.tier).to.equal(2); // SELF_ATTESTED

      // Institution upgrades
      await credentialRegistry.connect(institution).upgradeToTier1(credId);

      // Now Tier 1
      result = await credentialRegistry.verifyCredential(credId);
      expect(result.tier).to.equal(1); // INSTITUTION_VERIFIED
    });

    it("issuer can revoke with reason", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("degree_data"));
      await credentialRegistry.connect(institution).issueCredential(candidate.address, hash, "QmTest", "");
      const credentials = await credentialRegistry.getCredentialsByCandidate(candidate.address);
      const credId = credentials[0];

      await credentialRegistry.connect(institution).revokeCredential(credId, "Student expelled");

      const result = await credentialRegistry.verifyCredential(credId);
      expect(result.isValid).to.equal(false);
      expect(result.isRevoked).to.equal(true);
      expect(result.revokeReason).to.equal("Student expelled");
    });

    it("revoke without reason fails", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("degree_data"));
      await credentialRegistry.connect(institution).issueCredential(candidate.address, hash, "QmTest", "");
      const credentials = await credentialRegistry.getCredentialsByCandidate(candidate.address);
      const credId = credentials[0];

      await expect(
        credentialRegistry.connect(institution).revokeCredential(credId, "")
      ).to.be.revertedWith("Revocation reason required");
    });

    it("soulbound NFT cannot be transferred", async () => {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("degree_data"));
      await credentialRegistry.connect(institution).issueCredential(candidate.address, hash, "QmTest", "");

      const tokenId = 1;
      await expect(
        credentialNFT.connect(candidate).transferFrom(candidate.address, attacker.address, tokenId)
      ).to.be.revertedWith("VeridiChain: credential NFT is soulbound");
    });
  });
});
