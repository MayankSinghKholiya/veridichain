const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const { Resend } = require("resend");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/send-otp
router.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const otp = generateOTP();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Upsert user
  await prisma.user.upsert({
    where:  { email },
    update: {},
    create: { email, role: "CANDIDATE" },
  });

  // Save OTP session
  await prisma.otpSession.create({
    data: { email, otp: hashedOtp, expiresAt },
  });

  // Send email
  try {
    await resend.emails.send({
      from:    process.env.FROM_EMAIL || "noreply@veridichain.io",
      to:      email,
      subject: "VeridiChain — Your verification code",
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px">
          <h2 style="margin-bottom:8px">Your verification code</h2>
          <p style="color:#666;margin-bottom:24px">Enter this code to sign in to VeridiChain</p>
          <div style="background:#f5f5f5;border-radius:8px;padding:24px;text-align:center;letter-spacing:8px;font-size:32px;font-weight:600">
            ${otp}
          </div>
          <p style="color:#999;font-size:13px;margin-top:16px">Expires in 10 minutes. Do not share this code.</p>
        </div>
      `,
    });
  } catch (err) {
    // In dev, log OTP to console if email fails
    if (process.env.NODE_ENV === "development") {
      console.log(`[DEV] OTP for ${email}: ${otp}`);
    }
  }

  res.json({ success: true, message: "OTP sent to email" });
});

// POST /api/auth/verify-otp
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: "Email and OTP required" });
  }

  // Get latest unused OTP for this email
  const session = await prisma.otpSession.findFirst({
    where: { email, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    return res.status(401).json({ error: "OTP expired or not found" });
  }

  const isValid = await bcrypt.compare(otp, session.otp);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid OTP" });
  }

  // Mark OTP as used
  await prisma.otpSession.update({
    where: { id: session.id },
    data:  { used: true },
  });

  const user = await prisma.user.findUnique({ where: { email } });

  // Issue JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );

  res.json({ success: true, token, user: { id: user.id, email: user.email, role: user.role, walletAddress: user.walletAddress } });
});

// POST /api/auth/link-wallet  — link wallet address to email account
router.post("/link-wallet", async (req, res) => {
  const { email, walletAddress, signature } = req.body;
  if (!email || !walletAddress || !signature) {
    return res.status(400).json({ error: "Email, wallet address, and signature required" });
  }

  // TODO: verify signature server-side using ethers.js
  // const recovered = ethers.verifyMessage(`Link wallet ${walletAddress} to ${email}`, signature);
  // if (recovered.toLowerCase() !== walletAddress.toLowerCase()) return 401

  await prisma.user.update({
    where: { email },
    data:  { walletAddress: walletAddress.toLowerCase() },
  });

  res.json({ success: true });
});

module.exports = router;
