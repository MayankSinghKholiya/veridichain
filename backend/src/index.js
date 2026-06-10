require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes       = require("./routes/auth");
const ipfsRoutes       = require("./routes/ipfs");
const institutionRoutes = require("./routes/institution");
const credentialRoutes = require("./routes/credential");

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Security middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use("/api/", limiter);

// Stricter limit for OTP endpoints
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
app.use("/api/auth/send-otp", otpLimiter);

// ─── Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth",        authRoutes);
app.use("/api/ipfs",        ipfsRoutes);
app.use("/api/institution", institutionRoutes);
app.use("/api/credential",  credentialRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "veridichain-api", timestamp: Date.now() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`VeridiChain API running on http://localhost:${PORT}`);
  console.log(`Chain: QIE Testnet | RPC: ${process.env.QIE_RPC_URL}`);
});
