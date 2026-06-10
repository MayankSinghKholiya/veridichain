const express = require("express");
const { PrismaClient } = require("@prisma/client");
const router  = express.Router();
const prisma  = new PrismaClient();

// POST /api/credential/cache — cache credential data after onchain issuance
router.post("/cache", async (req, res) => {
  const { credentialId, ipfsCID, issuerAddress, candidateAddress, tier, issuedAt } = req.body;

  if (!credentialId || !ipfsCID || !issuerAddress || !candidateAddress) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const cached = await prisma.credentialCache.upsert({
      where:  { credentialId },
      update: { ipfsCID, tier, isRevoked: false },
      create: {
        credentialId,
        ipfsCID,
        issuerAddress:    issuerAddress.toLowerCase(),
        candidateAddress: candidateAddress.toLowerCase(),
        tier:             Number(tier),
        issuedAt:         new Date(Number(issuedAt) * 1000),
      },
    });
    res.json({ success: true, cached });
  } catch (err) {
    res.status(500).json({ error: "Cache failed" });
  }
});

// GET /api/credential/:credentialId — get cached credential info
router.get("/:credentialId", async (req, res) => {
  const cached = await prisma.credentialCache.findUnique({
    where: { credentialId: req.params.credentialId },
  });
  if (!cached) return res.status(404).json({ error: "Not found in cache" });
  res.json({ success: true, credential: cached });
});

// GET /api/credential/candidate/:wallet — get all credentials for a wallet
router.get("/candidate/:wallet", async (req, res) => {
  const credentials = await prisma.credentialCache.findMany({
    where: { candidateAddress: req.params.wallet.toLowerCase() },
    orderBy: { issuedAt: "desc" },
  });
  res.json({ success: true, credentials });
});

// POST /api/credential/verify-log — log each verification event
router.post("/verify-log", async (req, res) => {
  const { credentialId, verifierEmail, result } = req.body;
  const verifierIp = req.ip;

  await prisma.verificationLog.create({
    data: {
      credentialId,
      verifierEmail: verifierEmail || null,
      verifierIp,
      result: Boolean(result),
    },
  });

  res.json({ success: true });
});

module.exports = router;
