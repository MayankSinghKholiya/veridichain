// GET /api/qiepass/claims
// Returns available claims from QIE Pass API.
import { NextResponse } from "next/server";
import { getAvailableClaims } from "../../../../lib/qiepassApi";

export async function GET() {
  try {
    const claims = await getAvailableClaims();
    return NextResponse.json({ success: true, data: claims });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
