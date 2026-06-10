// Stores QIE Pass name claims in an httpOnly cookie — free, no
// external service required.
//
// Why cookies instead of KV:
//   • Free — no Upstash/Redis account needed
//   • httpOnly — client JS cannot read or tamper with it
//   • 2-year expiry — survives localStorage clears, browser restarts
//   • Same-domain — browser sends it automatically on every API call
//
// Limitation vs KV: doesn't survive across browsers/devices.
// Fine for testnet; for multi-device production add Upstash later.
//
// Cookie: "qpc" (QIE Pass Claims)
// Value:  JSON object → { "candidate:1990:0xabc": { firstName, lastName, ... } }
//
// Chain ID scoping: keys include the chain ID so testnet (1983) and
// mainnet (1990) verifications are completely isolated — prevents a
// testnet VC from appearing as "KYC done" on mainnet.
import { cookies } from "next/headers";
import { type NextResponse } from "next/server";

const COOKIE_NAME    = "qpc";
const COOKIE_MAX_AGE = 2 * 365 * 24 * 3600; // 2 years in seconds
// Chain ID scoping — testnet (1983) and mainnet (1990) use separate keys
const CHAIN_ID = process.env.NEXT_PUBLIC_QIE_CHAIN_ID ?? "1983";

export interface StoredClaims {
  firstName?: string;
  lastName?:  string;
  did?:       string;
  requestId?: string;
  storedAt:   number;
}

type ClaimsMap = Record<string, StoredClaims>;

/** Read the full claims map from the request cookie (server-side). */
function readMap(): ClaimsMap {
  try {
    const raw = cookies().get(COOKIE_NAME)?.value;
    return raw ? (JSON.parse(raw) as ClaimsMap) : {};
  } catch { return {}; }
}

/** Read one wallet's claims from the incoming request cookie. */
export function getClaims(
  role:          "candidate" | "institution",
  walletAddress: string,
): StoredClaims | null {
  const map = readMap();
  const scoped = map[`${role}:${CHAIN_ID}:${walletAddress.toLowerCase()}`];
  if (scoped) return scoped;
  // Legacy key (no chain ID) — only accept on testnet (1983) for one-time migration.
  // On mainnet (1990) we NEVER fall back to legacy keys: a testnet VC must not
  // count as "KYC done" on mainnet.
  if (CHAIN_ID !== "1990") {
    return map[`${role}:${walletAddress.toLowerCase()}`] ?? null;
  }
  return null;
}

/**
 * Write claims to the outgoing response cookie.
 * Call this BEFORE returning the NextResponse — it mutates the response.
 */
export function setClaimsOnResponse(
  response:      NextResponse,
  role:          "candidate" | "institution",
  walletAddress: string,
  claims:        StoredClaims,
): void {
  try {
    const map = readMap();
    // Always write with chain-scoped key; optionally clean up legacy un-scoped key
    map[`${role}:${CHAIN_ID}:${walletAddress.toLowerCase()}`] = claims;
    // Remove legacy un-scoped key if present (one-time migration)
    delete map[`${role}:${walletAddress.toLowerCase()}`];
    response.cookies.set(COOKIE_NAME, JSON.stringify(map), {
      httpOnly: true,
      maxAge:   COOKIE_MAX_AGE,
      path:     "/",
      sameSite: "lax",
      // secure: true  ← Next.js sets this automatically on HTTPS (Vercel)
    });
  } catch (err) {
    console.error("[claimsStore] setClaimsOnResponse error:", err);
  }
}
