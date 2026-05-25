const express = require("express");
const axios   = require("axios");
const CryptoJS = require("crypto-js");
const router  = express.Router();

const PINATA_API_KEY    = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;
const ENCRYPTION_KEY    = process.env.ENCRYPTION_KEY;
const PINATA_GATEWAY    = process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs/";

// Encrypt credential data before IPFS upload
function encryptData(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
}

// Decrypt fetched data
function decryptData(encryptedData) {
  const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

// POST /api/ipfs/upload — encrypt + upload credential data
router.post("/upload", async (req, res) => {
  const { credentialData } = req.body;
  if (!credentialData) {
    return res.status(400).json({ error: "Credential data required" });
  }

  // Validate required fields
  const { holderName, degree, institution, year } = credentialData;
  if (!holderName || !degree || !institution || !year) {
    return res.status(400).json({ error: "holderName, degree, institution, year are required" });
  }

  try {
    // Encrypt all PII before upload — GDPR compliance
    const encrypted = encryptData(credentialData);

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        pinataContent: { data: encrypted, version: "1.0" },
        pinataMetadata: { name: `veridichain-credential-${Date.now()}` },
      },
      {
        headers: {
          pinata_api_key:    PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_KEY,
          "Content-Type":   "application/json",
        },
      }
    );

    res.json({
      success: true,
      cid: response.data.IpfsHash,
      url: `${PINATA_GATEWAY}${response.data.IpfsHash}`,
    });
  } catch (err) {
    console.error("Pinata upload error:", err.message);
    res.status(500).json({ error: "IPFS upload failed" });
  }
});

// GET /api/ipfs/:cid — fetch and decrypt credential data
router.get("/:cid", async (req, res) => {
  const { cid } = req.params;
  if (!cid || cid.length < 10) {
    return res.status(400).json({ error: "Invalid CID" });
  }

  try {
    const response = await axios.get(`${PINATA_GATEWAY}${cid}`);
    const encrypted = response.data?.data;

    if (!encrypted) {
      return res.status(404).json({ error: "No encrypted data found" });
    }

    const decrypted = decryptData(encrypted);
    res.json({ success: true, data: decrypted });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch from IPFS" });
  }
});

module.exports = router;
