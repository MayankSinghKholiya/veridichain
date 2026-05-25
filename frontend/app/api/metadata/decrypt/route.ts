/**
 * GET /api/metadata/decrypt?cid=<ipfs-cid>&credId=<bytes32>&t=<token>
 *
 * Fetches encrypted credential metadata from IPFS and decrypts it.
 *
 * Privacy model:
 *   - `type`    is ALWAYS returned (it's in the unencrypted outer wrapper)
 *   - `details` is returned ONLY when a valid share token is supplied:
 *       t = HMAC-SHA256(METADATA_ENC_KEY, credId)[:32 hex chars]
 *     Without a valid token, details is null — protecting the candidate's
 *     private info (name, institution, document link) from anyone who
 *     only knows the credential ID.
 *
 * Required env var:
 *   METADATA_ENC_KEY — same 64-char hex key used by the encrypt route
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const IPFS_GW = process.env.NEXT_PUBLIC_PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/";

/** Compute the expected share token for a credential ID */
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

  // ── Fetch from IPFS ────────────────────────────────────────────────────────
  let meta: Record<string, unknown>;

  // Step 1: fetch the raw bytes — network errors → 502
  let ipfsRes: Response;
  try {
    ipfsRes = await fetch(`${IPFS_GW}${cid}`, {
      next: { revalidate: 3600 },
    });
  } catch (err) {
    return NextResponse.json(
      { type: null, details: null, error: `IPFS network error: ${String(err)}` },
      { status: 502 }
    );
  }
  if (!ipfsRes.ok) {
    return NextResponse.json(
      { type: null, details: null, error: `IPFS fetch failed (${ipfsRes.status})` },
      { status: 502 }
    );
  }

  // Step 2: parse as JSON — non-JSON files (images, PDFs, legacy documents stored
  // directly on IPFS) cause a SyntaxError here. That is NOT a server error; it just
  // means this credential has no encrypted metadata envelope (pre-structured-form).
  // Return 200 with null details so the client can show a graceful "legacy credential" message.
  try {
    meta = await ipfsRes.json();
  } catch {
    return NextResponse.json({ type: null, details: null });
  }

  const docType = (meta.type as string | undefined) ?? null;

  // ── Legacy / plain IPFS file — no encrypted envelope ──────────────────────
  if (!meta.enc) {
    return NextResponse.json({ type: docType, details: null });
  }

  // ── Token verification — must pass before decrypting ──────────────────────
  if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
    return NextResponse.json({
      type:    docType,
      details: null,
      error:   "Decryption unavailable: METADATA_ENC_KEY not configured",
    });
  }

  // Require both credId and token; verify HMAC before decrypting
  if (!credId || !token) {
    // No token supplied — return type only (privacy mode, not an error)
    return NextResponse.json({ type: docType, details: null });
  }

  const expectedToken = computeShareToken(ENC_KEY_HEX, credId);
  if (token !== expectedToken) {
    // Token present but wrong — silently return null (don't hint at correct format)
    return NextResponse.json({ type: docType, details: null });
  }

  // ── Decrypt ────────────────────────────────────────────────────────────────
  try {
    const key = Buffer.from(ENC_KEY_HEX, "hex");
    const buf = Buffer.from(meta.enc as string, "base64");

    // Unpack: iv (12 B) | authTag (16 B) | ciphertext
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
