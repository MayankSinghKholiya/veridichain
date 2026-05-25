// POST /api/qiepass/request
// Creates a QIE Pass verification request for a user DID.
// Server-side only — QIEPASS_SECRET_KEY stays here.
import { NextRequest, NextResponse } from "next/server";
import { createVerificationRequest } from "../../../../lib/qiepassApi";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { identifier, requestedClaims } = body as {
      identifier:      string;
      requestedClaims: string[];
    };

    console.log("[qiepass/request] identifier:", identifier, "claims:", requestedClaims);

    if (!identifier || !requestedClaims?.length) {
      return NextResponse.json(
        { success: false, error: "identifier and requestedClaims are required" },
        { status: 400 }
      );
    }

    const data = await createVerificationRequest(identifier, requestedClaims);
    console.log("[qiepass/request] response:", JSON.stringify(data));
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[qiepass/request] ERROR:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
