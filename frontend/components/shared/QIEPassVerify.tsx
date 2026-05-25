"use client";

// ── QIEPassVerify ────────────────────────────────────────────
// Full QIE Pass verification flow component.
//
// Roles:
//   candidate   → key: qiepass:candidate:0xWallet
//   institution → key: qiepass:institution:0xWallet  (locked — no Remove/Change)
//
// Same wallet can have SEPARATE verifications per role — different localStorage
// keys mean different DIDs, different QIE requests, no cross-contamination.
//
// States:
//   idle       → "Verify with QIE Pass" button → goes to input
//   input      → user manually enters their QIE Pass DID
//   requesting → calling our API route
//   pending    → waiting for user to approve in QIE Wallet app
//   approved   → verified ✅ (stored in localStorage)
//   rejected   → user rejected or expired
//   error      → API/network error
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────
type VerifyState =
  | "idle"
  | "input"
  | "requesting"
  | "pending"
  | "approved"
  | "rejected"
  | "error";

interface StoredPass {
  verified:    boolean;
  did:         string;
  requestId?:  string;
  claims?:     Record<string, unknown>;
  verifiedAt:  number;
  /** ISO string — when QIE VC expires and a new request can be created */
  vcExpiresAt?: string;
}

export type QIEPassRole = "candidate" | "institution";

interface Props {
  /** Connected wallet address */
  address: `0x${string}` | undefined;
  /**
   * Role determines the localStorage namespace.
   * "candidate"   → key: qiepass:candidate:0xWallet
   * "institution" → key: qiepass:institution:0xWallet
   * Same wallet gets SEPARATE verifications per role.
   */
  role?: QIEPassRole;
  /** Claims to request from QIE Pass */
  requestedClaims?: string[];
  /** Called when KYC verification is complete */
  onVerified?: (did: string, claims: Record<string, unknown>) => void;
  /** compact = just badge; full = badge + button (default) */
  variant?: "compact" | "full";
  /**
   * locked = institution mode.
   * Once verified, the badge is permanent — no Change / Remove buttons shown.
   * Prevents an institution from removing KYC after registration.
   */
  locked?: boolean;
}

// ── localStorage helpers — role-scoped ───────────────────────
// Key format: qiepass:{role}:{address}
// This ensures candidate and institution verifications are completely separate,
// even when the same wallet is used for both roles.
function storageKey(role: QIEPassRole, address: string): string {
  return `qiepass:${role}:${address.toLowerCase()}`;
}

function getStoredPass(role: QIEPassRole, address: string): StoredPass | null {
  try {
    const raw = localStorage.getItem(storageKey(role, address));
    return raw ? (JSON.parse(raw) as StoredPass) : null;
  } catch { return null; }
}

function setStoredPass(role: QIEPassRole, address: string, pass: StoredPass) {
  try {
    localStorage.setItem(storageKey(role, address), JSON.stringify(pass));
  } catch { /* ignore */ }
}

function clearStoredPass(role: QIEPassRole, address: string) {
  try { localStorage.removeItem(storageKey(role, address)); } catch { /* ignore */ }
}

// ── Component ────────────────────────────────────────────────
export function QIEPassVerify({
  address,
  role = "candidate",
  requestedClaims = ["firstName", "lastName", "age_over_18"],
  onVerified,
  variant = "full",
  locked = false,
}: Props) {
  const [state,       setState]       = useState<VerifyState>("idle");
  const [didInput,    setDidInput]    = useState("");
  const [requestId,   setRequestId]   = useState("");
  const [storedPass,  setStoredPassState] = useState<StoredPass | null>(null);
  const [errorMsg,    setErrorMsg]    = useState("");
  const [pollCount,   setPollCount]   = useState(0);
  /**
   * Why QIE blocked the last request (set when alreadyVerified=true, null otherwise).
   * Drives context-aware error messages without string-matching hacks.
   *   "vc_active"  — VC hasn't expired; user must wait
   *   "vc_expired" — VC expired but QIE cleanup pending; retry in ~1-2 hours
   *   "unknown"    — no expiry info from QIE
   */
  const [blockReason, setBlockReason] = useState<"vc_active" | "vc_expired" | "unknown" | null>(null);

  // ── Load stored pass on mount ───────────────────────────────
  useEffect(() => {
    if (!address) return;
    const stored = getStoredPass(role, address);
    if (stored?.verified) {
      setStoredPassState(stored);
      setState("approved");
      if (stored.did) setDidInput(stored.did);
    }
  }, [address]);

  // ── Poll for approval ───────────────────────────────────────
  const pollStatus = useCallback(async (rid: string) => {
    if (!rid) return;
    try {
      const res  = await fetch(`/api/qiepass/status/${rid}`);
      const json = await res.json();

      if (!json.success) {
        setErrorMsg(json.error ?? "Polling error");
        setState("error");
        return;
      }

      const { status, claimed } = json.data;

      // API route normalises consent_given → approved, but guard both
      const isApproved = status === "approved" || status === "consent_given";

      if (isApproved) {
        // Prefer real DID from API response over what user typed
        const resolvedDid =
          (json.data.did as string | undefined) ||
          (claimed?.did   as string | undefined) ||
          didInput;

        const freshClaims  = (claimed?.claims ?? {}) as Record<string, unknown>;
        const nameInFresh  = !!(String(freshClaims.firstName ?? "").trim() || String(freshClaims.lastName ?? "").trim());

        // ── NEVER overwrite existing name claims with empty ones ──────────
        // Race condition: multiple concurrent polls can both trigger while
        // status is "consent_given". claimAndVerify is single-use — the server
        // deduplicates it, but the second poll response might still arrive with
        // no claims (claimError). If we already stored a good name, keep it.
        const existingClaims = storedPass?.claims ?? {};
        const nameInExisting = !!(
          String(existingClaims.firstName ?? "").trim() ||
          String(existingClaims.lastName  ?? "").trim()
        );
        const finalClaims = nameInFresh
          ? freshClaims           // fresh response has name — use it
          : nameInExisting
            ? existingClaims      // keep existing name, don't overwrite with {}
            : freshClaims;        // both empty — store whatever we got

        const pass: StoredPass = {
          verified:   true,
          did:        resolvedDid,
          requestId:  rid,
          claims:     finalClaims,
          verifiedAt: Date.now(),
        };
        if (address) { setStoredPass(role, address, pass); setStoredPassState(pass); }
        if (resolvedDid !== didInput) setDidInput(resolvedDid);
        setState("approved");
        onVerified?.(resolvedDid, finalClaims);
      } else if (status === "rejected" || status === "expired") {
        setState("rejected");
      } else {
        setPollCount((n) => n + 1);
      }
    } catch {
      setPollCount((n) => n + 1); // retry on network error
    }
  }, [address, role, didInput, onVerified, storedPass]);

  // ── Polling effect — every 5s while pending ─────────────────
  useEffect(() => {
    if (state !== "pending" || !requestId) return;
    const timer = setTimeout(() => pollStatus(requestId), 5000);
    return () => clearTimeout(timer);
  }, [state, requestId, pollCount, pollStatus]);

  // ── Handlers ─────────────────────────────────────────────────
  async function handleCreateRequest() {
    const did = didInput.trim();
    if (!did) {
      setErrorMsg("Please enter your QIE Pass DID");
      return;
    }
    setState("requesting");
    setErrorMsg("");
    setBlockReason(null);

    try {
      const res  = await fetch("/api/qiepass/request", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ identifier: did, requestedClaims }),
      });
      const json = await res.json();

      if (!json.success) {
        setErrorMsg(json.error ?? "Failed to create verification request");
        setState("error");
        return;
      }

      const {
        requestId: rid, userStatus, alreadyVerified,
        existingClaims, vcExpiresAt,
        blockReason: apiBlockReason,
      } = json.data as {
        requestId?:    string;
        userStatus?:   string;
        alreadyVerified?: boolean;
        existingClaims?: Record<string, unknown>;
        vcExpiresAt?:  string;
        blockReason?:  "vc_active" | "vc_expired" | "unknown";
      };

      // ── 409: QIE Pass already paired with this partner ───────────────────
      // This means an active VC exists. We CANNOT get a new request until it expires.
      //
      // The name is REQUIRED — self-attest name-matching won't work without it.
      // So we do NOT auto-approve here. Instead:
      //   • Priority 1 — claims came in the 409 body (rare but possible)
      //   • Priority 2 — claims are in localStorage from a previous successful flow
      //   • Otherwise  — show expiry countdown and ask user to retry after VC expires
      if (alreadyVerified) {
        const hasName = (c?: Record<string, unknown>) =>
          !!(String(c?.firstName ?? "").trim() || String(c?.lastName ?? "").trim());

        // ── Priority 1: QIE included claims in the 409 body ─────────────
        if (hasName(existingClaims as Record<string, unknown>)) {
          const merged = { ...(existingClaims ?? {}) };
          const pass: StoredPass = {
            verified: true, did, requestId: rid ?? "",
            claims: merged, verifiedAt: Date.now(), vcExpiresAt,
          };
          if (address) { setStoredPass(role, address, pass); setStoredPassState(pass); }
          setState("approved");
          onVerified?.(did, merged);
          return;
        }

        // ── Priority 2: name already in localStorage (same session / page reload)
        if (hasName(storedPass?.claims)) {
          const restored: StoredPass = {
            ...storedPass,
            verified:    true,
            did,
            requestId:   rid ?? storedPass?.requestId ?? "",
            verifiedAt:  Date.now(),
            vcExpiresAt: vcExpiresAt ?? storedPass?.vcExpiresAt,
          } as StoredPass;
          if (address) { setStoredPass(role, address, restored); setStoredPassState(restored); }
          setState("approved");
          onVerified?.(did, storedPass?.claims ?? {});
          return;
        }

        // ── Priority 3: try claimAndVerify via fetch-claims with prior requestId
        // When QIE returns 409 the VC is still active. The prior claimAndVerify
        // call might have failed silently (race condition / network error). Try
        // once more — server-side cache deduplicates it, so this is safe.
        const priorRid = rid || storedPass?.requestId;
        if (priorRid) {
          try {
            const fcRes = await fetch("/api/qiepass/fetch-claims", {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ requestId: priorRid }),
            });
            if (fcRes.ok) {
              const fc = await fcRes.json() as { success: boolean; claims?: Record<string, unknown>; did?: string };
              const resolvedDid = fc.did || did;
              const fetchedFirst = String(fc.claims?.firstName ?? "").trim();
              const fetchedLast  = String(fc.claims?.lastName  ?? "").trim();
              if (fetchedFirst || fetchedLast) {
                const pass: StoredPass = {
                  verified: true, did: resolvedDid, requestId: priorRid,
                  claims: fc.claims ?? {}, verifiedAt: Date.now(), vcExpiresAt,
                };
                if (address) { setStoredPass(role, address, pass); setStoredPassState(pass); }
                setState("approved");
                onVerified?.(resolvedDid, fc.claims ?? {});
                return;
              }
            }
          } catch { /* fetch-claims failed — fall through to expiry message */ }
        }

        // ── No name available — show expiry info and block ───────────────
        // The name IS required for self-attest verification. We cannot proceed
        // without it. Use blockReason (set by the server) for accurate guidance:
        //   "vc_active"  → VC hasn't expired; user must wait until vcExpiresAt
        //   "vc_expired" → VC past expiry but QIE cleanup job hasn't run; retry in 1–2 h
        //   "unknown"    → QIE blocked for unclear reason; contact support if persistent
        const br = apiBlockReason ?? "unknown";
        setBlockReason(br);

        // Persist vcExpiresAt so the "name not synced" warning in approved UI is accurate
        if (vcExpiresAt && address) {
          try {
            const k = storageKey(role, address);
            const prev = localStorage.getItem(k);
            localStorage.setItem(k, JSON.stringify({ ...(prev ? JSON.parse(prev) : {}), vcExpiresAt }));
          } catch { /* ignore */ }
        }

        if (br === "vc_active") {
          const expDate = new Date(vcExpiresAt!);
          const dateStr = expDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
          const timeStr = expDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
          setErrorMsg(
            `Your QIE Pass verification is active until ${dateStr} at ${timeStr}. ` +
            `Come back after that time and click "Verify →" — a new request will appear in your QIE Wallet.`
          );
        } else if (br === "vc_expired") {
          const timeStr = vcExpiresAt
            ? new Date(vcExpiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
            : "";
          setErrorMsg(
            `Your QIE VC expired${timeStr ? ` at ${timeStr}` : ""}. ` +
            `QIE processes expirations periodically — try again in 1–2 hours and ` +
            `a new verification request will appear in your QIE Wallet.`
          );
        } else {
          // "unknown" — QIE blocked without expiry data
          setErrorMsg(
            "QIE is blocking this request — the DID pairing may still be active on QIE's side. " +
            "If this continues after a few hours, contact QIE Pass support."
          );
        }

        setState("error");
        return;
      }
      // ── Fresh request — go to pending/polling ────────────────────────────
      setRequestId(rid);
      setState("pending");
      setPollCount(0);

      // Immediately poll once for already-verified users
      if (userStatus === "verified") { setTimeout(() => pollStatus(rid), 1000); }
    } catch {
      setErrorMsg("Network error — check connection and try again");
      setState("error");
    }
  }

  // ── No handleChange / handleReset ───────────────────────────
  // KYC verification is a ONE-TIME permanent action for both candidate and
  // institution. Once a DID is verified with QIE Pass it cannot be changed
  // or removed — QIE permanently pairs the DID with this partner, and the
  // name from QIE is the ground truth for self-attest name matching.
  // The disclaimer shown before verification makes this clear to the user.

  // ── Render helpers ───────────────────────────────────────────

  // ── Approved ─────────────────────────────────────────────────
  if (state === "approved" && storedPass) {
    const date = new Date(storedPass.verifiedAt).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });

    if (variant === "compact") {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-green-500/30 text-xs font-semibold"
          style={{ background: "rgba(34,197,94,0.10)" }}
        >
          <span className="text-green-400">✅ KYC Verified</span>
          <span className="text-green-300/40 font-normal">· QIE Pass · 🔒</span>
        </span>
      );
    }

    // Strip QIE placeholder tokens (e.g. "Unknown") from display and matching
    const stripPlaceholders = (s: string) => {
      const PLACEHOLDERS = new Set(["unknown", "n/a", "null", "undefined", "none", "na"]);
      return s.trim().split(/\s+/).filter(w => w && !PLACEHOLDERS.has(w.toLowerCase())).join(" ");
    };
    const displayFirst = stripPlaceholders(String(storedPass.claims?.firstName ?? ""));
    const displayLast  = stripPlaceholders(String(storedPass.claims?.lastName  ?? ""));
    const hasName = !!(displayFirst || displayLast);

    return (
      <div className="rounded-2xl p-5 border border-green-500/20 space-y-2"
        style={{ background: "rgba(34,197,94,0.07)" }}>
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔒</span>
          <div>
            <p className="text-green-400 font-bold text-sm">
              {hasName
                ? `KYC Verified · ${displayFirst} ${displayLast}`.trimEnd()
                : "KYC Verified via QIE Pass"}
              <span className="text-green-300/35 font-normal text-xs ml-1.5">(Permanent)</span>
            </p>
            <p className="text-green-300/40 text-xs">
              Verified on {date} · cannot be changed
            </p>
          </div>
        </div>

        {/* Warning when name not available — informational only, no action possible */}
        {!hasName && (
          <div className="rounded-xl px-3 py-2.5 border border-amber-500/20 text-xs text-amber-300/60 leading-relaxed space-y-1"
            style={{ background: "rgba(245,158,11,0.05)" }}>
            <p className="font-semibold text-amber-300/80">⚠️ Name not synced</p>
            <p>
              Your QIE Pass DID is linked but the legal name wasn&apos;t fetched (one-time claim was already consumed).
              Self-attest name-matching won&apos;t work until QIE&apos;s pairing resets.
              Contact support if this persists.
            </p>
          </div>
        )}

        {storedPass.did && (
          <p className="text-green-300/25 text-xs font-mono break-all pl-8">
            {storedPass.did}
          </p>
        )}
      </div>
    );
  }

  // ── Role conflict check ──────────────────────────────────────
  // Candidate and institution are mutually exclusive on VeridiChain.
  // If the opposite role is already verified for this wallet, block immediately.
  const oppositeRole: QIEPassRole = role === "candidate" ? "institution" : "candidate";
  const isConflicted = !!(address && getStoredPass(oppositeRole, address)?.verified);

  if (isConflicted) {
    return (
      <div className="rounded-2xl px-4 py-3.5 border border-red-500/20 space-y-1.5"
        style={{ background: "rgba(239,68,68,0.05)" }}>
        <p className="text-red-400/80 font-semibold text-xs flex items-center gap-1.5">
          <span>🚫</span> Role conflict — cannot verify as {role}
        </p>
        <p className="text-red-300/50 text-xs leading-relaxed">
          This wallet is already linked as a{" "}
          <strong className="text-red-300/70">{oppositeRole}</strong>.
          A single wallet cannot hold both roles — use a different wallet for {role} access.
        </p>
      </div>
    );
  }

  // ── Idle — one-time disclaimer + verify button ───────────────
  if (state === "idle") {
    return (
      <div className="space-y-3">
        {/* One-time permanent warning — shown BEFORE user starts */}
        <div className="rounded-2xl px-4 py-3.5 border border-amber-500/25 space-y-2"
          style={{ background: "rgba(245,158,11,0.06)" }}>
          <p className="text-amber-300/85 font-semibold text-xs flex items-center gap-1.5">
            <span>⚠️</span> One-time verification — please read
          </p>
          <ul className="text-amber-300/55 text-xs space-y-1.5 leading-relaxed">
            <li>• Once verified, <strong className="text-amber-300/75">this cannot be changed or removed</strong></li>
            <li>• Your legal name will be fetched from QIE Pass and used for identity verification</li>
            <li>• Make sure you open the <strong className="text-amber-300/75">correct QIE Wallet account</strong> on your phone before tapping below</li>
          </ul>
        </div>
        <button
          onClick={() => setState("input")}
          disabled={!address}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold border border-sky-500/30 hover:border-sky-500/60 transition-all disabled:opacity-40 w-full justify-center"
          style={{ background: "rgba(14,165,233,0.08)" }}
        >
          <span>🪪</span>
          <span className="text-sky-400">I understand — Verify with QIE Pass →</span>
        </button>
      </div>
    );
  }

  // ── Input — manual DID entry ─────────────────────────────────
  if (state === "input") {
    return (
      <div className="glass rounded-2xl p-5 space-y-4 border-sky-500/15">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🪪</span>
          <p className="text-white font-semibold text-sm">Enter your QIE Pass DID</p>
        </div>

        <div className="rounded-xl px-3 py-2.5 border border-sky-500/15 text-xs text-sky-300/50 leading-relaxed space-y-1"
          style={{ background: "rgba(14,165,233,0.04)" }}>
          <p className="font-semibold text-sky-300/70">📱 Where to find your DID:</p>
          <p>Open <strong className="text-sky-300/80">QIE Wallet</strong> app → <strong className="text-sky-300/80">QIE Pass</strong> section → Profile → Copy your DID</p>
        </div>

        <input
          value={didInput}
          onChange={(e) => setDidInput(e.target.value)}
          placeholder="did:qie:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          autoFocus
          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono"
        />

        {errorMsg && (
          <p className="text-red-300 text-xs flex items-center gap-1.5">
            <span>⚠️</span>{errorMsg}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleCreateRequest}
            className="btn-primary flex-1 text-white py-2.5 rounded-xl font-semibold text-sm"
          >
            Verify →
          </button>
          <button
            onClick={() => setState("idle")}
            className="px-4 py-2.5 rounded-xl text-sm text-white/40 hover:text-white/70 glass transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Requesting — spinner ─────────────────────────────────────
  if (state === "requesting") {
    return (
      <div className="glass rounded-2xl p-5 flex items-center gap-3">
        <svg className="animate-spin text-sky-400 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="rgba(14,165,233,0.3)" strokeWidth="3"/>
          <path d="M12 2a10 10 0 0110 10" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round"/>
        </svg>
        <p className="text-white/60 text-sm">Creating verification request…</p>
      </div>
    );
  }

  // ── Pending — waiting for user to approve ────────────────────
  if (state === "pending") {
    return (
      <div className="glass rounded-2xl p-5 space-y-4 border-amber-500/15">
        <div className="flex items-center gap-3">
          <svg className="animate-spin text-amber-400 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="rgba(245,158,11,0.3)" strokeWidth="3"/>
            <path d="M12 2a10 10 0 0110 10" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <p className="text-amber-300 font-semibold text-sm">Waiting for your approval…</p>
        </div>

        <div className="rounded-xl px-4 py-3 border border-amber-500/20 space-y-2.5"
          style={{ background: "rgba(245,158,11,0.07)" }}>
          <p className="text-amber-300/80 text-xs font-semibold">📱 Steps to approve:</p>
          <ol className="text-amber-300/60 text-xs space-y-1.5 list-decimal list-inside">
            <li>Open your <strong className="text-amber-300/80">QIE Wallet</strong> app on your phone</li>
            <li>Go to the <strong className="text-amber-300/80">QIE Pass</strong> section</li>
            <li>Open <strong className="text-amber-300/80">Verification Requests</strong></li>
            <li>Tap <strong className="text-amber-300/80">Approve</strong> on the VeridiChain request</li>
          </ol>
        </div>

        {requestId && (
          <p className="text-white/20 text-xs font-mono break-all">
            Request ID: {requestId}
          </p>
        )}

        <div className="flex gap-3">
          <button onClick={() => pollStatus(requestId)}
            className="text-sky-400/70 text-xs hover:text-sky-400 transition-colors flex items-center gap-1">
            🔄 Check now
          </button>
          <button onClick={() => setState("idle")}
            className="text-white/25 text-xs hover:text-white/50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Rejected / expired ───────────────────────────────────────
  if (state === "rejected") {
    return (
      <div className="glass rounded-2xl p-5 space-y-3 border-red-500/15">
        <p className="text-red-400 font-semibold text-sm">❌ Verification rejected or expired</p>
        <p className="text-red-300/50 text-xs">The request was denied or timed out. Open QIE Wallet and try again.</p>
        <button onClick={() => { setErrorMsg(""); setState("input"); }}
          className="text-sky-400 text-xs hover:underline">
          Try again →
        </button>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────
  // blockReason is set by the 409 handler and drives the contextual UI:
  //   "vc_active"  → VC hasn't expired — no wallet steps, no "Try again" (pointless until expiry)
  //   "vc_expired" → VC expired but QIE cleanup pending — "Try again in 1-2h" + wallet steps after retry
  //   "unknown"    → generic block — no wallet steps (no pending request was created)
  //   null         → network/other error — show generic help

  return (
    <div className="glass rounded-2xl p-5 space-y-3 border-amber-500/15">
      <p className="text-amber-300 font-semibold text-sm">⚠️ Verification issue</p>
      <p className="text-amber-300/50 text-xs leading-relaxed">{errorMsg}</p>

      {/* vc_expired: after clicking "Try again" + QIE cleanup, a NEW request will appear in wallet */}
      {blockReason === "vc_expired" && (
        <div className="rounded-xl px-3 py-2.5 border border-sky-500/15 text-xs text-sky-300/50 leading-relaxed"
          style={{ background: "rgba(14,165,233,0.04)" }}>
          📱 After clicking <strong className="text-sky-300/70">&quot;Try again →&quot;</strong>{" "}
          (once ~1–2 hours have passed), open your{" "}
          <strong className="text-sky-300/70">QIE Wallet</strong> → QIE Pass → Verification Requests → Approve the new VeridiChain request
        </div>
      )}

      {/* vc_active: VC is live — user just needs to wait, no action possible yet */}
      {blockReason === "vc_active" && (
        <div className="rounded-xl px-3 py-2.5 border border-white/[0.06] text-xs text-white/25 leading-relaxed"
          style={{ background: "rgba(255,255,255,0.02)" }}>
          ℹ️ Your QIE VC is single-use and time-limited. Once it expires, you can create a fresh one and your name will be re-verified.
        </div>
      )}

      {/* null / "unknown": generic error — show wallet hint only if no blockReason (could be unrelated error) */}
      {!blockReason && (
        <div className="rounded-xl px-3 py-2.5 border border-amber-500/15 text-xs text-amber-300/40 leading-relaxed"
          style={{ background: "rgba(245,158,11,0.04)" }}>
          📱 If a request is pending: open <strong className="text-amber-300/60">QIE Wallet</strong> → QIE Pass → Verification Requests → Approve the VeridiChain request
        </div>
      )}

      {/* "Try again" goes to input state.
          Hidden when VC is still ACTIVE — retrying immediately will just get
          another 409. User must wait for vcExpiresAt. */}
      {blockReason !== "vc_active" && (
        <div className="pt-1">
          <button onClick={() => { setErrorMsg(""); setBlockReason(null); setState("input"); }}
            className="text-sky-400/70 text-xs hover:text-sky-400 transition-colors">
            Try again →
          </button>
        </div>
      )}
    </div>
  );
}
