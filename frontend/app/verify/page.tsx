"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Navbar } from "../../components/shared/Navbar";
import { useLang } from "../../lib/LangContext";
import { CONTRACTS } from "../../lib/contracts";
import { CRED_DOC_TYPES, type CredDocType, type CredMetaDetails } from "../../lib/credentialMeta";
import { QIE_CHAIN_ID, QIE_CHAIN_NAME, QIE_EXPLORER } from "../../lib/wagmi";
import type { VerifyResult } from "../api/verify/[credId]/route";

/** Resolve a bare CID or full gateway URL to a clickable IPFS URL */
function toIpfsUrl(cidOrUrl: string): string {
  const s = cidOrUrl.trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://gateway.pinata.cloud/ipfs/${s}`;
}

//
// Displays the full verification chain as a horizontal strip:
//   🏛️ Institutional › 🔍 Team › ✅ KYC › ✍️ Self-Attested
//
// Rules:
//   • REVOKED  → single red "Revoked" pill (no other badges — credential invalid)
//   • ACTIVE   → all achieved layers shown left-to-right (highest first)
//                Primary (highest) is full colour; lower layers are muted pills
//                so the hierarchy is immediately visible without a dropdown
//
type BadgeInfo = {
  label: string;
  icon:  string;
  desc:  string;
  color: "sky" | "green" | "indigo" | "amber";
  meta?: string;
};

const BADGE_COLORS = {
  sky:    { bg: "rgba(14,165,233,0.10)",  border: "rgba(14,165,233,0.25)",  text: "#38bdf8" },
  green:  { bg: "rgba(34,197,94,0.10)",   border: "rgba(34,197,94,0.25)",   text: "#4ade80" },
  indigo: { bg: "rgba(99,102,241,0.10)",  border: "rgba(99,102,241,0.25)",  text: "#818cf8" },
  amber:  { bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.25)",  text: "#fbbf24" },
} as const;

function VerificationBadgeStack({
  result,
  cacheHit,
}: {
  result:   VerifyResult;
  cacheHit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Never show KYC/Institution/Team badges for revoked credentials — it's
  // misleading to say "KYC Verified" when the credential itself is invalid.
  if (result.isRevoked) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border"
          style={{
            background:  "rgba(239,68,68,0.12)",
            borderColor: "rgba(239,68,68,0.30)",
            color:       "#f87171",
          }}
        >
          <span>🚫</span>
          <span>Credential Revoked</span>
        </div>
        {result.revokeReason && (
          <span className="text-xs text-red-400/50 italic">
            &ldquo;{result.revokeReason}&rdquo;
          </span>
        )}
        {cacheHit && (
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border"
            style={{ background: "rgba(168,85,247,0.10)", borderColor: "rgba(168,85,247,0.25)", color: "#c084fc" }}
          >
            ⚡ Cached
          </div>
        )}
      </div>
    );
  }

  const layers: BadgeInfo[] = [];

  // Layer 1 — Institutional (on-chain tier upgrade)
  if (result.tier === 1) {
    layers.push({
      label: "Institutional Verified",
      icon:  "🏛️",
      desc:  "Upgraded and counter-signed by a registered institution on the QIE blockchain",
      color: "sky",
      meta:  result.issuer
        ? `Issuer · ${result.issuer.slice(0, 6)}…${result.issuer.slice(-4)}`
        : undefined,
    });
  }

  // Layer 2 — Team verified (ManualVerificationRegistry)
  if (result.teamVerified?.verified) {
    layers.push({
      label: "Team Verified",
      icon:  "🔍",
      desc:  result.teamVerified.note || "Manually reviewed and approved by VeridiChain team",
      color: "indigo",
      meta:  result.teamVerified.verifiedBy
        ? `by ${result.teamVerified.verifiedBy.slice(0, 6)}…${result.teamVerified.verifiedBy.slice(-4)}`
        : undefined,
    });
  }

  // Layer 3 — KYC (QIE Pass DID linked to credential)
  if (result.candidatePassDid) {
    layers.push({
      label: "KYC Verified",
      icon:  "✅",
      desc:  "Candidate identity linked to a verified QIE Pass DID",
      color: "green",
      meta:  result.candidatePassDid.length > 22
        ? `${result.candidatePassDid.slice(0, 20)}…`
        : result.candidatePassDid,
    });
  }

  // Layer 4 — Self-Attested (always the base layer)
  layers.push({
    label: "Self-Attested",
    icon:  "✍️",
    desc:  "Candidate submitted and attested this credential on-chain",
    color: "amber",
  });

  const primary = layers[0];
  const rest    = layers.slice(1);
  const pc      = BADGE_COLORS[primary.color];

  return (
    <div className="flex flex-wrap items-center gap-1.5">

      {/* Primary badge — highest trust layer — full colour */}
      <div
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border cursor-pointer select-none"
        style={{ background: pc.bg, borderColor: pc.border, color: pc.text }}
        title={primary.desc + (primary.meta ? ` · ${primary.meta}` : "")}
        onClick={() => rest.length > 0 && setExpanded((e) => !e)}
      >
        <span>{primary.icon}</span>
        <span>{primary.label}</span>
        {/* +N indicator when secondary layers exist and not expanded */}
        {rest.length > 0 && !expanded && (
          <span
            className="ml-0.5 rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none"
            style={{
              background:  "rgba(255,255,255,0.15)",
              color:       pc.text,
            }}
          >
            +{rest.length}
          </span>
        )}
      </div>

      {/* Expanded: secondary layers with › separators + history label */}
      {expanded && (
        <>
          {/* "Verification history" label */}
          <span className="text-white/25 text-xs italic select-none">Verification history</span>

          {rest.map((b) => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span className="text-white/15 text-xs select-none">›</span>
              <div
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border"
                style={{
                  background:  "rgba(255,255,255,0.03)",
                  borderColor: "rgba(255,255,255,0.08)",
                  color:       "rgba(255,255,255,0.35)",
                }}
                title={b.desc + (b.meta ? ` · ${b.meta}` : "")}
              >
                <span style={{ opacity: 0.55 }}>{b.icon}</span>
                <span>{b.label}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Cache indicator — always visible */}
      {cacheHit && (
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border"
          style={{
            background:  "rgba(168,85,247,0.10)",
            borderColor: "rgba(168,85,247,0.25)",
            color:       "#c084fc",
          }}
        >
          ⚡ Cached
        </div>
      )}
    </div>
  );
}

function ResultRow({ label, value, mono = false, link }: {
  label: string; value: string; mono?: boolean; link?: string;
}) {
  return (
    <div className="flex gap-4 py-3.5 border-b border-white/[0.05] last:border-0">
      <span className="text-white/35 text-sm w-28 sm:w-36 shrink-0">{label}</span>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer"
          className={`text-sky-400 hover:text-sky-300 hover:underline break-all transition-colors ${mono ? "font-mono text-sm" : "text-sm"}`}>
          {value}
        </a>
      ) : (
        <span className={`text-white break-all ${mono ? "font-mono text-sm" : "text-sm"}`}>{value}</span>
      )}
    </div>
  );
}

type ScanStep = "connecting" | "scanning" | "processing" | "done";

function ScanProgress({
  step,
  progress,
  elapsed,
  cacheHit,
}: {
  step:     ScanStep;
  progress: number;   // 0–100
  elapsed:  number;   // seconds
  cacheHit: boolean;
}) {
  const steps: { key: ScanStep | "done"; label: string; sub: string }[] = [
    { key: "connecting", label: "Connecting to QIE Network",   sub: "Establishing RPC link" },
    { key: "scanning",   label: "Scanning blockchain events",  sub: cacheHit ? "⚡ Found in cache" : `Searching block history… ${elapsed}s` },
    { key: "processing", label: "Verifying authenticity",      sub: "Cross-checking on-chain state" },
  ];

  const stepOrder: ScanStep[] = ["connecting", "scanning", "processing", "done"];
  const currentIdx = stepOrder.indexOf(step);

  return (
    <div className="glass rounded-3xl p-7 border-sky-500/15 max-w-xl mx-auto"
      style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.06), rgba(129,140,248,0.03))" }}>

      {/* Title */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.2)" }}>
          🔍
        </div>
        <div>
          <p className="text-white font-bold text-sm">Verifying Credential</p>
          <p className="text-white/30 text-xs mt-0.5">
            {cacheHit ? "⚡ Instant — served from cache" : "Scanning QIE blockchain…"}
          </p>
        </div>
      </div>

      {/* Step list */}
      <div className="space-y-3 mb-6">
        {steps.map((s, i) => {
          const done   = currentIdx > i;
          const active = currentIdx === i;
          return (
            <div key={s.key} className="flex items-start gap-3">
              {/* Status icon */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5 transition-all ${
                done    ? "bg-green-500/20 border border-green-500/40 text-green-400"
                : active  ? "bg-sky-500/20 border border-sky-500/40"
                : "bg-white/5 border border-white/10 text-white/20"
              }`}>
                {done ? "✓" : active ? (
                  <span className="inline-block w-2.5 h-2.5 border-2 border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                )}
              </div>
              {/* Label */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${done ? "text-green-400" : active ? "text-white" : "text-white/25"}`}>
                  {s.label}
                </p>
                <p className={`text-xs mt-0.5 ${done ? "text-green-400/50" : active ? "text-white/40" : "text-white/15"}`}>
                  {s.sub}
                </p>
              </div>
              {/* Elapsed time badge on active scanning step */}
              {active && s.key === "scanning" && !cacheHit && elapsed > 0 && (
                <span className="text-xs text-sky-400/60 font-mono shrink-0 mt-0.5">{elapsed}s</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="rounded-full h-1.5 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${cacheHit ? 100 : progress}%`,
            background: cacheHit
              ? "linear-gradient(90deg, #22c55e, #16a34a)"
              : "linear-gradient(90deg, #0ea5e9, #818cf8)",
            transition: cacheHit ? "width 0.3s ease" : "width 0.1s linear",
          }}
        />
      </div>
      <div className="flex justify-between mt-2">
        <p className="text-white/20 text-xs">
          {cacheHit ? "Cache hit — completed instantly" : "Typical: 5–15 s on first lookup, ⚡ instant after caching"}
        </p>
        <p className="text-white/25 text-xs font-mono">
          {cacheHit ? "100%" : `${Math.round(progress)}%`}
        </p>
      </div>
    </div>
  );
}

const RECENT_KEY = "veridichain:recent-verifies";
const RECENT_MAX = 5;

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; }
  catch { return []; }
}
function saveRecentSearch(id: string) {
  const list = getRecentSearches();
  const updated = [id, ...list.filter(x => x !== id)].slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
}

function VerifyCore() {
  const params       = useSearchParams();
  const { tr }       = useLang();
  const v            = tr.verify;

  const initId     = params?.get("id") ?? "";
  const shareToken = params?.get("t") ?? "";
  const isSharedLink = shareToken.length === 32;

  const [input,     setInput]     = useState<string>(initId);
  const [searchId,  setSearchId]  = useState<string>(initId);
  const [err,       setErr]       = useState("");
  const [loading,   setLoading]   = useState(false);
  const [searched,  setSearched]  = useState(false);
  const [result,    setResult]    = useState<VerifyResult | null>(null);
  const [credMeta,        setCredMeta]        = useState<{ type: CredDocType | null; details: CredMetaDetails | null } | null>(null);
  const [credMetaLoading, setCredMetaLoading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [pasteCopied, setPasteCopied] = useState(false);

  // Progress state
  const [scanStep,    setScanStep]    = useState<ScanStep>("connecting");
  const [scanProgress, setScanProgress] = useState(0);
  const [elapsed,     setElapsed]     = useState(0);
  const [cacheHit,    setCacheHit]    = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load recent searches on mount
  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, []);

  // Paste detection — auto-fill if clipboard has a valid credential ID
  useEffect(() => {
    if (initId) return; // already have an ID from URL params
    navigator.clipboard?.readText?.().then(text => {
      const t = text?.trim() ?? "";
      if (t.startsWith("0x") && t.length === 66) {
        setInput(t);
        setPasteCopied(true);
        setTimeout(() => setPasteCopied(false), 2500);
      }
    }).catch(() => { /* clipboard permission denied — silently ignore */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animate the progress bar while loading
  useEffect(() => {
    if (loading) {
      const start = Date.now();
      const EXPECTED_MS = 10_000;
      timerRef.current = setInterval(() => {
        const pct = Math.min(90, ((Date.now() - start) / EXPECTED_MS) * 100);
        setScanProgress(pct);
        setElapsed(Math.round((Date.now() - start) / 1000));
      }, 120);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setScanProgress(100);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading]);

  // Copy verify link
  function handleCopyVerifyLink() {
    const url = `${window.location.origin}/verify?id=${searchId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {});
  }

  // bypass=true  →  skips server cache, forces fresh blockchain scan
  async function doVerify(id: string, bypass = false) {
    setLoading(true);
    setResult(null);
    setCredMeta(null);
    setCredMetaLoading(false);
    setSearched(true);
    setCacheHit(false);
    setScanProgress(0);
    setElapsed(0);
    setScanStep("connecting");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSearchId(id as any);

    try {
      // brief pause so "Connecting…" step is visible
      await new Promise((r) => setTimeout(r, 200));
      setScanStep("scanning");

      // Server runs all 3 event scans in PARALLEL and caches the result.
      // Cache hit → <5 ms. Cache miss → ~5–12 s (parallel scan on server).
      // bypass=true → ?bypass=1 skips server cache (force-refresh button).
      const apiUrl = bypass ? `/api/verify/${id}?bypass=1` : `/api/verify/${id}`;
      const res = await fetch(apiUrl);

      const hit = res.headers.get("X-Cache") === "HIT";
      setCacheHit(hit);
      setScanStep("processing");

      if (!res.ok) {
        throw new Error(`Server error ${res.status}`);
      }

      const data = await res.json() as {
        found:    boolean;
        result:   VerifyResult | null;
        cachedAt?: number;
      };

      setResult(data.result ?? null);
      setScanStep("done");

      // Save to recent searches (only when found)
      if (data.result) {
        saveRecentSearch(id);
        setRecentSearches(getRecentSearches());
      }

      // Uses ipfsCid from server response — no need for a second blockchain call
      if (isSharedLink) {
        if (data.result?.ipfsCid) {
          setCredMetaLoading(true);
          (async () => {
            try {
              // 12-second client-side timeout — prevents spinner hanging forever
              // if Pinata gateway is slow or the server function times out.
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 12_000);
              const url = `/api/metadata/decrypt?cid=${encodeURIComponent(data.result!.ipfsCid!)}&credId=${encodeURIComponent(id)}&t=${encodeURIComponent(shareToken)}`;
              const metaRes = await fetch(url, { signal: controller.signal });
              clearTimeout(timer);
              if (metaRes.ok) {
                const m = await metaRes.json() as { type: CredDocType | null; details: CredMetaDetails | null };
                setCredMeta(m);
              } else {
                // Non-200 from decrypt API (IPFS timeout, etc.) → show legacy notice
                setCredMeta({ type: null, details: null });
              }
            } catch {
              // Network error / AbortError (timeout) → show legacy notice, not spinner
              setCredMeta({ type: null, details: null });
            } finally {
              setCredMetaLoading(false);
            }
          })();
        } else {
          // Share link but no ipfsCid in credential — immediately show legacy notice
          setCredMeta({ type: null, details: null });
        }
      }

    } catch (e) {
      console.error("[verify]", e);
      setResult(null);
      setScanStep("done");
    }

    setLoading(false);
  }

  // Auto-verify from URL params
  useEffect(() => {
    if (initId.length === 66) doVerify(initId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleVerify() {
    setErr("");
    const val = input.trim();
    if (!val.startsWith("0x") || val.length !== 66) {
      setErr(v.errorInvalid);
      return;
    }
    doVerify(val);
  }

  const issuedDate = result?.issuedAt
    ? new Date(result.issuedAt * 1000).toLocaleString("en-IN", {
        day: "2-digit", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "";

  const notFound = searched && !loading && !result;

  return (
    <>
      <div className="max-w-3xl mx-auto">
        <div className="glass rounded-3xl p-2 flex gap-2 mb-3 border-sky-500/15"
          style={{ boxShadow: "0 0 40px rgba(14,165,233,0.08)" }}>
          <div className="flex-1 flex items-center gap-3 px-4">
            <svg className="text-white/20 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              placeholder={v.placeholder}
              className="flex-1 bg-transparent text-white placeholder-white/20 font-mono text-sm focus:outline-none py-3"
            />
          </div>
          <button
            onClick={handleVerify}
            disabled={loading}
            className="btn-primary text-white px-7 py-3 rounded-2xl font-semibold text-sm shrink-0 disabled:opacity-60">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {v.checking}
              </span>
            ) : v.btn}
          </button>
        </div>

        {/* Paste auto-fill notice */}
        {pasteCopied && (
          <div className="flex items-center gap-2 text-sky-400/70 text-xs mb-2 px-1">
            <span>📋</span>
            <span>Credential ID detected in clipboard — auto-filled above</span>
          </div>
        )}

        {err && (
          <div className="glass rounded-xl px-5 py-3 flex items-center gap-3 border border-red-500/20 mb-3">
            <span className="text-red-400">⚠️</span>
            <span className="text-red-300 text-sm">{err}</span>
          </div>
        )}

        {/* Recent searches — shown only when input is empty and not loading */}
        {!loading && !searched && recentSearches.length > 0 && !input.trim() && (
          <div className="glass rounded-2xl px-4 py-3 border border-white/[0.06] mt-1">
            <p className="text-white/25 text-xs font-semibold uppercase tracking-wider mb-2.5">
              🕐 Recent lookups
            </p>
            <div className="space-y-1">
              {recentSearches.map((id) => (
                <button
                  key={id}
                  onClick={() => { setInput(id); doVerify(id); }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.04] transition-colors text-left group"
                >
                  <span className="text-white/20 text-sm group-hover:text-sky-400/50 transition-colors">→</span>
                  <span className="text-white/40 text-xs font-mono group-hover:text-white/70 transition-colors truncate">
                    {id.slice(0, 10)}…{id.slice(-8)}
                  </span>
                  <span className="text-white/15 text-xs ml-auto shrink-0 group-hover:text-sky-400/40 transition-colors">
                    Verify again
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="max-w-3xl mx-auto mt-8">
        {loading && (
          <ScanProgress
            step={scanStep}
            progress={scanProgress}
            elapsed={elapsed}
            cacheHit={cacheHit}
          />
        )}

        {/* Not found */}
        {notFound && (
          <div className="glass rounded-3xl p-14 text-center border border-red-500/20"
            style={{ background: "rgba(239,68,68,0.05)" }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20, fontSize: 32,
              background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>❌</div>
            <h3 className="text-white font-bold text-xl mb-2">{v.notFoundTitle}</h3>
            <p className="text-white/40 text-sm">{v.notFoundDesc}</p>
          </div>
        )}

        {/* Found */}
        {result && !loading && (
          <div
            className="rounded-3xl border overflow-hidden"
            style={{
              background: result.isRevoked
                ? "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.04))"
                : "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(14,165,233,0.05))",
              borderColor: result.isRevoked
                ? "rgba(239,68,68,0.25)"
                : "rgba(34,197,94,0.25)",
            }}
          >
            {/* Status banner */}
            <div className="p-8 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-5 flex-wrap">
                <div style={{
                  width: 72, height: 72, borderRadius: 20, fontSize: 32,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: result.isRevoked ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                  border: result.isRevoked ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(34,197,94,0.2)",
                }}>
                  {result.isRevoked ? "❌" : "✅"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-2xl font-black mb-2 ${result.isRevoked ? "text-red-400" : "text-green-400"}`}>
                    {result.isRevoked ? v.revoked : v.valid}
                  </p>
                  {/* Priority badge stack — highest trust shown, rest in dropdown */}
                  <VerificationBadgeStack result={result} cacheHit={cacheHit} />
                </div>
              </div>
            </div>

            {/* Privacy notice for manual searches (no share token) */}
            {!isSharedLink && (
              <div className="mx-6 my-5 rounded-2xl border border-white/[0.08] px-5 py-4 flex items-start gap-3"
                style={{ background: "rgba(255,255,255,0.03)" }}>
                <span className="text-xl mt-0.5 shrink-0">🔒</span>
                <div>
                  <p className="text-white/60 text-sm font-semibold mb-1">Detailed credentials are hidden</p>
                  <p className="text-white/30 text-xs leading-relaxed">
                    Name, institution, and document proof are visible only via the candidate&apos;s personal share link.
                    To get hard proof, <span className="text-sky-400/70">contact the credential holder and ask them to share their verification link</span> — it unlocks the full details including the cryptographically linked document.
                  </p>
                </div>
              </div>
            )}

            {/* Decrypt loading — shown only while the fetch is actually in-flight */}
            {isSharedLink && credMetaLoading && (
              <div className="mx-6 my-4 flex items-center gap-2 text-white/25 text-xs">
                <span className="inline-block w-3 h-3 border-2 border-sky-400/20 border-t-sky-400/50 rounded-full animate-spin" />
                Loading credential details…
              </div>
            )}

            {/* Legacy / no-details notice — shown when fetch is done but no details available */}
            {isSharedLink && !credMetaLoading && credMeta !== null && !credMeta.details && (
              <div className="mx-6 my-5 rounded-2xl border border-amber-500/20 px-5 py-4 flex items-start gap-3"
                style={{ background: "rgba(245,158,11,0.04)" }}>
                <span className="text-xl mt-0.5 shrink-0">📋</span>
                <div>
                  <p className="text-white/60 text-sm font-semibold mb-1">Credential details not available</p>
                  <p className="text-white/30 text-xs leading-relaxed">
                    This credential was created before the structured metadata system — only the
                    blockchain record exists. The verification above confirms it is genuine and on-chain.
                    For full details, the candidate should re-attest using the{" "}
                    <span className="text-sky-400/70">Self-Attest</span> form on their dashboard.
                  </p>
                </div>
              </div>
            )}

            {/* Decrypted credential details */}
            {credMeta?.details && (
              <div className="mx-6 my-5 rounded-2xl border border-sky-500/15 overflow-hidden"
                style={{ background: "rgba(14,165,233,0.04)" }}>
                <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.05]"
                  style={{ background: "rgba(14,165,233,0.06)" }}>
                  <span className="text-base">
                    {credMeta.type && CRED_DOC_TYPES[credMeta.type] ? CRED_DOC_TYPES[credMeta.type].icon : "📄"}
                  </span>
                  <span className="text-sky-300 text-sm font-semibold">
                    {credMeta.type && CRED_DOC_TYPES[credMeta.type] ? CRED_DOC_TYPES[credMeta.type].label : "Credential Details"}
                  </span>
                  <span className="ml-auto text-white/25 text-xs">Decrypted · Admin-verified</span>
                </div>
                <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-white/30 text-xs mb-0.5">Candidate Name</p>
                    <p className="text-white text-sm font-semibold">{credMeta.details.candidateName}</p>
                  </div>
                  <div>
                    <p className="text-white/30 text-xs mb-0.5">
                      {credMeta.type && CRED_DOC_TYPES[credMeta.type] ? CRED_DOC_TYPES[credMeta.type].instLabel : "Institution"}
                    </p>
                    <p className="text-white text-sm font-semibold">{credMeta.details.institutionName}</p>
                  </div>
                  <div>
                    <p className="text-white/30 text-xs mb-0.5">Issue Year</p>
                    <p className="text-white text-sm font-semibold">{credMeta.details.issueYear}</p>
                  </div>
                  {credMeta.details.degreeType && (
                    <div>
                      <p className="text-white/30 text-xs mb-0.5">Degree / Program</p>
                      <p className="text-white text-sm font-semibold">{credMeta.details.degreeType}</p>
                    </div>
                  )}
                  {credMeta.details.role && (
                    <div>
                      <p className="text-white/30 text-xs mb-0.5">Role / Designation</p>
                      <p className="text-white text-sm font-semibold">{credMeta.details.role}</p>
                    </div>
                  )}
                  {(credMeta.details.dateFrom || credMeta.details.dateTo) && (
                    <div>
                      <p className="text-white/30 text-xs mb-0.5">Tenure</p>
                      <p className="text-white text-sm font-semibold">
                        {credMeta.details.dateFrom || "?"} → {credMeta.details.dateTo || "Present"}
                      </p>
                    </div>
                  )}
                  {credMeta.details.courseName && (
                    <div>
                      <p className="text-white/30 text-xs mb-0.5">Course / Title</p>
                      <p className="text-white text-sm font-semibold">{credMeta.details.courseName}</p>
                    </div>
                  )}
                  {credMeta.details.hasBarcode && credMeta.details.barcodeValue && (
                    <div className="col-span-2">
                      <p className="text-white/30 text-xs mb-0.5">Barcode / QR Code</p>
                      <p className="text-white text-sm font-mono">{credMeta.details.barcodeValue}</p>
                    </div>
                  )}
                </div>
                {credMeta.details.documentCID && (
                  <div className="px-5 pb-4">
                    <div className="rounded-xl border border-amber-500/20 px-4 py-3"
                      style={{ background: "rgba(245,158,11,0.05)" }}>
                      <p className="text-amber-400/80 text-xs font-semibold mb-2">🔐 Cryptographic Document Binding</p>
                      <p className="text-white/40 text-xs leading-relaxed mb-3">
                        This credential&apos;s on-chain hash commits to the exact document below.
                        If the document you received matches the one linked here, it is
                        cryptographically inseparable from this credential — it cannot be swapped.
                      </p>
                      <a href={toIpfsUrl(credMeta.details.documentCID)}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-sky-300 hover:text-sky-200 transition-colors"
                        style={{ background: "rgba(14,165,233,0.10)", border: "1px solid rgba(14,165,233,0.2)" }}>
                        <span>📄</span>View linked document on IPFS ↗
                      </a>
                      <p className="text-white/20 text-xs font-mono mt-2 break-all">{credMeta.details.documentCID}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Detail rows */}
            <div className="px-8 py-4">
              <ResultRow label={v.fieldCredId}    value={searchId}          mono />
              <ResultRow label={v.fieldIssuer}     value={result.issuer}    mono
                link={`${QIE_EXPLORER}/address/${result.issuer}`} />
              <ResultRow label={v.fieldCandidate}  value={result.candidate} mono
                link={`${QIE_EXPLORER}/address/${result.candidate}`} />
              <ResultRow label={v.fieldIssuedAt}   value={issuedDate} />
              <ResultRow label={v.fieldBlockchain} value={`${QIE_CHAIN_NAME} · Chain ID ${QIE_CHAIN_ID}`} />
              {result.candidatePassDid && (
                <ResultRow label="QIE Pass DID" value={result.candidatePassDid} mono />
              )}
              {result.credentialHash && (
                <ResultRow label="Credential Hash" value={result.credentialHash} mono />
              )}
              {result.teamVerified?.verified && (
                <ResultRow label="Team Verification Note" value={result.teamVerified.note || "Approved"} />
              )}
              {result.isRevoked && result.revokeReason && (
                <ResultRow label={v.fieldRevokeReason} value={result.revokeReason} />
              )}
            </div>

            {/* Actions row */}
            <div className="px-8 pb-8 flex items-center flex-wrap gap-3">
              <a
                href={`${QIE_EXPLORER}/address/${CONTRACTS.CREDENTIAL_REGISTRY}`}
                target="_blank" rel="noopener noreferrer"
                className="glass glass-hover inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white/60 hover:text-white transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {v.explorerBtn}
              </a>
              <button
                onClick={handleCopyVerifyLink}
                className="glass glass-hover inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white/60 hover:text-white transition-all"
              >
                {linkCopied ? (
                  <><span className="text-green-400">✓</span><span className="text-green-400">Link Copied!</span></>
                ) : (
                  <><span>🔗</span><span>Copy Verify Link</span></>
                )}
              </button>
              {/* Re-verify / Force-refresh — always shown so institution updates
                  (tier upgrade, revoke) are immediately visible on demand.
                  cacheHit=true → "Force Refresh" (skips 5-min cache)
                  cacheHit=false → "Re-verify" (re-runs the blockchain read) */}
              <button
                onClick={() => doVerify(searchId, true)}
                title={cacheHit
                  ? "Force re-read blockchain (bypasses 5-min cache)"
                  : "Re-read credential state from blockchain"}
                className="glass glass-hover inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white/40 hover:text-white/70 transition-all"
              >
                <span>🔄</span>
                <span>{cacheHit ? "Force Refresh" : "Re-verify"}</span>
              </button>
            </div>
          </div>
        )}

        {/* Empty / hint cards */}
        {!result && !notFound && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            {[
              { icon: "📋", title: v.hint1Title, desc: v.hint1Desc },
              { icon: "⚡", title: v.hint2Title, desc: v.hint2Desc },
              { icon: "🔒", title: v.hint3Title, desc: v.hint3Desc },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="glass rounded-2xl p-5 hover:border-sky-500/15 transition-all">
                <span className="text-2xl block mb-3">{icon}</span>
                <p className="text-white/70 text-sm font-semibold mb-1">{title}</p>
                <p className="text-white/30 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function VerifyPage() {
  const { tr } = useLang();
  const v      = tr.verify;

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      <Navbar />

      <div className="pt-16 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg" />
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% -10%, rgba(14,165,233,0.15) 0%, transparent 60%)" }} />

        <div className="relative z-10 max-w-5xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 mb-8 border-sky-500/20">
            <span className="text-xl">🔍</span>
            <span className="text-sky-400 text-sm font-medium">{v.badge}</span>
          </div>
          <h1 className="text-5xl font-black mb-4">
            <span className="gradient-text">{v.title}</span>
          </h1>
          <p className="text-white/40 max-w-lg mx-auto mb-12 leading-relaxed">{v.subtitle}</p>

          <Suspense fallback={null}>
            <VerifyCore />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
