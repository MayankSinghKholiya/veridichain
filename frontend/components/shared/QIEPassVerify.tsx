"use client";

import { useState, useEffect, useCallback } from "react";
import { QIE_CHAIN_ID } from "../../lib/wagmi";

type VerifyState =
  | "idle"
  | "input"
  | "requesting"
  | "pending"
  | "approved"
  | "rejected"
  | "error";

interface StoredPass {
  verified:     boolean;
  did:          string;
  requestId?:   string;
  claims?:      Record<string, unknown>;
  verifiedAt:   number;
  vcExpiresAt?: string;
}

export type QIEPassRole = "candidate" | "institution";

interface Props {
  address:           `0x${string}` | undefined;
  role?:             QIEPassRole;
  requestedClaims?:  string[];
  onVerified?:       (did: string, claims: Record<string, unknown>) => void;
  variant?:          "compact" | "full";
  locked?:           boolean;
}

function storageKey(role: QIEPassRole, address: string): string {
  return `qiepass:${role}:${QIE_CHAIN_ID}:${address.toLowerCase()}`;
}

function legacyStorageKey(role: QIEPassRole, address: string): string {
  return `qiepass:${role}:${address.toLowerCase()}`;
}

function getStoredPass(role: QIEPassRole, address: string): StoredPass | null {
  try {
    const raw = localStorage.getItem(storageKey(role, address))
             ?? localStorage.getItem(legacyStorageKey(role, address));
    return raw ? (JSON.parse(raw) as StoredPass) : null;
  } catch { return null; }
}

function setStoredPass(role: QIEPassRole, address: string, pass: StoredPass) {
  try {
    localStorage.setItem(storageKey(role, address), JSON.stringify(pass));
    localStorage.removeItem(legacyStorageKey(role, address));
  } catch { /* ignore */ }
}

function clearStoredPass(role: QIEPassRole, address: string) {
  try { localStorage.removeItem(storageKey(role, address)); } catch { /* ignore */ }
}

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
  const [blockReason,    setBlockReason]    = useState<"vc_active" | "vc_expired" | "unknown" | null>(null);
  const [kycRedirectUrl, setKycRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    const stored = getStoredPass(role, address);
    if (stored?.verified) {
      setStoredPassState(stored);
      setState("approved");
      if (stored.did) setDidInput(stored.did);
    }
  }, [address]);

  const pollStatus = useCallback(async (rid: string) => {
    if (!rid) return;
    try {
      const res  = await fetch(`/api/qiepass/status/${rid}?role=${role}`);
      const json = await res.json();

      if (!json.success) {
        // Stale requestId (e.g. switched from live to sandbox) — clear localStorage and reset
        if (json.stale && address) {
          clearStoredPass(role, address);
          setStoredPassState(null);
          setState("idle");
          return;
        }
        setErrorMsg(json.error ?? "Polling error");
        setState("error");
        return;
      }

      const { status, claimed } = json.data;

      const isApproved = status === "approved" || status === "consent_given";

      if (isApproved) {
        const resolvedDid =
          (json.data.did as string | undefined) ||
          (claimed?.did   as string | undefined) ||
          didInput;

        const freshClaims  = (claimed?.claims ?? {}) as Record<string, unknown>;
        const nameInFresh  = !!(String(freshClaims.firstName ?? "").trim() || String(freshClaims.lastName ?? "").trim());

        // claimAndVerify is single-use; if a concurrent poll already consumed it,
        // the second response may arrive with no claims — keep existing name if so.
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

  useEffect(() => {
    if (state !== "pending" || !requestId) return;
    const timer = setTimeout(() => pollStatus(requestId), 5000);
    return () => clearTimeout(timer);
  }, [state, requestId, pollCount, pollStatus]);

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
        redirectUrl,
      } = json.data as {
        requestId?:    string;
        userStatus?:   string;
        alreadyVerified?: boolean;
        existingClaims?: Record<string, unknown>;
        vcExpiresAt?:  string;
        blockReason?:  "vc_active" | "vc_expired" | "unknown";
        redirectUrl?:  string;
      };

      if (alreadyVerified) {
        const hasName = (c?: Record<string, unknown>) =>
          !!(String(c?.firstName ?? "").trim() || String(c?.lastName ?? "").trim());

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

        // One more attempt via fetch-claims — server deduplicates, safe to retry.
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

        const br = apiBlockReason ?? "unknown";
        setBlockReason(br);

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
          setErrorMsg(
            "QIE is blocking this request — the DID pairing may still be active on QIE's side. " +
            "If this continues after a few hours, contact QIE Pass support."
          );
        }

        setState("error");
        return;
      }
      setRequestId(rid);
      setState("pending");
      setPollCount(0);

      if ((userStatus === "not_verified" || userStatus === "unverified") && redirectUrl) {
        setKycRedirectUrl(redirectUrl);
      } else {
        setKycRedirectUrl(null);
      }

      if (userStatus === "verified") { setTimeout(() => pollStatus(rid), 1000); }
    } catch {
      setErrorMsg("Network error — check connection and try again");
      setState("error");
    }
  }

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

  if (state === "idle") {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl px-4 py-3 border border-violet-500/30 space-y-1"
          style={{ background: "rgba(139,92,246,0.07)" }}>
          <p className="text-violet-300/90 font-semibold text-xs flex items-center gap-1.5">
            <span>🧪</span> QIE Pass is running in Sandbox mode
          </p>
          <p className="text-violet-300/55 text-xs leading-relaxed">
            Use the <strong className="text-violet-300/80">QIE Pass Sandbox</strong> (test environment) — <strong className="text-violet-300/80">not the mainnet QIE Pass</strong>. The mainnet version requires a paid partner plan, so sandbox is used here for demo purposes.
          </p>
        </div>
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

  if (state === "input") {
    return (
      <div className="glass rounded-2xl p-5 space-y-4 border-sky-500/15">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🪪</span>
          <p className="text-white font-semibold text-sm">Enter your QIE Pass DID</p>
        </div>

        <div className="rounded-xl px-3 py-2 border border-violet-500/25 text-xs leading-relaxed"
          style={{ background: "rgba(139,92,246,0.06)" }}>
          <p className="text-violet-300/75 font-semibold">🧪 Sandbox mode — use QIE Pass Sandbox, not mainnet</p>
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

  if (state === "pending") {
    return (
      <div className="glass rounded-2xl p-5 space-y-4 border-amber-500/15">
        <div className="flex items-center gap-3">
          <svg className="animate-spin text-amber-400 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="rgba(245,158,11,0.3)" strokeWidth="3"/>
            <path d="M12 2a10 10 0 0110 10" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <p className="text-amber-300 font-semibold text-sm">
            {kycRedirectUrl ? "KYC required — complete identity verification" : "Waiting for your approval…"}
          </p>
        </div>

        {kycRedirectUrl ? (
          <div className="rounded-xl px-4 py-3 border border-sky-500/20 space-y-2.5"
            style={{ background: "rgba(14,165,233,0.07)" }}>
            <p className="text-sky-300/80 text-xs font-semibold">🪪 Complete KYC first:</p>
            <ol className="text-sky-300/60 text-xs space-y-1.5 list-decimal list-inside">
              <li>Click the link below to complete identity verification</li>
              <li>Come back here after finishing KYC</li>
              <li>Click <strong className="text-sky-300/80">Check now</strong> below</li>
            </ol>
            <a href={kycRedirectUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-1 text-sky-400 text-xs font-semibold hover:text-sky-300 transition-colors underline underline-offset-2">
              Open KYC Portal →
            </a>
          </div>
        ) : (
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
        )}

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
          <button onClick={() => { setState("idle"); setKycRedirectUrl(null); }}
            className="text-white/25 text-xs hover:text-white/50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

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

  return (
    <div className="glass rounded-2xl p-5 space-y-3 border-amber-500/15">
      <p className="text-amber-300 font-semibold text-sm">⚠️ Verification issue</p>
      <p className="text-amber-300/50 text-xs leading-relaxed">{errorMsg}</p>

      {blockReason === "vc_expired" && (
        <div className="rounded-xl px-3 py-2.5 border border-sky-500/15 text-xs text-sky-300/50 leading-relaxed"
          style={{ background: "rgba(14,165,233,0.04)" }}>
          📱 After clicking <strong className="text-sky-300/70">&quot;Try again →&quot;</strong>{" "}
          (once ~1–2 hours have passed), open your{" "}
          <strong className="text-sky-300/70">QIE Wallet</strong> → QIE Pass → Verification Requests → Approve the new VeridiChain request
        </div>
      )}

      {blockReason === "vc_active" && (
        <div className="rounded-xl px-3 py-2.5 border border-white/[0.06] text-xs text-white/25 leading-relaxed"
          style={{ background: "rgba(255,255,255,0.02)" }}>
          ℹ️ Your QIE VC is single-use and time-limited. Once it expires, you can create a fresh one and your name will be re-verified.
        </div>
      )}

      {!blockReason && (
        <div className="rounded-xl px-3 py-2.5 border border-amber-500/15 text-xs text-amber-300/40 leading-relaxed"
          style={{ background: "rgba(245,158,11,0.04)" }}>
          📱 If a request is pending: open <strong className="text-amber-300/60">QIE Wallet</strong> → QIE Pass → Verification Requests → Approve the VeridiChain request
        </div>
      )}

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
