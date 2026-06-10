// QIE Pass API — server-side only. Uses HMAC-SHA256 auth.
// Never import this in client components — reads QIEPASS_SECRET_KEY which must stay server-side.

import crypto from "crypto";

const BASE_URL    = process.env.QIEPASS_BASE_URL    ?? "https://pass-api.qie.digital";
const PUBLIC_KEY  = process.env.QIEPASS_PUBLIC_KEY  ?? "";
const SECRET_KEY  = process.env.QIEPASS_SECRET_KEY  ?? "";

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

export interface VerificationRequest {
  requestId:        string;
  status:           "pending_consent" | "pending_kyc" | "approved" | "rejected" | "expired";
  userStatus:       "verified" | "unverified" | "not_verified" | "not_found";
  expiresAt:        string;
  alreadyVerified?:  boolean;
  existingClaims?:   Record<string, unknown>;
  vcExpiresAt?:      string;
  blockReason?:      "vc_active" | "vc_expired" | "unknown";
  redirectUrl?:      string;
}

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
  requestedClaims?: string[];
  did?:           string;
  walletAddress?: string;
  vcMetadata?:    VCMetadata;
}

export interface ClaimedCredential {
  credentialId?:   string;
  subject?:        string;
  claims:          Record<string, unknown>;
  did?:            string;
  proof?:          Record<string, unknown>;
  verification?:   Record<string, unknown>;
}

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

  // 409 = user already verified with this partner, no new request possible.
  // We look up the most recent request to get vcExpiresAt so the frontend
  // can tell the user when they can retry.
  if (res.status === 409) {
    let bodyData: Record<string, unknown> = {};
    try { bodyData = await res.json(); } catch { /* ignore */ }
    console.log("[qiepassApi] 409 body:", JSON.stringify(bodyData));

    let vcExpiresAt: string | undefined;
    let priorRequestId: string | undefined = (bodyData.requestId as string | undefined) || undefined;
    try {
      const list = await listVerificationRequests();
      const match = list.find(r =>
        r.did?.toLowerCase()           === identifier.toLowerCase() ||
        r.walletAddress?.toLowerCase() === identifier.toLowerCase()
      ) ?? list.find(r => r.status === "approved" || r.status === "consent_given")
        ?? list[0];
      vcExpiresAt = match?.vcExpiresAt ?? match?.vcMetadata?.expiresAt;
      if (match?.requestId) {
        priorRequestId = priorRequestId || match.requestId;
        console.log("[qiepassApi] 409 — found prior requestId:", match.requestId, "vcExpiresAt:", vcExpiresAt);
      }
    } catch { /* ignore */ }

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

// POST /api/v1/vc/partner/claim-and-verify
// Response shape (top-level, not nested under .data):
// { success, credentialId, subject, requestedClaims: { firstName, lastName, ... }, proof, verification }
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
  if (!json.success) {
    throw new Error(json.error ?? json.message ?? "Claim failed");
  }

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

// /api/v1/vc/partner/available-claims doesn't exist on pass-api.qie.digital
// these are the valid claims confirmed via live testing (as of May 2026)
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
