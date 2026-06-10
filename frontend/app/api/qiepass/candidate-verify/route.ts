// GET /api/qiepass/candidate-verify?wallet=0x...
// Claims lookup order: httpOnly cookie first (survives localStorage clears),
// then claimAndVerify as fallback (single-use, works only on first call after approval).
import { NextRequest, NextResponse } from "next/server";
import { listVerificationRequests, claimAndVerify } from "../../../../lib/qiepassApi";
import { getClaims, setClaimsOnResponse } from "../../../../lib/claimsStore";

export async function GET(req: NextRequest) {
  try {
    const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase();
    if (!wallet || !wallet.startsWith("0x")) {
      return NextResponse.json(
        { verified: false, error: "wallet param required (0x...)" },
        { status: 400 }
      );
    }

    const cookieClaims = getClaims("candidate", wallet);
    const cookieHasName = !!(cookieClaims?.firstName || cookieClaims?.lastName);

    const requests = await listVerificationRequests();
    const match = requests.find(
      (r) => r.walletAddress?.toLowerCase() === wallet && r.status === "completed"
    );

    if (!match) {
      // No completed request found for this wallet under current API keys.
      // Cookie may have claims from a previous partner/testnet — do NOT trust it.
      // Always require QIE Pass to confirm verification before returning verified:true.
      return NextResponse.json({ verified: false });
    }

    // Return cookie claims immediately if we have them
    if (cookieHasName) {
      return NextResponse.json({
        verified:    true,
        did:         cookieClaims!.did ?? match.did ?? null,
        requestId:   match.requestId,
        vcExpiresAt: match.vcExpiresAt ?? match.vcMetadata?.expiresAt ?? null,
        completedAt: match.completedAt ?? null,
        claims:      { firstName: cookieClaims!.firstName, lastName: cookieClaims!.lastName },
        source:      "cookie",
      });
    }

    let claims: Record<string, unknown> = {};
    let did: string | null = match.did ?? null;
    const response = NextResponse.json({
      verified:    true,
      did,
      requestId:   match.requestId,
      vcExpiresAt: match.vcExpiresAt ?? match.vcMetadata?.expiresAt ?? null,
      completedAt: match.completedAt ?? null,
      claims,
      source:      "api",
    });

    if (match.requestId) {
      try {
        const claimed = await claimAndVerify(match.requestId);
        claims = claimed.claims ?? {};
        did    = claimed.did ?? did;

        const firstName = String(claims.firstName ?? "").trim();
        const lastName  = String(claims.lastName  ?? "").trim();

        if (firstName || lastName) {
          setClaimsOnResponse(response, "candidate", wallet, {
            firstName, lastName,
            did:       did ?? undefined,
            requestId: match.requestId,
            storedAt:  Date.now(),
          });
        }
      } catch {
        // claimAndVerify already consumed — cookie will fix this on next fresh verify
      }
    }

    // Rebuild response with actual claims values
    return NextResponse.json({
      verified:    true,
      did,
      requestId:   match.requestId,
      vcExpiresAt: match.vcExpiresAt ?? match.vcMetadata?.expiresAt ?? null,
      completedAt: match.completedAt ?? null,
      claims,
      source:      "api",
    }, {
      headers: Object.fromEntries(response.headers.entries()),
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[candidate-verify] ERROR:", message);
    return NextResponse.json({ verified: false, error: message }, { status: 500 });
  }
}
