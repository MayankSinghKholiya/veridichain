// POST /api/metadata/encrypt
// Encrypts credential metadata with AES-256-GCM and pins the JSON to IPFS via Pinata.
// Stored format: { v: 1, type: "DEGREE", enc: "<base64: IV+AuthTag+Ciphertext>" }
// type is public, enc is only decryptable server-side via METADATA_ENC_KEY.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const ENC_KEY_HEX = process.env.METADATA_ENC_KEY;
  const PINATA_JWT  = process.env.PINATA_JWT;

  if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
    return NextResponse.json(
      { error: "Server not configured: METADATA_ENC_KEY missing or wrong length (must be 64 hex chars)" },
      { status: 500 }
    );
  }
  if (!PINATA_JWT) {
    return NextResponse.json(
      { error: "Server not configured: PINATA_JWT missing" },
      { status: 500 }
    );
  }

  let type: string;
  let details: Record<string, unknown>;
  try {
    const body = await req.json();
    type    = body.type;
    details = body.details;
    if (!type || !details) throw new Error("Missing type or details");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const key     = Buffer.from(ENC_KEY_HEX, "hex");
  const iv      = crypto.randomBytes(12);   // 96-bit nonce for GCM
  const cipher  = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain   = JSON.stringify(details);
  const encData = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // pack: iv (12B) | authTag (16B) | ciphertext
  const packed = Buffer.concat([iv, authTag, encData]).toString("base64");

  const ipfsPayload = { v: 1, type, enc: packed };

  let pinRes: Response;
  try {
    pinRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${PINATA_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataContent:  ipfsPayload,
        pinataMetadata: { name: `vc-meta-${Date.now()}` },
        pinataOptions:  { cidVersion: 1 },
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: `Pinata network error: ${String(err)}` }, { status: 502 });
  }

  if (!pinRes.ok) {
    const errText = await pinRes.text();
    return NextResponse.json(
      { error: `Pinata error (${pinRes.status}): ${errText}` },
      { status: 502 }
    );
  }

  const { IpfsHash } = await pinRes.json() as { IpfsHash: string };
  return NextResponse.json({ cid: IpfsHash });
}
