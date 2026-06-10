// GET /api/qiepass/status/[requestId]
//
// claimAndVerify() is single-use per requestId. The 5s polling loop can fire
// concurrent requests while status is "consent_given", causing a race:
//   Call #1 succeeds → { firstName, lastName }
//   Call #2 fails ("already claimed") → {} overwrites localStorage
// Fix: module-level Map caches the result per requestId so claimAndVerify
// is called exactly once even under concurrent polls.

import { NextRequest, NextResponse } from "next/server";
import { getVerificationStatus, claimAndVerify, type ClaimedCredential } from "../../../../../lib/qiepassApi";
import { setClaimsOnResponse } from "../../../../../lib/claimsStore";

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

// All concurrent callers for the same requestId wait for the same promise
const inFlight = new Map<string, Promise<ClaimedCredential | null>>();

async function claimOnce(requestId: string): Promise<ClaimedCredential | null> {
  const cached = getCachedClaim(requestId);
  if (cached) return cached.claimed;

  if (inFlight.has(requestId)) return inFlight.get(requestId)!;

  const promise = (async (): Promise<ClaimedCredential | null> => {
    try {
      const claimed = await claimAndVerify(requestId);
      claimCache.set(requestId, { claimed, cachedAt: Date.now() });
      return claimed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[qiepass/status] claimAndVerify failed for", requestId, ":", msg);
      claimCache.set(requestId, { claimed: null, cachedAt: Date.now() });
      return null;
    } finally {
      inFlight.delete(requestId);
    }
  })();

  inFlight.set(requestId, promise);
  return promise;
}

export async function GET(
  req: NextRequest,
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

    const role = (req.nextUrl.searchParams.get("role") ?? "candidate") as "candidate" | "institution";
    const status = await getVerificationStatus(requestId);

    if (status.status === "consent_rejected" || status.status === "rejected") {
      return NextResponse.json({
        success: true,
        data: { ...status, status: "rejected" },
      });
    }

    const isClaimable =
      status.status === "consent_given" ||
      status.status === "approved";
    const vcReady = status.vcMetadata == null || status.vcMetadata.ready === true;

    if (isClaimable && vcReady) {
      const claimed = await claimOnce(requestId);

      if (claimed) {
        // Persist to cookie immediately — claimAndVerify is single-use so this
        // is our only chance to get the name claims. Cookie survives localStorage clears.
        const wallet    = status.walletAddress?.toLowerCase();
        const firstName = String(claimed.claims?.firstName ?? "").trim();
        const lastName  = String(claimed.claims?.lastName  ?? "").trim();

        const claimedResponse = NextResponse.json({
          success: true,
          data: { ...status, status: "approved", claimed },
        });

        if (wallet && (firstName || lastName)) {
          setClaimsOnResponse(claimedResponse, role, wallet, {
            firstName, lastName,
            did:       claimed.did ?? status.did,
            requestId,
            storedAt:  Date.now(),
          });
        }

        return claimedResponse;
      } else {
        // claimAndVerify already consumed or VC not ready yet
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

    return NextResponse.json({ success: true, data: status });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // 404 = requestId doesn't exist in current API env (e.g. switched live→sandbox)
    // Return stale flag so client can clear localStorage and start fresh
    const isStale = message.includes("404") || message.toLowerCase().includes("not found");
    return NextResponse.json({ success: false, error: message, stale: isStale }, { status: 200 });
  }
}
