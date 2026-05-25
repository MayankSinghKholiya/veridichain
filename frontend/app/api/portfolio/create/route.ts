/**
 * POST /api/portfolio/create
 *
 * Creates a "Skill Portfolio" — a curated bundle of on-chain credentials
 * that a candidate shares with HR/recruiters for a specific job application.
 *
 * Body:
 *   {
 *     creatorWallet:  string,              — candidate's wallet address
 *     jobTitle:       string,              — e.g. "Senior React Developer"
 *     targetCompany?: string,              — e.g. "TechCorp" (optional)
 *     applyingFor?:   string,              — role description (optional)
 *     note?:          string,              — personal cover note (optional)
 *     credentials: [
 *       { credentialId: "0x...", personalNote?: "Proves React expertise" }
 *     ]
 *   }
 *
 * Returns: { cid: string }
 *
 * Security: A per-credential HMAC share token is embedded in the IPFS bundle.
 * This lets the portfolio view page decrypt private metadata for each credential
 * without ever exposing the key to the client.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

interface InputCredential {
  credentialId: string;
  personalNote?: string;
}

interface BundleCredential {
  credentialId: string;
  personalNote?: string;
  shareToken: string; // HMAC-SHA256(ENC_KEY, credentialId)[:32] — server-signed
}

interface PortfolioBundle {
  v:              number;
  creatorWallet:  string;
  jobTitle:       string;
  targetCompany?: string;
  applyingFor?:   string;
  note?:          string;
  createdAt:      number;
  credentials:    BundleCredential[];
}

function computeShareToken(encKeyHex: string, credId: string): string {
  return crypto
    .createHmac("sha256", Buffer.from(encKeyHex, "hex"))
    .update(credId.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export async function POST(req: NextRequest) {
  const ENC_KEY_HEX = process.env.METADATA_ENC_KEY;
  const PINATA_JWT  = process.env.PINATA_JWT;

  if (!ENC_KEY_HEX || ENC_KEY_HEX.length !== 64) {
    return NextResponse.json({ error: "Server not configured: METADATA_ENC_KEY" }, { status: 500 });
  }
  if (!PINATA_JWT) {
    return NextResponse.json({ error: "Server not configured: PINATA_JWT" }, { status: 500 });
  }

  let body: {
    creatorWallet: string;
    jobTitle:      string;
    targetCompany?: string;
    applyingFor?:  string;
    note?:         string;
    credentials:   InputCredential[];
  };

  try {
    body = await req.json();
    if (!body.creatorWallet || !body.jobTitle?.trim() || !body.credentials?.length) {
      throw new Error("Missing required fields");
    }
    if (body.credentials.length > 20) throw new Error("Max 20 credentials per portfolio");
  } catch (e) {
    return NextResponse.json({ error: `Invalid request: ${String(e)}` }, { status: 400 });
  }

  // Build bundle — embed a per-credential share token so the view page
  // can decrypt private metadata without needing the encryption key client-side.
  const bundle: PortfolioBundle = {
    v:             1,
    creatorWallet: body.creatorWallet.toLowerCase(),
    jobTitle:      body.jobTitle.trim(),
    targetCompany: body.targetCompany?.trim() || undefined,
    applyingFor:   body.applyingFor?.trim()   || undefined,
    note:          body.note?.trim()           || undefined,
    createdAt:     Math.floor(Date.now() / 1000),
    credentials:   body.credentials.map((c) => ({
      credentialId: c.credentialId,
      personalNote: c.personalNote?.trim() || undefined,
      shareToken:   computeShareToken(ENC_KEY_HEX, c.credentialId),
    })),
  };

  // Pin bundle to IPFS
  let pinRes: Response;
  try {
    pinRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${PINATA_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataContent:  bundle,
        pinataMetadata: { name: `vc-portfolio-${Date.now()}` },
        pinataOptions:  { cidVersion: 1 },
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: `Pinata network error: ${String(err)}` }, { status: 502 });
  }

  if (!pinRes.ok) {
    return NextResponse.json(
      { error: `Pinata error (${pinRes.status}): ${await pinRes.text()}` },
      { status: 502 }
    );
  }

  const { IpfsHash } = await pinRes.json() as { IpfsHash: string };
  return NextResponse.json({ cid: IpfsHash });
}
