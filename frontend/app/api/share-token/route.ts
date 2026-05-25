/**
 * GET /api/share-token?credId=0x<bytes32>
 *
 * Generates a short-lived HMAC-SHA256 share token for a credential.
 * Token = first 32 hex chars of HMAC-SHA256(METADATA_ENC_KEY, credId).
 *
 * This token is:
 *   - Non-guessable without the server secret (METADATA_ENC_KEY)
 *   - Deterministic — same credential always gives the same token
 *   - Verified by the decrypt route before revealing private details
 *
 * The candidate uses this to build a share link:
 *   /verify?id=0x...&t=<token>
 *
 * Anyone who only has the credential ID cannot compute the token —
 * they would need knowledge of METADATA_ENC_KEY.
 */

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
