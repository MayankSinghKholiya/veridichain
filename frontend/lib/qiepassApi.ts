// ── QIE Pass API — server-side only ──────────────────────────
// Uses HMAC-SHA256 authentication as per QIE Pass docs.
// NEVER import this file in client components — it uses `crypto`
// and reads QIEPASS_SECRET_KEY which must stay server-side.
// ─────────────────────────────────────────────────────────────
import crypto from "crypto";

const BASE_URL    = process.env.QIEPASS_BASE_URL    ?? "https://pass-api.qie.digital";
const PUBLIC_KEY  = process.env.QIEPASS_PUBLIC_KEY  ?? "";
const SECRET_KEY  = process.env.QIEPASS_SECRET_KEY  ?? "";

/** Build HMAC-SHA256 signed headers for every request */
function buildHeaders(): Record<string, string> {
  const timestamp = Date.now().toString();
  const message   = PUBLIC_KEY + timestamp;
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(message)
    .digest("hex");

  return {
    "Content-Type":  "application/json",
    "X-Public-Key":  PUBLIC_KEY,
    "X-Signature":   signature,
    "X-Timestamp":   timestamp,
  };
}

// ── Types ─────────────────────────────────────────────────────

export interface VerificationRequest {
  requestId:        string;
  status:           "pending_consent" | "approved" | "rejected" | "expired";
  userStatus:       "verified" | "unverified" | "not_found";
  expiresAt:        string;
  /** true when QIE Pass returns 409 "already verified with this partner" */
  alreadyVerified?:  boolean;
  /** Claims extracted from the 409 response body (if QIE returns them) */
  existingClaims?:   Record<string, unknown>;
  /** ISO string — when the existing VC expires (after which a new request may succeed) */
  vcExpiresAt?:      string;
  /**
   * Why QIE is blocking a new request (only set when alreadyVerified=true):
   *   "vc_active"  — VC hasn't expired yet; user must wait until vcExpiresAt
   *   "vc_expired" — VC is past vcExpiresAt but QIE cleanup job hasn't run; try in 1-2 hours
   *   "unknown"    — no expiry data from QIE; generic block
   */
  blockReason?:      "vc_active" | "vc_expired" | "unknown";
}

// ── List all requests for this partner ────────────────────────
// GET /api/v1/partners/verification-requests
export interface PartnerRequest {
  requestId:     string;
  status:        string;
  did?:          string;
  walletAddress?: string;
  completedAt?:  string;
  vcExpiresAt?:  string;
  vcMetadata?:   { expiresAt?: string; claimedAt?: string; ready?: boolean };
}

export async function listVerificationRequests(): Promise<PartnerRequest[]> {
  const res = await fetch(
    `${BASE_URL}/api/v1/partners/verification-requests`,
    { method: "GET", headers: buildHeaders() }
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []) as PartnerRequest[];
}

export interface VCMetadata {
  submittedAt?: string;
  expiresAt?:   string;
  ready:        boolean;
}

export interface VerificationStatus {
  requestId:      string;
  status:         "pending_consent" | "consent_given" | "consent_rejected" | "approved" | "rejected" | "expired";
  /** The list of claim *names* requested (NOT the values — values come from claimAndVerify) */
  requestedClaims?: string[];
  did?:           string;
  walletAddress?: string;
  vcMetadata?:    VCMetadata;
}

export interface ClaimedCredential {
  credentialId?:   string;
  subject?:        string;
  /** Actual claim values (firstName, lastName, etc.) — top-level in the API response */
  claims:          Record<string, unknown>;
  did?:            string;
  proof?:          Record<string, unknown>;
  verification?:   Record<string, unknown>;
}

// ── 1. Create Verification Request ───────────────────────────
// POST /api/v1/partners/verification-requests
export async function createVerificationRequest(
  identifier:      string,
  requestedClaims: string[]
): Promise<VerificationRequest> {
  const res = await fetch(
    `${BASE_URL}/api/v1/partners/verification-requests`,
    {
      method:  "POST",
      headers: buildHeaders(),
      body:    JSON.stringify({ identifier, requestedClaims }),
    }
  );

  // 409 = user already paired with this partner — no new request possible.
  // Look up the most recent completed request to find vcExpiresAt so the
  // frontend can tell the user when to retry.
  if (res.status === 409) {
    let bodyData: Record<string, unknown> = {};
    try { bodyData = await res.json(); } catch { /* ignore */ }
    console.log("[qiepassApi] 409 body:", JSON.stringify(bodyData));

    // Fetch partner request list to find vcExpiresAt + prior requestId
    let vcExpiresAt: string | undefined;
    let priorRequestId: string | undefined = (bodyData.requestId as string | undefined) || undefined;
    try {
      const list = await listVerificationRequests();
      // Find the most recent completed request matching this identifier
      const match = list.find(r =>
        r.did?.toLowerCase()           === identifier.toLowerCase() ||
        r.walletAddress?.toLowerCase() === identifier.toLowerCase()
      ) ?? list.find(r => r.status === "approved" || r.status === "consent_given")
        ?? list[0];
      vcExpiresAt = match?.vcExpiresAt ?? match?.vcMetadata?.expiresAt;
      // ← KEY FIX: return priorRequestId so frontend can try fetch-claims on it
      if (match?.requestId) {
        priorRequestId = priorRequestId || match.requestId;
        console.log("[qiepassApi] 409 — found prior requestId:", match.requestId, "vcExpiresAt:", vcExpiresAt);
      }
    } catch { /* ignore */ }

    // Determine exact blocking reason so frontend can show correct guidance:
    //   "vc_active"   — VC not expired yet, must wait until vcExpiresAt
    //   "vc_expired"  — VC expired but QIE cleanup job hasn't run yet (try in a few hours)
    //   "unknown"     — no expiry info from QIE
    const now = Date.now();
    const expMs = vcExpiresAt ? new Date(vcExpiresAt).getTime() : 0;
    const blockReason: "vc_active" | "vc_expired" | "unknown" =
      expMs > 0 && now < expMs  ? "vc_active"  :
      expMs > 0 && now >= expMs ? "vc_expired" :
      "unknown";

    return {
      requestId:       priorRequestId ?? "",
      status:          "approved",
      userStatus:      "verified",
      expiresAt:       "",
      alreadyVerified: true,
      existingClaims:  (bodyData.claims ?? bodyData.data) as Record<string, unknown> | undefined,
      vcExpiresAt,
      blockReason,
    };
  }

  if (!res.ok) {
    const text = await res.text();
    console.error("[qiepassApi] createVerificationRequest error", res.status, text);
    throw new Error(`QIE Pass API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  console.log("[qiepassApi] createVerificationRequest success:", JSON.stringify(json));
  if (!json.success) throw new Error(json.message ?? "Request failed");
  return json.data as VerificationRequest;
}

// ── 2. Poll Request Status ────────────────────────────────────
// GET /api/v1/partners/verification-requests/{requestId}
export async function getVerificationStatus(
  requestId: string
): Promise<VerificationStatus> {
  const res = await fetch(
    `${BASE_URL}/api/v1/partners/verification-requests/${requestId}`,
    { method: "GET", headers: buildHeaders() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QIE Pass status error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "Status fetch failed");
  return json.data as VerificationStatus;
}

// ── 3. Claim & Verify Credentials ────────────────────────────
// POST /api/v1/vc/partner/claim-and-verify
// Actual response shape (from docs — top-level, NOT nested under .data):
// {
//   "success": true,
//   "credentialId": "urn:uuid:...",
//   "subject": "did:qie:...",
//   "requestedClaims": { "firstName": "John", "lastName": "Doe", ... },
//   "proof": { ... },
//   "verification": { "signatureValid": true, ... }
// }
// Error shape: { success:false, valid:false, error: string, reason: string }
export async function claimAndVerify(
  requestId: string
): Promise<ClaimedCredential> {
  const res = await fetch(
    `${BASE_URL}/api/v1/vc/partner/claim-and-verify`,
    {
      method:  "POST",
      headers: buildHeaders(),
      body:    JSON.stringify({ requestId }),
    }
  );

  const json = await res.json();
  // error field used in failure responses (not message)
  if (!json.success) {
    throw new Error(json.error ?? json.message ?? "Claim failed");
  }

  // Response is at top level (not json.data).
  // Claims are in "requestedClaims" field — map to our internal "claims" key.
  const rawClaims = (json.requestedClaims ?? json.data?.requestedClaims ?? json.data?.claims ?? {}) as Record<string, unknown>;
  const did = (json.subject ?? json.data?.subject ?? json.data?.did) as string | undefined;

  return {
    credentialId: json.credentialId ?? json.data?.credentialId,
    subject:      did,
    claims:       rawClaims,
    did,
    proof:        json.proof,
    verification: json.verification,
  };
}

// ── 4. Get Available Claims ───────────────────────────────────
// NOTE: /api/v1/vc/partner/available-claims does not exist on pass-api.qie.digital
// Returning the known valid claims discovered via live testing.
// Valid as of May 2026 — update if QIE adds more claims.
export const KNOWN_VALID_CLAIMS = [
  "firstName",
  "lastName",
  "nationality",
  "dateOfBirth",
  "age_over_18",
  "age_over_21",
] as const;

export type QIEClaim = (typeof KNOWN_VALID_CLAIMS)[number];

export async function getAvailableClaims(): Promise<string[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/v1/vc/partner/available-claims`,
      { method: "GET", headers: buildHeaders() }
    );
    if (!res.ok) return [...KNOWN_VALID_CLAIMS];
    const json = await res.json();
    const fromApi = (json.data?.claims ?? json.data ?? []) as string[];
    return fromApi.length > 0 ? fromApi : [...KNOWN_VALID_CLAIMS];
  } catch {
    return [...KNOWN_VALID_CLAIMS];
  }
}
