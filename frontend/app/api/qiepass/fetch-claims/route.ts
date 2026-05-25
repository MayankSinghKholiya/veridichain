// POST /api/qiepass/fetch-claims
// Retrieves name claims from an already-approved QIE Pass request.
// Used when the user is already paired (409) but we have no cached claims.
//
// Strategy:
//   1. Call getVerificationStatus(requestId) — note: status response only has claim *names*,
//      not values. But check if status is consent_given + vcMetadata.ready first.
//   2. Try claimAndVerify(requestId) — works if VC has not been claimed yet.
//      NOTE: claimAndVerify is SINGLE-USE. If already claimed, it will throw.
//   3. Return whatever firstName / lastName we can find.
import { NextRequest, NextResponse } from "next/server";
import { getVerificationStatus, claimAndVerify } from "../../../../lib/qiepassApi";

export async function POST(req: NextRequest) {
  try {
    const { requestId } = await req.json() as { requestId?: string };
    if (!requestId) {
      return NextResponse.json({ success: false, error: "requestId required" }, { status: 400 });
    }

    // ── Step 1: check status to get DID and see if VC is ready ───────────
    let statusDid: string | undefined;
    let vcIsReady = false;

    try {
      const status = await getVerificationStatus(requestId);
      statusDid = status.did;
      // VC ready when consent given AND vcMetadata.ready (or vcMetadata absent = old API)
      const consentGiven = status.status === "consent_given" || status.status === "approved";
      const metaReady = status.vcMetadata == null || status.vcMetadata.ready === true;
      vcIsReady = consentGiven && metaReady;
    } catch {
      // Ignore — still try claimAndVerify below
    }

    const hasName = (c: Record<string, unknown>) =>
      !!(String(c.firstName ?? "").trim() || String(c.lastName ?? "").trim());

    // ── Step 2: claimAndVerify (works if not yet claimed / VC is ready) ───
    try {
      const claimed = await claimAndVerify(requestId);
      if (hasName(claimed.claims)) {
        return NextResponse.json({
          success: true,
          claims:  claimed.claims,
          did:     claimed.did ?? statusDid,
        });
      }
    } catch {
      // claimAndVerify fails for already-claimed or not-yet-ready VCs — that's expected
    }

    // ── Nothing worked — return empty (caller will surface a friendly error) ─
    return NextResponse.json({
      success: true,
      claims:  {},
      did:     statusDid,
      vcReady: vcIsReady,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
