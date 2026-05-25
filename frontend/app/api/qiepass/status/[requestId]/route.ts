// GET /api/qiepass/status/[requestId]
// Polls the status of a QIE Pass verification request.
//
// ── claimAndVerify is SINGLE-USE ─────────────────────────────────────────────
// The QIE API allows claimAndVerify() to be called exactly ONCE per requestId.
// The polling loop (every 5s) can fire multiple concurrent requests while the
// status is "consent_given", causing a race where:
//   Call #1 → claimAndVerify succeeds → returns { firstName, lastName }
//   Call #2 → claimAndVerify fails ("already claimed") → returns empty claims
//   Call #2 response arrives AFTER call #1 → overwrites localStorage with {}
//
// Fix: module-level Map caches the claimAndVerify result per requestId.
//   - First call that reaches "consent_given": claims it, stores result.
//   - Every subsequent call: reads from cache, returns same result instantly.
//   - No double-call possible, no race condition.
//
// Flow:
//   status === "consent_given" → claimAndVerify (deduplicated via cache) → "approved" + claims
//   status === "approved"      → already claimed server-side → return cached result or empty
//   status === "rejected"      → surface immediately
//   status === "expired"       → surface immediately

import { NextRequest, NextResponse } from "next/server";
import { getVerificationStatus, claimAndVerify, type ClaimedCredential } from "../../../../../lib/qiepassApi";

// ── Server-side claim cache ───────────────────────────────────────────────────
// Key: requestId  Value: claimed credential (or null = failed/empty)
// Prevents double-calling the single-use claimAndVerify endpoint.
// TTL: 30 minutes (claims are small, no harm keeping them around)
interface CachedClaim {
  claimed:   ClaimedCredential | null;
  cachedAt:  number;
}
const CLAIM_TTL  = 30 * 60 * 1_000;
const claimCache = new Map<string, CachedClaim>();

function getCachedClaim(requestId: string): CachedClaim | null {
  const entry = claimCache.get(requestId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CLAIM_TTL) {
    claimCache.delete(requestId);
    return null;
  }
  return entry;
}

// Claim exactly once — all concurrent callers for the same requestId wait for
// the same promise (no duplicate network calls).
const inFlight = new Map<string, Promise<ClaimedCredential | null>>();

async function claimOnce(requestId: string): Promise<ClaimedCredential | null> {
  // Cache hit
  const cached = getCachedClaim(requestId);
  if (cached) return cached.claimed;

  // Already in-flight for this requestId — wait for the same promise
  if (inFlight.has(requestId)) return inFlight.get(requestId)!;

  // First caller — claim it, cache it, resolve all waiters
  const promise = (async (): Promise<ClaimedCredential | null> => {
    try {
      const claimed = await claimAndVerify(requestId);
      claimCache.set(requestId, { claimed, cachedAt: Date.now() });
      return claimed;
    } catch (err) {
      // Single-use already consumed, VC not ready, or other error
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[qiepass/status] claimAndVerify failed for", requestId, ":", msg);
      // Cache null so subsequent calls don't retry (it won't work)
      claimCache.set(requestId, { claimed: null, cachedAt: Date.now() });
      return null;
    } finally {
      inFlight.delete(requestId);
    }
  })();

  inFlight.set(requestId, promise);
  return promise;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  try {
    const { requestId } = params;
    if (!requestId) {
      return NextResponse.json(
        { success: false, error: "requestId required" },
        { status: 400 }
      );
    }

    const status = await getVerificationStatus(requestId);

    // ── Rejected ───────────────────────────────────────────────────────────
    if (status.status === "consent_rejected" || status.status === "rejected") {
      return NextResponse.json({
        success: true,
        data: { ...status, status: "rejected" },
      });
    }

    // ── Consent given → claim (exactly once, deduplicated) ─────────────────
    // "consent_given" = user just approved in wallet, VC ready to claim
    // "approved" on some QIE API versions also means claimable
    const isClaimable =
      status.status === "consent_given" ||
      status.status === "approved";
    const vcReady = status.vcMetadata == null || status.vcMetadata.ready === true;

    if (isClaimable && vcReady) {
      // claimOnce is idempotent — safe to call from multiple concurrent polls
      const claimed = await claimOnce(requestId);

      if (claimed) {
        return NextResponse.json({
          success: true,
          data: {
            ...status,
            status:  "approved",
            claimed,
          },
        });
      } else {
        // claimAndVerify failed (already consumed or VC not ready yet).
        // If status was "consent_given" but claim failed, it might not be ready
        // yet — keep polling. If "approved", it was already claimed elsewhere.
        const keepPolling = status.status === "consent_given" && !vcReady;
        return NextResponse.json({
          success: true,
          data: {
            ...status,
            status: keepPolling ? "consent_given" : "approved",
            claimError: "claimAndVerify unavailable (single-use already consumed or VC not ready)",
          },
        });
      }
    }

    // ── Still waiting for user consent ────────────────────────────────────
    return NextResponse.json({ success: true, data: status });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
