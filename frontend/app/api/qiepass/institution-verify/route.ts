// GET /api/qiepass/institution-verify?wallet=0x...
//
// SERVER-SIDE institution KYC check — does NOT trust localStorage.
// Calls QIE Pass API directly to confirm this wallet has a completed
// verification with VeridiChain. Used by institution page on every load.
//
// Security model:
//   • localStorage can be cleared/faked by anyone with DevTools
//   • This endpoint queries QIE Pass servers — cannot be bypassed client-side
//   • Returns { verified: true } only if QIE Pass confirms a completed request
//     for this wallet address
//
import { NextRequest, NextResponse } from "next/server";
import { listVerificationRequests } from "../../../../lib/qiepassApi";

export async function GET(req: NextRequest) {
  try {
    const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase();
    if (!wallet || !wallet.startsWith("0x")) {
      return NextResponse.json(
        { verified: false, error: "wallet param required (0x...)" },
        { status: 400 }
      );
    }

    // Fetch all requests for this partner from QIE Pass
    const requests = await listVerificationRequests();

    // Find a completed request for this wallet address
    const match = requests.find(
      (r) =>
        r.walletAddress?.toLowerCase() === wallet &&
        r.status === "completed"
    );

    if (match) {
      return NextResponse.json({
        verified:    true,
        did:         match.did ?? null,
        requestId:   match.requestId,
        completedAt: match.completedAt ?? null,
      });
    }

    return NextResponse.json({ verified: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[institution-verify] ERROR:", message);
    // On API error, default to unverified (fail-safe)
    return NextResponse.json({ verified: false, error: message }, { status: 500 });
  }
}
