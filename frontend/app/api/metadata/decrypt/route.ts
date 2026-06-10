// GET /api/metadata/decrypt?cid=<ipfs-cid>&credId=<bytes32>&t=<token>
// Fetches encrypted credential metadata from IPFS and decrypts it.
// `type` is always returned. `details` is only returned with a valid share token:
//   t = HMAC-SHA256(METADATA_ENC_KEY, credId)[:32 hex chars]
// Without it, details is null — protects candidate's private info from anyone
// who only knows the credential ID.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const IPFS_GW = process.env.NEXT_PUBLIC_PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/";

function computeShareToken(encKeyHex: string, credId: string): string {
  const key = Buffer.from(encKeyHex, "hex");
  return crypto
    .createHmac("sha256", key)
    .update(credId.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export async function GET(req: NextRequest) {
  const ENC_KEY_HEX = process.env.METADATA_ENC_KEY;

  const cid    = req.nextUrl.searchParams.get("cid");
  const credId = req.nextUrl.searchParams.get("credId");
  const token  = req.nextUrl.searchParams.get("t");

  if (!cid) {
    return NextResponse.json({ error: "Missing ?cid param" }, { status: 400 });
  }

  let meta: Record<string, unknown>;

  // 8s timeout — Pinata can be slow for cold CIDs. Without this the Vercel
  // function times out at ~10s and the client can't distinguish it from a
  // valid "no details" response.
  let ipfsRes: Response;
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8_000);
    ipfsRes = await fetch(`${IPFS_GW}${cid}`, {
      signal: controller.signal,
      next:   { revalidate: 3600 },
    });
    clearTimeout(timeoutId);
  } catch (err) {
    const reason = (err as Error)?.name === "AbortError" ? "IPFS gateway timeout (>8 s)" : String(err);
    return NextResponse.json({ type: null, details: null, error: reason });
  }

  if (!ipfsRes.ok) {
    return NextResponse.json(
      { type: null, details: null, error: `IPFS fetch failed (${ipfsRes.status})` }
    );
  }

  // Non-JSON files (PDFs, images, legacy direct uploads) just get null details
  try {
    meta = await ipfsRes.json();
  } catch {
    return NextResponse.json({ type: null, details: null });
  }

  const docType = (meta.type as string | undefined) ?? null;

  if (!meta.enc) {
    return NextResponse.json({ type: docType, details: null });
  }

  if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
    return NextResponse.json({
      type:    docType,
      details: null,
      error:   "Decryption unavailable: METADATA_ENC_KEY not configured",
    });
  }

  if (!credId || !token) {
    return NextResponse.json({ type: docType, details: null });
  }

  const expectedToken = computeShareToken(ENC_KEY_HEX, credId);
  if (token !== expectedToken) {
    return NextResponse.json({ type: docType, details: null });
  }

  try {
    const key = Buffer.from(ENC_KEY_HEX, "hex");
    const buf = Buffer.from(meta.enc as string, "base64");

    // unpack: iv (12B) | authTag (16B) | ciphertext
    const iv      = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ct      = buf.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");

    return NextResponse.json({ type: docType, details: JSON.parse(plain) });
  } catch {
    return NextResponse.json({
      type:    docType,
      details: null,
      error:   "Decryption failed — wrong key or corrupted data",
    });
  }
}
