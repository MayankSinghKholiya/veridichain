// GET /api/share-token?credId=0x<bytes32>
// Returns HMAC-SHA256(METADATA_ENC_KEY, credId)[:32 hex chars].
// Deterministic and non-guessable without the server key.
// Candidate embeds this in the share link; decrypt route verifies it before revealing details.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const ENC_KEY_HEX = process.env.METADATA_ENC_KEY;
  if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const credId = req.nextUrl.searchParams.get("credId");
  if (!credId || !/^0x[0-9a-fA-F]{64}$/.test(credId)) {
    return NextResponse.json({ error: "Invalid credId — must be 0x-prefixed bytes32" }, { status: 400 });
  }

  const key   = Buffer.from(ENC_KEY_HEX, "hex");
  const token = crypto
    .createHmac("sha256", key)
    .update(credId.toLowerCase())   // normalise casing
    .digest("hex")
    .slice(0, 32);                  // 16 bytes = 128 bits — more than enough for a share token

  return NextResponse.json({ token });
}
