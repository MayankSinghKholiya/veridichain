"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { parseAbiItem } from "viem";
import {
  useAccount, useConnect, useDisconnect,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { Navbar } from "../../components/shared/Navbar";
import { ConnectWalletPrompt } from "../../components/shared/ConnectWalletPrompt";
import {
  CONTRACTS,
  INSTITUTION_REGISTRY_ABI,
  CREDENTIAL_REGISTRY_ABI,
  MANUAL_VERIFICATION_REGISTRY_ABI,
  ERC20_ABI,
} from "../../lib/contracts";
import { getLogsChunked, getLogsInRange } from "../../lib/getLogs";
import { CRED_DOC_TYPES, type CredDocType, type CredMetaDetails } from "../../lib/credentialMeta";
import { QIE_CHAIN_ID, QIE_CHAIN_NAME, QIE_RPC, QIE_EXPLORER } from "../../lib/wagmi";

const ADMIN_CHAIN_ID   = QIE_CHAIN_ID;  // env-driven — works for testnet & mainnet

// Admin page previously had NO chain switch, causing QIE Wallet to show the
// transaction on the wrong network → gas not deducted, tx silently dropped.
async function ensureChain(): Promise<boolean> {
  const eth = typeof window !== "undefined" ? (window as any).ethereum : null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!eth) return true; // no injected wallet — wagmi will handle it
  const chainHex = "0x" + QIE_CHAIN_ID.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    return true;
  } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (e?.code === 4902) {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainHex,
            chainName: QIE_CHAIN_NAME,
            nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
            rpcUrls: [QIE_RPC],
            blockExplorerUrls: [QIE_EXPLORER],
          }],
        });
        return true;
      } catch { return false; }
    }
    // User rejected the switch
    return false;
  }
}
const BLOCKS_PER_DAY   = 28800n; // ~3 s/block conservative — safe for QIE chain
const REQ_BATCH        = 5;       // parallel getRequest calls per round
const ACTIVITY_PAGE_SZ = 10;      // items per page in All Activity tab
const NULL_ADDRESS     = "0x0000000000000000000000000000000000000000";

const ADMIN_WALLETS: string[] = (
  process.env.NEXT_PUBLIC_ADMIN_WALLETS ?? ""
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

type AdminTab      = "pending" | "all" | "institutions" | "credentials" | "team";
type ActivityFilter = "all" | "verif" | "revocations" | "byteam";
type DaysFilter     = 1 | 7 | 30 | 90 | null; // null = All time

interface RequestData {
  id:              number;
  credentialId:    string;
  candidate:       string;
  documentIpfsCID: string;
  candidateNote:   string;
  status:          number; // 0=Pending 1=Approved 2=Rejected
  reviewedBy:      string;
  reviewNote:      string;
  submittedAt:     number;
  reviewedAt:      number;
}

interface InstitutionData {
  address:      string;
  name:         string;
  domain:       string;
  country:      string;
  website:      string;
  isVerified:   boolean;
  isSlashed:    boolean;
  stakedAmount: bigint;
  registeredAt: bigint;
}

interface RevokeActivityData {
  credentialId: string;
  revokedBy:    string;
  reason:       string;
  timestamp:    number;
  txHash?:      string;
}

type ActivityItem =
  | { kind: "request";    ts: number; req: RequestData        }
  | { kind: "revocation"; ts: number; rev: RevokeActivityData };

function scGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try { const r = sessionStorage.getItem(key); return r ? JSON.parse(r) as T : null; }
  catch { return null; }
}
function scSet(key: string, val: unknown) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
}

const isDeployedAddr = (a: string | undefined) => !!a && a !== NULL_ADDRESS;

/**
 * Safely build an IPFS URL from either a bare CID or a full gateway URL.
 * Prevents double-gateway URLs like gateway.../ipfs/https://...
 */
function toIpfsUrl(cidOrUrl: string): string {
  const s = cidOrUrl.trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://gateway.pinata.cloud/ipfs/${s}`;
}

function fmtAddr(addr: string) {
  if (!addr || addr === NULL_ADDRESS) return "—";
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
function fmtDate(ts: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function SkeletonCard() {
  return (
    <div className="glass rounded-3xl p-6 animate-pulse space-y-3">
      <div className="h-4 bg-white/10 rounded w-1/3" />
      <div className="h-3 bg-white/5 rounded w-full" />
      <div className="h-3 bg-white/5 rounded w-2/3" />
      <div className="h-8 bg-white/5 rounded-xl mt-4" />
    </div>
  );
}

function InfoRow({ label, value, link, mono = false }: {
  label: string; value: string; link?: string; mono?: boolean;
}) {
  return (
    <div className="glass rounded-xl px-4 py-3">
      <p className="text-white/30 text-xs mb-1">{label}</p>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer"
          className={`text-sky-400 hover:underline text-xs break-all ${mono ? "font-mono" : ""}`}>
          {value} ↗
        </a>
      ) : (
        <p className={`text-white/75 text-xs break-all ${mono ? "font-mono" : ""}`}>{value}</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  if (status === 0) return (
    <span className="text-xs px-3 py-1 rounded-full border font-semibold bg-amber-500/10 border-amber-500/25 text-amber-400">⏳ Pending</span>
  );
  if (status === 1) return (
    <span className="text-xs px-3 py-1 rounded-full border font-semibold bg-green-500/10 border-green-500/25 text-green-400">✅ Approved</span>
  );
  return (
    <span className="text-xs px-3 py-1 rounded-full border font-semibold bg-red-500/10 border-red-500/25 text-red-400">❌ Rejected</span>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl px-3 py-2">
      <p className="text-white/25 text-xs mb-0.5">{label}</p>
      <p className="text-white/70 text-xs break-all">{value || "—"}</p>
    </div>
  );
}

function CredentialDetailsPanel({ credentialId }: { credentialId: string }) {
  const publicClient = usePublicClient();
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [type,    setType]    = useState<CredDocType | null>(null);
  const [details, setDetails] = useState<CredMetaDetails | null>(null);
  const [err,     setErr]     = useState("");

  async function loadDetails() {
    if (open) { setOpen(false); return; } // toggle
    if (details !== null || type !== null) { setOpen(true); return; } // already loaded
    if (!publicClient) return;
    setLoading(true); setErr("");
    try {
      // ① Fetch ipfsCID from CredentialRegistry public mapping
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await (publicClient as any).readContract({
        address:      CONTRACTS.CREDENTIAL_REGISTRY,
        abi:          CREDENTIAL_REGISTRY_ABI,
        functionName: "credentials",
        args:         [credentialId as `0x${string}`],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
      const ipfsCID = (raw?.ipfsCID ?? raw?.[1] ?? "") as string;
      if (!ipfsCID) { setErr("No metadata CID found on-chain for this credential"); setLoading(false); return; }

      // ② Get a server-signed token for this credential (admin has same access as server)
      const tokenRes  = await fetch(`/api/share-token?credId=${encodeURIComponent(credentialId)}`);
      const tokenJson = await tokenRes.json() as { token?: string };
      const token = tokenJson.token ?? "";

      // ③ Decrypt via server-side API route (token required to unlock details)
      const decryptUrl = `/api/metadata/decrypt?cid=${encodeURIComponent(ipfsCID)}&credId=${encodeURIComponent(credentialId)}&t=${encodeURIComponent(token)}`;
      const res  = await fetch(decryptUrl);
      const json = await res.json();

      setType(json.type as CredDocType | null);
      setDetails(json.details as CredMetaDetails | null);
      if (json.error && !json.type) setErr(json.error);
      else setOpen(true);
    } catch (e) {
      setErr(`Failed to load: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }

  const typeInfo = type ? CRED_DOC_TYPES[type] : null;

  return (
    <div className="pt-3 border-t border-white/[0.06]">
      <button onClick={loadDetails} disabled={loading}
        className="flex items-center gap-1.5 text-xs text-sky-400/60 hover:text-sky-400 transition-colors disabled:opacity-40">
        {loading ? (
          <><span className="inline-block w-3 h-3 border border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />Loading credential details…</>
        ) : (
          <>{open ? "🔼 Hide details" : "🔍 View credential details"}</>
        )}
      </button>

      {err && <p className="text-amber-400/60 text-xs mt-1.5">{err}</p>}

      {open && (
        <div className="mt-3 rounded-2xl border border-sky-500/15 p-4 space-y-3"
          style={{ background: "rgba(14,165,233,0.04)" }}>
          {/* Type header */}
          <div className="flex items-center gap-2">
            <span className="text-lg">{typeInfo?.icon ?? "📋"}</span>
            <p className="text-sky-400 text-xs font-bold">{typeInfo?.label ?? type ?? "Unknown type"}</p>
            <button onClick={() => setOpen(false)}
              className="ml-auto text-white/20 hover:text-white/50 text-xs transition-colors">✕</button>
          </div>

          {details ? (
            <div className="grid grid-cols-2 gap-2">
              <MetaField label="Candidate Name"   value={details.candidateName} />
              <MetaField label="Institution / Org" value={details.institutionName} />
              <MetaField label="Year"             value={details.issueYear} />
              {details.degreeType  && <MetaField label="Degree Type" value={details.degreeType} />}
              {details.role        && <MetaField label="Role"        value={details.role} />}
              {details.dateFrom    && <MetaField label="From"        value={details.dateFrom} />}
              {details.dateTo      && <MetaField label="To"          value={details.dateTo} />}
              {details.courseName  && <MetaField label="Course"      value={details.courseName} />}
              {details.title       && <MetaField label="Title"       value={details.title} />}

              {/* Barcode */}
              {details.hasBarcode && (
                <div className="col-span-2 glass rounded-xl px-3 py-2">
                  <p className="text-white/25 text-xs mb-0.5">Barcode / QR Code Value</p>
                  <p className="text-green-400 text-xs font-mono break-all">
                    ✅ {details.barcodeValue || "Provided (no value captured)"}
                  </p>
                </div>
              )}
              {!details.hasBarcode && (
                <div className="col-span-2 glass rounded-xl px-3 py-2">
                  <p className="text-white/25 text-xs">No barcode / QR code on document</p>
                </div>
              )}

              {/* Supporting document preview */}
              {details.documentCID && (
                <div className="col-span-2">
                  <a href={toIpfsUrl(details.documentCID)}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:underline font-medium">
                    📄 View supporting document ↗
                  </a>
                  <p className="text-white/20 text-xs font-mono mt-0.5 break-all">{details.documentCID}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-white/30 text-xs">
              {type
                ? "Credential type is visible but details are in legacy format or unencrypted."
                : "No structured metadata — this credential was attested before the new format."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RequestCard({
  req, showActions,
  approveNote, rejectReason,
  onApproveNoteChange, onRejectReasonChange,
  onApprove, onReject, actionState,
  isCredentialRevoked,
}: {
  req: RequestData; showActions: boolean;
  approveNote: string; rejectReason: string;
  onApproveNoteChange: (v: string) => void;
  onRejectReasonChange: (v: string) => void;
  onApprove: () => void; onReject: () => void;
  actionState: "approving" | "rejecting" | "revoking" | "idle";
  isCredentialRevoked?: boolean;
}) {
  const borderColor = req.status === 1 ? "border-green-500/20" : req.status === 2 ? "border-red-500/20" : "border-amber-500/20";
  const bgStyle = req.status === 1 ? "rgba(34,197,94,0.05)" : req.status === 2 ? "rgba(239,68,68,0.05)" : "rgba(245,158,11,0.04)";

  return (
    <div className={`rounded-3xl border ${borderColor} transition-all`} style={{ background: bgStyle }}>
      <div className="p-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <p className="text-white/30 text-xs">Request #{req.id}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={req.status} />
              {isCredentialRevoked && req.status === 1 && (
                <span className="text-xs px-2.5 py-1 rounded-full border font-semibold bg-red-500/10 border-red-500/25 text-red-400">⚠️ Cred Revoked</span>
              )}
            </div>
          </div>
          <span className="text-white/25 text-xs font-mono shrink-0">{fmtDate(req.submittedAt)}</span>
        </div>

        <InfoRow label="Credential ID" value={req.credentialId} mono />
        <InfoRow label="Candidate"
          value={`${req.candidate.slice(0, 10)}…${req.candidate.slice(-8)}`}
          link={`${QIE_EXPLORER}/address/${req.candidate}`} mono />

        {req.documentIpfsCID && (
          <InfoRow label="Document (IPFS)"
            value={req.documentIpfsCID.length > 36 ? `${req.documentIpfsCID.slice(0,18)}…${req.documentIpfsCID.slice(-10)}` : req.documentIpfsCID}
            link={`https://gateway.pinata.cloud/ipfs/${req.documentIpfsCID}`} />
        )}
        {req.candidateNote && (
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-white/30 text-xs mb-1">Candidate Note</p>
            <p className="text-white/70 text-xs leading-relaxed">{req.candidateNote}</p>
          </div>
        )}
        {req.status !== 0 && req.reviewNote && (
          <div className={`rounded-xl px-4 py-3 border ${req.status === 1 ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5"}`}>
            <p className="text-white/30 text-xs mb-1">{req.status === 1 ? "Approval Note" : "Rejection Reason"}</p>
            <p className="text-white/70 text-xs leading-relaxed">{req.reviewNote}</p>
            <p className="text-white/25 text-xs mt-1.5 font-mono">by {fmtAddr(req.reviewedBy)} · {fmtDate(req.reviewedAt)}</p>
          </div>
        )}
        {isCredentialRevoked && req.status === 1 && (
          <div className="rounded-xl px-4 py-3 border border-red-500/20" style={{ background: "rgba(239,68,68,0.08)" }}>
            <p className="text-red-400 text-xs font-semibold">⚠️ Credential was revoked after team approval</p>
            <p className="text-red-400/50 text-xs mt-0.5">The team verification remains on-chain but the credential is no longer valid.</p>
          </div>
        )}

        {/* Admin-only: decrypt and show structured credential metadata */}
        <CredentialDetailsPanel credentialId={req.credentialId} />

        {showActions && req.status === 0 && (
          <div className="space-y-3 pt-3 border-t border-white/[0.06]">
            <div>
              <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                Approval Note <span className="text-white/20 font-normal normal-case">(optional)</span>
              </label>
              <textarea value={approveNote} onChange={(e) => onApproveNoteChange(e.target.value)}
                placeholder="e.g. Degree certificate verified — barcode matched" rows={2}
                className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-xs resize-none" />
            </div>
            <div>
              <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider mb-1.5">
                Rejection Reason <span className="text-white/20 font-normal normal-case">(required to reject)</span>
              </label>
              <textarea value={rejectReason} onChange={(e) => onRejectReasonChange(e.target.value)}
                placeholder="e.g. Document unreadable, mismatched information..." rows={2}
                className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-xs resize-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={onApprove} disabled={actionState !== "idle"}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 4px 14px rgba(22,163,74,0.3)" }}>
                {actionState === "approving" ? "⏳ Approving…" : "✅ Approve"}
              </button>
              <button onClick={onReject} disabled={actionState !== "idle"}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#dc2626,#b91c1c)", boxShadow: "0 4px 14px rgba(220,38,38,0.3)" }}>
                {actionState === "rejecting" ? "⏳ Rejecting…" : actionState === "revoking" ? "🔒 Revoking credential…" : "❌ Reject"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RevokeActivityCard({ act }: { act: RevokeActivityData }) {
  return (
    <div className="rounded-3xl border border-red-500/20 transition-all" style={{ background: "rgba(239,68,68,0.05)" }}>
      <div className="p-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <p className="text-white/30 text-xs">Revocation Event</p>
            <span className="text-xs px-3 py-1 rounded-full border font-semibold bg-red-500/10 border-red-500/25 text-red-400">🚫 Revoked</span>
          </div>
          <span className="text-white/25 text-xs font-mono shrink-0">{fmtDate(act.timestamp)}</span>
        </div>
        <InfoRow label="Credential ID" value={act.credentialId} mono />
        <InfoRow label="Revoked By" value={`${act.revokedBy.slice(0,10)}…${act.revokedBy.slice(-8)}`}
          link={`${QIE_EXPLORER}/address/${act.revokedBy}`} mono />
        {act.reason && (
          <div className="glass rounded-xl px-4 py-3">
            <p className="text-white/30 text-xs mb-1">Reason</p>
            <p className="text-white/70 text-xs leading-relaxed">{act.reason}</p>
          </div>
        )}
        {act.txHash && (
          <InfoRow label="Transaction" value={`${act.txHash.slice(0,16)}…${act.txHash.slice(-6)}`}
            link={`${QIE_EXPLORER}/tx/${act.txHash}`} mono />
        )}
      </div>
    </div>
  );
}

function InstitutionCard({
  inst,
  slashReason,    onSlashReasonChange,
  rejectReason,   onRejectReasonChange,
  revokeInstReason, onRevokeInstReasonChange,
  onVerify, onSlash, onReject, onRevokeInst,
  verifyState, slashState, rejectState, revokeInstState,
}: {
  inst: InstitutionData;
  slashReason:       string; onSlashReasonChange:       (v: string) => void;
  rejectReason:      string; onRejectReasonChange:      (v: string) => void;
  revokeInstReason:  string; onRevokeInstReasonChange:  (v: string) => void;
  onVerify: () => void; onSlash: () => void; onReject: () => void; onRevokeInst: () => void;
  verifyState:    "idle" | "loading";
  slashState:     "idle" | "loading";
  rejectState:    "idle" | "loading";
  revokeInstState:"idle" | "loading";
}) {
  const isActive  = inst.isVerified && !inst.isSlashed;
  const isPending = !inst.isVerified && !inst.isSlashed;
  const isSlashed = inst.isSlashed;
  const borderColor = isActive ? "border-green-500/20" : isPending ? "border-amber-500/20" : "border-red-500/20";
  const bgStyle     = isActive ? "rgba(34,197,94,0.04)" : isPending ? "rgba(245,158,11,0.04)" : "rgba(239,68,68,0.04)";

  return (
    <div className={`rounded-3xl border ${borderColor} transition-all`} style={{ background: bgStyle }}>
      <div className="p-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-white font-bold text-base">{inst.name || "—"}</p>
            <p className="text-white/40 text-xs mt-0.5">{inst.domain}</p>
          </div>
          <span className={`text-xs px-3 py-1 rounded-full border font-semibold shrink-0 ${
            isActive ? "bg-green-500/10 border-green-500/25 text-green-400"
            : isPending ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
            : "bg-red-500/10 border-red-500/25 text-red-400"
          }`}>
            {isActive ? "✅ Verified" : isPending ? "⏳ Pending" : "🚫 Slashed"}
          </span>
        </div>
        <InfoRow label="Wallet" value={fmtAddr(inst.address)} link={`${QIE_EXPLORER}/address/${inst.address}`} mono />
        {inst.country && <InfoRow label="Country" value={inst.country} />}
        {inst.website && <InfoRow label="Website" value={inst.website} link={inst.website.startsWith("http") ? inst.website : `https://${inst.website}`} />}
        <InfoRow label="Registered" value={fmtDate(Number(inst.registeredAt))} />

        <div className="pt-3 border-t border-white/[0.06] space-y-3">

          {}
          {isPending && (
            <>
              <button onClick={onVerify} disabled={verifyState !== "idle"}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#0ea5e9,#6366f1)", boxShadow: "0 4px 14px rgba(14,165,233,0.3)" }}>
                {verifyState === "loading" ? "⏳ Approving…" : "✅ Approve Institution"}
              </button>

              <div className="rounded-2xl border border-red-500/15 p-3 space-y-2"
                style={{ background: "rgba(239,68,68,0.04)" }}>
                <p className="text-white/35 text-xs font-semibold uppercase tracking-wider">Reject Registration</p>
                <p className="text-white/25 text-xs">↩️ WQIE stake returned to institution in full</p>
                <textarea value={rejectReason} onChange={(e) => onRejectReasonChange(e.target.value)}
                  placeholder="e.g. Domain could not be verified..." rows={2}
                  className="input-field w-full rounded-xl px-3 py-2 text-white placeholder-white/20 text-xs resize-none" />
                <button onClick={onReject}
                  disabled={rejectState !== "idle"}
                  className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#b91c1c,#7f1d1d)", opacity: rejectState !== "idle" ? 0.6 : 1 }}>
                  {rejectState === "loading" ? "⏳ Rejecting…" : "❌ Reject & Return Stake"}
                </button>
              </div>
            </>
          )}

          {}
          {isActive && (
            <>
              {/* Non-punitive revoke — returns WQIE stake */}
              <div className="rounded-2xl border border-amber-500/15 p-3 space-y-2"
                style={{ background: "rgba(245,158,11,0.04)" }}>
                <p className="text-white/35 text-xs font-semibold uppercase tracking-wider">Revoke (Non-Punitive)</p>
                <p className="text-white/25 text-xs">↩️ WQIE stake returned — use for policy/admin reasons, not fraud</p>
                <textarea value={revokeInstReason} onChange={(e) => onRevokeInstReasonChange(e.target.value)}
                  placeholder="e.g. Institution requested removal..." rows={2}
                  className="input-field w-full rounded-xl px-3 py-2 text-white placeholder-white/20 text-xs resize-none" />
                <button onClick={onRevokeInst}
                  disabled={revokeInstState !== "idle" || !revokeInstReason.trim()}
                  className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#d97706,#b45309)", opacity: (!revokeInstReason.trim() || revokeInstState !== "idle") ? 0.5 : 1 }}>
                  {revokeInstState === "loading" ? "⏳ Revoking…" : "↩️ Revoke & Return Stake"}
                </button>
              </div>

              {/* Fraud slash — burns 50% WQIE, 50% to DEX */}
              <div className="rounded-2xl border border-red-500/15 p-3 space-y-2"
                style={{ background: "rgba(239,68,68,0.04)" }}>
                <p className="text-white/35 text-xs font-semibold uppercase tracking-wider">Slash (Fraud Only)</p>
                <p className="text-white/25 text-xs">🔥 50% WQIE burned · 50% to DEX liquidity — irreversible</p>
                <textarea value={slashReason} onChange={(e) => onSlashReasonChange(e.target.value)}
                  placeholder="e.g. Fraudulent credentials issued, investigation confirmed..." rows={2}
                  className="input-field w-full rounded-xl px-3 py-2 text-white placeholder-white/20 text-xs resize-none" />
                <button onClick={onSlash} disabled={slashState !== "idle" || !slashReason.trim()}
                  className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#dc2626,#9f1239)", opacity: (!slashReason.trim() || slashState !== "idle") ? 0.5 : 1 }}>
                  {slashState === "loading" ? "⏳ Slashing…" : "🚫 Slash & Burn Stake (fraud)"}
                </button>
              </div>
            </>
          )}

          {isSlashed && <p className="text-red-400/60 text-xs text-center py-1">This institution has been slashed and removed.</p>}
        </div>
      </div>
    </div>
  );
}

function PageNav({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button disabled={page === 1} onClick={() => onChange(page - 1)}
        className="glass glass-hover px-4 py-2 rounded-xl text-sm font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
        ← Prev
      </button>
      <div className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => i + 1)
          .filter((pg) => pg === 1 || pg === total || (pg >= page - 1 && pg <= page + 1))
          .reduce<(number | "…")[]>((acc, pg, idx, arr) => {
            if (idx > 0 && pg - (arr[idx - 1] as number) > 1) acc.push("…");
            acc.push(pg);
            return acc;
          }, [])
          .map((item, i) =>
            item === "…" ? (
              <span key={`e${i}`} className="w-9 h-9 flex items-center justify-center text-white/20 text-sm">…</span>
            ) : (
              <button key={item} onClick={() => onChange(item as number)}
                className={`w-9 h-9 rounded-xl text-sm font-semibold transition-all ${
                  item === page ? "text-white" : "text-white/30 glass hover:text-white/70"
                }`}
                style={item === page ? {
                  background: "linear-gradient(135deg,#6366f1,#4f46e5)",
                  boxShadow: "0 2px 10px rgba(99,102,241,0.3)",
                } : {}}>
                {item}
              </button>
            )
          )}
      </div>
      <button disabled={page === total} onClick={() => onChange(page + 1)}
        className="glass glass-hover px-4 py-2 rounded-xl text-sm font-semibold text-white/50 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all">
        Next →
      </button>
    </div>
  );
}

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient   = usePublicClient();

  const [mounted, setMounted] = useState(false);
  const [tab,     setTab]     = useState<AdminTab>("pending");

  const [requests,     setRequests]     = useState<RequestData[]>([]);
  const [reqLoading,   setReqLoading]   = useState(false);
  const [approveNote,  setApproveNote]  = useState<Record<number, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<number, string>>({});
  const [actionStates, setActionStates] = useState<Record<number, "approving" | "rejecting" | "revoking" | "idle">>({});
  // After a reject tx confirms, auto-revoke the linked credential
  const [autoRevokeQueue, setAutoRevokeQueue] = useState<{ credentialId: string; reason: string } | null>(null);

  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [daysFilter,     setDaysFilter]     = useState<DaysFilter>(30);
  const [customDate,     setCustomDate]     = useState(""); // "YYYY-MM-DD"
  const [actPage,        setActPage]        = useState(1);

  const [revokeActivity, setRevokeActivity] = useState<RevokeActivityData[]>([]);
  const [revokeFetching, setRevokeFetching] = useState(false);

  const [institutions,       setInstitutions]       = useState<InstitutionData[]>([]);
  const [instLoading,        setInstLoading]        = useState(false);
  const [slashReasons,       setSlashReasons]       = useState<Record<string, string>>({});
  const [rejectInstReasons,  setRejectInstReasons]  = useState<Record<string, string>>({});
  const [revokeInstReasons,  setRevokeInstReasons]  = useState<Record<string, string>>({});
  const [verifyStates,       setVerifyStates]       = useState<Record<string, "idle" | "loading">>({});
  const [slashStates,        setSlashStates]        = useState<Record<string, "idle" | "loading">>({});
  const [rejectInstStates,   setRejectInstStates]   = useState<Record<string, "idle" | "loading">>({});
  const [revokeInstStates,   setRevokeInstStates]   = useState<Record<string, "idle" | "loading">>({});

  const [revokeId,     setRevokeId]     = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeErr,    setRevokeErr]    = useState("");

  const [newVerifierInput, setNewVerifierInput] = useState("");
  const [verifierErr,      setVerifierErr]      = useState("");

  const [qieusdInput,      setQieusdInput]      = useState("");
  const [stakeInput,       setStakeInput]       = useState("");
  const [qieusdErr,        setQieusdErr]        = useState("");

  const [instAdminInput,   setInstAdminInput]   = useState("");
  const [instAdminErr,     setInstAdminErr]     = useState("");
  // Known institution admins — seeded with deployed admin, updated on add/remove
  const [instAdminList,    setInstAdminList]    = useState<string[]>(["0x409B8875254A1E2Bbb9eE5eB06D0f3F7260a96df"]);

  useEffect(() => { setMounted(true); }, []);

  const manualAddr       = CONTRACTS.MANUAL_VERIFICATION_REGISTRY;
  const instAddr         = CONTRACTS.INSTITUTION_REGISTRY;
  const credAddr         = CONTRACTS.CREDENTIAL_REGISTRY;
  const isManualDeployed = isDeployedAddr(manualAddr);

  const { data: isMemberData } = useReadContract({
    address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "isTeamMember",
    args: [address!], query: { enabled: isManualDeployed && !!address },
  });
  const { data: ownerData } = useReadContract({
    address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "owner",
    query: { enabled: isManualDeployed },
  });
  const { data: requestCountData, refetch: refetchCount } = useReadContract({
    address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "requestCount",
    query: { enabled: isManualDeployed },
  });
  const { data: verifierListData, refetch: refetchVerifiers } = useReadContract({
    address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "getVerifierList",
    query: { enabled: isManualDeployed },
  });
  const { data: feeData } = useReadContract({
    address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "verificationFee",
    query: { enabled: isManualDeployed },
  });

  const { data: currentStakeAmountRaw, refetch: refetchStakeAmount } = useReadContract({
    address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "STAKE_AMOUNT",
    query: { enabled: !!instAddr },
  });
  const { data: currentQieusdAddrRaw, refetch: refetchQieusdAddr } = useReadContract({
    address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "qieStableCoin",
    query: { enabled: !!instAddr },
  });
  const currentStakeAmount = (currentStakeAmountRaw as bigint | undefined) ?? 0n;
  const currentQieusdAddr  = (currentQieusdAddrRaw  as string | undefined) ?? "";

  // Read QIEUSD token decimals dynamically — USDC-style tokens use 6, DAI-style use 18
  // This ensures setStakeAmount sends the correct wei value regardless of token config
  const { data: qieusdDecimalsRaw } = useReadContract({
    address: currentQieusdAddr as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: !!currentQieusdAddr && currentQieusdAddr !== NULL_ADDRESS },
  });
  // Default to 18 if not set or read fails
  const qieusdDecimals = typeof qieusdDecimalsRaw === "number"
    ? qieusdDecimalsRaw
    : (typeof qieusdDecimalsRaw === "bigint" ? Number(qieusdDecimalsRaw) : 18);

  const ownerAddr    = (ownerData as string | undefined) ?? "";
  // isOwner: contract owner  OR  address in NEXT_PUBLIC_ADMIN_WALLETS env whitelist
  const isOwner      = !!address && (
    (!!ownerAddr && address.toLowerCase() === ownerAddr.toLowerCase()) ||
    ADMIN_WALLETS.includes(address.toLowerCase())
  );
  // isMember: on-chain team member  OR  whitelisted admin (owner also gets full access)
  const isMember     = ((isMemberData as boolean | undefined) ?? false) || isOwner;
  const verifierList = (verifierListData as string[] | undefined) ?? [];
  const fee          = (feeData as bigint | undefined) ?? 0n;

  const loadRequests = useCallback(async () => {
    if (!publicClient || !isManualDeployed) return;
    const count = requestCountData ? Number(requestCountData) : 0;
    if (count === 0) { setRequests([]); return; }
    setReqLoading(true);

    // Session cache keyed by count — auto-invalidates when new requests arrive
    const cacheKey = `vc:admin:reqs:${ADMIN_CHAIN_ID}:${count}`;
    const cached = scGet<RequestData[]>(cacheKey);
    if (cached) {
      setRequests(cached);
      setReqLoading(false);
      return;
    }

    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const results: RequestData[] = [];

    for (let i = 0; i < ids.length; i += REQ_BATCH) {
      const batch = ids.slice(i, i + REQ_BATCH);
      const settled = await Promise.allSettled(
        batch.map((id) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (publicClient as any).readContract({
            address: manualAddr,
            abi: MANUAL_VERIFICATION_REGISTRY_ABI,
            functionName: "getRequest",
            args: [BigInt(id)],
          })
        )
      );
      for (const r of settled) {
        if (r.status === "fulfilled") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = r.value as any;
          results.push({
            id:              Number(raw.id ?? raw[0]),
            credentialId:    (raw.credentialId ?? raw[1]) as string,
            candidate:       (raw.candidate ?? raw[2]) as string,
            documentIpfsCID: (raw.documentIpfsCID ?? raw[3]) as string,
            candidateNote:   (raw.candidateNote ?? raw[4]) as string,
            status:          Number(raw.status ?? raw[5]),
            reviewedBy:      (raw.reviewedBy ?? raw[6]) as string,
            reviewNote:      (raw.reviewNote ?? raw[7]) as string,
            submittedAt:     Number(raw.submittedAt ?? raw[8]),
            reviewedAt:      Number(raw.reviewedAt ?? raw[9]),
          });
        }
      }
    }

    // Newest first
    results.sort((a, b) => b.submittedAt - a.submittedAt);
    setRequests(results);
    scSet(cacheKey, results);
    setReqLoading(false);
  }, [publicClient, isManualDeployed, manualAddr, requestCountData]);

  const loadRevokeActivity = useCallback(async (days: DaysFilter | "custom", customFrom?: number) => {
    if (!publicClient || !credAddr) return;
    setRevokeFetching(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let logs: any[];

      if (days === null) {
        // All time: full backwards scan (slow but complete)
        logs = await getLogsChunked(publicClient, {
          address: credAddr,
          event: parseAbiItem(
            "event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, string reason, uint256 timestamp)"
          ),
        }, 40, true);
      } else {
        // Date-bounded: calculate fromBlock → MUCH faster via getLogsInRange
        const latestBlock = await publicClient.getBlockNumber();
        let fromBlock: bigint;
        if (days === "custom" && customFrom) {
          const secsAgo = Math.floor(Date.now() / 1000) - customFrom;
          const blocksAgo = BigInt(Math.ceil(secsAgo / 3)); // ~3s/block
          fromBlock = latestBlock > blocksAgo ? latestBlock - blocksAgo : 1n;
        } else {
          fromBlock = latestBlock - BigInt(days as number) * BLOCKS_PER_DAY;
          if (fromBlock < 1n) fromBlock = 1n;
        }
        logs = await getLogsInRange(publicClient, {
          address: credAddr,
          event: parseAbiItem(
            "event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, string reason, uint256 timestamp)"
          ),
        }, fromBlock, latestBlock);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acts: RevokeActivityData[] = logs.map((log: any) => ({
        credentialId: (log.args?.credentialId ?? "") as string,
        revokedBy:    (log.args?.revokedBy    ?? "") as string,
        reason:       (log.args?.reason       ?? "") as string,
        timestamp:    Number(log.args?.timestamp ?? 0),
        txHash:       log.transactionHash as string | undefined,
      }));
      acts.sort((a, b) => b.timestamp - a.timestamp);
      setRevokeActivity(acts);
    } catch { /* ignore */ }
    setRevokeFetching(false);
  }, [publicClient, credAddr]);

  const loadInstitutions = useCallback(async () => {
    if (!publicClient || !instAddr) return;
    setInstLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addrs = await (publicClient as any).readContract({
        address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "getAllInstitutions",
      }) as string[];

      const results: InstitutionData[] = [];
      for (const addr of addrs) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = await (publicClient as any).readContract({
            address: instAddr, abi: INSTITUTION_REGISTRY_ABI,
            functionName: "getInstitution", args: [addr as `0x${string}`],
          }) as any;
          results.push({
            address:      addr,
            name:         (raw.name ?? raw[0]) as string,
            domain:       (raw.domain ?? raw[1]) as string,
            country:      (raw.country ?? raw[2]) as string,
            website:      (raw.website ?? raw[3]) as string,
            isVerified:   Boolean(raw.isVerified ?? raw[7]),
            isSlashed:    Boolean(raw.isSlashed  ?? raw[8]),
            stakedAmount: BigInt(raw.stakedAmount ?? raw[5] ?? 0),
            registeredAt: BigInt(raw.registeredAt ?? raw[6] ?? 0),
          });
        } catch { /* skip */ }
      }
      setInstitutions(results);
    } catch { /* ignore */ }
    setInstLoading(false);
  }, [publicClient, instAddr]);

  useEffect(() => {
    if (isMember && isManualDeployed) loadRequests();
  }, [isMember, isManualDeployed, loadRequests]);

  useEffect(() => {
    if (isMember && tab === "all") {
      // customDate → convert to Unix timestamp
      const customFrom = customDate ? new Date(customDate).getTime() / 1000 : undefined;
      loadRevokeActivity(customDate ? "custom" : daysFilter, customFrom);
    }
  }, [isMember, tab, daysFilter, customDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isMember && tab === "institutions") loadInstitutions();
  }, [isMember, tab, loadInstitutions]);

  const { writeContract: doApproveW, data: approveHash, error: approveError, reset: approveReset } = useWriteContract();
  const { writeContract: doRejectW,  data: rejectHash,  error: rejectError,  reset: rejectReset  } = useWriteContract();
  const { writeContract: doVerifyInstW,  data: verifyInstHash  } = useWriteContract();
  const { writeContract: doSlashInstW,   data: slashInstHash   } = useWriteContract();
  const { writeContract: doRejectInstW,  data: rejectInstHash  } = useWriteContract();
  const { writeContract: doRevokeInstW,  data: revokeInstHash  } = useWriteContract();
  const { writeContract: doRevokeCredW,  data: revokeCredHash,  isPending: revokeCredPending,  error: revokeCredError,  reset: revokeCredReset  } = useWriteContract();
  // Separate hook for auto-revoke triggered after reject confirms (keeps manual revoke UI clean)
  const { writeContract: doAutoRevokeW,  data: autoRevokeHash  } = useWriteContract();
  const { writeContract: doAddVerW,           data: addVerHash,           isPending: addVerPending           } = useWriteContract();
  const { writeContract: doRemoveVerW,        data: removeVerHash,        isPending: removeVerPending        } = useWriteContract();
  const { writeContract: doSetQieusdW,        data: setQieusdHash,        isPending: setQieusdPending,       error: setQieusdError,    reset: setQieusdReset    } = useWriteContract();
  const { writeContract: doSetStakeW,         data: setStakeHash,         isPending: setStakePending,        error: setStakeError,     reset: setStakeReset     } = useWriteContract();
  const { writeContract: doAddInstAdminW,     data: addInstAdminHash,     isPending: addInstAdminPending     } = useWriteContract();
  const { writeContract: doRemoveInstAdminW,  data: removeInstAdminHash,  isPending: removeInstAdminPending  } = useWriteContract();

  const { isSuccess: approveOk    } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isSuccess: rejectOk     } = useWaitForTransactionReceipt({ hash: rejectHash });
  const { isSuccess: verifyInstOk  } = useWaitForTransactionReceipt({ hash: verifyInstHash  });
  const { isSuccess: slashInstOk   } = useWaitForTransactionReceipt({ hash: slashInstHash   });
  const { isSuccess: rejectInstOk  } = useWaitForTransactionReceipt({ hash: rejectInstHash  });
  const { isSuccess: revokeInstOk  } = useWaitForTransactionReceipt({ hash: revokeInstHash  });
  const { isSuccess: revokeCredOk,  isLoading: revokeCredWaiting  } = useWaitForTransactionReceipt({ hash: revokeCredHash });
  const { isSuccess: autoRevokeOk                                  } = useWaitForTransactionReceipt({ hash: autoRevokeHash });
  const { isSuccess: addVerOk         } = useWaitForTransactionReceipt({ hash: addVerHash         });
  const { isSuccess: removeVerOk      } = useWaitForTransactionReceipt({ hash: removeVerHash      });
  const { isSuccess: addInstAdminOk   } = useWaitForTransactionReceipt({ hash: addInstAdminHash   });
  const { isSuccess: removeInstAdminOk} = useWaitForTransactionReceipt({ hash: removeInstAdminHash});
  const { isSuccess: setQieusdOk,  isLoading: setQieusdWaiting  } = useWaitForTransactionReceipt({ hash: setQieusdHash });
  const { isSuccess: setStakeOk,   isLoading: setStakeWaiting   } = useWaitForTransactionReceipt({ hash: setStakeHash });

  useEffect(() => {
    if (approveOk) {
      if (typeof window !== "undefined") {
        Object.keys(sessionStorage).filter((k) => k.startsWith("vc:admin:reqs:")).forEach((k) => sessionStorage.removeItem(k));
      }
      loadRequests(); setActionStates({}); refetchCount();
    }
  }, [approveOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset stuck "Approving..." / "Rejecting..." state when tx errors
  useEffect(() => {
    if (approveError) {
      setActionStates({});
      approveReset();
      console.error("[admin] approveRequest error:", approveError);
    }
  }, [approveError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rejectError) {
      setActionStates({});
      rejectReset();
      console.error("[admin] rejectRequest error:", rejectError);
    }
  }, [rejectError]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (rejectOk && autoRevokeQueue) {
      // Phase 2 — auto-revoke the credential on CredentialRegistry.
      // Switch UI to "revoking" state so the button shows progress.
      setActionStates((s) => {
        const next = { ...s };
        Object.keys(next).forEach((k) => { if (next[+k] === "rejecting") next[+k] = "revoking"; });
        return next;
      });
      (doAutoRevokeW as any)({
        address:      credAddr,
        abi:          CREDENTIAL_REGISTRY_ABI,
        functionName: "revokeCredential",
        args:         [autoRevokeQueue.credentialId as `0x${string}`, `Verification rejected: ${autoRevokeQueue.reason}`],
      });
      setAutoRevokeQueue(null);
    }
  }, [rejectOk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Auto-revoke tx confirmed — now reload everything and clear states
    if (autoRevokeOk) {
      if (typeof window !== "undefined") {
        Object.keys(sessionStorage).filter((k) => k.startsWith("vc:admin:reqs:")).forEach((k) => sessionStorage.removeItem(k));
      }
      loadRequests(); setActionStates({}); refetchCount();
      const customFrom = customDate ? new Date(customDate).getTime() / 1000 : undefined;
      loadRevokeActivity(customDate ? "custom" : daysFilter, customFrom);
    }
  }, [autoRevokeOk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (verifyInstOk || slashInstOk || rejectInstOk || revokeInstOk) {
      loadInstitutions();
      setVerifyStates({}); setSlashStates({});   setSlashReasons({});
      setRejectInstStates({}); setRejectInstReasons({});
      setRevokeInstStates({}); setRevokeInstReasons({});
    }
  }, [verifyInstOk, slashInstOk, rejectInstOk, revokeInstOk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (revokeCredOk) {
      setRevokeId(""); setRevokeReason(""); setRevokeErr("");
      const customFrom = customDate ? new Date(customDate).getTime() / 1000 : undefined;
      loadRevokeActivity(customDate ? "custom" : daysFilter, customFrom);
    }
  }, [revokeCredOk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (addVerOk || removeVerOk) { refetchVerifiers(); setNewVerifierInput(""); setVerifierErr(""); }
  }, [addVerOk, removeVerOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (addInstAdminOk) {
      const addr = instAdminInput.trim();
      setInstAdminList((l) => l.includes(addr.toLowerCase()) ? l : [...l, addr]);
      setInstAdminInput(""); setInstAdminErr("");
    }
  }, [addInstAdminOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (removeInstAdminOk) { setInstAdminErr(""); }
  }, [removeInstAdminOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (setQieusdOk) { refetchQieusdAddr(); setQieusdInput(""); setQieusdErr(""); }
  }, [setQieusdOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (setStakeOk) { refetchStakeAmount(); setStakeInput(""); setQieusdErr(""); }
  }, [setStakeOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // network before sending transactions. Without this the wallet shows the tx
  // but gas is never deducted and the tx silently drops.
  async function handleApprove(reqId: number) {
    if (!await ensureChain()) return;
    setActionStates((s) => ({ ...s, [reqId]: "approving" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doApproveW as any)({ address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "approveRequest", args: [BigInt(reqId), approveNote[reqId] ?? ""] });
  }
  async function handleReject(reqId: number) {
    const reason = rejectReason[reqId] ?? "";
    if (!reason.trim()) return;
    if (!await ensureChain()) return;

    // Queue auto-revoke: after reject tx confirms, revokeCredential fires automatically
    const req = requests.find((r) => r.id === reqId);
    if (req?.credentialId) {
      setAutoRevokeQueue({ credentialId: req.credentialId, reason: reason.trim() });
    }

    setActionStates((s) => ({ ...s, [reqId]: "rejecting" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRejectW as any)({ address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "rejectRequest", args: [BigInt(reqId), reason.trim()] });
  }
  async function handleVerifyInst(addr: string) {
    if (!await ensureChain()) return;
    setVerifyStates((s) => ({ ...s, [addr]: "loading" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doVerifyInstW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "verifyInstitution", args: [addr as `0x${string}`] });
  }
  async function handleSlashInst(addr: string) {
    const reason = slashReasons[addr] ?? "";
    if (!reason.trim()) return;
    if (!await ensureChain()) return;
    setSlashStates((s) => ({ ...s, [addr]: "loading" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doSlashInstW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "slashInstitution", args: [addr as `0x${string}`, reason.trim()] });
  }
  async function handleRejectInst(addr: string) {
    if (!await ensureChain()) return;
    setRejectInstStates((s) => ({ ...s, [addr]: "loading" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRejectInstW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "rejectInstitution", args: [addr as `0x${string}`] });
  }
  async function handleRevokeInst(addr: string) {
    const reason = revokeInstReasons[addr] ?? "";
    if (!reason.trim()) return;
    if (!await ensureChain()) return;
    setRevokeInstStates((s) => ({ ...s, [addr]: "loading" }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRevokeInstW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "revokeInstitution", args: [addr as `0x${string}`, reason.trim()] });
  }
  async function handleRevokeCred() {
    const id = revokeId.trim();
    const reason = revokeReason.trim();
    setRevokeErr(""); revokeCredReset();
    if (!id.startsWith("0x") || id.length !== 66) { setRevokeErr("Enter a valid bytes32 credential ID (0x + 64 hex chars)"); return; }
    if (!reason) { setRevokeErr("Revocation reason is required"); return; }
    if (!await ensureChain()) { setRevokeErr("Switch to QIE network in your wallet first"); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRevokeCredW as any)({ address: credAddr, abi: CREDENTIAL_REGISTRY_ABI, functionName: "revokeCredential", args: [id as `0x${string}`, reason] });
  }
  async function handleAddInstAdmin() {
    const v = instAdminInput.trim();
    if (!v.startsWith("0x") || v.length !== 42) { setInstAdminErr("Enter a valid Ethereum address (0x…)"); return; }
    setInstAdminErr("");
    if (!await ensureChain()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doAddInstAdminW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "addInstitutionAdmin", args: [v as `0x${string}`] });
  }
  async function handleRemoveInstAdmin(v: string) {
    if (!await ensureChain()) return;
    setInstAdminList((l) => l.filter((a) => a.toLowerCase() !== v.toLowerCase()));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRemoveInstAdminW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "removeInstitutionAdmin", args: [v as `0x${string}`] });
  }
  async function handleAddVerifier() {
    const v = newVerifierInput.trim();
    if (!v.startsWith("0x") || v.length !== 42) { setVerifierErr("Enter a valid Ethereum address (0x…)"); return; }
    setVerifierErr("");
    if (!await ensureChain()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doAddVerW as any)({ address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "addVerifier", args: [v as `0x${string}`] });
  }
  async function handleRemoveVerifier(v: string) {
    if (!await ensureChain()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRemoveVerW as any)({ address: manualAddr, abi: MANUAL_VERIFICATION_REGISTRY_ABI, functionName: "removeVerifier", args: [v as `0x${string}`] });
  }
  async function handleSetQieusd() {
    const addr = qieusdInput.trim();
    setQieusdErr(""); setQieusdReset();
    if (!addr.startsWith("0x") || addr.length !== 42) { setQieusdErr("Enter a valid Ethereum address (0x + 40 hex chars)"); return; }
    if (!await ensureChain()) { setQieusdErr("Switch to QIE network in your wallet first"); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doSetQieusdW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "setQieStableCoin", args: [addr as `0x${string}`] });
  }
  async function handleSetStakeAmount() {
    const raw = stakeInput.trim();
    setQieusdErr(""); setStakeReset();
    if (!raw || isNaN(parseFloat(raw)) || parseFloat(raw) < 0) { setQieusdErr("Enter a valid stake amount (e.g. 100 for 100 QIEUSD)"); return; }
    if (!await ensureChain()) { setQieusdErr("Switch to QIE network in your wallet first"); return; }
    // Convert human-readable QIEUSD → 18-decimal bigint
    const factor = BigInt(10 ** qieusdDecimals);
    const stakeWei = BigInt(Math.round(parseFloat(raw) * 1e6)) * (factor / BigInt(1e6));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doSetStakeW as any)({ address: instAddr, abi: INSTITUTION_REGISTRY_ABI, functionName: "setStakeAmount", args: [stakeWei] });
  }

  const pendingRequests = requests.filter((r) => r.status === 0);
  const pendingInst     = institutions.filter((i) => !i.isVerified && !i.isSlashed);
  const verifiedInst    = institutions.filter((i) =>  i.isVerified && !i.isSlashed);
  const slashedInst     = institutions.filter((i) =>  i.isSlashed);

  const revokedCredIds = useMemo(
    () => new Set(revokeActivity.map((a) => a.credentialId.toLowerCase())),
    [revokeActivity]
  );

  // Date cutoff for client-side request filtering
  const dateCutoffTs = useMemo(() => {
    if (customDate) return new Date(customDate).getTime() / 1000;
    if (daysFilter === null) return 0;
    return Date.now() / 1000 - daysFilter * 86400;
  }, [daysFilter, customDate]);

  // Build combined activity list (sorted newest first)
  const combinedActivity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    // Requests filtered by activity type + date
    const dateReqs = requests.filter((r) => r.submittedAt >= dateCutoffTs);
    const typeReqs =
      activityFilter === "byteam"
        ? dateReqs.filter((r) => r.status !== 0 && r.reviewedBy !== NULL_ADDRESS && r.reviewedBy.toLowerCase() !== ownerAddr.toLowerCase())
        : activityFilter === "revocations"
        ? []
        : dateReqs;

    for (const req of typeReqs) items.push({ kind: "request", ts: req.submittedAt, req });

    // Revocations (already date-filtered by block range in loadRevokeActivity)
    if (activityFilter !== "verif" && activityFilter !== "byteam") {
      for (const rev of revokeActivity) items.push({ kind: "revocation", ts: rev.timestamp, rev });
    }

    items.sort((a, b) => b.ts - a.ts);
    return items;
  }, [requests, revokeActivity, activityFilter, dateCutoffTs, ownerAddr]);

  const totalActPages = Math.ceil(combinedActivity.length / ACTIVITY_PAGE_SZ);
  const pagedActivity = combinedActivity.slice(
    (actPage - 1) * ACTIVITY_PAGE_SZ,
    actPage * ACTIVITY_PAGE_SZ
  );

  // Reset to page 1 when filter changes
  useEffect(() => { setActPage(1); }, [activityFilter, daysFilter, customDate]);

  const tabs: AdminTab[] = isOwner
    ? ["pending", "all", "institutions", "credentials", "team"]
    : ["pending", "all", "institutions"];

  const tabLabel: Record<AdminTab, string> = {
    pending:      `⏳ Pending (${pendingRequests.length})`,
    all:          "📋 All Activity",
    institutions: `🏛️ Institutions (${institutions.length})`,
    credentials:  "📄 Revoke Credential",
    team:         "👥 Team",
  };

  if (!isManualDeployed) {
    return (
      <div className="min-h-screen" style={{ background: "#020817" }}>
        <Navbar />
        <div className="pt-16 flex items-center justify-center min-h-screen px-6">
          <div className="glass rounded-3xl p-12 text-center max-w-md border-amber-500/20"
            style={{ background: "rgba(245,158,11,0.05)" }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, fontSize: 32, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>⚙️</div>
            <h2 className="text-white font-bold text-xl mb-2">Contract Not Deployed</h2>
            <p className="text-white/40 text-sm leading-relaxed">
              Run <code className="text-amber-400">deployManualVerification.js</code> and update{" "}
              <code className="text-amber-400 text-xs">NEXT_PUBLIC_MANUAL_VERIFICATION_REGISTRY</code> in <code className="text-amber-400 text-xs">.env.local</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (!mounted) return <div className="min-h-screen" style={{ background: "#020817" }}><Navbar /></div>;

  if (!isConnected) {
    return (
      <div className="min-h-screen" style={{ background: "#020817" }}>
        <Navbar />
        <div className="pt-16">
          <ConnectWalletPrompt
            title="Connect Your Wallet"
            description="Connect to access the admin dashboard."
          />
        </div>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="min-h-screen" style={{ background: "#020817" }}>
        <Navbar />
        <div className="pt-16 flex items-center justify-center min-h-screen px-6">
          <div className="glass rounded-3xl p-12 text-center max-w-md border-red-500/20" style={{ background: "rgba(239,68,68,0.05)" }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, fontSize: 32, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>🔒</div>
            <h2 className="text-white font-bold text-xl mb-2">Access Denied</h2>
            <p className="text-white/40 text-sm mb-3 leading-relaxed">This area is restricted to VeridiChain team members.</p>
            <p className="text-white/25 text-xs font-mono break-all">{address}</p>
            <button onClick={() => disconnect()} className="mt-6 glass glass-hover text-white/60 hover:text-white px-6 py-2 rounded-xl text-sm font-semibold transition-all">Disconnect</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      <Navbar />

      {/* Header */}
      <div className="pt-16 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.14) 0%, transparent 60%)" }} />
        <div className="max-w-6xl mx-auto px-6 py-12 relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-6">
            <div>
              <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 mb-4 border-indigo-500/20">
                <span>🔍</span>
                <span className="text-indigo-400 text-sm font-medium">Admin Dashboard</span>
                {isOwner && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold">Owner</span>}
              </div>
              <h1 className="text-4xl font-black text-white mb-2">Admin Control Panel</h1>
              <p className="text-white/40">Manage verifications, institutions, credentials and team members</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              {[
                { label: "Pending Verif.", value: pendingRequests.length, c: "#f59e0b" },
                { label: "Pending Inst.",  value: pendingInst.length,     c: "#0ea5e9" },
                { label: "Revocations",    value: revokeActivity.length,  c: "#ef4444" },
                { label: "Total Requests", value: requests.length,        c: "#6366f1" },
              ].map(({ label, value, c }) => (
                <div key={label} className="glass rounded-2xl px-5 py-3 text-center min-w-[90px]">
                  <p className="text-2xl font-black" style={{ color: c }}>{value}</p>
                  <p className="text-white/35 text-xs">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 pb-24">

        {/* Tabs */}
        <div className="flex flex-wrap w-full gap-2 mb-8 glass rounded-2xl p-1.5">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${tab === t ? "text-white" : "text-white/40 hover:text-white/70"}`}
              style={tab === t ? { background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 4px 14px rgba(99,102,241,0.3)" } : {}}>
              {tabLabel[t]}
            </button>
          ))}
        </div>

        {/* ══ PENDING TAB ══ */}
        {tab === "pending" && (
          reqLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
          ) : pendingRequests.length === 0 ? (
            <div className="glass rounded-3xl p-16 text-center">
              <div style={{ width: 72, height: 72, borderRadius: 20, fontSize: 32, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>📭</div>
              <h3 className="text-white font-bold text-xl mb-2">No Pending Requests</h3>
              <p className="text-white/40 text-sm">All verification requests have been reviewed.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {pendingRequests.map((req) => (
                <RequestCard key={req.id} req={req} showActions
                  approveNote={approveNote[req.id] ?? ""} rejectReason={rejectReason[req.id] ?? ""}
                  onApproveNoteChange={(v) => setApproveNote((s) => ({ ...s, [req.id]: v }))}
                  onRejectReasonChange={(v) => setRejectReason((s) => ({ ...s, [req.id]: v }))}
                  onApprove={() => handleApprove(req.id)} onReject={() => handleReject(req.id)}
                  actionState={actionStates[req.id] ?? "idle"}
                  isCredentialRevoked={revokedCredIds.has(req.credentialId.toLowerCase())} />
              ))}
            </div>
          )
        )}

        {/* ══ ALL ACTIVITY TAB ══ */}
        {tab === "all" && (
          <div className="space-y-5">

            {}
            <div className="glass rounded-2xl p-4 space-y-3">
              {/* Row 1: date presets */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-white/30 text-xs font-semibold uppercase tracking-wider shrink-0">Date range</span>
                {([1, 7, 30, 90, null] as DaysFilter[]).map((d) => {
                  const label = d === 1 ? "Today" : d === null ? "All time" : `${d}d`;
                  const active = !customDate && daysFilter === d;
                  return (
                    <button key={String(d)} onClick={() => { setDaysFilter(d); setCustomDate(""); }}
                      className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${active ? "text-white" : "text-white/40 hover:text-white/70 border border-white/[0.06]"}`}
                      style={active ? { background: "linear-gradient(135deg,#6366f1,#4f46e5)", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" } : {}}>
                      {label}
                    </button>
                  );
                })}
                {/* Custom date */}
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-white/25 text-xs">From date:</span>
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => { setCustomDate(e.target.value); }}
                    className="input-field rounded-xl px-3 py-1.5 text-white text-xs font-mono"
                    style={{ colorScheme: "dark", width: 140 }}
                  />
                  {customDate && (
                    <button onClick={() => setCustomDate("")} className="text-white/30 hover:text-white/70 text-xs transition-colors">✕</button>
                  )}
                </div>
              </div>

              {/* Row 2: activity type + refresh */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.05]">
                <div className="flex flex-wrap gap-2">
                  {(["all", "verif", "revocations", "byteam"] as ActivityFilter[]).map((f) => {
                    const labels: Record<ActivityFilter, string> = {
                      all: "All Types", verif: "Verifications", revocations: "Revocations", byteam: "By Team",
                    };
                    return (
                      <button key={f} onClick={() => setActivityFilter(f)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                          activityFilter === f ? "text-white bg-white/10 border border-white/20" : "text-white/35 hover:text-white/60"
                        }`}>
                        {labels[f]}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  {(reqLoading || revokeFetching) && (
                    <div className="flex items-center gap-1.5 text-white/30 text-xs">
                      <span className="inline-block w-3 h-3 border border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />
                      Loading…
                    </div>
                  )}
                  <button
                    onClick={() => {
                      // Bust session cache and reload
                      if (typeof window !== "undefined") {
                        Object.keys(sessionStorage)
                          .filter((k) => k.startsWith("vc:admin:reqs:"))
                          .forEach((k) => sessionStorage.removeItem(k));
                      }
                      loadRequests();
                      const cf = customDate ? new Date(customDate).getTime() / 1000 : undefined;
                      loadRevokeActivity(customDate ? "custom" : daysFilter, cf);
                    }}
                    disabled={reqLoading || revokeFetching}
                    className="glass glass-hover text-white/50 hover:text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-40 flex items-center gap-1.5">
                    🔄 Refresh
                  </button>
                </div>
              </div>
            </div>

            {/* Speed hint */}
            {daysFilter !== null && !customDate && (
              <p className="text-white/20 text-xs px-1">
                ⚡ Fetching last {daysFilter === 1 ? "24 hours" : `${daysFilter} days`} of on-chain data only — switch to &quot;All time&quot; for full history.
              </p>
            )}

            {/* "By team" hint */}
            {activityFilter === "byteam" && (
              <div className="rounded-xl px-4 py-3 border border-indigo-500/20 flex items-center gap-3" style={{ background: "rgba(99,102,241,0.06)" }}>
                <span>👥</span>
                <p className="text-indigo-300/70 text-xs">Showing only actions performed by team verifiers (not the owner).</p>
              </div>
            )}

            {/* Empty */}
            {!reqLoading && !revokeFetching && combinedActivity.length === 0 && (
              <div className="glass rounded-3xl p-16 text-center">
                <div style={{ width: 72, height: 72, borderRadius: 20, fontSize: 32, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>📭</div>
                <h3 className="text-white font-bold text-xl mb-2">No Activity Found</h3>
                <p className="text-white/40 text-sm">
                  {daysFilter !== null ? `No activity in the last ${daysFilter === 1 ? "24 hours" : `${daysFilter} days`}. Try a wider date range.` : "No activity recorded yet."}
                </p>
              </div>
            )}

            {/* Results summary */}
            {combinedActivity.length > 0 && (
              <div className="flex items-center justify-between px-1">
                <p className="text-white/30 text-sm">
                  Showing{" "}
                  <span className="text-white/60 font-semibold">
                    {Math.min((actPage - 1) * ACTIVITY_PAGE_SZ + 1, combinedActivity.length)}–{Math.min(actPage * ACTIVITY_PAGE_SZ, combinedActivity.length)}
                  </span>{" "}
                  of <span className="text-white/60 font-semibold">{combinedActivity.length}</span>{" "}
                  events (newest first)
                </p>
                {(reqLoading || revokeFetching) && (
                  <span className="text-white/20 text-xs">updating…</span>
                )}
              </div>
            )}

            {/* Activity grid */}
            {pagedActivity.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {pagedActivity.map((item, i) =>
                  item.kind === "request" ? (
                    <RequestCard key={`req-${item.req.id}`} req={item.req} showActions={item.req.status === 0}
                      approveNote={approveNote[item.req.id] ?? ""} rejectReason={rejectReason[item.req.id] ?? ""}
                      onApproveNoteChange={(v) => setApproveNote((s) => ({ ...s, [item.req.id]: v }))}
                      onRejectReasonChange={(v) => setRejectReason((s) => ({ ...s, [item.req.id]: v }))}
                      onApprove={() => handleApprove(item.req.id)} onReject={() => handleReject(item.req.id)}
                      actionState={actionStates[item.req.id] ?? "idle"}
                      isCredentialRevoked={revokedCredIds.has(item.req.credentialId.toLowerCase())} />
                  ) : (
                    <RevokeActivityCard key={`rev-${i}`} act={item.rev} />
                  )
                )}
              </div>
            )}

            {/* Pagination */}
            <PageNav page={actPage} total={totalActPages} onChange={(p) => { setActPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          </div>
        )}

        {/* ══ INSTITUTIONS TAB ══ */}
        {tab === "institutions" && (
          <div className="space-y-8">
            <div className="flex justify-end">
              <button onClick={loadInstitutions} disabled={instLoading}
                className="glass glass-hover text-white/50 hover:text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2">
                🔄 {instLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {}
            {isOwner && (
              <div className="glass rounded-3xl p-6 space-y-5" style={{ borderColor: "rgba(14,165,233,0.15)" }}>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-xl">🪙</span>
                  <div>
                    <h3 className="text-white font-bold text-base">QIEUSD Staking Config</h3>
                    <p className="text-white/35 text-xs mt-0.5">Set stablecoin address and required stake for institution registration</p>
                  </div>
                </div>

                {/* Current state display */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="glass rounded-xl px-4 py-3">
                    <p className="text-white/30 text-xs mb-1">Current QIEUSD Address</p>
                    <p className={`text-xs font-mono font-medium break-all ${
                      currentQieusdAddr && currentQieusdAddr !== NULL_ADDRESS ? "text-green-400" : "text-white/25"
                    }`}>
                      {currentQieusdAddr && currentQieusdAddr !== NULL_ADDRESS ? currentQieusdAddr : "Not set (zero address)"}
                    </p>
                  </div>
                  <div className="glass rounded-xl px-4 py-3">
                    <p className="text-white/30 text-xs mb-1">Current Stake Requirement</p>
                    <p className={`text-sm font-bold ${currentStakeAmount > 0n ? "text-sky-400" : "text-white/25"}`}>
                      {currentStakeAmount > 0n
                        ? `${parseFloat((Number(currentStakeAmount) / 10 ** qieusdDecimals).toFixed(4)).toLocaleString()} QIEUSD`
                        : "0 (staking disabled)"}
                    </p>
                  </div>
                </div>

                {qieusdErr && (
                  <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                    <span>⚠️</span><p className="text-red-300 text-sm">{qieusdErr}</p>
                  </div>
                )}
                {(setQieusdOk || setStakeOk) && (
                  <div className="rounded-xl px-4 py-3 border border-green-500/25" style={{ background: "rgba(34,197,94,0.08)" }}>
                    <p className="text-green-400 text-sm font-semibold">✅ Contract updated successfully</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Set QIEUSD address */}
                  <div className="space-y-2">
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider">
                      QIEUSD Contract Address
                    </label>
                    <input
                      value={qieusdInput} onChange={(e) => setQieusdInput(e.target.value)}
                      placeholder="0x..."
                      className="input-field w-full rounded-xl px-4 py-2.5 text-white placeholder-white/20 text-sm font-mono"
                    />
                    <p className="text-white/20 text-xs">Get from QIE team or mainnet explorer</p>
                    {setQieusdError && <p className="text-red-400/70 text-xs break-all">{(setQieusdError as any)?.shortMessage || (setQieusdError as any)?.message}</p>}
                    <button
                      onClick={handleSetQieusd}
                      disabled={setQieusdPending || setQieusdWaiting || !qieusdInput.trim()}
                      className="w-full text-white py-2.5 rounded-xl font-semibold text-sm border border-sky-500/30 hover:border-sky-500/50 transition-all"
                      style={{ background: "rgba(14,165,233,0.12)", opacity: !qieusdInput.trim() ? 0.5 : 1 }}>
                      {setQieusdPending ? "📱 Confirm…" : setQieusdWaiting ? "⏳ Setting…" : "Set QIEUSD Address"}
                    </button>
                  </div>

                  {/* Set stake amount */}
                  <div className="space-y-2">
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider">
                      Stake Amount (QIEUSD)
                    </label>
                    <input
                      value={stakeInput} onChange={(e) => setStakeInput(e.target.value)}
                      placeholder="e.g. 100"
                      type="number" min="0"
                      className="input-field w-full rounded-xl px-4 py-2.5 text-white placeholder-white/20 text-sm"
                    />
                    <p className="text-white/20 text-xs">Set 0 to disable staking requirement</p>
                    {setStakeError && <p className="text-red-400/70 text-xs break-all">{(setStakeError as any)?.shortMessage || (setStakeError as any)?.message}</p>}
                    <button
                      onClick={handleSetStakeAmount}
                      disabled={setStakePending || setStakeWaiting || !stakeInput.trim()}
                      className="w-full text-white py-2.5 rounded-xl font-semibold text-sm border border-sky-500/30 hover:border-sky-500/50 transition-all"
                      style={{ background: "rgba(14,165,233,0.12)", opacity: !stakeInput.trim() ? 0.5 : 1 }}>
                      {setStakePending ? "📱 Confirm…" : setStakeWaiting ? "⏳ Setting…" : "Set Stake Amount"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {instLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
            ) : institutions.length === 0 ? (
              <div className="glass rounded-3xl p-16 text-center">
                <div style={{ width: 72, height: 72, borderRadius: 20, fontSize: 32, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>🏛️</div>
                <h3 className="text-white font-bold text-xl mb-2">No Institutions Registered</h3>
                <p className="text-white/40 text-sm">No institutions have registered yet.</p>
              </div>
            ) : (
              <>
                {pendingInst.length > 0 && (
                  <section>
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-white font-bold text-lg">⏳ Pending Approval</h2>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-semibold">{pendingInst.length}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {pendingInst.map((inst) => (
                        <InstitutionCard key={inst.address} inst={inst}
                          slashReason={slashReasons[inst.address] ?? ""}      onSlashReasonChange={(v) => setSlashReasons((s) => ({ ...s, [inst.address]: v }))}
                          rejectReason={rejectInstReasons[inst.address] ?? ""} onRejectReasonChange={(v) => setRejectInstReasons((s) => ({ ...s, [inst.address]: v }))}
                          revokeInstReason={revokeInstReasons[inst.address] ?? ""} onRevokeInstReasonChange={(v) => setRevokeInstReasons((s) => ({ ...s, [inst.address]: v }))}
                          onVerify={() => handleVerifyInst(inst.address)}
                          onSlash={() => handleSlashInst(inst.address)}
                          onReject={() => handleRejectInst(inst.address)}
                          onRevokeInst={() => handleRevokeInst(inst.address)}
                          verifyState={verifyStates[inst.address] ?? "idle"}
                          slashState={slashStates[inst.address] ?? "idle"}
                          rejectState={rejectInstStates[inst.address] ?? "idle"}
                          revokeInstState={revokeInstStates[inst.address] ?? "idle"} />
                      ))}
                    </div>
                  </section>
                )}
                {verifiedInst.length > 0 && (
                  <section>
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-white font-bold text-lg">✅ Verified Institutions</h2>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 font-semibold">{verifiedInst.length}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {verifiedInst.map((inst) => (
                        <InstitutionCard key={inst.address} inst={inst}
                          slashReason={slashReasons[inst.address] ?? ""}      onSlashReasonChange={(v) => setSlashReasons((s) => ({ ...s, [inst.address]: v }))}
                          rejectReason={rejectInstReasons[inst.address] ?? ""} onRejectReasonChange={(v) => setRejectInstReasons((s) => ({ ...s, [inst.address]: v }))}
                          revokeInstReason={revokeInstReasons[inst.address] ?? ""} onRevokeInstReasonChange={(v) => setRevokeInstReasons((s) => ({ ...s, [inst.address]: v }))}
                          onVerify={() => handleVerifyInst(inst.address)}
                          onSlash={() => handleSlashInst(inst.address)}
                          onReject={() => handleRejectInst(inst.address)}
                          onRevokeInst={() => handleRevokeInst(inst.address)}
                          verifyState={verifyStates[inst.address] ?? "idle"}
                          slashState={slashStates[inst.address] ?? "idle"}
                          rejectState={rejectInstStates[inst.address] ?? "idle"}
                          revokeInstState={revokeInstStates[inst.address] ?? "idle"} />
                      ))}
                    </div>
                  </section>
                )}
                {slashedInst.length > 0 && (
                  <section>
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-white font-bold text-lg">🚫 Slashed</h2>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20 font-semibold">{slashedInst.length}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {slashedInst.map((inst) => (
                        <InstitutionCard key={inst.address} inst={inst}
                          slashReason={slashReasons[inst.address] ?? ""}      onSlashReasonChange={(v) => setSlashReasons((s) => ({ ...s, [inst.address]: v }))}
                          rejectReason={rejectInstReasons[inst.address] ?? ""} onRejectReasonChange={(v) => setRejectInstReasons((s) => ({ ...s, [inst.address]: v }))}
                          revokeInstReason={revokeInstReasons[inst.address] ?? ""} onRevokeInstReasonChange={(v) => setRevokeInstReasons((s) => ({ ...s, [inst.address]: v }))}
                          onVerify={() => handleVerifyInst(inst.address)}
                          onSlash={() => handleSlashInst(inst.address)}
                          onReject={() => handleRejectInst(inst.address)}
                          onRevokeInst={() => handleRevokeInst(inst.address)}
                          verifyState={verifyStates[inst.address] ?? "idle"}
                          slashState={slashStates[inst.address] ?? "idle"}
                          rejectState={rejectInstStates[inst.address] ?? "idle"}
                          revokeInstState={revokeInstStates[inst.address] ?? "idle"} />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* ══ REVOKE CREDENTIAL TAB ══ */}
        {tab === "credentials" && isOwner && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass rounded-3xl p-8 space-y-5 border-red-500/10">
              <div>
                <h2 className="text-white font-bold text-xl mb-1">Revoke Any Credential</h2>
                <p className="text-white/40 text-sm leading-relaxed">As admin you can revoke any credential on-chain. This is permanent and irreversible.</p>
              </div>
              <div className="rounded-xl px-4 py-3 border border-amber-500/20" style={{ background: "rgba(245,158,11,0.07)" }}>
                <p className="text-amber-300/80 text-xs font-semibold mb-1">⚠️ Irreversible Action</p>
                <p className="text-amber-300/50 text-xs leading-relaxed">Revoking a credential permanently invalidates it on-chain.</p>
              </div>
              <div>
                <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">Credential ID (bytes32)</label>
                <input value={revokeId} onChange={(e) => setRevokeId(e.target.value)}
                  placeholder="0xe6442ca7bfbc25b071324dcf4bfe2301c38cdfc..."
                  className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono" />
                <p className="text-white/25 text-xs mt-1.5">Paste the 0x-prefixed 66-character credential ID</p>
              </div>
              <div>
                <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">Revocation Reason <span className="text-red-400/60">*</span></label>
                <textarea value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g. Fraudulent credential — institution reported fake degree issuance" rows={3}
                  className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm resize-none" />
              </div>
              {revokeErr && <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25"><span>⚠️</span><p className="text-red-300 text-sm">{revokeErr}</p></div>}
              {revokeCredError && <div className="glass rounded-xl px-4 py-3 border border-red-500/25"><p className="text-red-300 text-sm">{(revokeCredError as any)?.shortMessage || (revokeCredError as any)?.message}</p></div>}
              {revokeCredOk && <div className="rounded-xl px-4 py-3 border border-green-500/20" style={{ background: "rgba(34,197,94,0.08)" }}><p className="text-green-400 text-sm font-semibold">✅ Credential revoked on-chain</p><p className="text-green-400/50 text-xs mt-0.5">It will appear in All Activity → Revocations.</p></div>}
              {revokeCredPending ? (
                <div className="w-full py-3.5 rounded-2xl text-center text-sm font-semibold text-white/60 border border-white/10" style={{ background: "rgba(255,255,255,0.04)" }}>📱 Confirm in wallet…</div>
              ) : revokeCredWaiting ? (
                <div className="w-full py-3.5 rounded-2xl text-center text-sm font-semibold text-white/60 border border-white/10 flex items-center justify-center gap-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <span className="inline-block w-3 h-3 border-2 border-red-400/40 border-t-red-400 rounded-full animate-spin" />Revoking on-chain…
                </div>
              ) : (
                <button onClick={handleRevokeCred} className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-all"
                  style={{ background: "linear-gradient(135deg,#dc2626,#9f1239)", boxShadow: "0 8px 24px rgba(220,38,38,0.35)" }}>
                  🚫 Revoke Credential
                </button>
              )}
            </div>
            <div className="space-y-4">
              <div className="glass rounded-3xl p-6 space-y-4">
                <h3 className="text-white font-bold text-base">When to revoke?</h3>
                {[
                  { icon: "🚨", title: "Fraudulent credential", desc: "Issuing institution confirmed the credential was fabricated." },
                  { icon: "📋", title: "Policy violation",      desc: "Credential issued in violation of platform terms." },
                  { icon: "⚖️", title: "Legal order",           desc: "Court or regulatory order requires removal." },
                  { icon: "🔄", title: "Superseded",            desc: "Credential was reissued to a new wallet — old one should be revoked." },
                ].map(({ icon, title, desc }) => (
                  <div key={title} className="flex gap-3 items-start">
                    <span className="text-xl mt-0.5">{icon}</span>
                    <div><p className="text-white/80 text-sm font-semibold">{title}</p><p className="text-white/35 text-xs leading-relaxed">{desc}</p></div>
                  </div>
                ))}
              </div>
              <div className="glass rounded-3xl p-6 border-indigo-500/10">
                <h3 className="text-white font-bold text-base mb-3">How to find a Credential ID</h3>
                <ol className="space-y-2 text-white/40 text-xs leading-relaxed list-decimal list-inside">
                  <li>Go to the Verify page</li><li>Search for the credential</li>
                  <li>Copy the Credential ID from the result</li><li>Paste it here</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* ══ TEAM TAB ══ */}
        {tab === "team" && isOwner && (
          <div className="space-y-6">

            {}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Verification team members (ManualVerificationRegistry) */}
              <div className="glass rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-white font-bold text-lg">Verification Team</h2>
                    <p className="text-white/30 text-xs mt-0.5">Approve / reject candidate verification requests</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 font-semibold">{verifierList.length + 1} members</span>
                </div>
                <div className="flex items-center justify-between glass rounded-xl px-4 py-3.5">
                  <div><p className="text-white/30 text-xs mb-0.5">Owner (You)</p><p className="text-sky-400 text-xs font-mono">{ownerAddr.slice(0,10)}…{ownerAddr.slice(-8)}</p></div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 font-semibold">👑 Owner</span>
                </div>
                {verifierList.length === 0 ? (
                  <div className="text-center py-4"><p className="text-white/25 text-sm">No additional verifiers added yet.</p></div>
                ) : verifierList.map((v) => (
                  <div key={v} className="flex items-center justify-between glass rounded-xl px-4 py-3.5">
                    <div><p className="text-white/30 text-xs mb-0.5">Verifier</p><p className="text-white/70 text-xs font-mono">{v.slice(0,10)}…{v.slice(-8)}</p></div>
                    <button onClick={() => handleRemoveVerifier(v)} disabled={removeVerPending}
                      className="text-xs px-3 py-1.5 rounded-lg border font-semibold transition-all border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40 disabled:opacity-40">
                      {removeVerPending ? "…" : "Remove"}
                    </button>
                  </div>
                ))}
                <div className="border-t border-white/[0.06] pt-3 space-y-2">
                  <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider">Add Verifier</label>
                  <input value={newVerifierInput} onChange={(e) => setNewVerifierInput(e.target.value)}
                    placeholder="0x..."
                    className="input-field w-full rounded-xl px-4 py-2.5 text-white placeholder-white/20 text-sm font-mono" />
                  {verifierErr && <p className="text-red-400 text-xs">{verifierErr}</p>}
                  {addVerPending ? (
                    <div className="w-full py-2.5 rounded-xl text-center text-sm font-semibold text-white/60 border border-white/10" style={{ background: "rgba(255,255,255,0.04)" }}>Confirm in wallet…</div>
                  ) : (
                    <button onClick={handleAddVerifier} className="w-full text-white py-2.5 rounded-xl font-semibold text-sm"
                      style={{ background: "linear-gradient(135deg,#6366f1,#4f46e5)" }}>
                      Add Verifier →
                    </button>
                  )}
                  {addVerOk && <p className="text-green-400 text-xs font-semibold">✅ Verifier added</p>}
                </div>
              </div>

              {/* Institution admins (InstitutionRegistry) */}
              <div className="glass rounded-3xl p-6 space-y-4" style={{ borderColor: "rgba(14,165,233,0.15)" }}>
                <div>
                  <h2 className="text-white font-bold text-lg">Institution Admins</h2>
                  <p className="text-white/30 text-xs mt-0.5">Can approve / reject / revoke institutions — <span className="text-red-400/70">cannot slash</span></p>
                </div>
                <div className="flex items-center justify-between glass rounded-xl px-4 py-3.5">
                  <div><p className="text-white/30 text-xs mb-0.5">Owner (always)</p><p className="text-sky-400 text-xs font-mono">{ownerAddr.slice(0,10)}…{ownerAddr.slice(-8)}</p></div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 font-semibold">👑 Owner</span>
                </div>
                {instAdminList.filter((a) => a.toLowerCase() !== ownerAddr.toLowerCase()).map((v) => (
                  <div key={v} className="flex items-center justify-between glass rounded-xl px-4 py-3.5">
                    <div>
                      <p className="text-white/30 text-xs mb-0.5">Institution Admin</p>
                      <p className="text-sky-300/70 text-xs font-mono">{v.slice(0,10)}…{v.slice(-8)}</p>
                    </div>
                    <button onClick={() => handleRemoveInstAdmin(v)} disabled={removeInstAdminPending}
                      className="text-xs px-3 py-1.5 rounded-lg border font-semibold transition-all border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40 disabled:opacity-40">
                      {removeInstAdminPending ? "…" : "Remove"}
                    </button>
                  </div>
                ))}
                {instAdminList.filter((a) => a.toLowerCase() !== ownerAddr.toLowerCase()).length === 0 && (
                  <div className="text-center py-4"><p className="text-white/25 text-sm">No institution admins added yet.</p></div>
                )}
                <div className="border-t border-white/[0.06] pt-3 space-y-2">
                  <label className="block text-white/40 text-xs font-semibold uppercase tracking-wider">Add Institution Admin</label>
                  <input value={instAdminInput} onChange={(e) => setInstAdminInput(e.target.value)}
                    placeholder="0x..."
                    className="input-field w-full rounded-xl px-4 py-2.5 text-white placeholder-white/20 text-sm font-mono" />
                  {instAdminErr && <p className="text-red-400 text-xs">{instAdminErr}</p>}
                  {addInstAdminPending ? (
                    <div className="w-full py-2.5 rounded-xl text-center text-sm font-semibold text-white/60 border border-white/10" style={{ background: "rgba(255,255,255,0.04)" }}>Confirm in wallet…</div>
                  ) : (
                    <button onClick={handleAddInstAdmin} className="w-full text-white py-2.5 rounded-xl font-semibold text-sm"
                      style={{ background: "linear-gradient(135deg,#0ea5e9,#0284c7)" }}>
                      Add Institution Admin →
                    </button>
                  )}
                  {addInstAdminOk && <p className="text-green-400 text-xs font-semibold">✅ Institution admin added</p>}
                  {removeInstAdminOk && <p className="text-amber-400 text-xs font-semibold">↩️ Admin removed</p>}
                </div>
              </div>
            </div>

            {}
            <div className="glass rounded-3xl p-6 max-w-sm">
              <h3 className="text-white font-bold text-base mb-3">Verification Fee</h3>
              <div className="glass rounded-xl px-4 py-3 mb-3">
                <p className="text-white/30 text-xs mb-1">Current Fee</p>
                <p className="text-white/80 text-sm font-mono font-semibold">{fee === 0n ? "Free (0 QIE)" : `${Number(fee) / 1e18} QIE`}</p>
              </div>
              <p className="text-white/25 text-xs leading-relaxed">Fee is charged per verification request. Collected fees can be withdrawn to the owner wallet.</p>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
