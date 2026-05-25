const express = require("express");
const { PrismaClient } = require("@prisma/client");
const router  = express.Router();
const prisma  = new PrismaClient();

// GET /api/institution/all — list all cached institution metadata
router.get("/all", async (req, res) => {
  const institutions = await prisma.institution.findMany({
    where:   { onchainVerified: true },
    orderBy: { createdAt: "asc" },
    select:  { walletAddress: true, name: true, domain: true, country: true, website: true, logoUrl: true },
  });
  res.json({ success: true, institutions });
});

// GET /api/institution/:wallet — get single institution metadata
router.get("/:wallet", async (req, res) => {
  const institution = await prisma.institution.findUnique({
    where: { walletAddress: req.params.wallet.toLowerCase() },
  });
  if (!institution) return res.status(404).json({ error: "Institution not found" });
  res.json({ success: true, institution });
});

// POST /api/institution/register-metadata — cache institution metadata after onchain registration
router.post("/register-metadata", async (req, res) => {
  const { walletAddress, name, domain, country, website, userId } = req.body;

  try {
    const institution = await prisma.institution.upsert({
      where:  { walletAddress: walletAddress.toLowerCase() },
      update: { name, domain, country, website },
      create: {
        walletAddress: walletAddress.toLowerCase(),
        name, domain, country, website,
        userId,
      },
    });
    res.json({ success: true, institution });
  } catch (err) {
    res.status(500).json({ error: "Failed to save institution metadata" });
  }
});

module.exports = router;
