// GET /api/verify/[credId]
//
// Server-side credential verification with in-memory cache.
//
// Why server-side?
//   • Cache is shared across ALL users — once one user verifies a credential,
//     every subsequent request returns in <5 ms.
//   • Server RPC calls are lower-latency than browser → QIE RPC.
//   • All 3 event scans run in PARALLEL (Promise.all) → ~3× faster than
//     the old client-side sequential approach.
//
// Cache:
//   • Module-level Map (Node.js singleton per server process)
//   • 5-minute TTL — stale entries are evicted on next access
//   • X-Cache: HIT / MISS header lets frontend distinguish instant vs scanned
//
// Returns:
//   { found: boolean, result: VerifyResult | null, cachedAt?: number }

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem, defineChain } from "viem";
import { getLogsChunked } from "../../../../lib/getLogs";
import {
  CONTRACTS,
  CREDENTIAL_REGISTRY_ABI,
  MANUAL_VERIFICATION_REGISTRY_ABI,
} from "../../../../lib/contracts";

// ── Server-side viem client ───────────────────────────────────────────────────
const qieChain = defineChain({
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc1testnet.qie.digital/"] },
    public:  { http: ["https://rpc1testnet.qie.digital/"] },
  },
  blockExplorers: {
    default: { name: "QIE Explorer", url: "https://testnet.qie.digital" },
  },
});

const serverClient = createPublicClient({
  chain: qieChain,
  transport: http("https://rpc1testnet.qie.digital/", {
    timeout: 30_000,
    retryCount: 2,
  }),
});

// ── In-memory cache (module-level singleton) ──────────────────────────────────
export interface VerifyResult {
  issuer:          string;
  candidate:       string;
  tier:            number;
  issuedAt:        number;
  isRevoked:       boolean;
  revokeReason?:   string;
  candidatePassDid?: string;
  credentialHash?: string;
  ipfsCid?:        string;
  teamVerified?: {
    verified:   boolean;
    note:       string;
    verifiedBy: string;
    verifiedAt: number;
  };
}

interface CacheEntry {
  result:    VerifyResult | null; // null = credential not found
  cachedAt:  number;
}

// 90-second TTL — short enough that revoke/upgrade changes appear quickly,
// long enough to absorb rapid repeated lookups from multiple verifiers.
const CACHE_TTL = 90 * 1_000;
const credCache  = new Map<string, CacheEntry>();

function getCached(key: string): CacheEntry | null {
  const entry = credCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL) {
    credCache.delete(key);
    return null;
  }
  return entry;
}

// ── Quick on-chain revoke + tier check ───────────────────────────────────────
// Used to validate cached "valid" results before serving them.
// readContract is ~100 ms — fast enough to run on every cache-hit request.
// Returns { isRevoked, tier } or null if the check itself fails.
async function quickStateCheck(
  credId: `0x${string}`
): Promise<{ isRevoked: boolean; tier: number } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (serverClient as any).readContract({
      address: CONTRACTS.CREDENTIAL_REGISTRY,
      abi:     CREDENTIAL_REGISTRY_ABI,
      functionName: "credentials",
      args:    [credId],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (field: string, idx: number): any =>
      raw?.[field] !== undefined ? raw[field] : (Array.isArray(raw) ? raw[idx] : undefined);
    return {
      isRevoked: Boolean(r("isRevoked", 8)),
      tier:      Number(r("tier", 6) ?? 2),
    };
  } catch {
    return null; // RPC blip — don't invalidate cache on transient errors
  }
}

// ── Core scan function ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanCredential(credId: `0x${string}`): Promise<VerifyResult | null> {
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

  // ── Strategy: read credentials mapping DIRECTLY (no event scanning) ─────────
  //
  // Why NOT event-based lookup:
  //   QIE testnet RPC silently drops getLogs results when filtering by an indexed
  //   bytes32 topic (e.g. credentialId). This causes issuedLogs.length === 0 even
  //   when the credential exists — resulting in false "not found" responses.
  //
  // Why direct readContract:
  //   • credentials(credId) returns the full authoritative struct in one call
  //   • Issuer = zero address ↔ credential doesn't exist (safe existence check)
  //   • Always reflects current state (post-upgrade, post-revoke)
  //   • ~instant — no multi-chunk block scan required
  //
  // We run the struct read + team verification IN PARALLEL for speed.

  // ① Read credential struct (primary — authoritative current state)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw = await (serverClient as any).readContract({
      address: CONTRACTS.CREDENTIAL_REGISTRY,
      abi:     CREDENTIAL_REGISTRY_ABI,
      functionName: "credentials",
      args: [credId],
    });
  } catch (err) {
    // readContract itself failed (RPC down, etc.) — fall back to event scan
    console.error("[verify] readContract(credentials) failed, falling back to events:", err);
    return scanCredentialViaEvents(credId);
  }

  // Named + positional accessor (viem can return named object or array depending on ABI shape)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (field: string, idx: number): any =>
    raw?.[field] !== undefined ? raw[field] : (Array.isArray(raw) ? raw[idx] : undefined);

  // ── Existence check: issuer is zero address ↔ credential not stored ────────
  const issuer = (r("issuer", 2) as string | undefined) ?? "";
  if (!issuer || issuer === ZERO_ADDR) return null;

  // ── Extract all fields from struct ─────────────────────────────────────────
  const credentialHash   = (r("credentialHash",   0) as string) ?? "";
  const ipfsCid          = (r("ipfsCID",          1) as string) ?? "";
  const candidate        = (r("candidate",        4) as string) ?? "";
  const candidatePassDid = (r("candidatePassDID", 5) as string) || undefined;
  const tier             = Number(r("tier",       6) ?? 2);
  const issuedAt         = Number(r("issuedAt",   7) ?? 0);
  const isRevoked        = Boolean(r("isRevoked", 8));
  const revokeReason     = isRevoked ? ((r("revokeReason", 9) as string) || undefined) : undefined;

  // ② Team verification (runs in parallel with nothing now, kept async for future)
  let teamVerified: VerifyResult["teamVerified"] | undefined;
  const manualAddr = CONTRACTS.MANUAL_VERIFICATION_REGISTRY;
  const isManualDeployed =
    !!manualAddr && manualAddr !== ZERO_ADDR;
  if (isManualDeployed) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tv = await (serverClient as any).readContract({
        address: manualAddr,
        abi:     MANUAL_VERIFICATION_REGISTRY_ABI,
        functionName: "getTeamVerification",
        args: [credId],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      if (tv?.verified) {
        teamVerified = {
          verified:   true,
          note:       tv.note as string,
          verifiedBy: tv.verifiedBy as string,
          verifiedAt: Number(tv.verifiedAt),
        };
      }
    } catch { /* ignore — team verification is optional */ }
  }

  return {
    issuer,
    candidate,
    tier,
    issuedAt,
    isRevoked,
    revokeReason,
    candidatePassDid,
    credentialHash: credentialHash || undefined,
    ipfsCid:        ipfsCid || undefined,
    teamVerified,
  };
}

// ── Fallback: event-based scan (used only if readContract completely fails) ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanCredentialViaEvents(credId: `0x${string}`): Promise<VerifyResult | null> {
  // Fetch ALL CredentialIssued events (no credentialId filter — avoids QIE RPC
  // bytes32 topic filter bug), then match in JS.
  const [allIssuedLogs, allRevokedLogs, allUpgradedLogs] = await Promise.all([
    getLogsChunked(
      serverClient as Parameters<typeof getLogsChunked>[0],
      {
        address: CONTRACTS.CREDENTIAL_REGISTRY,
        event: parseAbiItem(
          "event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed candidate, bytes32 credentialHash, uint8 tier, uint256 timestamp)"
        ),
      },
      40, true
    ),
    getLogsChunked(
      serverClient as Parameters<typeof getLogsChunked>[0],
      {
        address: CONTRACTS.CREDENTIAL_REGISTRY,
        event: parseAbiItem(
          "event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, string reason, uint256 timestamp)"
        ),
      },
      40, true
    ),
    getLogsChunked(
      serverClient as Parameters<typeof getLogsChunked>[0],
      {
        address: CONTRACTS.CREDENTIAL_REGISTRY,
        event: parseAbiItem(
          "event CredentialUpgraded(bytes32 indexed credentialId, address indexed institution, uint256 timestamp)"
        ),
      },
      40, true
    ),
  ]);

  const credIdLower = credId.toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = (l: any) =>
    (l?.args?.credentialId as string | undefined)?.toLowerCase() === credIdLower;

  const issuedLogs   = allIssuedLogs.filter(match);
  const revokedLogs  = allRevokedLogs.filter(match);
  const upgradedLogs = allUpgradedLogs.filter(match);

  if (issuedLogs.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ia = issuedLogs[0].args as any;
  let finalTier    = upgradedLogs.length > 0 ? 1 : Number(ia.tier);
  let finalIssuer  = ia.issuer as string;
  const isRevoked  = revokedLogs.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revokeReason = isRevoked ? ((revokedLogs[0].args as any)?.reason as string | undefined) : undefined;

  if (upgradedLogs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = (upgradedLogs[upgradedLogs.length - 1].args as any)?.institution;
    if (inst) finalIssuer = inst as string;
    finalTier = 1;
  }

  let teamVerified: VerifyResult["teamVerified"] | undefined;
  const manualAddr = CONTRACTS.MANUAL_VERIFICATION_REGISTRY;
  if (manualAddr && manualAddr !== "0x0000000000000000000000000000000000000000") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tv = await (serverClient as any).readContract({
        address: manualAddr,
        abi: MANUAL_VERIFICATION_REGISTRY_ABI,
        functionName: "getTeamVerification",
        args: [credId],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      if (tv?.verified) {
        teamVerified = {
          verified:   true,
          note:       tv.note as string,
          verifiedBy: tv.verifiedBy as string,
          verifiedAt: Number(tv.verifiedAt),
        };
      }
    } catch { /* ignore */ }
  }

  return {
    issuer:    finalIssuer,
    candidate: ia.candidate as string,
    tier:      finalTier,
    issuedAt:  Number(ia.timestamp),
    isRevoked,
    revokeReason,
    candidatePassDid: undefined,
    teamVerified,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { credId: string } }
) {
  const { credId } = params;

  // Validate format
  if (!credId || !credId.startsWith("0x") || credId.length !== 66) {
    return NextResponse.json(
      { error: "Invalid credential ID — must be a 0x-prefixed 32-byte hex string" },
      { status: 400 }
    );
  }

  const key    = credId.toLowerCase();
  // ?bypass=1  →  skip cache, re-scan blockchain (used by force-refresh button)
  const bypass = _req.nextUrl.searchParams.get("bypass") === "1";

  // ── Cache hit (unless bypass requested) ───────────────────────────────────
  if (!bypass) {
    const cached = getCached(key);
    if (cached) {
      // For non-null, non-revoked cached results: do a quick on-chain check
      // (single readContract call, ~100 ms) to detect if the credential has been
      // revoked or upgraded since caching. If so, evict and re-read the full result.
      // This prevents stale "Valid Credential" being served for a revoked credential.
      if (cached.result && !cached.result.isRevoked) {
        const live = await quickStateCheck(credId as `0x${string}`);
        if (live && (live.isRevoked !== cached.result.isRevoked || live.tier !== cached.result.tier)) {
          // State has changed — evict the stale cache entry and fall through to fresh read
          credCache.delete(key);
        } else {
          // State unchanged — safe to serve from cache
          return NextResponse.json(
            { found: true, result: cached.result, cachedAt: cached.cachedAt },
            { headers: { "X-Cache": "HIT", "Cache-Control": "public, max-age=30" } }
          );
        }
      } else {
        // null (not found) or already-revoked — serve from cache directly
        return NextResponse.json(
          { found: cached.result !== null, result: cached.result, cachedAt: cached.cachedAt },
          { headers: { "X-Cache": "HIT", "Cache-Control": "public, max-age=30" } }
        );
      }
    }
  } else {
    // Evict stale entry so we always store fresh data below
    credCache.delete(key);
  }

  // ── Cache miss — read from blockchain ────────────────────────────────────────
  try {
    const result = await scanCredential(credId as `0x${string}`);

    // Cache strategy:
    //   • Active (non-revoked) credential → 90s TTL; state is re-validated on
    //     every cache hit via quickStateCheck(), so stale revoke/upgrade is caught
    //   • Revoked credential              → NOT cached — always serve fresh state
    //   • Not found                       → 30s TTL — might be minted very soon
    if (result !== null && !result.isRevoked) {
      credCache.set(key, { result, cachedAt: Date.now() });
    } else if (result === null) {
      credCache.set(key, { result: null, cachedAt: Date.now() - (CACHE_TTL - 30_000) });
    }
    // isRevoked === true → intentionally NOT cached → always fresh from blockchain

    return NextResponse.json(
      { found: result !== null, result },
      { headers: { "X-Cache": "MISS" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown scan error";
    console.error("[verify API]", credId, msg);
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
