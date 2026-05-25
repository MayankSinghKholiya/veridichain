"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import { parseAbiItem } from "viem";
import {
  useAccount, useConnect, useDisconnect, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { qieTestnet } from "../../lib/wagmi";
import { Navbar } from "../../components/shared/Navbar";
import { useLang } from "../../lib/LangContext";
import {
  CONTRACTS, CREDENTIAL_REGISTRY_ABI, CREDENTIAL_NFT_ABI,
  MANUAL_VERIFICATION_REGISTRY_ABI,
  CREDENTIAL_TIER, type TierKey,
} from "../../lib/contracts";
import { getLogsChunked, getLogsInRange } from "../../lib/getLogs";
import { idbGet, idbSet, idbDel } from "../../lib/credentialCache";
import { useQIEPass } from "../../lib/useQIEPass";
import { QIEPassVerify } from "../../components/shared/QIEPassVerify";
import {
  CRED_DOC_TYPES, type CredDocType, type CredMetaDetails,
} from "../../lib/credentialMeta";
import { showToast } from "../../lib/toast";

type Tab = "credentials" | "attest" | "portfolios";

/* ── Pre-fetched event data shape ──────────────────────────── */
interface CredEventData {
  tier:      number;
  issuedAt:  number;
  issuer:    string;
  isRevoked: boolean;
}

// ── Chain ID for cache key ────────────────────────────────────────────────
const CACHE_CHAIN = 1983;

// ── IPFS helpers ──────────────────────────────────────────────────────────
/**
 * Build a safe IPFS URL from either a bare CID or a full gateway URL.
 * Prevents double-gateway: gateway.../ipfs/https://...
 */
function toIpfsUrl(cidOrUrl: string): string {
  const s = cidOrUrl.trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://gateway.pinata.cloud/ipfs/${s}`;
}

/**
 * Extract just the bare CID from a full IPFS gateway URL.
 * e.g. "https://foo.mypinata.cloud/ipfs/bafybei..." → "bafybei..."
 * Returns the input unchanged if it's already a bare CID.
 */
function extractIpfsCid(input: string): string {
  const s = input.trim();
  const match = s.match(/\/ipfs\/([^/?#\s]+)/);
  if (match) return match[1];
  return s;
}

// ── Pure helper: build credential event map from raw log arrays ───────────
function buildCredMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  issuedLogs:   any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  revokedLogs:  any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upgradedLogs: any[],
  validIds:     Set<string>,
): Map<string, CredEventData> {
  const map = new Map<string, CredEventData>();

  for (const log of issuedLogs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (log as any).args;
    if (a?.credentialId) {
      map.set(a.credentialId as string, {
        tier:      Number(a.tier),
        issuedAt:  Number(a.timestamp),
        issuer:    a.issuer as string,
        isRevoked: false,
      });
    }
  }

  for (const log of revokedLogs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cid = (log as any).args?.credentialId as string;
    if (cid && validIds.has(cid)) {
      const entry = map.get(cid);
      if (entry) map.set(cid, { ...entry, isRevoked: true });
    }
  }

  for (const log of upgradedLogs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cid  = (log as any).args?.credentialId as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = (log as any).args?.institution   as string;
    if (cid && map.has(cid)) {
      const entry = map.get(cid)!;
      map.set(cid, { ...entry, tier: 1, issuer: inst ?? entry.issuer });
    }
  }

  return map;
}

/* ── Manual verification modal ──────────────────────────────── */
function VerifRequestModal({
  credentialId,
  onClose,
  onSuccess,
}: {
  credentialId: `0x${string}`;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [docCid,  setDocCid]  = useState("");
  const [note,    setNote]    = useState("");
  const [err,     setErr]     = useState("");

  const {
    writeContract: doSubmit,
    data:      submitHash,
    isPending: submitPending,
    error:     submitError,
    reset:     submitReset,
  } = useWriteContract();

  const { isLoading: submitWaiting, isSuccess: submitOk } =
    useWaitForTransactionReceipt({ hash: submitHash });

  useEffect(() => {
    if (submitOk) {
      onSuccess();
    }
  }, [submitOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const txError = submitError
    ? ((submitError as any)?.shortMessage || (submitError as any)?.message)
    : null;

  async function handleSubmit() {
    if (!docCid.trim()) { setErr("Document IPFS CID is required."); return; }
    setErr("");
    submitReset();

    // Switch to QIE Testnet
    const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
    if (eth) {
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7BF" }] });
      } catch (e: any) {
        if (e?.code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: "0x7BF", chainName: "QIE Testnet",
              nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
              rpcUrls: ["https://rpc1testnet.qie.digital/"],
              blockExplorerUrls: ["https://testnet.qie.digital"],
            }],
          });
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doSubmit as any)({
      address: CONTRACTS.MANUAL_VERIFICATION_REGISTRY,
      abi: MANUAL_VERIFICATION_REGISTRY_ABI,
      functionName: "submitVerificationRequest",
      args: [credentialId, docCid.trim(), note.trim()],
      value: 0n,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(2,8,23,0.85)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="glass rounded-3xl p-8 w-full max-w-lg border-indigo-500/20"
        style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(14,165,233,0.04))" }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white font-bold text-xl">Request Manual Verification</h2>
            <p className="text-white/40 text-sm mt-1">Upload a document and submit for team review</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/70 text-2xl transition-colors leading-none"
          >
            ×
          </button>
        </div>

        {/* Credential ID */}
        <div className="glass rounded-xl px-4 py-3 mb-5">
          <p className="text-white/30 text-xs mb-1">Credential ID</p>
          <p className="text-white/50 text-xs font-mono break-all">{credentialId}</p>
        </div>

        {/* Doc CID */}
        <div className="mb-4">
          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
            Document IPFS CID *
          </label>
          <input
            value={docCid}
            onChange={(e) => setDocCid(e.target.value)}
            placeholder="QmXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono"
          />
          <p className="text-white/25 text-xs mt-1.5">
            Upload your supporting document to{" "}
            <a href="https://app.pinata.cloud" target="_blank" rel="noopener noreferrer"
              className="text-sky-400 hover:underline">
              Pinata
            </a>{" "}
            first and paste the CID here.
          </p>
        </div>

        {/* Note */}
        <div className="mb-5">
          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
            Note to Team (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. This is my degree certificate from XYZ University. Batch 2024."
            rows={3}
            className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm resize-none"
          />
        </div>

        {/* Errors */}
        {(err || txError) && (
          <div className="glass rounded-xl px-4 py-3 mb-4 flex items-start gap-3 border border-red-500/25">
            <span className="mt-0.5">⚠️</span>
            <p className="text-red-300 text-sm">{err || txError}</p>
          </div>
        )}

        {/* Success */}
        {submitOk && (
          <div className="rounded-xl px-4 py-3 mb-4 border border-green-500/20"
            style={{ background: "rgba(34,197,94,0.08)" }}>
            <p className="text-green-400 text-sm font-semibold">✅ Request submitted successfully!</p>
            <p className="text-green-400/60 text-xs mt-1">The VeridiChain team will review your document.</p>
          </div>
        )}

        {/* Actions */}
        {submitPending ? (
          <div className="w-full py-3.5 rounded-2xl text-center text-sm font-semibold text-white/60 border border-white/10"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            Confirm in wallet…
          </div>
        ) : submitWaiting ? (
          <div className="w-full py-3.5 rounded-2xl text-center text-sm font-semibold text-white/60 border border-white/10 flex items-center justify-center gap-2"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <span className="inline-block w-3 h-3 border-2 border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />
            Mining transaction…
          </div>
        ) : submitOk ? (
          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white"
            style={{
              background: "linear-gradient(135deg, #16a34a, #15803d)",
              boxShadow: "0 8px 24px rgba(22,163,74,0.3)",
            }}
          >
            Close
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              className="flex-1 py-3.5 rounded-2xl font-semibold text-sm text-white"
              style={{
                background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                boxShadow: "0 8px 24px rgba(99,102,241,0.3)",
              }}
            >
              Submit Request →
            </button>
            <button
              onClick={onClose}
              className="px-5 py-3.5 rounded-2xl text-sm font-semibold text-white/40 border border-white/10 hover:text-white/70 hover:border-white/20 transition-all"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Credential card ────────────────────────────────────────
   Receives pre-fetched event data from parent (one batch RPC call).
   Handles its own NFT token ID fetch + revoke workflow. */
function CredentialCard({
  credentialId,
  eventData,
  onRevoked,
  isQIEVerified,
  hasTeamVerification,
  hasPendingRequest,
  onRequestVerification,
  tokenId: tokenIdProp,
  ipfsCid,
}: {
  credentialId: `0x${string}`;
  eventData: CredEventData | undefined;
  onRevoked: () => void;
  /** True when the wallet owner has a verified QIE Pass in localStorage */
  isQIEVerified?: boolean;
  hasTeamVerification?: boolean;
  hasPendingRequest?: boolean;
  onRequestVerification?: () => void;
  /** Pre-fetched by parent to avoid per-card flickering */
  tokenId?: bigint | null;
  /** IPFS CID of the encrypted metadata JSON — used to derive doc type */
  ipfsCid?: string | null;
}) {
  const { tr } = useLang();
  const c = tr.candidate;

  /* ── Share / copy state ── */
  const [copied,      setCopied]      = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  async function handleCopyLink() {
    setShareLoading(true);
    try {
      // Fetch a server-signed HMAC token — only the server (which holds METADATA_ENC_KEY)
      // can generate it, so no one can spoof the share link by guessing the token.
      const res = await fetch(`/api/share-token?credId=${credentialId}`);
      const { token } = await res.json() as { token?: string };
      const url = token
        ? `${window.location.origin}/verify?id=${credentialId}&t=${token}`
        : `${window.location.origin}/verify?id=${credentialId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: copy plain link (no details unlocked)
      navigator.clipboard.writeText(`${window.location.origin}/verify?id=${credentialId}`).catch(() => {});
    } finally {
      setShareLoading(false);
    }
  }

  /* ── Revoke state ── */
  const [showRevoke,    setShowRevoke]    = useState(false);
  const [revokeReason,  setRevokeReason]  = useState("");
  const [revokeErr,     setRevokeErr]     = useState("");

  const {
    writeContract: doRevoke,
    data:      revokeHash,
    isPending: revokePending,
    error:     revokeError,
    reset:     revokeReset,
  } = useWriteContract();

  const { isLoading: revokeWaiting, isSuccess: revokeOk } =
    useWaitForTransactionReceipt({ hash: revokeHash });

  // After revoke confirmed — notify parent to refresh
  useEffect(() => {
    if (revokeOk) { onRevoked(); }
  }, [revokeOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Token ID comes from parent batch fetch — no per-card RPC call needed
  const tokenId    = tokenIdProp !== undefined ? tokenIdProp : null;
  const tokenLoading = tokenIdProp === undefined;

  // Credential type — fetched lazily from IPFS (only the public `type` field)
  const [credType, setCredType] = useState<CredDocType | null>(null);
  useEffect(() => {
    if (!ipfsCid || credType) return;
    let cancelled = false;
    fetch(`https://gateway.pinata.cloud/ipfs/${ipfsCid}`)
      .then((r) => r.ok ? r.json() : null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((meta: any) => { if (!cancelled && meta?.type) setCredType(meta.type as CredDocType); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [ipfsCid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRevoke() {
    if (!revokeReason.trim()) { setRevokeErr(c.revokeErrReason); return; }
    setRevokeErr("");
    revokeReset();

    // Force switch to QIE Testnet
    const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
    if (eth) {
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7BF" }] });
      } catch (e: any) {
        if (e?.code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: "0x7BF", chainName: "QIE Testnet",
              nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
              rpcUrls: ["https://rpc1testnet.qie.digital/"],
              blockExplorerUrls: ["https://testnet.qie.digital"],
            }],
          });
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRevoke as any)({
      address: CONTRACTS.CREDENTIAL_REGISTRY,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: "revokeCredential",
      args: [credentialId, revokeReason.trim()],
    });
  }

  // Show skeleton only until we have the event data
  if (!eventData) {
    return (
      <div className="glass rounded-3xl p-6 animate-pulse">
        <div className="h-4 bg-white/10 rounded mb-3 w-1/3" />
        <div className="h-3 bg-white/5 rounded mb-2 w-full" />
        <div className="h-3 bg-white/5 rounded w-2/3" />
      </div>
    );
  }

  const { tier: tierNum, issuedAt, issuer, isRevoked } = eventData;
  const tier       = CREDENTIAL_TIER[tierNum as TierKey];
  const isVerified = tier?.color === "green";
  const isSelfAttested = tierNum === 2;
  const dateStr    = issuedAt
    ? new Date(issuedAt * 1000).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";

  const revokeTxError = revokeError
    ? ((revokeError as any)?.shortMessage || (revokeError as any)?.message)
    : null;

  const isManualVerifDeployed =
    !!CONTRACTS.MANUAL_VERIFICATION_REGISTRY &&
    CONTRACTS.MANUAL_VERIFICATION_REGISTRY !== "0x0000000000000000000000000000000000000000";

  return (
    <div
      className={`rounded-3xl border transition-all ${
        !showRevoke ? "hover:scale-[1.01]" : ""
      } ${
        isRevoked ? "border-red-500/20" : isVerified ? "border-sky-500/20" : "border-amber-500/20"
      }`}
      style={{
        background: isRevoked
          ? "rgba(239,68,68,0.05)"
          : isVerified
          ? "linear-gradient(135deg, rgba(14,165,233,0.07), rgba(129,140,248,0.04))"
          : "rgba(245,158,11,0.06)",
      }}
    >
      <div className="p-6">
        {/* Top row */}
        <div className="flex items-start justify-between mb-5">
          <div style={{
            width: 48, height: 48, borderRadius: 14, fontSize: 22,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isRevoked
              ? "rgba(239,68,68,0.15)"
              : isVerified
              ? "linear-gradient(135deg, rgba(14,165,233,0.2), rgba(129,140,248,0.2))"
              : "rgba(245,158,11,0.15)",
          }}>
            {isRevoked ? "❌" : isVerified ? "🎓" : "📄"}
          </div>

          <div className="flex gap-2 flex-wrap justify-end items-center">
            {/* Document type badge — from encrypted IPFS metadata */}
            {credType && CRED_DOC_TYPES[credType] && (
              <span className="text-xs px-2.5 py-1 rounded-full border border-white/10 font-semibold text-white/50"
                style={{ background: "rgba(255,255,255,0.04)" }}>
                {CRED_DOC_TYPES[credType].icon} {CRED_DOC_TYPES[credType].short}
              </span>
            )}
            <span className={`text-xs px-3 py-1 rounded-full border font-semibold ${
              isRevoked
                ? "bg-red-500/10 border-red-500/25 text-red-400"
                : isVerified
                ? "bg-sky-500/10 border-sky-500/25 text-sky-400"
                : "bg-amber-500/10 border-amber-500/25 text-amber-400"
            }`}>
              {isRevoked ? "Revoked" : (tier?.label ?? "Unknown")}
            </span>
            {/* QIE Pass KYC badge */}
            {isQIEVerified && !isRevoked && (
              <span className="text-xs px-2.5 py-1 rounded-full border border-green-500/30 font-semibold text-green-400"
                style={{ background: "rgba(34,197,94,0.10)" }}
                title="Identity verified via QIE Pass">
                🪪 KYC
              </span>
            )}
            {/* Team Verification badges */}
            {!isRevoked && hasTeamVerification && (
              <span className="text-xs px-2.5 py-1 rounded-full border border-indigo-500/30 font-semibold text-indigo-400"
                style={{ background: "rgba(99,102,241,0.10)" }}
                title="Manually verified by VeridiChain team">
                🔍 Team Verified
              </span>
            )}
            {!isRevoked && !hasTeamVerification && hasPendingRequest && (
              <span className="text-xs px-2.5 py-1 rounded-full border border-amber-500/30 font-semibold text-amber-400"
                style={{ background: "rgba(245,158,11,0.10)" }}
                title="Manual verification request pending">
                ⏳ Verification Pending
              </span>
            )}
            {/* Request verification button — for self-attested, non-revoked, no team verif, no pending */}
            {!isRevoked && isSelfAttested && !hasTeamVerification && !hasPendingRequest && isManualVerifDeployed && onRequestVerification && (
              <button
                onClick={onRequestVerification}
                className="text-xs px-2.5 py-1 rounded-full border font-semibold transition-all border-sky-500/20 text-sky-400/70 hover:bg-sky-500/10 hover:text-sky-400 hover:border-sky-500/40"
              >
                🔍 Request Verification
              </button>
            )}
            {/* Revoke trigger — only show if not already revoked */}
            {!isRevoked && !revokeOk && (
              <button
                onClick={() => { setShowRevoke(!showRevoke); setRevokeErr(""); revokeReset(); }}
                className="text-xs px-3 py-1 rounded-full border font-semibold transition-all border-red-500/20 text-red-400/60 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40"
              >
                🗑️ {c.revokeBtn}
              </button>
            )}
          </div>
        </div>

        {/* Credential ID */}
        <div className="glass rounded-xl px-4 py-3 mb-4">
          <p className="text-white/30 text-xs mb-1">{c.credId}</p>
          <p className="text-white/70 text-xs font-mono break-all">{credentialId}</p>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="glass rounded-xl p-3">
            <p className="text-white/30 text-xs mb-1">{c.issuedDate}</p>
            <p className="text-white text-sm font-medium">{dateStr}</p>
          </div>
          <div className="glass rounded-xl p-3">
            <p className="text-white/30 text-xs mb-1">{c.nftToken}</p>
            <p className="text-sky-400 text-sm font-medium font-mono">
              {tokenLoading ? "…" : tokenId !== null ? `#${String(tokenId).padStart(4, "0")}` : "—"}
            </p>
          </div>
        </div>

        {/* Issuer + verify link */}
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
          <div>
            <p className="text-white/30 text-xs mb-1">{c.issuedBy}</p>
            {issuer ? (
              <a href={`https://testnet.qie.digital/address/${issuer}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sky-400 text-xs font-mono hover:underline">
                {issuer.slice(0, 10)}…{issuer.slice(-6)}
              </a>
            ) : (
              <span className="text-white/30 text-xs">{c.selfAttested}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Copy shareable verification link */}
            <button
              onClick={handleCopyLink}
              disabled={shareLoading}
              title="Copy verification link to share with HR / recruiter"
              className="glass glass-hover text-white/50 hover:text-white text-xs px-3 py-2 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-50">
              {copied ? (
                <><span className="text-green-400">✓</span><span className="text-green-400">Copied!</span></>
              ) : shareLoading ? (
                <><span className="inline-block w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /><span>...</span></>
              ) : (
                <><span>🔗</span><span>Share</span></>
              )}
            </button>
            <Link href={`/verify?id=${credentialId}`}
              className="glass glass-hover text-white/60 hover:text-white text-xs px-4 py-2 rounded-xl transition-all">
              {c.verifyBtn}
            </Link>
          </div>
        </div>
      </div>

      {/* ── Inline Revoke Panel ───────────────────────────────── */}
      {showRevoke && !revokeOk && (
        <div className="border-t border-red-500/20 mx-0 px-6 py-5 space-y-4"
          style={{ background: "rgba(239,68,68,0.06)" }}>
          <p className="text-red-300 text-xs leading-relaxed">{c.revokeWarning}</p>

          <div>
            <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
              {c.revokeReasonLabel}
            </label>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder={c.revokeReasonPlaceholder}
              rows={2}
              className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm resize-none"
            />
            {(revokeErr || revokeTxError) && (
              <p className="text-red-400 text-xs mt-1.5">{revokeErr || revokeTxError}</p>
            )}
          </div>

          {revokePending ? (
            <div className="text-center text-white/50 text-sm py-2">{c.revokeWalletConfirm}</div>
          ) : revokeWaiting ? (
            <div className="flex items-center justify-center gap-2 text-white/50 text-sm py-2">
              <span className="inline-block w-3 h-3 border-2 border-red-400/40 border-t-red-400 rounded-full animate-spin" />
              {c.revokeMining}
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={handleRevoke}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)", boxShadow: "0 4px 14px rgba(220,38,38,0.3)" }}>
                {c.revokeConfirmBtn}
              </button>
              <button
                onClick={() => { setShowRevoke(false); setRevokeReason(""); setRevokeErr(""); revokeReset(); }}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white/40 border border-white/10 hover:text-white/70 hover:border-white/20 transition-all">
                {c.revokeCancelBtn}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Revoke success banner */}
      {revokeOk && (
        <div className="border-t border-red-500/20 px-6 py-4"
          style={{ background: "rgba(239,68,68,0.08)" }}>
          <p className="text-red-400 text-sm font-semibold">✅ {c.revokeSuccess}</p>
          {revokeHash && (
            <a href={`https://testnet.qie.digital/tx/${revokeHash}`}
              target="_blank" rel="noopener noreferrer"
              className="text-red-400/60 text-xs hover:underline mt-1 block font-mono">
              {revokeHash.slice(0, 18)}…
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────── */
export default function CandidatePage() {
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();
  const chainId        = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient   = usePublicClient();
  const { tr } = useLang();
  const c = tr.candidate;

  const isWrongChain = isConnected && chainId !== qieTestnet.id;

  const [mounted,  setMounted]  = useState(false);
  const [tab,      setTab]      = useState<Tab>("credentials");
  const [form,     setForm]     = useState({ data: "", ipfsCID: "" });
  const [err,      setErr]      = useState("");

  /* ── QIE Pass — optional, loaded from localStorage ── */
  const { hasPass, did: passDid, passConfigured } = useQIEPass(address);
  const [isQIEPassVerified, setIsQIEPassVerified] = useState(false);
  const [qiePassDid,        setQiePassDid]        = useState("");
  /**
   * True when this wallet has already been verified as an INSTITUTION.
   * Candidate and institution are mutually exclusive — the same wallet
   * cannot be used for both roles. When true, QIE Pass and self-attest
   * are blocked with a clear message.
   */
  const [isBlockedByRole,   setIsBlockedByRole]   = useState(false);

  // Re-read QIE Pass state from localStorage whenever address or mounted changes.
  useEffect(() => {
    if (!address || !mounted) return;

    // ── Role conflict check — institution wallet cannot be a candidate ─────
    try {
      const institutionRaw = localStorage.getItem(`qiepass:institution:${address.toLowerCase()}`);
      if (institutionRaw) {
        const institutionParsed = JSON.parse(institutionRaw) as { verified?: boolean };
        if (institutionParsed?.verified) {
          setIsBlockedByRole(true);
          setIsQIEPassVerified(false);
          return; // Don't load candidate QIE state for institution wallets
        }
      }
    } catch { /* ignore */ }

    try {
      const raw = localStorage.getItem(`qiepass:candidate:${address.toLowerCase()}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { verified?: boolean; did?: string; claims?: Record<string, unknown> };
        if (parsed?.verified) {
          setIsQIEPassVerified(true);
          setQiePassDid(parsed.did ?? "");
          // Read name claims for the name-match check in the attest form.
          // Strip QIE placeholder tokens (e.g. "Unknown") before storing.
          if (parsed.claims) {
            setQiePassFirst(stripQIEPlaceholders(String(parsed.claims.firstName ?? "")));
            setQiePassLast(stripQIEPlaceholders(String(parsed.claims.lastName  ?? "")));
          }
        }
      }
    } catch { /* ignore */ }
  }, [address, mounted, isQIEPassVerified]);

  /* credEventMap: credentialId → event data (batch-fetched once) */
  const [credEventMap,   setCredEventMap]   = useState<Map<string, CredEventData>>(new Map());
  const [eventsFetching, setEventsFetching] = useState(false);

  /* Team verification maps */
  const [teamVerifMap,  setTeamVerifMap]  = useState<Map<string, boolean>>(new Map());
  const [pendingReqMap, setPendingReqMap] = useState<Map<string, boolean>>(new Map());

  /* NFT token ID map — batch-fetched in parent to avoid per-card flicker */
  const [tokenIdMap, setTokenIdMap] = useState<Map<string, bigint>>(new Map());

  /* IPFS CID map — batch-fetched so CredentialCard can derive doc type */
  const [ipfsCidMap, setIpfsCidMap] = useState<Map<string, string>>(new Map());

  /* Structured attest form state */
  const [docType,     setDocType]     = useState<CredDocType | "">("");
  const [candName,    setCandName]    = useState("");
  const [institution, setInstitution] = useState("");
  const [issueYear,   setIssueYear]   = useState("");
  const [hasBarcode,  setHasBarcode]  = useState(false);
  const [barcodeVal,  setBarcodeVal]  = useState("");
  const [docCID,      setDocCID]      = useState("");
  const [degreeType,  setDegreeType]  = useState("");
  const [role,        setRole]        = useState("");
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [courseName,  setCourseName]  = useState("");
  const [attestLoading, setAttestLoading] = useState(false);

  /* QIE Pass Name Gate state */
  type QIEGateState = "idle" | "requesting" | "polling" | "approved" | "rejected";
  const [qieGateState,     setQieGateState]     = useState<QIEGateState>("idle");
  const [qieGateRequestId, setQieGateRequestId] = useState("");

  /* QIE Pass verified name claims (for name-match check) */
  const [qiePassFirst, setQiePassFirst] = useState("");
  const [qiePassLast,  setQiePassLast]  = useState("");

  /* ── Skill Portfolio state ── */
  interface StoredPortfolio { cid: string; jobTitle: string; targetCompany?: string; createdAt: number; credCount: number; }
  const [portStep,        setPortStep]        = useState<0|1|2>(0); // 0=list, 1=select, 2=details
  const [portSelected,    setPortSelected]    = useState<Set<string>>(new Set());
  const [portCredNotes,   setPortCredNotes]   = useState<Record<string,string>>({});
  const [portJobTitle,    setPortJobTitle]    = useState("");
  const [portCompany,     setPortCompany]     = useState("");
  const [portRole,        setPortRole]        = useState("");
  const [portNote,        setPortNote]        = useState("");
  const [portLoading,     setPortLoading]     = useState(false);
  const [portErr,         setPortErr]         = useState("");
  const [portCreatedCid,  setPortCreatedCid]  = useState("");
  const [portfolios,      setPortfolios]      = useState<StoredPortfolio[]>([]);
  const [portCopied,      setPortCopied]      = useState<Record<string,boolean>>({});

  const PORTFOLIO_LSKEY = (addr: string) => `vc:portfolios:${addr.toLowerCase()}`;

  // Load stored portfolios from localStorage when wallet connects
  useEffect(() => {
    if (!address) return;
    try {
      const stored = localStorage.getItem(PORTFOLIO_LSKEY(address));
      if (stored) setPortfolios(JSON.parse(stored));
    } catch {}
  }, [address]);

  function savePortfolio(p: StoredPortfolio) {
    if (!address) return;
    const updated = [p, ...portfolios];
    setPortfolios(updated);
    try { localStorage.setItem(PORTFOLIO_LSKEY(address), JSON.stringify(updated)); } catch {}
  }

  function togglePortSelect(credId: string) {
    setPortSelected((prev) => {
      const next = new Set(prev);
      if (next.has(credId)) next.delete(credId); else next.add(credId);
      return next;
    });
  }

  function portReset() {
    setPortStep(0); setPortSelected(new Set()); setPortCredNotes({});
    setPortJobTitle(""); setPortCompany(""); setPortRole(""); setPortNote("");
    setPortErr(""); setPortCreatedCid("");
  }

  function portCopyLink(cid: string) {
    navigator.clipboard.writeText(`${window.location.origin}/portfolio/${cid}`).then(() => {
      setPortCopied((p) => ({ ...p, [cid]: true }));
      setTimeout(() => setPortCopied((p) => ({ ...p, [cid]: false })), 2000);
    });
  }

  async function handleCreatePortfolio() {
    if (!address) return;
    if (portSelected.size === 0) { setPortErr("Select at least one credential"); return; }
    if (!portJobTitle.trim())    { setPortErr("Job title is required"); return; }
    setPortErr(""); setPortLoading(true);

    try {
      const res = await fetch("/api/portfolio/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorWallet: address,
          jobTitle:      portJobTitle.trim(),
          targetCompany: portCompany.trim()  || undefined,
          applyingFor:   portRole.trim()     || undefined,
          note:          portNote.trim()     || undefined,
          credentials:   Array.from(portSelected).map((id) => ({
            credentialId: id,
            personalNote: portCredNotes[id]?.trim() || undefined,
          })),
        }),
      });
      const json = await res.json() as { cid?: string; error?: string };
      if (!res.ok || !json.cid) throw new Error(json.error ?? "Failed to create portfolio");

      setPortCreatedCid(json.cid);
      savePortfolio({
        cid:          json.cid,
        jobTitle:     portJobTitle.trim(),
        targetCompany: portCompany.trim() || undefined,
        createdAt:    Math.floor(Date.now() / 1000),
        credCount:    portSelected.size,
      });
    } catch (e) {
      setPortErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPortLoading(false);
    }
  }

  /* Credential filter + sort */
  type CredFilter = "all" | "verified" | "self" | "revoked";
  type CredSort   = "newest" | "oldest";
  const [credFilter, setCredFilter] = useState<CredFilter>("all");
  const [credSort,   setCredSort]   = useState<CredSort>("newest");

  /* Pagination */
  const PAGE_SIZE = 5;
  const [credPage, setCredPage] = useState(1);

  /* Manual verification modal */
  const [verifModalCred, setVerifModalCred] = useState<`0x${string}` | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const { data: ids, refetch: refetchIds } = useReadContract({
    address: CONTRACTS.CREDENTIAL_REGISTRY,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "getCredentialsByCandidate",
    args: [address!],
    query: { enabled: !!address },
  });

  const credIds = (ids as `0x${string}`[] | undefined) ?? [];

  /* ── Cache-aware credential event sync ─────────────────────────────────
   *
   * Strategy:
   *  1. Serve from IndexedDB instantly (stale-while-revalidate)
   *  2. Delta-sync only NEW blocks since last sync → near-instant on repeat loads
   *  3. First load (no cache): run all 3 event queries in PARALLEL → 3× faster
   *     than sequential, then save everything to IndexedDB for next time
   * ── */
  useEffect(() => {
    if (!publicClient || !address || credIds.length === 0) return;
    if (eventsFetching) return;

    const credIdSet = new Set(credIds as string[]);
    const cacheKey  = `ce:${CACHE_CHAIN}:${address.toLowerCase()}`;

    setEventsFetching(true);

    async function syncEvents() {
      try {
        // ① Load cache → render stale data immediately (zero-wait UX)
        const cached = await idbGet(cacheKey);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let allIssued:   any[] = cached?.issued   ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let allRevoked:  any[] = cached?.revoked  ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let allUpgraded: any[] = cached?.upgraded ?? [];

        if (cached && allIssued.length > 0) {
          // Show cached credentials while we sync in background
          setCredEventMap(buildCredMap(allIssued, allRevoked, allUpgraded, credIdSet));
        }

        // ② Determine what block range needs fetching
        const latestBlock = await publicClient.getBlockNumber();
        const deltaFrom   = cached ? BigInt(cached.lastBlock) + 1n : null;

        if (deltaFrom !== null && deltaFrom > latestBlock) {
          // Cache already covers current head — nothing to fetch
          setEventsFetching(false);
          return;
        }

        if (deltaFrom !== null) {
          // ③a DELTA SYNC — only new blocks (fast: 1 parallel batch usually)
          const [newIssued, newRevoked, newUpgraded] = await Promise.all([
            getLogsInRange(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed candidate, bytes32 credentialHash, uint8 tier, uint256 timestamp)"
              ),
              args: { candidate: address as `0x${string}` },
            }, deltaFrom, latestBlock),

            getLogsInRange(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, string reason, uint256 timestamp)"
              ),
            }, deltaFrom, latestBlock),

            getLogsInRange(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialUpgraded(bytes32 indexed credentialId, address indexed institution, uint256 timestamp)"
              ),
            }, deltaFrom, latestBlock),
          ]);

          allIssued   = [...allIssued,   ...newIssued];
          allRevoked  = [...allRevoked,  ...newRevoked];
          allUpgraded = [...allUpgraded, ...newUpgraded];

        } else {
          // ③b FULL SCAN — first time, no cache.
          // Run all three queries in PARALLEL so total time ≈ slowest single query
          // instead of sum of all three.
          const [issued, revoked, upgraded] = await Promise.all([
            getLogsChunked(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed candidate, bytes32 credentialHash, uint8 tier, uint256 timestamp)"
              ),
              args: { candidate: address as `0x${string}` },
            }, 40, true),

            getLogsChunked(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, string reason, uint256 timestamp)"
              ),
            }, 40, true),

            getLogsChunked(publicClient, {
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              event: parseAbiItem(
                "event CredentialUpgraded(bytes32 indexed credentialId, address indexed institution, uint256 timestamp)"
              ),
            }, 40, true),
          ]);

          allIssued   = issued;
          allRevoked  = revoked;
          allUpgraded = upgraded;
        }

        // ④ Update UI with fresh/merged data
        setCredEventMap(buildCredMap(allIssued, allRevoked, allUpgraded, credIdSet));

        // ⑤ Persist to IndexedDB — next load will be instant
        await idbSet(cacheKey, {
          issued:    allIssued,
          revoked:   allRevoked,
          upgraded:  allUpgraded,
          fromBlock: cached?.fromBlock ?? Number(latestBlock),
          lastBlock: Number(latestBlock),
        });

      } catch (e) {
        console.error("[syncEvents]", e);
      }

      setEventsFetching(false);
    }

    syncEvents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, address, credIds.length]);

  /* ── Fetch team verification state for each credential ── */
  const isManualVerifDeployed =
    !!CONTRACTS.MANUAL_VERIFICATION_REGISTRY &&
    CONTRACTS.MANUAL_VERIFICATION_REGISTRY !== "0x0000000000000000000000000000000000000000";

  useEffect(() => {
    if (!publicClient || credIds.length === 0 || !isManualVerifDeployed) return;

    async function fetchVerifState() {
      const tvMap  = new Map<string, boolean>();
      const prMap  = new Map<string, boolean>();

      for (const cid of credIds) {
        try {
          // Team verification
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tv = await (publicClient as any).readContract({
            address: CONTRACTS.MANUAL_VERIFICATION_REGISTRY,
            abi: MANUAL_VERIFICATION_REGISTRY_ABI,
            functionName: "getTeamVerification",
            args: [cid],
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((tv as any)?.verified) {
            tvMap.set(cid, true);
          }
        } catch { /* ignore */ }

        try {
          // Pending request check
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reqId = await (publicClient as any).readContract({
            address: CONTRACTS.MANUAL_VERIFICATION_REGISTRY,
            abi: MANUAL_VERIFICATION_REGISTRY_ABI,
            functionName: "credentialToRequest",
            args: [cid],
          });
          if (reqId && Number(reqId) > 0) {
            // fetch status of that request
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const req = await (publicClient as any).readContract({
              address: CONTRACTS.MANUAL_VERIFICATION_REGISTRY,
              abi: MANUAL_VERIFICATION_REGISTRY_ABI,
              functionName: "getRequest",
              args: [reqId],
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (Number((req as any)?.status ?? (req as any)?.[5]) === 0) {
              prMap.set(cid, true);
            }
          }
        } catch { /* ignore */ }
      }

      setTeamVerifMap(tvMap);
      setPendingReqMap(prMap);
    }

    fetchVerifState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, credIds.length, isManualVerifDeployed]);

  /* ── Batch-fetch all NFT token IDs (avoids per-card flicker) ── */
  useEffect(() => {
    if (!publicClient || credIds.length === 0) return;
    let cancelled = false;

    async function fetchTokenIds() {
      const map = new Map<string, bigint>();
      await Promise.all(
        (credIds as `0x${string}`[]).map(async (cid) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tid = await (publicClient as any).readContract({
              address: CONTRACTS.CREDENTIAL_NFT,
              abi: CREDENTIAL_NFT_ABI,
              functionName: "credentialToToken",
              args: [cid],
            }) as bigint;
            map.set(cid, tid);
          } catch { /* ignore */ }
        })
      );
      if (!cancelled) setTokenIdMap(new Map(map));
    }

    fetchTokenIds();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, credIds.length]);

  /* ── Batch-fetch IPFS CIDs from CredentialRegistry (for doc-type display) ── */
  useEffect(() => {
    if (!publicClient || credIds.length === 0) return;
    let cancelled = false;

    async function fetchIpfsCids() {
      const map = new Map<string, string>();
      await Promise.all(
        (credIds as `0x${string}`[]).map(async (credId) => {
          try {
            // `credentials(bytes32)` is the public mapping accessor
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = await (publicClient as any).readContract({
              address: CONTRACTS.CREDENTIAL_REGISTRY,
              abi:     CREDENTIAL_REGISTRY_ABI,
              functionName: "credentials",
              args:    [credId],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any;
            const ipfsCid = (raw?.ipfsCID ?? raw?.[1] ?? "") as string;
            if (ipfsCid) map.set(credId, ipfsCid);
          } catch { /* ignore */ }
        })
      );
      if (!cancelled) setIpfsCidMap(new Map(map));
    }

    fetchIpfsCids();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, credIds.length]);

  const {
    writeContract: doAttest,
    data:      attHash,
    isPending: attPending,
    error:     attError,
    reset:     attReset,
  } = useWriteContract();

  const { isLoading: attWaiting, isSuccess: attOk } =
    useWaitForTransactionReceipt({ hash: attHash });

  useEffect(() => {
    if (attOk) {
      refetchIds();
      // Drop cache so the new credential's CredentialIssued event is delta-synced
      if (address) idbDel(`ce:${CACHE_CHAIN}:${address.toLowerCase()}`);
      setCredEventMap(new Map());
      setIpfsCidMap(new Map());
      setEventsFetching(false);
      // Reset attest form + gate state
      setDocType(""); setCandName(""); setInstitution(""); setIssueYear("");
      setHasBarcode(false); setBarcodeVal(""); setDocCID("");
      setDegreeType(""); setRole(""); setDateFrom(""); setDateTo(""); setCourseName("");
      setQieGateState("idle"); setQieGateRequestId("");
      // Toast + auto-switch to credentials tab
      showToast("Credential attested on-chain! 🎉", "success");
      setTimeout(() => setTab("credentials"), 1800);
    }
  }, [attOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const txError = attError
    ? ((attError as any)?.shortMessage || (attError as any)?.message || "Transaction failed")
    : null;

  // ── QIE Pass name gate helpers ──────────────────────────────────────────

  /**
   * Strip QIE placeholder tokens that are not real name data.
   * QIE Pass sometimes returns "Unknown" (or "N/A", "None") when a field
   * is unavailable — e.g. lastName="KHOLIYA Unknown" or firstName="Unknown".
   * These must be removed before any name comparison or display.
   */
  function stripQIEPlaceholders(s: string): string {
    const PLACEHOLDERS = new Set(["unknown", "n/a", "null", "undefined", "none", "na"]);
    return s
      .trim()
      .split(/\s+/)
      .filter(w => w && !PLACEHOLDERS.has(w.toLowerCase()))
      .join(" ");
  }

  /**
   * Word-level name match — every real word in the QIE Pass name must appear
   * as a complete word in the entered name (case-insensitive).
   * QIE placeholder tokens ("Unknown", "N/A" etc.) are stripped before matching.
   *
   * ✅ "Nishant Kholiya"       entered against QIE "Nishant Kholiya"
   * ✅ "Nishant Kholiya"       entered against QIE "Nishant Kholiya Unknown" (placeholder stripped)
   * ✅ "Nishant Kumar Kholiya" entered against QIE "Nishant Kholiya"  (extra middle word OK)
   * ❌ "Nishant"               — "Kholiya" missing, blocks partial first-name entry
   * ❌ "N"                     — "n" ≠ "nishant", substring match explicitly NOT used
   * ❌ ""                      — blank always blocked
   *
   * Returns false when QIE has no real name data — forces re-verification.
   */
  function checkNameMatch(entered: string, first: string, last: string): boolean {
    const norm     = (s: string) => stripQIEPlaceholders(s).toLowerCase();
    const qieWords = norm(`${first} ${last}`).split(" ").filter(Boolean);
    const entWords = entered.trim().toLowerCase().replace(/\s+/g, " ").split(" ").filter(Boolean);
    // No real QIE name words (all were placeholders) → block
    if (qieWords.length === 0) return false;
    // Nothing entered → block
    if (entWords.length === 0) return false;
    // Every real word in the QIE name must appear as an exact whole word in what was entered.
    return qieWords.every(w => entWords.includes(w));
  }

  /**
   * Poll /api/qiepass/status/{requestId} every 3 s until:
   *   - status === "approved"                               → return claims object
   *   - status === "rejected" / "consent_rejected" / "expired" → return null
   *   - 2-minute timeout                                    → return null
   *
   * NOTE: The status API route normalises consent_given + vcMetadata.ready → "approved"
   *       and consent_rejected → "rejected", so we primarily check for those.
   */
  async function pollForQIEApproval(
    requestId: string
  ): Promise<Record<string, unknown> | null> {
    const TIMEOUT_MS = 120_000;
    const POLL_MS    =   3_000;
    const startTime  = Date.now();

    while (Date.now() - startTime < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const res  = await fetch(`/api/qiepass/status/${requestId}`);
        const json = await res.json() as {
          success: boolean;
          data?: {
            status: string;
            claimed?: { claims?: Record<string, unknown>; did?: string };
            claimError?: string;
          };
        };
        if (!json.success || !json.data) continue;

        const { status, claimed } = json.data;

        // Status route returns "approved" once consent_given + vcMetadata.ready + claimed
        if (status === "approved") {
          return claimed?.claims ?? {};
        }

        // User rejected in QIE Wallet, or request expired
        if (
          status === "rejected" ||
          status === "consent_rejected" ||
          status === "expired"
        ) {
          return null;
        }

        // "pending_consent" | "consent_given" (VC not ready yet) → keep polling
      } catch {
        // network hiccup — keep polling
      }
    }
    return null; // timed out
  }

  async function handleStructuredAttest() {
    if (!docType)         { setErr("Please select a document type"); return; }
    if (!candName.trim()) { setErr("Please enter your full name as on the document"); return; }
    if (!institution.trim()) { setErr("Please enter the institution / organization name"); return; }
    if (!issueYear.trim()) { setErr("Please enter the issue / passing year"); return; }
    if (!docCID.trim())   { setErr("Please provide the IPFS CID of your document"); return; }
    if (hasBarcode && !barcodeVal.trim()) { setErr("Please enter the barcode / QR code value"); return; }

    setErr("");
    attReset();
    setQieGateState("idle");
    setQieGateRequestId("");

    // ── QIE Pass KYC Hard Gate ──────────────────────────────────────────────
    // SECURITY: name match is MANDATORY. Without it anyone could attest fake
    // credentials. The stored claims come from QIE Pass KYC — they are the
    // ground truth. If claims are empty the user MUST re-verify QIE Pass first.
    if (isQIEPassVerified && address) {

      // ── Load stored claims ────────────────────────────────────────────────
      let claimsFirst = qiePassFirst;
      let claimsLast  = qiePassLast;

      if (!claimsFirst && !claimsLast) {
        try {
          const raw = localStorage.getItem(`qiepass:candidate:${address.toLowerCase()}`);
          if (raw) {
            const stored = JSON.parse(raw) as { claims?: Record<string, unknown> };
            claimsFirst = stripQIEPlaceholders(String(stored.claims?.firstName ?? ""));
            claimsLast  = stripQIEPlaceholders(String(stored.claims?.lastName  ?? ""));
            if (claimsFirst) setQiePassFirst(claimsFirst);
            if (claimsLast)  setQiePassLast(claimsLast);
          }
        } catch { /* ignore */ }
      }

      // ── HARD BLOCK: no cached name = re-verify required ──────────────────
      if (!claimsFirst && !claimsLast) {
        setErr(
          "KYC name verification required. Scroll up → QIE Pass section → click \"Sync name →\" and approve in QIE Wallet app."
        );
        return;
      }

      // ── Name match check — MANDATORY ─────────────────────────────────────
      if (!checkNameMatch(candName.trim(), claimsFirst, claimsLast)) {
        setErr(
          "Name doesn't match your QIE Pass identity. " +
          "Enter your full name exactly as registered in QIE Pass (open QIE Wallet → Profile to check)."
        );
        return;
      }

      setQieGateState("approved");
    }
    // ── End QIE Gate ────────────────────────────────────────────────────────

    setAttestLoading(true);

    // Build the private details object
    const details: CredMetaDetails = {
      candidateName:   candName.trim(),
      institutionName: institution.trim(),
      issueYear:       issueYear.trim(),
      hasBarcode,
      barcodeValue:    hasBarcode ? barcodeVal.trim() : "",
      documentCID:     extractIpfsCid(docCID),
    };
    if (docType === "DEGREE" && degreeType.trim())          details.degreeType = degreeType.trim();
    if (docType === "EXPERIENCE_LETTER") {
      if (role.trim())     details.role     = role.trim();
      if (dateFrom.trim()) details.dateFrom = dateFrom.trim();
      if (dateTo.trim())   details.dateTo   = dateTo.trim();
    }
    if ((docType === "COURSE_COMPLETION" || docType === "CERTIFICATE") && courseName.trim())
      details.courseName = courseName.trim();
    if ((docType === "ACHIEVEMENT" || docType === "OTHER") && courseName.trim())
      details.title = courseName.trim();

    try {
      // ① Encrypt & pin metadata to IPFS via server-side API
      const encRes = await fetch("/api/metadata/encrypt", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: docType, details }),
      });
      const encJson = await encRes.json();
      if (!encRes.ok) {
        setErr(encJson.error ?? "Failed to encrypt credential metadata. Check PINATA_JWT in .env.local.");
        setAttestLoading(false);
        return;
      }
      const metadataCID: string = encJson.cid;

      // ② credentialHash = keccak256(JSON.stringify(details)) — proves data integrity on-chain
      const credentialHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(details))
      ) as `0x${string}`;

      // ③ Get QIE Pass DID
      let freshDid = qiePassDid;
      if (!freshDid && address) {
        try {
          const raw = localStorage.getItem(`qiepass:candidate:${address.toLowerCase()}`);
          if (raw) {
            const p = JSON.parse(raw) as { verified?: boolean; did?: string };
            if (p?.verified && p?.did) freshDid = p.did;
          }
        } catch { /* ignore */ }
      }

      // ④ Switch to QIE Testnet and submit
      const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
      if (eth) {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7BF" }] });
        } catch (switchErr: any) {
          if (switchErr?.code === 4902) {
            try {
              await eth.request({
                method: "wallet_addEthereumChain",
                params: [{ chainId: "0x7BF", chainName: "QIE Testnet",
                  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
                  rpcUrls: ["https://rpc1testnet.qie.digital/"],
                  blockExplorerUrls: ["https://testnet.qie.digital"],
                }],
              });
            } catch { setErr(c.errSwitchFail); setAttestLoading(false); return; }
          } else if (switchErr?.code === 4001) {
            setErr(c.errSwitchReject); setAttestLoading(false); return;
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doAttest as any)({
        address: CONTRACTS.CREDENTIAL_REGISTRY,
        abi: CREDENTIAL_REGISTRY_ABI,
        functionName: "selfAttestCredential",
        args: [credentialHash, metadataCID, freshDid || passDid || ""],
      });
    } catch (e) {
      setErr(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }

    setAttestLoading(false);
  }

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      <Navbar />

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="pt-16 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 40% 0%, rgba(129,140,248,0.12) 0%, transparent 60%)" }} />
        <div className="max-w-5xl mx-auto px-6 py-14 relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-6">
            <div>
              <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 mb-5 border-purple-500/20">
                <span className="text-2xl">🎓</span>
                <span className="text-purple-400 text-sm font-medium">{c.badge}</span>
              </div>
              <h1 className="text-4xl font-black text-white mb-2">{c.title}</h1>
              <p className="text-white/40">{c.subtitle}</p>
            </div>

            {mounted && isConnected && (
              <div className="flex flex-col gap-3 items-end">
                {/* QIE Pass — candidate identity layer (blocked for institution wallets) */}
                {isBlockedByRole ? (
                  <div className="rounded-2xl px-4 py-3 border border-red-500/20 text-xs max-w-xs"
                    style={{ background: "rgba(239,68,68,0.05)" }}>
                    <p className="text-red-400/80 font-semibold flex items-center gap-1.5 mb-1">
                      <span>🚫</span> Institution wallet
                    </p>
                    <p className="text-red-300/50 leading-relaxed">
                      This wallet is registered as an institution. Use a different wallet for candidate access.
                    </p>
                  </div>
                ) : (
                  <QIEPassVerify
                    address={address}
                    role="candidate"
                    variant="compact"
                    requestedClaims={["firstName", "lastName", "age_over_18"]}
                    onVerified={(did) => { setIsQIEPassVerified(true); setQiePassDid(did); }}
                  />
                )}
                {/* Credentials count */}
                <div className="glass rounded-2xl px-6 py-4 border-purple-500/15 text-center">
                  <p className="text-3xl font-black text-white">{credIds.length}</p>
                  <p className="text-white/40 text-xs">{c.totalLabel}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-20">
        {!mounted ? null : !isConnected ? (
          /* ── Connect prompt ── */
          <div className="glass rounded-3xl p-16 text-center border-purple-500/10"
            style={{ background: "linear-gradient(135deg, rgba(129,140,248,0.06), rgba(14,165,233,0.03))" }}>
            <div style={{
              width: 80, height: 80, borderRadius: 24, fontSize: 36,
              background: "linear-gradient(135deg, rgba(129,140,248,0.2), rgba(14,165,233,0.2))",
              border: "1px solid rgba(129,140,248,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
            }}>🎓</div>
            <h2 className="text-2xl font-bold text-white mb-3">{c.connectTitle}</h2>
            <p className="text-white/40 mb-8">{c.connectDesc}</p>
            <button onClick={() => connect({ connector: injected() })}
              className="btn-primary text-white px-10 py-3.5 rounded-2xl font-semibold">
              {c.connectBtn}
            </button>
          </div>
        ) : (
          <>
            {/* ── Tabs ── */}
            <div className="flex gap-2 mb-8 glass rounded-2xl p-1.5" style={{ display: "inline-flex" }}>
              {([
                { key: "credentials", label: `📋 ${c.tabCredentials} (${credIds.length})` },
                { key: "portfolios",  label: `📦 Skill Portfolios${portfolios.length > 0 ? ` (${portfolios.length})` : ""}` },
                { key: "attest",      label: `✍️ ${c.tabAttest}` },
              ] as { key: Tab; label: string }[]).map(({ key, label }) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    tab === key ? "text-white" : "text-white/40 hover:text-white/70"
                  }`}
                  style={tab === key ? {
                    background: "linear-gradient(135deg, #818cf8, #6366f1)",
                    boxShadow: "0 4px 14px rgba(129,140,248,0.3)",
                  } : {}}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Credentials grid ── */}
            {tab === "credentials" && (
              <>
                {/* QIE Pass verified identity banner */}
                {isQIEPassVerified && (
                  <div className="flex items-center gap-3 rounded-2xl px-5 py-3 mb-6 border border-green-500/20"
                    style={{ background: "rgba(34,197,94,0.06)" }}>
                    <span className="text-green-400 text-lg">✅</span>
                    <div className="flex-1">
                      <p className="text-green-400 text-sm font-semibold">QIE Pass Identity Verified</p>
                      {qiePassDid && (
                        <p className="text-green-300/40 text-xs font-mono">{qiePassDid}</p>
                      )}
                    </div>
                    <span className="text-green-300/30 text-xs border border-green-500/20 px-2 py-1 rounded-lg">
                      🪪 KYC Done
                    </span>
                  </div>
                )}

                {/* ── Filter + Sort bar ── */}
                {credIds.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {([
                      { key: "all",      label: `All (${credIds.length})` },
                      { key: "verified", label: "✅ Verified" },
                      { key: "self",     label: "✍️ Self-Attested" },
                      { key: "revoked",  label: "🗑️ Revoked" },
                    ] as { key: CredFilter; label: string }[]).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => { setCredFilter(key); setCredPage(1); }}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                          credFilter === key
                            ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                            : "border-white/10 text-white/40 hover:text-white/70 hover:border-white/20"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <div className="ml-auto flex items-center glass rounded-xl overflow-hidden border border-white/10">
                      {(["newest", "oldest"] as CredSort[]).map((s, i) => (
                        <><button
                            key={s}
                            onClick={() => { setCredSort(s); setCredPage(1); }}
                            className={`px-3 py-1.5 text-xs font-semibold transition-all ${
                              credSort === s ? "bg-white/10 text-white" : "text-white/30 hover:text-white/60"
                            }`}
                          >
                            {s === "newest" ? "Newest" : "Oldest"}
                          </button>
                          {i === 0 && <div className="w-px h-3 bg-white/10" />}
                        </>
                      ))}
                    </div>
                  </div>
                )}

                {credIds.length === 0 ? (
                  <div className="space-y-4">
                    {/* Hero empty state */}
                    <div className="glass rounded-3xl p-10 text-center border border-white/[0.05]">
                      <div style={{
                        width: 72, height: 72, borderRadius: 20, fontSize: 32,
                        background: "linear-gradient(135deg,rgba(129,140,248,0.15),rgba(14,165,233,0.10))",
                        border: "1px solid rgba(129,140,248,0.2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        margin: "0 auto 16px",
                      }}>📭</div>
                      <h3 className="text-white font-bold text-xl mb-2">No credentials yet</h3>
                      <p className="text-white/40 text-sm mb-6 max-w-sm mx-auto">
                        Start by self-attesting your first credential — degree, certificate, experience, and more.
                      </p>
                      <button onClick={() => setTab("attest")}
                        className="btn-primary text-white px-7 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2">
                        <span>✍️</span> Attest your first credential →
                      </button>
                    </div>

                    {/* How it works — 3 step guide */}
                    <div className="glass rounded-3xl p-6 border border-white/[0.05]">
                      <p className="text-white/30 text-xs font-semibold uppercase tracking-widest mb-5">
                        How VeridiChain works
                      </p>
                      <div className="grid sm:grid-cols-3 gap-4">
                        {[
                          {
                            step: "01", icon: "🪪", color: "rgba(14,165,233,0.12)", border: "rgba(14,165,233,0.2)", text: "#38bdf8",
                            title: "Verify Identity",
                            desc: "Link your QIE Pass DID to prove you're a real person. Your legal name is fetched securely — no manual entry."
                          },
                          {
                            step: "02", icon: "✍️", color: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.2)", text: "#c084fc",
                            title: "Self-Attest",
                            desc: "Submit your degree, certificate or experience. Your name is auto-verified against QIE Pass — no fake names allowed."
                          },
                          {
                            step: "03", icon: "🏛️", color: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.2)", text: "#4ade80",
                            title: "Get Verified",
                            desc: "Your institution upgrades the credential to Tier 1. Anyone can now verify it on-chain in seconds — no PDFs, no emails."
                          },
                        ].map(({ step, icon, color, border, text, title, desc }) => (
                          <div key={step} className="rounded-2xl p-4 space-y-2" style={{ background: color, border: `1px solid ${border}` }}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xl">{icon}</span>
                              <span className="text-xs font-bold font-mono" style={{ color, filter: "brightness(2)" }}>Step {step}</span>
                            </div>
                            <p className="font-bold text-sm text-white">{title}</p>
                            <p className="text-xs leading-relaxed" style={{ color: `${text}99` }}>{desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Loading / sync status */}
                    {eventsFetching && credEventMap.size === 0 && (
                      <div className="flex items-center gap-3 mb-6 text-white/40 text-sm">
                        <span className="inline-block w-4 h-4 border-2 border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />
                        Loading credentials from blockchain… (first load is slower — cached after this)
                      </div>
                    )}
                    {eventsFetching && credEventMap.size > 0 && (
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-white/30 text-xs">
                          <span className="inline-block w-3 h-3 border border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />
                          Syncing new events…
                        </div>
                        <button
                          onClick={async () => {
                            await idbDel(`ce:${CACHE_CHAIN}:${(address ?? "").toLowerCase()}`);
                            setCredEventMap(new Map());
                            setTokenIdMap(new Map());
                            setEventsFetching(false);
                          }}
                          className="text-white/20 hover:text-white/50 text-xs transition-colors">
                          🔄 Clear cache
                        </button>
                      </div>
                    )}
                    {!eventsFetching && credEventMap.size > 0 && (
                      <div className="flex justify-end mb-2">
                        <button
                          onClick={async () => {
                            await idbDel(`ce:${CACHE_CHAIN}:${(address ?? "").toLowerCase()}`);
                            setCredEventMap(new Map());
                            setTokenIdMap(new Map());
                            setEventsFetching(false);
                          }}
                          className="text-white/15 hover:text-white/40 text-xs transition-colors">
                          🔄 Force refresh
                        </button>
                      </div>
                    )}

                    {/* ── Compute filtered + sorted IDs ── */}
                    {(() => {
                      // Sort
                      const sorted = [...(credIds as `0x${string}`[])].sort((a, b) => {
                        const ta = credEventMap.get(a)?.issuedAt ?? 0;
                        const tb = credEventMap.get(b)?.issuedAt ?? 0;
                        return credSort === "oldest" ? ta - tb : tb - ta;
                      });
                      // Filter
                      const filtered = sorted.filter((id) => {
                        const ev = credEventMap.get(id);
                        if (!ev) return credFilter === "all"; // not loaded yet → show in "all" only
                        if (credFilter === "verified") return !ev.isRevoked && ev.tier === 1;
                        if (credFilter === "self")     return !ev.isRevoked && ev.tier === 2;
                        if (credFilter === "revoked")  return ev.isRevoked;
                        return true;
                      });
                      const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
                      const safePage   = Math.min(credPage, Math.max(1, totalPages));

                      return (
                        <>
                          {/* Empty filter result */}
                          {filtered.length === 0 && credFilter !== "all" && (
                            <div className="glass rounded-2xl px-6 py-8 text-center">
                              <p className="text-white/30 text-sm">No credentials match this filter.</p>
                              <button onClick={() => setCredFilter("all")}
                                className="mt-3 text-indigo-400 text-xs hover:underline">
                                Show all →
                              </button>
                            </div>
                          )}

                          {/* Pagination info */}
                          {filtered.length > PAGE_SIZE && (
                            <div className="flex items-center justify-between mb-4">
                              <p className="text-white/30 text-sm">
                                Showing{" "}
                                <span className="text-white/60 font-semibold">
                                  {Math.min((safePage - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(safePage * PAGE_SIZE, filtered.length)}
                                </span>{" "}
                                of <span className="text-white/60 font-semibold">{filtered.length}</span>
                              </p>
                              <div className="flex items-center gap-2">
                                <button disabled={safePage === 1}
                                  onClick={() => setCredPage((p) => Math.max(1, p - 1))}
                                  className="glass glass-hover px-3 py-1.5 rounded-xl text-xs font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                                  ← Prev
                                </button>
                                <span className="text-white/30 text-xs px-1">{safePage} / {totalPages}</span>
                                <button disabled={safePage >= totalPages}
                                  onClick={() => setCredPage((p) => p + 1)}
                                  className="glass glass-hover px-3 py-1.5 rounded-xl text-xs font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                                  Next →
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            {filtered
                              .slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
                              .map((id) => (
                                <CredentialCard
                                  key={id}
                                  credentialId={id}
                                  eventData={credEventMap.get(id)}
                                  isQIEVerified={isQIEPassVerified}
                                  hasTeamVerification={teamVerifMap.get(id) ?? false}
                                  hasPendingRequest={pendingReqMap.get(id) ?? false}
                                  onRequestVerification={() => setVerifModalCred(id)}
                                  tokenId={tokenIdMap.get(id) ?? null}
                                  ipfsCid={ipfsCidMap.get(id) ?? null}
                                  onRevoked={() => {
                                    idbDel(`ce:${CACHE_CHAIN}:${(address ?? "").toLowerCase()}`);
                                    setCredEventMap(new Map());
                                    setTokenIdMap(new Map());
                                    setIpfsCidMap(new Map());
                                    setEventsFetching(false);
                                  }}
                                />
                              ))}
                          </div>

                          {/* Bottom pagination */}
                          {filtered.length > PAGE_SIZE && (
                            <div className="flex items-center justify-center gap-3 mt-6">
                              <button disabled={safePage === 1}
                                onClick={() => { setCredPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                                className="glass glass-hover px-5 py-2.5 rounded-xl text-sm font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                                ← Previous
                              </button>
                              <div className="flex gap-1.5">
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                                  <button key={pg} onClick={() => setCredPage(pg)}
                                    className={`w-9 h-9 rounded-xl text-sm font-semibold transition-all ${
                                      pg === safePage ? "text-white" : "text-white/30 glass hover:text-white/70"
                                    }`}
                                    style={pg === safePage ? {
                                      background: "linear-gradient(135deg, #818cf8, #6366f1)",
                                      boxShadow: "0 2px 10px rgba(129,140,248,0.3)",
                                    } : {}}>
                                    {pg}
                                  </button>
                                ))}
                              </div>
                              <button disabled={safePage >= totalPages}
                                onClick={() => { setCredPage((p) => p + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                                className="glass glass-hover px-5 py-2.5 rounded-xl text-sm font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                                Next →
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </>
            )}

            {/* ── Skill Portfolios ── */}
            {tab === "portfolios" && (
              <div className="max-w-2xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-white text-lg font-bold">📦 Skill Portfolios</h2>
                    <p className="text-white/30 text-sm mt-0.5">
                      Bundle your credentials into a single shareable link for job applications.
                    </p>
                  </div>
                  {portStep === 0 && (
                    <button
                      onClick={() => { portReset(); setPortStep(1); }}
                      className="text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
                      style={{ background: "linear-gradient(135deg,#818cf8,#6366f1)", boxShadow: "0 4px 14px rgba(129,140,248,0.3)" }}>
                      + Create New
                    </button>
                  )}
                </div>

                {/* ── STEP 1: Select Credentials ── */}
                {portStep === 1 && (
                  <div className="glass rounded-3xl p-6 space-y-4 border border-indigo-500/15">
                    <div className="flex items-center justify-between">
                      <p className="text-white font-semibold">Step 1 of 2 — Select Credentials</p>
                      <button onClick={portReset} className="text-white/30 hover:text-white/60 text-sm transition-colors">✕ Cancel</button>
                    </div>
                    <p className="text-white/30 text-xs">Choose which credentials to include in this portfolio. Only your active (non-revoked) credentials are shown.</p>

                    {credIds.filter((id) => !credEventMap.get(id)?.isRevoked).length === 0 ? (
                      <p className="text-white/30 text-sm text-center py-8">No active credentials yet. Self-attest one first.</p>
                    ) : (
                      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                        {credIds
                          .filter((id) => !credEventMap.get(id)?.isRevoked)
                          .map((id) => {
                            const ev = credEventMap.get(id);
                            const isSelected = portSelected.has(id);
                            return (
                              <label key={id} className={`flex items-start gap-3 rounded-2xl px-4 py-3 cursor-pointer transition-all border ${
                                isSelected ? "border-indigo-500/40 bg-indigo-500/10" : "border-white/[0.06] bg-white/[0.02] hover:border-white/10"
                              }`}>
                                <input type="checkbox" checked={isSelected} onChange={() => togglePortSelect(id)}
                                  className="mt-0.5 accent-indigo-500 w-4 h-4 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-white/70 text-xs font-mono truncate">{id.slice(0,18)}…{id.slice(-8)}</p>
                                  <p className="text-white/30 text-xs mt-0.5">
                                    {ev?.tier === 1 ? "✅ Institution Verified" : "✍️ Self Attested"}
                                    {ev?.issuedAt ? ` · ${new Date(ev.issuedAt * 1000).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` : ""}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                      </div>
                    )}

                    {portSelected.size > 0 && (
                      <div className="space-y-3 pt-2 border-t border-white/[0.06]">
                        <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">
                          Add a note per credential <span className="text-white/20 font-normal normal-case">(optional — e.g. &quot;Proves React expertise&quot;)</span>
                        </p>
                        {Array.from(portSelected).map((id) => (
                          <div key={id}>
                            <p className="text-white/25 text-xs font-mono mb-1">{id.slice(0,14)}…</p>
                            <input
                              value={portCredNotes[id] ?? ""}
                              onChange={(e) => setPortCredNotes((n) => ({ ...n, [id]: e.target.value }))}
                              placeholder="e.g. Proves my cloud architecture skills"
                              className="input-field w-full rounded-xl px-4 py-2.5 text-white placeholder-white/20 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      <button onClick={portReset}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white/40 border border-white/10 hover:text-white/60 transition-all">
                        Cancel
                      </button>
                      <button
                        onClick={() => { if (portSelected.size === 0) { setPortErr("Select at least one credential"); return; } setPortErr(""); setPortStep(2); }}
                        disabled={portSelected.size === 0}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                        style={{ background: "linear-gradient(135deg,#818cf8,#6366f1)", boxShadow: "0 4px 14px rgba(129,140,248,0.3)" }}>
                        Next → Add Job Details ({portSelected.size} selected)
                      </button>
                    </div>
                    {portErr && <p className="text-red-400 text-xs">{portErr}</p>}
                  </div>
                )}

                {/* ── STEP 2: Job Details ── */}
                {portStep === 2 && !portCreatedCid && (
                  <div className="glass rounded-3xl p-6 space-y-4 border border-indigo-500/15">
                    <div className="flex items-center justify-between">
                      <p className="text-white font-semibold">Step 2 of 2 — Job Details</p>
                      <button onClick={() => setPortStep(1)} className="text-white/30 hover:text-white/60 text-sm transition-colors">← Back</button>
                    </div>

                    <div>
                      <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Job Title <span className="text-red-400/60">*</span>
                      </label>
                      <input value={portJobTitle} onChange={(e) => setPortJobTitle(e.target.value)}
                        placeholder="e.g. Senior React Developer"
                        className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">Company</label>
                        <input value={portCompany} onChange={(e) => setPortCompany(e.target.value)}
                          placeholder="e.g. TechCorp"
                          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                      </div>
                      <div>
                        <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">Role / Position</label>
                        <input value={portRole} onChange={(e) => setPortRole(e.target.value)}
                          placeholder="e.g. Frontend Engineer"
                          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                        Cover Note <span className="text-white/20 font-normal normal-case">(optional)</span>
                      </label>
                      <textarea value={portNote} onChange={(e) => setPortNote(e.target.value)}
                        placeholder="e.g. 3 years of React + Node.js experience, AWS certified."
                        rows={3}
                        className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm resize-none" />
                    </div>

                    {portErr && (
                      <div className="glass rounded-xl px-4 py-3 border border-red-500/20 flex items-center gap-2">
                        <span className="text-red-400 text-sm">⚠️</span>
                        <span className="text-red-300 text-xs">{portErr}</span>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => setPortStep(1)}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white/40 border border-white/10 hover:text-white/60 transition-all">
                        ← Back
                      </button>
                      <button onClick={handleCreatePortfolio} disabled={portLoading}
                        className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg,#818cf8,#6366f1)", boxShadow: "0 4px 14px rgba(129,140,248,0.3)" }}>
                        {portLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Creating Portfolio…
                          </span>
                        ) : "✨ Generate Portfolio Link"}
                      </button>
                    </div>
                  </div>
                )}

                {/* ── SUCCESS: Portfolio Created ── */}
                {portCreatedCid && (
                  <div className="glass rounded-3xl p-6 space-y-4 border border-green-500/25"
                    style={{ background: "rgba(34,197,94,0.05)" }}>
                    <div className="text-center">
                      <p className="text-4xl mb-3">🎉</p>
                      <p className="text-green-400 text-lg font-bold mb-1">Portfolio Created!</p>
                      <p className="text-white/40 text-sm">Share this link with HR or recruiters</p>
                    </div>

                    <div className="rounded-xl border border-white/[0.08] px-4 py-3"
                      style={{ background: "rgba(255,255,255,0.03)" }}>
                      <p className="text-white/50 text-xs font-mono break-all">
                        {typeof window !== "undefined" ? `${window.location.origin}/portfolio/${portCreatedCid}` : `/portfolio/${portCreatedCid}`}
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button onClick={() => portCopyLink(portCreatedCid)}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                        style={{ background: portCopied[portCreatedCid] ? "linear-gradient(135deg,#16a34a,#15803d)" : "linear-gradient(135deg,#818cf8,#6366f1)" }}>
                        {portCopied[portCreatedCid] ? "✓ Link Copied!" : "🔗 Copy Share Link"}
                      </button>
                      <a
                        href={`/portfolio/${portCreatedCid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-sky-300 border border-sky-500/25 hover:bg-sky-500/10 hover:border-sky-500/40 transition-all"
                        style={{ background: "rgba(14,165,233,0.06)" }}>
                        Open ↗
                      </a>
                      <button onClick={portReset}
                        className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white/40 border border-white/10 hover:text-white/60 transition-all">
                        Done
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Created Portfolios List ── */}
                {portStep === 0 && portfolios.length === 0 && (
                  <div className="glass rounded-3xl p-12 text-center border border-white/[0.06]">
                    <p className="text-4xl mb-4">📦</p>
                    <p className="text-white/50 font-semibold mb-2">No portfolios yet</p>
                    <p className="text-white/25 text-sm mb-6">
                      Create a portfolio to bundle your credentials into a single shareable link for job applications.
                    </p>
                    <button
                      onClick={() => { portReset(); setPortStep(1); }}
                      className="text-white text-sm font-semibold px-6 py-3 rounded-xl transition-all"
                      style={{ background: "linear-gradient(135deg,#818cf8,#6366f1)", boxShadow: "0 4px 14px rgba(129,140,248,0.3)" }}>
                      Create Your First Portfolio
                    </button>
                  </div>
                )}

                {portStep === 0 && portfolios.length > 0 && (
                  <div className="space-y-3">
                    {portfolios.map((p) => (
                      <div key={p.cid}
                        className="glass rounded-2xl p-5 flex items-center gap-4 border border-white/[0.06] hover:border-indigo-500/20 transition-all">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                          style={{ background: "rgba(99,102,241,0.1)" }}>
                          📦
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-sm truncate">{p.jobTitle}</p>
                          <p className="text-white/30 text-xs mt-0.5">
                            {p.targetCompany ? `${p.targetCompany} · ` : ""}
                            {p.credCount} credential{p.credCount !== 1 ? "s" : ""} ·{" "}
                            {new Date(p.createdAt * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a href={`/portfolio/${p.cid}`} target="_blank" rel="noopener noreferrer"
                            className="glass glass-hover text-white/50 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all">
                            View ↗
                          </a>
                          <button onClick={() => portCopyLink(p.cid)}
                            className="glass glass-hover text-white/50 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1">
                            {portCopied[p.cid] ? <span className="text-green-400">✓ Copied!</span> : "🔗 Share"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Self-attest form (structured) ── */}
            {tab === "attest" && (() => {
              // Institution wallet — block self-attestation entirely
              if (isBlockedByRole) {
                return (
                  <div className="glass rounded-3xl p-8 flex flex-col items-center gap-4 text-center">
                    <span className="text-4xl">🚫</span>
                    <div>
                      <p className="text-red-400 font-bold text-lg mb-1">Institution wallet detected</p>
                      <p className="text-red-300/50 text-sm leading-relaxed max-w-sm">
                        This wallet is registered as an institution on VeridiChain.
                        Self-attestation is only available for candidate wallets.
                        Please connect a different wallet to use candidate features.
                      </p>
                    </div>
                  </div>
                );
              }

              // QIE Pass name comparison — same word-level logic as checkNameMatch()
              // null = not enough typed yet; true = match; false = mismatch
              const nameMatch: boolean | null =
                (qiePassFirst || qiePassLast) && candName.trim()
                  ? checkNameMatch(candName.trim(), qiePassFirst, qiePassLast)
                  : null;

              const typeInfo = docType ? CRED_DOC_TYPES[docType] : null;

              return (
                <div className="space-y-6">

                  {/* ── Step progress indicator ── */}
                  <div className="glass rounded-2xl px-6 py-4">
                    <div className="flex items-center gap-0">
                      {[
                        { n: 1, label: "Document Type", done: !!docType, active: !docType },
                        { n: 2, label: "Fill Details",  done: !!docType && !!docCID, active: !!docType && !docCID },
                        { n: 3, label: "Upload & Submit", done: attOk,                active: !!docCID },
                      ].map((step, i) => (
                        <div key={step.n} className="flex items-center flex-1">
                          <div className="flex items-center gap-2 shrink-0">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all ${
                              step.done
                                ? "bg-indigo-500/25 border-indigo-500/50 text-indigo-300"
                                : step.active
                                ? "bg-white/10 border-white/40 text-white"
                                : "bg-transparent border-white/10 text-white/20"
                            }`}>
                              {step.done ? "✓" : step.n}
                            </div>
                            <span className={`text-xs font-medium hidden sm:block whitespace-nowrap ${
                              step.done ? "text-indigo-300" : step.active ? "text-white/70" : "text-white/20"
                            }`}>
                              {step.label}
                            </span>
                          </div>
                          {i < 2 && (
                            <div className={`flex-1 h-px mx-3 transition-all ${step.done ? "bg-indigo-500/40" : "bg-white/10"}`} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Step 1: Document type ── */}
                  <div className="glass rounded-3xl p-6">
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
                      Step 1 — What type of document are you attesting?
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(Object.entries(CRED_DOC_TYPES) as [CredDocType, typeof CRED_DOC_TYPES[CredDocType]][]).map(([key, meta]) => (
                        <button key={key} onClick={() => setDocType(key)}
                          className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all text-center ${
                            docType === key
                              ? "border-indigo-500/60 text-white"
                              : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20"
                          }`}
                          style={docType === key ? {
                            background: "linear-gradient(135deg,rgba(99,102,241,0.15),rgba(79,70,229,0.08))",
                          } : { background: "rgba(255,255,255,0.02)" }}>
                          <span className="text-2xl">{meta.icon}</span>
                          <span className="text-xs font-semibold leading-tight">{meta.short}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Step 2: Details ── */}
                  {docType && (
                    <div className="glass rounded-3xl p-6 space-y-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{typeInfo?.icon}</span>
                        <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                          Step 2 — {typeInfo?.label} Details
                        </p>
                        {/* QIE Pass link */}
                        <div className="ml-auto">
                          {isQIEPassVerified ? (
                            <span className="text-xs px-2.5 py-1 rounded-full border border-green-500/25 text-green-400 font-semibold"
                              style={{ background: "rgba(34,197,94,0.08)" }}>✅ QIE Pass linked</span>
                          ) : (
                            <QIEPassVerify address={address} role="candidate" variant="compact"
                              requestedClaims={["firstName", "lastName", "age_over_18"]}
                              onVerified={(did, claims) => {
                                setIsQIEPassVerified(true); setQiePassDid(did);
                                setQiePassFirst(stripQIEPlaceholders(String((claims as any)?.firstName ?? "")));
                                setQiePassLast(stripQIEPlaceholders(String((claims as any)?.lastName  ?? "")));
                              }} />
                          )}
                        </div>
                      </div>

                      {/* Full name field */}
                      <div>
                        <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                          Your Full Name <span className="text-red-400/60">*</span>
                          <span className="text-white/20 font-normal normal-case ml-1">(exactly as on document)</span>
                        </label>
                        <input value={candName} onChange={(e) => setCandName(e.target.value)}
                          placeholder="e.g. Rahul Kumar Sharma"
                          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                        {/* QIE Pass name match indicator — never reveals actual QIE name */}
                        {isQIEPassVerified && candName.trim() && (
                          nameMatch === true ? (
                            <p className="text-green-400 text-xs mt-1.5 flex items-center gap-1">
                              ✅ Name matches your QIE Pass identity
                            </p>
                          ) : nameMatch === false ? (
                            <p className="text-amber-400 text-xs mt-1.5 flex items-center gap-1">
                              ⚠️ Name doesn&apos;t match QIE Pass — enter your full name exactly as registered
                            </p>
                          ) : null
                        )}
                      </div>

                      {/* Institution / org name */}
                      <div>
                        <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                          {typeInfo?.instLabel} <span className="text-red-400/60">*</span>
                        </label>
                        <input value={institution} onChange={(e) => setInstitution(e.target.value)}
                          placeholder={typeInfo?.instPlaceholder}
                          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                      </div>

                      {/* Type-specific fields */}
                      {docType === "DEGREE" && (
                        <div>
                          <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                            Degree Type
                            <span className="text-white/20 font-normal normal-case ml-1">(optional)</span>
                          </label>
                          <select value={degreeType} onChange={(e) => setDegreeType(e.target.value)}
                            className="input-field w-full rounded-xl px-4 py-3 text-white text-sm"
                            style={{ background: "rgba(255,255,255,0.05)" }}>
                            <option value="">Select degree type…</option>
                            {["B.Tech / B.E.", "M.Tech / M.E.", "MBA", "BCA / MCA", "B.Sc / M.Sc",
                              "B.Com / M.Com", "BA / MA", "PhD / D.Sc", "Diploma", "Other"].map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(docType === "COURSE_COMPLETION" || docType === "CERTIFICATE") && (
                        <div>
                          <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                            {docType === "CERTIFICATE" ? "Certificate Title" : "Course Name"}
                            <span className="text-white/20 font-normal normal-case ml-1">(optional)</span>
                          </label>
                          <input value={courseName} onChange={(e) => setCourseName(e.target.value)}
                            placeholder={docType === "CERTIFICATE" ? "e.g. AWS Solutions Architect" : "e.g. Full Stack Web Development"}
                            className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                        </div>
                      )}

                      {docType === "EXPERIENCE_LETTER" && (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                              Role / Position
                              <span className="text-white/20 font-normal normal-case ml-1">(optional)</span>
                            </label>
                            <input value={role} onChange={(e) => setRole(e.target.value)}
                              placeholder="e.g. Software Engineer, Product Manager"
                              className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">From</label>
                              <input value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                placeholder="e.g. Jan 2022"
                                className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                            </div>
                            <div>
                              <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">To</label>
                              <input value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                placeholder="e.g. Dec 2023 / Present"
                                className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                            </div>
                          </div>
                        </div>
                      )}

                      {(docType === "ACHIEVEMENT" || docType === "OTHER") && (
                        <div>
                          <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                            Title / Description
                            <span className="text-white/20 font-normal normal-case ml-1">(optional)</span>
                          </label>
                          <input value={courseName} onChange={(e) => setCourseName(e.target.value)}
                            placeholder="e.g. National Science Olympiad Gold Medal"
                            className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                        </div>
                      )}

                      {/* Issue year */}
                      <div>
                        <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                          {docType === "EXPERIENCE_LETTER" ? "Year of Joining / Issue Year" : "Passing / Issue Year"}
                          <span className="text-red-400/60 ml-1">*</span>
                        </label>
                        <input value={issueYear} onChange={(e) => setIssueYear(e.target.value)}
                          placeholder="e.g. 2023 or June 2023"
                          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm" />
                      </div>

                      {/* Barcode section */}
                      <div className="rounded-xl border border-white/[0.06] p-4 space-y-3"
                        style={{ background: "rgba(255,255,255,0.02)" }}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-white/60 text-sm font-semibold">Does your document have a barcode / QR code?</p>
                            <p className="text-white/25 text-xs mt-0.5">Many modern certificates have scannable codes for instant verification</p>
                          </div>
                          <button onClick={() => { setHasBarcode(!hasBarcode); setBarcodeVal(""); }}
                            className={`w-12 h-6 rounded-full transition-all flex items-center px-1 ${hasBarcode ? "bg-indigo-500" : "bg-white/10"}`}>
                            <span className={`w-4 h-4 rounded-full bg-white transition-all ${hasBarcode ? "translate-x-6" : "translate-x-0"}`} />
                          </button>
                        </div>
                        {hasBarcode && (
                          <input value={barcodeVal} onChange={(e) => setBarcodeVal(e.target.value)}
                            placeholder="Paste the barcode value or QR code text here"
                            className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Step 3: Document IPFS CID ── */}
                  {docType && (
                    <div className="glass rounded-3xl p-6 space-y-4">
                      <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                        Step 3 — Upload Your Document to IPFS
                      </p>
                      <div className="rounded-xl px-4 py-3 border border-sky-500/20 text-xs text-sky-300/70 leading-relaxed"
                        style={{ background: "rgba(14,165,233,0.05)" }}>
                        📌 Upload your document (PDF or image) to{" "}
                        <a href="https://app.pinata.cloud" target="_blank" rel="noopener noreferrer"
                          className="text-sky-400 hover:underline font-semibold">Pinata.cloud</a>
                        {" "}→ Upload → Copy the CID and paste below.
                        Your document stays on IPFS; the metadata is encrypted before going on-chain.
                      </div>
                      <div>
                        <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                          Document IPFS CID <span className="text-red-400/60">*</span>
                        </label>
                        <input value={docCID} onChange={(e) => setDocCID(e.target.value)}
                          placeholder="Paste CID (bafy…) or full gateway URL"
                          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono" />
                        {docCID && (
                          <a href={toIpfsUrl(docCID)} target="_blank" rel="noopener noreferrer"
                            className="text-sky-400/60 hover:text-sky-400 text-xs mt-1.5 inline-flex items-center gap-1 transition-colors">
                            📄 Preview document ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Status + Submit ── */}
                  {docType && (
                    <div className="glass rounded-3xl p-6 space-y-4">
                      {/* Wrong chain */}
                      {isWrongChain && (
                        <div className="rounded-xl px-4 py-3 flex items-center gap-3 border border-amber-500/30"
                          style={{ background: "rgba(245,158,11,0.1)" }}>
                          <span>⚠️</span>
                          <div className="flex-1">
                            <p className="text-amber-300 font-semibold text-sm">{c.wrongNetwork}</p>
                            <p className="text-amber-300/60 text-xs">{c.wrongNetworkDesc}</p>
                          </div>
                          <button onClick={() => switchChain({ chainId: qieTestnet.id })}
                            className="text-xs bg-amber-500/20 border border-amber-500/40 text-amber-300 px-3 py-1.5 rounded-lg font-semibold hover:bg-amber-500/30 transition-colors">
                            {c.switchNow}
                          </button>
                        </div>
                      )}

                      {/* Errors */}
                      {(err || txError) && (
                        <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                          <span className="mt-0.5">⚠️</span>
                          <div>
                            <p className="text-red-300 text-sm font-semibold">{err || "Transaction failed"}</p>
                            {txError && !err && <p className="text-red-300/60 text-xs mt-1 break-all">{txError}</p>}
                          </div>
                        </div>
                      )}

                      {/* Success */}
                      {attOk && (
                        <div className="rounded-xl px-4 py-4 flex items-center gap-3 border border-green-500/30"
                          style={{ background: "rgba(34,197,94,0.08)" }}>
                          <span className="text-2xl">✅</span>
                          <div>
                            <p className="text-green-400 font-semibold text-sm">Credential attested on-chain!</p>
                            <p className="text-green-400/60 text-xs">
                              Your {typeInfo?.label} has been recorded. Metadata is encrypted — only the VeridiChain team can read the details.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Privacy notice */}
                      <div className="flex items-start gap-2 text-white/20 text-xs leading-relaxed">
                        <span className="mt-0.5 shrink-0">🔐</span>
                        <p>Your name, institution, year and barcode are <strong className="text-white/30">end-to-end encrypted</strong> — only visible to VeridiChain admin during manual verification. The public on-chain record only shows the document type.</p>
                      </div>

                      {/* ── QIE Pass Gate approved banner ── */}
                      {qieGateState === "approved" && (
                        <div className="rounded-2xl px-5 py-4 border border-green-500/30 flex items-center gap-3"
                          style={{ background: "rgba(34,197,94,0.07)" }}>
                          <span className="text-xl">✅</span>
                          <div>
                            <p className="text-green-400 font-semibold text-sm">QIE Pass name verified!</p>
                            <p className="text-green-400/50 text-xs mt-0.5">Name matched — processing blockchain transaction…</p>
                          </div>
                        </div>
                      )}

                      {/* Submit button */}
                      {attestLoading ? (
                        <div className="w-full py-3.5 rounded-2xl text-center text-sm font-semibold text-white/60 border border-white/10 flex items-center justify-center gap-2"
                          style={{ background: "rgba(255,255,255,0.04)" }}>
                          <span className="inline-block w-3 h-3 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin" />
                          Encrypting metadata…
                        </div>
                      ) : attPending ? (
                        <div className="space-y-2">
                          <div className="w-full py-3.5 rounded-2xl text-center text-sm font-semibold text-white/60 border border-white/10"
                            style={{ background: "rgba(255,255,255,0.04)" }}>
                            📱 Confirm in wallet…
                          </div>
                          <button onClick={() => { attReset(); setQieGateState("idle"); }}
                            className="w-full py-2.5 rounded-2xl text-xs font-semibold text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 transition-all"
                            style={{ background: "rgba(239,68,68,0.05)" }}>
                            Cancel
                          </button>
                        </div>
                      ) : attWaiting ? (
                        <div className="space-y-2">
                          <div className="w-full py-3.5 rounded-2xl text-center text-sm font-semibold text-white/60 border border-white/10 flex items-center justify-center gap-2"
                            style={{ background: "rgba(255,255,255,0.04)" }}>
                            <span className="inline-block w-3 h-3 border-2 border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />
                            Mining transaction…
                          </div>
                          {attHash && (
                            <a href={`https://testnet.qie.digital/tx/${attHash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="block w-full text-center py-2 rounded-xl text-xs text-sky-400 border border-sky-500/20 hover:bg-sky-500/10 transition-all">
                              View on Explorer ↗
                            </a>
                          )}
                        </div>
                      ) : (
                        <button onClick={handleStructuredAttest}
                          className="w-full text-white py-3.5 rounded-2xl font-semibold text-sm transition-all"
                          style={{
                            background: attOk
                              ? "linear-gradient(135deg,#16a34a,#15803d)"
                              : isWrongChain
                              ? "linear-gradient(135deg,#f59e0b,#d97706)"
                              : "linear-gradient(135deg,#818cf8,#6366f1)",
                            boxShadow: attOk
                              ? "0 8px 24px rgba(22,163,74,0.3)"
                              : isWrongChain
                              ? "0 8px 24px rgba(245,158,11,0.3)"
                              : "0 8px 24px rgba(129,140,248,0.3)",
                          }}>
                          {attOk
                            ? "✍️ Attest Another Credential →"
                            : isQIEPassVerified
                            ? `🪪 Attest with KYC Name Check →`
                            : `✍️ Self-Attest ${typeInfo?.label ?? "Credential"} →`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ── Manual Verification Modal ── */}
      {verifModalCred && (
        <VerifRequestModal
          credentialId={verifModalCred}
          onClose={() => setVerifModalCred(null)}
          onSuccess={() => {
            setVerifModalCred(null);
            // Refresh pending map after short delay
            setTimeout(() => {
              setPendingReqMap((m) => new Map(m.set(verifModalCred, true)));
            }, 2000);
          }}
        />
      )}
    </div>
  );
}
