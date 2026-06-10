// POST /api/qiepass/fetch-claims
// Retrieves name claims from an already-approved QIE Pass request.
//
// Strategy (most-reliable first):
//   1. httpOnly cookie "qpc" — permanent server-side store
//   2. claimAndVerify        — single-use, works if VC not yet claimed
//
import { NextRequest, NextResponse } from "next/server";
import { getVerificationStatus, claimAndVerify } from "../../../../lib/qiepassApi";
import { getClaims, setClaimsOnResponse } from "../../../../lib/claimsStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { requestId?: string; wallet?: string; role?: string };
    const { requestId, wallet, role = "candidate" } = body;
    const kvRole = (role === "institution" ? "institution" : "candidate") as "candidate" | "institution";

    if (!requestId) {
      return NextResponse.json({ success: false, error: "requestId required" }, { status: 400 });
    }

    if (wallet) {
      const cookieClaims = getClaims(kvRole, wallet);
      if (cookieClaims?.firstName || cookieClaims?.lastName) {
        return NextResponse.json({
          success: true,
          claims:  { firstName: cookieClaims.firstName, lastName: cookieClaims.lastName },
          did:     cookieClaims.did,
          source:  "cookie",
        });
      }
    }

    let statusDid: string | undefined;
    let vcIsReady = false;
    try {
      const status = await getVerificationStatus(requestId);
      statusDid = status.did;
      const consentGiven = status.status === "consent_given" || status.status === "approved";
      const metaReady = status.vcMetadata == null || status.vcMetadata.ready === true;
      vcIsReady = consentGiven && metaReady;
    } catch { /* ignore */ }

    const hasName = (c: Record<string, unknown>) =>
      !!(String(c.firstName ?? "").trim() || String(c.lastName ?? "").trim());

    try {
      const claimed = await claimAndVerify(requestId);
      if (hasName(claimed.claims)) {
        const firstName = String(claimed.claims.firstName ?? "").trim();
        const lastName  = String(claimed.claims.lastName  ?? "").trim();

        const response = NextResponse.json({
          success: true,
          claims:  claimed.claims,
          did:     claimed.did ?? statusDid,
          source:  "claimAndVerify",
        });

        if (wallet && (firstName || lastName)) {
          setClaimsOnResponse(response, kvRole, wallet, {
            firstName, lastName,
            did: claimed.did ?? statusDid,
            requestId, storedAt: Date.now(),
          });
        }
        return response;
      }
    } catch { /* already consumed */ }

    return NextResponse.json({
      success: true, claims: {}, did: statusDid, vcReady: vcIsReady, source: "empty",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
