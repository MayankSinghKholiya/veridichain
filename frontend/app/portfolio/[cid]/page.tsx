"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";
import { CONTRACTS, CREDENTIAL_REGISTRY_ABI, MANUAL_VERIFICATION_REGISTRY_ABI, CREDENTIAL_TIER, type TierKey } from "../../../lib/contracts";
import { CRED_DOC_TYPES, type CredDocType, type CredMetaDetails } from "../../../lib/credentialMeta";
import { getLogsChunked } from "../../../lib/getLogs";
import { QIE_CHAIN_ID, QIE_CHAIN_NAME, QIE_EXPLORER } from "../../../lib/wagmi";


interface BundleCredential {
  credentialId: string;
  personalNote?: string;
  shareToken:   string;
}

interface PortfolioBundle {
  v:             number;
  creatorWallet: string;
  jobTitle:      string;
  targetCompany?: string;
  applyingFor?:  string;
  note?:         string;
  createdAt:     number;
  credentials:   BundleCredential[];
}

interface OnChainStatus {
  tier:           number;
  issuedAt:       number;
  isRevoked:      boolean;
  revokeReason:   string;
  candidate:      string;
  ipfsCID:        string;
  teamVerified:   boolean;   // from ManualVerificationRegistry.getTeamVerification()
  teamVerifiedAt: number;
}

interface LoadedCredential extends BundleCredential {
  onChain:  OnChainStatus | null;
  docType:  CredDocType   | null;
  details:  CredMetaDetails | null;
  loading:  boolean;
}


const IPFS_GW = process.env.NEXT_PUBLIC_PINATA_GATEWAY ?? "https://gateway.pinata.cloud/ipfs/";

function toIpfsUrl(cidOrUrl: string): string {
  const s = cidOrUrl.trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `${IPFS_GW}${s}`;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

//
// Hierarchy: Institution > Team Verified > KYC > Self Attested
// Key insight: Self Attestation on VeridiChain requires QIE Pass KYC to be
// completed first — so tier-2 (Self Attested) credentials are implicitly
// KYC-verified and should be scored at the KYC level, not the lowest tier.
//
// Weight table:
//   Institution Verified  → 1.00  (issued & signed by a registered institution)
//   Team Verified         → 0.85  (manually reviewed by the VeridiChain team)
//   KYC Verified          → 0.65  (on-chain via QIE Pass; includes all Self Attested)
//   Revoked               → 0.00

function computeTrust(credentials: LoadedCredential[]) {
  const loaded = credentials.filter((c) => !c.loading && c.onChain);
  const revoked          = loaded.filter((c) =>  c.onChain!.isRevoked).length;

  // Institution Verified = tier 1 (issued by registered institution)
  const institutionVerif = loaded.filter((c) =>
    !c.onChain!.isRevoked && c.onChain!.tier === 1
  ).length;

  // Team Verified = Self Attested (tier 2) AND approved via ManualVerificationRegistry
  // These are a higher tier than plain KYC — manually reviewed by the team
  const teamVerified = loaded.filter((c) =>
    !c.onChain!.isRevoked && c.onChain!.teamVerified
  ).length;

  // KYC Verified = Self Attested (tier 2) but NOT yet team-reviewed
  // KYC is still done (prerequisite for self-attest) but no manual review yet
  const kycVerified = loaded.filter((c) =>
    !c.onChain!.isRevoked && c.onChain!.tier === 2 && !c.onChain!.teamVerified
  ).length;

  const total = credentials.length;

  // Score weights: Institution=1.0, Team Verified=0.85, KYC=0.65
  const score = total > 0
    ? Math.round(
        ((institutionVerif * 1.0 + teamVerified * 0.85 + kycVerified * 0.65) / total) * 100
      )
    : 0;
  return { revoked, institutionVerif, teamVerified, kycVerified, total, score };
}


function TrustBar({ score, stats }: {
  score: number;
  stats: {
    institutionVerif: number;
    teamVerified:     number;
    kycVerified:      number;
    revoked:          number;
    total:            number;
  };
}) {
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="rounded-2xl border border-white/[0.08] p-5"
      style={{ background: "rgba(255,255,255,0.03)" }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">Trust Overview</p>
        <span className="text-2xl font-black" style={{ color }}>{score}%</span>
      </div>

      {/* Hierarchy hint */}
      <p className="text-white/20 text-[10px] mb-3 leading-tight">
        Institution › Team › KYC · Self Attested = KYC verified
      </p>

      {/* Progress bar */}
      <div className="h-2.5 rounded-full mb-4 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: `linear-gradient(90deg, ${color}, ${color}99)` }} />
      </div>

      {/* Breakdown — 4 columns */}
      <div className="grid grid-cols-4 gap-2">
        {/* Institution */}
        <div className="text-center">
          <p className="text-green-400 text-base font-black">{stats.institutionVerif}</p>
          <p className="text-white/30 text-[10px] leading-tight">Institution<br />Verified</p>
        </div>
        {/* Team */}
        <div className="text-center">
          <p className={`text-base font-black ${stats.teamVerified > 0 ? "text-indigo-400" : "text-white/20"}`}>
            {stats.teamVerified}
          </p>
          <p className="text-white/30 text-[10px] leading-tight">Team<br />Verified</p>
        </div>
        {/* KYC (= Self Attested) */}
        <div className="text-center">
          <p className="text-amber-400 text-base font-black">{stats.kycVerified}</p>
          <p className="text-white/30 text-[10px] leading-tight">KYC<br />Verified</p>
        </div>
        {/* Revoked */}
        <div className="text-center">
          <p className={`text-base font-black ${stats.revoked > 0 ? "text-red-400" : "text-white/20"}`}>
            {stats.revoked}
          </p>
          <p className="text-white/30 text-[10px] leading-tight">Revoked</p>
        </div>
      </div>

      {/* KYC note */}
      {stats.kycVerified > 0 && (
        <p className="text-white/15 text-[10px] mt-3 border-t border-white/[0.05] pt-2">
          ✓ KYC count includes Self Attested credentials (QIE Pass KYC required to self-attest)
        </p>
      )}
    </div>
  );
}

function CredentialCard({ cred, idx }: { cred: LoadedCredential; idx: number }) {
  const [expanded, setExpanded] = useState(false);

  if (cred.loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] p-5 animate-pulse"
        style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="h-4 bg-white/10 rounded w-1/3 mb-3" />
        <div className="h-3 bg-white/[0.06] rounded w-2/3 mb-2" />
        <div className="h-3 bg-white/[0.06] rounded w-1/2" />
      </div>
    );
  }

  const { onChain, docType, details, personalNote, credentialId } = cred;
  const isRevoked = onChain?.isRevoked ?? false;
  const tier      = onChain?.tier ?? 0;
  const tierInfo  = CREDENTIAL_TIER[tier as TierKey];
  const typeInfo  = docType ? CRED_DOC_TYPES[docType] : null;

  const teamVerified = onChain?.teamVerified ?? false;

  const borderColor = isRevoked
    ? "rgba(239,68,68,0.25)"
    : tier === 1
    ? "rgba(34,197,94,0.2)"
    : teamVerified
    ? "rgba(99,102,241,0.25)"
    : "rgba(245,158,11,0.2)";

  const bgColor = isRevoked
    ? "rgba(239,68,68,0.05)"
    : tier === 1
    ? "rgba(34,197,94,0.04)"
    : teamVerified
    ? "rgba(99,102,241,0.05)"
    : "rgba(245,158,11,0.03)";

  return (
    <div className="rounded-2xl border overflow-hidden transition-all"
      style={{ borderColor, background: bgColor }}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
              style={{ background: "rgba(255,255,255,0.06)" }}>
              {typeInfo?.icon ?? "📄"}
            </div>
            <div>
              <p className="text-white text-sm font-semibold">
                {typeInfo?.label ?? `Credential #${idx + 1}`}
              </p>
              {!isRevoked && (
                <div className={`inline-flex items-center gap-1 text-xs font-semibold mt-0.5 ${
                  tier === 1       ? "text-green-400"
                  : teamVerified   ? "text-indigo-400"
                  : "text-amber-400"
                }`}>
                  {tier === 1 ? "✅" : teamVerified ? "🛡️" : "✍️"}
                  {tier === 1
                    ? (tierInfo?.label ?? "Institution Verified")
                    : teamVerified
                    ? "Team Verified"
                    : (tierInfo?.label ?? "Self Attested")}
                </div>
              )}
              {isRevoked && (
                <div className="inline-flex items-center gap-1 text-xs font-semibold text-red-400 mt-0.5">
                  ❌ Revoked
                </div>
              )}
            </div>
          </div>
          <span className="text-white/20 text-xs shrink-0">
            {onChain?.issuedAt ? fmtDate(onChain.issuedAt) : ""}
          </span>
        </div>

        {/* Credential details */}
        {details && !isRevoked && (
          <div className="space-y-1 mb-3">
            <p className="text-white/80 text-sm font-semibold">{details.candidateName}</p>
            <p className="text-white/40 text-xs">
              {details.institutionName}
              {details.issueYear ? ` · ${details.issueYear}` : ""}
              {details.degreeType ? ` · ${details.degreeType}` : ""}
              {details.courseName ? ` · ${details.courseName}` : ""}
              {details.role ? ` · ${details.role}` : ""}
            </p>
          </div>
        )}

        {/* Legacy credential — no encrypted metadata */}
        {!details && !isRevoked && onChain && (
          <p className="text-white/20 text-xs mb-3 italic">
            Pre-metadata credential — blockchain record only
          </p>
        )}

        {/* Personal note from candidate */}
        {personalNote && !isRevoked && (
          <div className="rounded-lg px-3 py-2 mb-3 border border-white/[0.06]"
            style={{ background: "rgba(255,255,255,0.03)" }}>
            <p className="text-white/50 text-xs">💬 {personalNote}</p>
          </div>
        )}

        {/* Revoke reason */}
        {isRevoked && onChain?.revokeReason && (
          <p className="text-red-400/60 text-xs mb-3">Reason: {onChain.revokeReason}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-white/[0.05]">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-white/25 hover:text-white/50 text-xs transition-colors">
            {expanded ? "Hide details ▲" : "Blockchain proof ▼"}
          </button>
          <a
            href={`/verify?id=${credentialId}&t=${cred.shareToken}`}
            target="_blank" rel="noopener noreferrer"
            className="text-sky-400/70 hover:text-sky-400 text-xs transition-colors flex items-center gap-1">
            Verify independently ↗
          </a>
        </div>

        {/* Collapsible blockchain details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/[0.05] space-y-1.5">
            <div className="flex gap-3">
              <span className="text-white/25 text-xs w-28 shrink-0">Credential ID</span>
              <span className="text-white/50 text-xs font-mono break-all">{credentialId}</span>
            </div>
            {onChain?.candidate && (
              <div className="flex gap-3">
                <span className="text-white/25 text-xs w-28 shrink-0">Wallet</span>
                <a href={`${QIE_EXPLORER}/address/${onChain.candidate}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sky-400/60 text-xs font-mono hover:underline">
                  {fmtAddr(onChain.candidate)}
                </a>
              </div>
            )}
            <div className="flex gap-3">
              <span className="text-white/25 text-xs w-28 shrink-0">Chain</span>
              <span className="text-white/40 text-xs">{QIE_CHAIN_NAME} · Chain ID {QIE_CHAIN_ID}</span>
            </div>
            {details?.documentCID && (
              <div className="flex gap-3">
                <span className="text-white/25 text-xs w-28 shrink-0">Document</span>
                <a href={toIpfsUrl(details.documentCID)} target="_blank" rel="noopener noreferrer"
                  className="text-sky-400/60 text-xs hover:underline">
                  View on IPFS ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


export default function PortfolioPage({ params }: { params: { cid: string } }) {
  const publicClient = usePublicClient();
  const { cid } = params;

  const [bundle,      setBundle]      = useState<PortfolioBundle | null>(null);
  const [credentials, setCredentials] = useState<LoadedCredential[]>([]);
  const [bundleErr,   setBundleErr]   = useState("");
  const [bundleLoading, setBundleLoading] = useState(true);
  const [copied,      setCopied]      = useState(false);

  useEffect(() => {
    if (!cid) return;
    setBundleLoading(true);
    fetch(toIpfsUrl(cid))
      .then((r) => r.ok ? r.json() : Promise.reject(`IPFS fetch failed (${r.status})`))
      .then((data: PortfolioBundle) => {
        if (!data.credentials || !data.jobTitle) throw new Error("Invalid portfolio bundle");
        setBundle(data);
        // Initialise all credentials in loading state
        setCredentials(data.credentials.map((c) => ({
          ...c, onChain: null, docType: null, details: null, loading: true,
        })));
      })
      .catch((e) => setBundleErr(String(e)))
      .finally(() => setBundleLoading(false));
  }, [cid]);

  useEffect(() => {
    // Use bundle.credentials.length (not the credentials state) — more reliable
    // because bundle and credentials are set together in the same React batch.
    if (!bundle || !publicClient || bundle.credentials.length === 0) return;

    bundle.credentials.forEach(async (bundleCred, idx) => {
      // a) On-chain status via readContract (fastest path)
      let onChain: OnChainStatus | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await (publicClient as any).readContract({
          address:      CONTRACTS.CREDENTIAL_REGISTRY,
          abi:          CREDENTIAL_REGISTRY_ABI,
          functionName: "credentials",
          args:         [bundleCred.credentialId as `0x${string}`],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
        onChain = {
          tier:           Number(raw?.tier         ?? raw?.[6]  ?? 0),
          issuedAt:       Number(raw?.issuedAt     ?? raw?.[7]  ?? 0),
          isRevoked:      Boolean(raw?.isRevoked   ?? raw?.[8]  ?? false),
          revokeReason:   String(raw?.revokeReason ?? raw?.[9]  ?? ""),
          candidate:      String(raw?.candidate    ?? raw?.[4]  ?? ""),
          ipfsCID:        String(raw?.ipfsCID      ?? raw?.[1]  ?? ""),
          teamVerified:   false,
          teamVerifiedAt: 0,
        };

              if (CONTRACTS.MANUAL_VERIFICATION_REGISTRY) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tv = await (publicClient as any).readContract({
              address:      CONTRACTS.MANUAL_VERIFICATION_REGISTRY,
              abi:          MANUAL_VERIFICATION_REGISTRY_ABI,
              functionName: "getTeamVerification",
              args:         [bundleCred.credentialId as `0x${string}`],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any;
            onChain.teamVerified   = Boolean(tv?.verified   ?? tv?.[0] ?? false);
            onChain.teamVerifiedAt = Number(tv?.verifiedAt  ?? tv?.[3] ?? 0);
          } catch { /* ManualVerificationRegistry not available — fine */ }
        }
      } catch { /* readContract failed — fall through to getLogs */ }

      // a2) getLogs fallback — QIE testnet sometimes rejects eth_call for
      //     string-returning functions. getLogs is more reliable for basic status.
      //     NOTE: ipfsCID is NOT in event logs, so decrypt will be skipped if
      //     readContract failed. We still get tier/date/issuer/revoke status.
      if (!onChain) {
        try {
          const [issuedLogs, revokedLogs] = await Promise.all([
            getLogsChunked(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed candidate, bytes32 credentialHash, uint8 tier, uint256 timestamp)"
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              args: { credentialId: bundleCred.credentialId as `0x${string}` } as any,
            }),
            getLogsChunked(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, string reason, uint256 timestamp)"
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              args: { credentialId: bundleCred.credentialId as `0x${string}` } as any,
            }),
          ]);

          if (issuedLogs.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ia = (issuedLogs[0].args as any);
            const isRevoked = revokedLogs.length > 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ra = isRevoked ? (revokedLogs[0].args as any) : null;
            onChain = {
              tier:           Number(ia.tier      ?? 0),
              issuedAt:       Number(ia.timestamp ?? 0),
              isRevoked,
              revokeReason:   String(ra?.reason   ?? ""),
              candidate:      String(ia.candidate ?? ""),
              ipfsCID:        "",   // not available from event logs
              teamVerified:   false,
              teamVerifiedAt: 0,
            };
          }
        } catch { /* getLogs also failed */ }
      }

      // b) Decrypt metadata using the embedded share token.
      //    Requires ipfsCID (only available from readContract, not from events).
      let docType: CredDocType | null = null;
      let details: CredMetaDetails | null = null;
      if (onChain?.ipfsCID && bundleCred.shareToken) {
        try {
          const res = await fetch(
            `/api/metadata/decrypt?cid=${encodeURIComponent(onChain.ipfsCID)}&credId=${encodeURIComponent(bundleCred.credentialId)}&t=${encodeURIComponent(bundleCred.shareToken)}`
          );
          if (res.ok) {
            const m = await res.json();
            docType = m.type    ?? null;
            details = m.details ?? null;
          }
        } catch { /* metadata fetch failed — show on-chain data only */ }
      }

      // Update just this credential
      setCredentials((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], onChain, docType, details, loading: false };
        return next;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, publicClient]);

  function copyPortfolioLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isFullyLoaded = credentials.length > 0 && credentials.every((c) => !c.loading);
  const trust = isFullyLoaded ? computeTrust(credentials) : null;


  if (bundleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#020817" }}>
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin mb-4" />
          <p className="text-white/30 text-sm">Loading portfolio…</p>
        </div>
      </div>
    );
  }

  if (bundleErr || !bundle) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#020817" }}>
        <div className="text-center max-w-sm">
          <p className="text-4xl mb-4">❌</p>
          <p className="text-white font-semibold mb-2">Portfolio not found</p>
          <p className="text-white/30 text-sm mb-6">{bundleErr || "Invalid portfolio link."}</p>
          <Link href="/verify" className="text-sky-400 text-sm hover:underline">
            Verify a credential instead →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      {/* Grid bg */}
      <div className="pointer-events-none fixed inset-0 grid-bg opacity-50" />
      <div className="pointer-events-none fixed inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(14,165,233,0.1) 0%, transparent 60%)" }} />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-12">

        {}
        <div className="flex items-center justify-between mb-8">
          <Link href="/" className="flex items-center gap-2 group">
            <Image src="/icon.png" alt="VeridiChain" width={32} height={32} style={{ flexShrink: 0 }} />
            <span className="text-white/60 text-sm font-medium group-hover:text-white transition-colors">
              VeridiChain
            </span>
          </Link>
          <button
            onClick={copyPortfolioLink}
            className="glass glass-hover text-white/50 hover:text-white text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-1.5">
            {copied ? (
              <><span className="text-green-400">✓</span><span className="text-green-400">Copied!</span></>
            ) : (
              <><span>🔗</span><span>Share this portfolio</span></>
            )}
          </button>
        </div>

        {}
        <div className="rounded-3xl border border-white/[0.08] p-8 mb-6"
          style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(14,165,233,0.05))" }}>

          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
              style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(14,165,233,0.1))", border: "1px solid rgba(99,102,241,0.2)" }}>
              📦
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-1">
                Verified Skill Portfolio
              </p>
              <h1 className="text-white text-xl font-black mb-1 leading-tight">
                {bundle.jobTitle}
              </h1>
              {bundle.targetCompany && (
                <p className="text-sky-400/80 text-sm font-medium">
                  {bundle.applyingFor ? `${bundle.applyingFor} at ` : "@ "}
                  {bundle.targetCompany}
                </p>
              )}
              {!bundle.targetCompany && bundle.applyingFor && (
                <p className="text-sky-400/80 text-sm">{bundle.applyingFor}</p>
              )}
            </div>
          </div>

          {/* Cover note */}
          {bundle.note && (
            <div className="rounded-xl px-4 py-3 mb-5 border border-white/[0.06]"
              style={{ background: "rgba(255,255,255,0.03)" }}>
              <p className="text-white/60 text-sm leading-relaxed italic">
                &ldquo;{bundle.note}&rdquo;
              </p>
            </div>
          )}

          {/* Creator + date */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-white/25 text-xs">Created by</span>
              <a href={`${QIE_EXPLORER}/address/${bundle.creatorWallet}`}
                target="_blank" rel="noopener noreferrer"
                className="text-white/50 text-xs font-mono hover:text-sky-400 transition-colors">
                {fmtAddr(bundle.creatorWallet)}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white/25 text-xs">·</span>
              <span className="text-white/25 text-xs">{fmtDate(bundle.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white/25 text-xs">·</span>
              <span className="text-white/25 text-xs">{bundle.credentials.length} credentials</span>
            </div>
          </div>
        </div>

        {}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left: credentials list */}
          <div className="lg:col-span-2 space-y-4">
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider px-1">
              Credentials ({credentials.length})
            </p>
            {credentials.map((cred, idx) => (
              <CredentialCard key={cred.credentialId} cred={cred} idx={idx} />
            ))}
          </div>

          {/* Right: trust + info */}
          <div className="space-y-4">
            {/* Trust bar (shows after all loaded) */}
            {trust ? (
              <TrustBar score={trust.score} stats={trust} />
            ) : (
              <div className="rounded-2xl border border-white/[0.06] p-5 animate-pulse"
                style={{ background: "rgba(255,255,255,0.02)" }}>
                <div className="h-3 bg-white/10 rounded w-1/2 mb-3" />
                <div className="h-2 bg-white/[0.06] rounded mb-4" />
                <div className="grid grid-cols-3 gap-3">
                  {[0,1,2].map((i) => <div key={i} className="h-10 bg-white/[0.04] rounded" />)}
                </div>
              </div>
            )}

            {/* Verified by VeridiChain */}
            <div className="rounded-2xl border border-white/[0.06] p-5"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
                🔒 Blockchain Verified
              </p>
              <p className="text-white/30 text-xs leading-relaxed mb-4">
                All credentials are permanently recorded on QIE Blockchain as soulbound NFTs.
                Status updates in real-time — this portfolio cannot be faked or altered.
              </p>
              <a href={`${QIE_EXPLORER}/address/${CONTRACTS.CREDENTIAL_REGISTRY}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sky-400/60 hover:text-sky-400 text-xs transition-colors flex items-center gap-1">
                View registry on QIE Explorer ↗
              </a>
            </div>

            {/* Verify any credential */}
            <div className="rounded-2xl border border-white/[0.06] p-5"
              style={{ background: "rgba(255,255,255,0.02)" }}>
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">
                Independent Verification
              </p>
              <p className="text-white/25 text-xs leading-relaxed mb-3">
                Click &ldquo;Verify independently&rdquo; on any credential to check its on-chain status directly.
              </p>
              <Link href="/verify"
                className="text-indigo-400/70 hover:text-indigo-400 text-xs transition-colors flex items-center gap-1">
                Open verifier →
              </Link>
            </div>
          </div>
        </div>

        {}
        <div className="text-center mt-12 pt-8 border-t border-white/[0.05]">
          <p className="text-white/15 text-xs">
            Powered by{" "}
            <Link href="/" className="text-white/30 hover:text-white/50 transition-colors">
              VeridiChain
            </Link>
            {" "}· QIE Blockchain · Decentralized Credential Verification
          </p>
        </div>

      </div>
    </div>
  );
}
