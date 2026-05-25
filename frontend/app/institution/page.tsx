"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  useAccount, useConnect, useDisconnect, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { qieTestnet } from "../../lib/wagmi";
import { Navbar } from "../../components/shared/Navbar";
import { useLang } from "../../lib/LangContext";
import { CONTRACTS, INSTITUTION_REGISTRY_ABI, CREDENTIAL_REGISTRY_ABI } from "../../lib/contracts";
import { useQIEPass } from "../../lib/useQIEPass";
import { QIEPassVerify } from "../../components/shared/QIEPassVerify";
import { showToast } from "../../lib/toast";

type Tab = "register" | "issue" | "upgrade" | "revoke";

function Field({ label, value, onChange, placeholder, hint }: {
  label: string; value: string;
  onChange: (v: string) => void;
  placeholder: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">{label}</label>
      <input
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
      />
      {hint && <p className="text-white/25 text-xs mt-1.5">{hint}</p>}
    </div>
  );
}

export default function InstitutionPage() {
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { tr } = useLang();
  const ins = tr.institution;

  const isWrongChain = isConnected && chainId !== qieTestnet.id;

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  /* ── QIE Pass — server-side verified (NOT localStorage) ─────────────────
   * Security: localStorage can be cleared via DevTools.
   * We verify directly against QIE Pass API on every wallet connect.
   * localStorage is used only as a fast initial hint; the server check
   * is the source of truth. If they diverge, server wins.
   * ─────────────────────────────────────────────────────────────────────── */
  const { hasPass, did: passDid, passConfigured } = useQIEPass(address);
  const [isQIEPassVerified,     setIsQIEPassVerified]     = useState(false);
  const [qiePassDid,            setQiePassDid]            = useState("");
  const [kycCheckLoading,       setKycCheckLoading]       = useState(false);
  /**
   * True when this wallet has already been verified as a CANDIDATE.
   * Candidate and institution are mutually exclusive — a wallet cannot hold both roles.
   * When true, registration is blocked regardless of what QIE Pass API returns.
   */
  const [isBlockedByRole,       setIsBlockedByRole]       = useState(false);

  useEffect(() => {
    if (!address) return;

    // ── Role conflict check — MUST run before any QIE verification ────────
    // If this wallet is already a verified CANDIDATE, block institution access.
    // The QIE Pass API is role-agnostic — it would return "verified" for a
    // candidate wallet too (same partner). We enforce role exclusivity here.
    try {
      const candidateRaw = localStorage.getItem(`qiepass:candidate:${address.toLowerCase()}`);
      if (candidateRaw) {
        const candidateParsed = JSON.parse(candidateRaw) as { verified?: boolean };
        if (candidateParsed?.verified) {
          setIsBlockedByRole(true);
          setIsQIEPassVerified(false);
          setKycCheckLoading(false);
          return; // Skip QIE API check entirely for conflicting wallets
        }
      }
    } catch { /* ignore */ }

    // ── Step 1: show localStorage hint immediately (fast UX) ─────────────
    try {
      const raw = localStorage.getItem(`qiepass:institution:${address.toLowerCase()}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { verified?: boolean; did?: string };
        if (parsed?.verified) {
          setIsQIEPassVerified(true);
          setQiePassDid(parsed.did ?? "");
        }
      }
    } catch { /* ignore */ }

    // ── Step 2: authoritative server-side check from QIE Pass API ─────────
    // Overrides localStorage — cannot be bypassed by clearing browser storage.
    // NOTE: QIE Pass API is role-agnostic (no candidate/institution distinction).
    //       The role conflict check above already blocked candidate wallets,
    //       so by this point we know the wallet is NOT a candidate.
    setKycCheckLoading(true);
    fetch(`/api/qiepass/institution-verify?wallet=${address.toLowerCase()}`)
      .then((r) => r.json())
      .then((data: { verified: boolean; did?: string | null }) => {
        if (data.verified) {
          setIsQIEPassVerified(true);
          if (data.did) setQiePassDid(data.did);
        } else {
          // Server says NOT verified — override any stale localStorage state
          setIsQIEPassVerified(false);
          setQiePassDid("");
        }
      })
      .catch(() => {
        // API error — fall back to localStorage hint (already set above)
        // Fail-open only on network error; not a security bypass
      })
      .finally(() => setKycCheckLoading(false));
  }, [address]);

  const [tab, setTab] = useState<Tab>("register");
  const [reg, setReg] = useState({ name: "", domain: "", country: "", website: "" });
  const [iss, setIss] = useState({ candidate: "", data: "", ipfsCID: "", candidatePassDid: "" });
  const [upg, setUpg] = useState({ credentialId: "" });
  const [lookupId, setLookupId] = useState<`0x${string}` | null>(null);
  const [rev, setRev] = useState({ credentialId: "" });
  const [revLookupId, setRevLookupId] = useState<`0x${string}` | null>(null);
  const [revReason, setRevReason] = useState("");
  const [err, setErr] = useState("");

  /* ── Reads ── */
  const { data: instRaw, refetch } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "getInstitution",
    args: [address!],
    query: { enabled: !!address },
  });
  const { data: isVerified } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "isVerified",
    args: [address!],
    query: { enabled: !!address },
  });
  const { data: totalInst } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "getTotalInstitutions",
  });

  /* ── Reads — credential lookup for upgrade tab ── */
  const { data: lookupRaw, isLoading: lookupLoading, error: lookupFetchErr, refetch: lookupRefetch } = useReadContract({
    address: CONTRACTS.CREDENTIAL_REGISTRY,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "verifyCredential",
    args: [lookupId!],
    query: { enabled: !!lookupId },
  });
  const lookup = lookupRaw as any;

  /* ── Reads — credential lookup for revoke tab ── */
  const { data: revLookupRaw, isLoading: revLookupLoading, error: revLookupFetchErr, refetch: revLookupRefetch } = useReadContract({
    address: CONTRACTS.CREDENTIAL_REGISTRY,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "verifyCredential",
    args: [revLookupId!],
    query: { enabled: !!revLookupId },
  });
  const revLookup = revLookupRaw as any;

  /* ── Writes ── */
  const { writeContract: doRegister, data: regHash, isPending: regPending, error: regError, reset: regReset } = useWriteContract();
  const { isLoading: regWaiting, isSuccess: regOk } = useWaitForTransactionReceipt({ hash: regHash });

  const { writeContract: doIssue, data: issHash, isPending: issPending, error: issError, reset: issReset } = useWriteContract();
  const { isLoading: issWaiting, isSuccess: issOk } = useWaitForTransactionReceipt({ hash: issHash });

  const { writeContract: doUpgrade, data: upgradeHash, isPending: upgradePending, error: upgradeError, reset: upgradeReset } = useWriteContract();
  const { isLoading: upgradeWaiting, isSuccess: upgradeOk } = useWaitForTransactionReceipt({ hash: upgradeHash });

  const regTxError     = regError     ? ((regError     as any)?.shortMessage || (regError     as any)?.message) : null;
  const issTxError     = issError     ? ((issError     as any)?.shortMessage || (issError     as any)?.message) : null;
  const upgradeTxError = upgradeError ? ((upgradeError as any)?.shortMessage || (upgradeError as any)?.message) : null;

  const { writeContract: doInstRevoke, data: instRevokeHash, isPending: instRevokePending, error: instRevokeError, reset: instRevokeReset } = useWriteContract();
  const { isLoading: instRevokeWaiting, isSuccess: instRevokeOk } = useWaitForTransactionReceipt({ hash: instRevokeHash });

  const instRevokeTxError = instRevokeError ? ((instRevokeError as any)?.shortMessage || (instRevokeError as any)?.message) : null;

  const inst         = instRaw as any;
  const isRegistered = inst && inst.registeredAt > 0n;

  // ── Transaction toast notifications ───────────────────────────────────────
  // Fire success/error toasts when on-chain transactions confirm or fail.
  useEffect(() => { if (regOk)          showToast("Institution registered on-chain! 🏛️", "success"); }, [regOk]);
  useEffect(() => { if (issOk)          showToast("Credential issued successfully! 🎓", "success"); }, [issOk]);
  useEffect(() => { if (upgradeOk)      showToast("Credential upgraded to Tier 1! ⭐", "success"); }, [upgradeOk]);
  useEffect(() => { if (instRevokeOk)   showToast("Credential revoked on-chain.", "info"); }, [instRevokeOk]);
  useEffect(() => { if (regTxError)     showToast(`Registration failed: ${regTxError}`, "error"); }, [regTxError]);
  useEffect(() => { if (issTxError)     showToast(`Issue failed: ${issTxError}`, "error"); }, [issTxError]);
  useEffect(() => { if (upgradeTxError) showToast(`Upgrade failed: ${upgradeTxError}`, "error"); }, [upgradeTxError]);
  useEffect(() => { if (instRevokeTxError) showToast(`Revoke failed: ${instRevokeTxError}`, "error"); }, [instRevokeTxError]);

  // Force switch to QIE Testnet before any write
  async function ensureQieChain(): Promise<boolean> {
    const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
    if (!eth) return true;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7BF" }],
      });
      return true;
    } catch (switchErr: any) {
      if (switchErr?.code === 4902) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x7BF",
              chainName: "QIE Testnet",
              nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
              rpcUrls: ["https://rpc1testnet.qie.digital/"],
              blockExplorerUrls: ["https://testnet.qie.digital"],
            }],
          });
          return true;
        } catch {
          setErr(ins.errSwitchFail);
          return false;
        }
      }
      if (switchErr?.code === 4001) {
        setErr(ins.errSwitchReject);
        return false;
      }
      return true;
    }
  }

  async function handleRegister() {
    if (!reg.name || !reg.domain || !reg.country || !reg.website) {
      setErr(ins.errFields); return;
    }
    setErr(""); regReset();
    const switched = await ensureQieChain();
    if (!switched) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doRegister as any)({
      address: CONTRACTS.INSTITUTION_REGISTRY,
      abi: INSTITUTION_REGISTRY_ABI,
      functionName: "registerInstitution",
      args: [reg.name, reg.domain, reg.country, reg.website],
    });
  }

  function handleLookup() {
    const id = upg.credentialId.trim();
    if (!id.startsWith("0x") || id.length !== 66) {
      setErr(ins.upgradeErrCredId); return;
    }
    setErr("");
    upgradeReset();
    // If same id, force refetch; otherwise set new id (triggers useReadContract)
    if (lookupId === id) {
      lookupRefetch();
    } else {
      setLookupId(id as `0x${string}`);
    }
  }

  async function handleUpgrade() {
    if (!lookupId) { setErr(ins.upgradeErrCredId); return; }
    setErr(""); upgradeReset();
    const switched = await ensureQieChain();
    if (!switched) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doUpgrade as any)({
      address: CONTRACTS.CREDENTIAL_REGISTRY,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: "upgradeToTier1",
      args: [lookupId],
    });
  }

  function handleRevokeLookup() {
    const id = rev.credentialId.trim();
    if (!id.startsWith("0x") || id.length !== 66) {
      setErr(ins.upgradeErrCredId); return;
    }
    setErr(""); instRevokeReset(); setRevReason("");
    if (revLookupId === id) { revLookupRefetch(); }
    else { setRevLookupId(id as `0x${string}`); }
  }

  async function handleInstRevoke() {
    if (!revReason.trim()) { setErr(ins.revokeErrReason); return; }
    if (!revLookupId) return;
    setErr(""); instRevokeReset();
    const switched = await ensureQieChain();
    if (!switched) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doInstRevoke as any)({
      address: CONTRACTS.CREDENTIAL_REGISTRY,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: "revokeCredential",
      args: [revLookupId, revReason.trim()],
    });
  }

  async function handleIssue() {
    if (!iss.candidate || !iss.data || !iss.ipfsCID) {
      setErr(ins.errFields); return;
    }
    if (!iss.candidate.startsWith("0x")) {
      setErr(ins.err0x); return;
    }
    setErr(""); issReset();
    const switched = await ensureQieChain();
    if (!switched) return;
    const hash = ethers.keccak256(ethers.toUtf8Bytes(iss.data)) as `0x${string}`;
    // Pass candidate's QIE Pass DID if provided — stored on-chain for KYC proof
    const candidatePassDid = iss.candidatePassDid.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doIssue as any)({
      address: CONTRACTS.CREDENTIAL_REGISTRY,
      abi: CREDENTIAL_REGISTRY_ABI,
      functionName: "issueCredential",
      args: [iss.candidate as `0x${string}`, hash, iss.ipfsCID, candidatePassDid],
    });
  }

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      <Navbar />

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="pt-16 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 60% 0%, rgba(14,165,233,0.1) 0%, transparent 60%)" }} />
        <div className="max-w-5xl mx-auto px-6 py-14 relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-6">
            <div>
              <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 mb-5 border-sky-500/20">
                <span className="text-2xl">🏛️</span>
                <span className="text-sky-400 text-sm font-medium">{ins.badge}</span>
              </div>
              <h1 className="text-4xl font-black text-white mb-2">{ins.title}</h1>
              <p className="text-white/40">{ins.subtitle}</p>
            </div>
            {mounted && isConnected && (
              <div className="flex flex-col gap-3 items-end">
                {/* QIE Pass — institution identity (role-scoped + locked) */}
                <QIEPassVerify
                  address={address}
                  role="institution"
                  variant="compact"
                  locked
                  requestedClaims={["firstName", "lastName", "nationality"]}
                  onVerified={(did) => { setIsQIEPassVerified(true); setQiePassDid(did); }}
                />
                {isRegistered && (
                  <div className="glass rounded-2xl px-5 py-4 text-center border-sky-500/15">
                    <p className="text-3xl font-black text-white">{String(totalInst ?? "—")}</p>
                    <p className="text-white/40 text-xs">{ins.totalLabel}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-20">
        {!mounted ? null : !isConnected ? (
          /* ── Connect prompt ── */
          <div className="glass rounded-3xl p-16 text-center border-sky-500/10"
            style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.06), rgba(129,140,248,0.04))" }}>
            <div style={{
              width: 80, height: 80, borderRadius: 24, fontSize: 36,
              background: "linear-gradient(135deg, rgba(14,165,233,0.2), rgba(129,140,248,0.2))",
              border: "1px solid rgba(14,165,233,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
            }}>🏛️</div>
            <h2 className="text-2xl font-bold text-white mb-3">{ins.connectTitle}</h2>
            <p className="text-white/40 mb-8">{ins.connectDesc}</p>
            <button onClick={() => connect({ connector: injected() })}
              className="btn-primary text-white px-10 py-3.5 rounded-2xl font-semibold">
              {ins.connectBtn}
            </button>
          </div>
        ) : (
          <>
            {/* ── Wrong chain banner ── */}
            {isWrongChain && (
              <div className="rounded-2xl p-5 mb-6 flex items-center gap-4 border border-amber-500/30"
                style={{ background: "rgba(245,158,11,0.1)" }}>
                <span className="text-2xl">⚠️</span>
                <div className="flex-1">
                  <p className="text-amber-300 font-bold">{ins.wrongNetwork}</p>
                  <p className="text-amber-300/60 text-sm">{ins.wrongNetworkDesc}</p>
                </div>
                <button onClick={() => switchChain({ chainId: qieTestnet.id })}
                  className="text-sm bg-amber-500/20 border border-amber-500/40 text-amber-300 px-4 py-2 rounded-xl font-semibold hover:bg-amber-500/30 transition-colors">
                  {ins.switchNow}
                </button>
              </div>
            )}

            {/* ── Institution status banner ── */}
            {isRegistered && (
              <div className={`rounded-2xl p-5 mb-8 flex items-center gap-5 ${
                isVerified ? "border border-green-500/20" : "border border-amber-500/20"
              }`}
                style={{ background: isVerified ? "rgba(34,197,94,0.07)" : "rgba(245,158,11,0.07)" }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 16, fontSize: 24,
                  background: isVerified ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isVerified ? "✅" : "⏳"}
                </div>
                <div className="flex-1">
                  <p className="text-white font-bold text-lg">{inst.name}</p>
                  <p className="text-white/50 text-sm">
                    {inst.domain} &nbsp;·&nbsp;
                    <span className={isVerified ? "text-green-400" : "text-amber-400"}>
                      {isVerified ? ins.verifiedBanner : ins.pendingBanner}
                    </span>
                  </p>
                </div>
                {isVerified && (
                  <div className="glass rounded-xl px-4 py-2 border-green-500/20">
                    <p className="text-green-400 text-xs font-bold uppercase tracking-wider">Active</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Tabs ── */}
            <div className="flex gap-2 mb-8 glass rounded-2xl p-1.5" style={{ display: "inline-flex", flexWrap: "wrap" }}>
              {(["register", "issue", "upgrade", "revoke"] as Tab[]).map((t) => (
                <button key={t} onClick={() => { setTab(t); setErr(""); }}
                  className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    tab === t ? "text-white" : "text-white/40 hover:text-white/70"
                  }`}
                  style={tab === t ? {
                    background: t === "revoke"
                      ? "linear-gradient(135deg, #dc2626, #b91c1c)"
                      : "linear-gradient(135deg, #0ea5e9, #0284c7)",
                    boxShadow: t === "revoke"
                      ? "0 4px 14px rgba(220,38,38,0.3)"
                      : "0 4px 14px rgba(14,165,233,0.3)",
                  } : {}}>
                  {t === "register" ? ins.tabRegister
                    : t === "issue"   ? ins.tabIssue
                    : t === "upgrade" ? ins.tabUpgrade
                    : ins.tabRevoke}
                </button>
              ))}
            </div>

            {/* ── Global error ── */}
            {err && (
              <div className="glass rounded-xl px-5 py-3.5 mb-6 flex items-center gap-3 border border-red-500/25">
                <span className="text-red-400">⚠️</span>
                <span className="text-red-300 text-sm">{err}</span>
              </div>
            )}

            {/* ── Register / Status tab ── */}
            {tab === "register" && (
              isRegistered ? (
                /* ══════════════════════════════════════════════════
                   ALREADY REGISTERED — show status dashboard
                   ══════════════════════════════════════════════════ */
                <div className="space-y-6">

                  {/* ── Main status card ── */}
                  <div className="glass rounded-3xl overflow-hidden"
                    style={{ borderColor: isVerified ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)" }}>

                    {/* Header strip */}
                    <div className="px-8 py-5 flex items-center gap-4 border-b border-white/[0.06]"
                      style={{ background: isVerified ? "rgba(34,197,94,0.07)" : "rgba(245,158,11,0.07)" }}>
                      <div style={{
                        width: 52, height: 52, borderRadius: 16, fontSize: 24,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isVerified ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
                      }}>
                        {isVerified ? "✅" : "⏳"}
                      </div>
                      <div className="flex-1">
                        <p className="text-white font-black text-xl">{inst.name}</p>
                        <p className={`text-sm font-medium ${isVerified ? "text-green-400" : "text-amber-400"}`}>
                          {isVerified ? "✅ Verified Institution" : "⏳ Pending Admin Approval"}
                        </p>
                      </div>
                      {isQIEPassVerified && (
                        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-green-500/30 text-xs font-semibold"
                          style={{ background: "rgba(34,197,94,0.10)" }}>
                          <span className="text-green-400">🪪 KYC Verified</span>
                        </span>
                      )}
                    </div>

                    {/* Details grid */}
                    <div className="px-8 py-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                        {[
                          { icon: "🌐", label: "Domain",   value: inst.domain  },
                          { icon: "🏳️", label: "Country",  value: inst.country },
                          { icon: "🔗", label: "Website",  value: inst.website },
                          {
                            icon: "📅", label: "Registered",
                            value: inst.registeredAt > 0n
                              ? new Date(Number(inst.registeredAt) * 1000).toLocaleDateString("en-IN", {
                                  day: "2-digit", month: "long", year: "numeric",
                                })
                              : "—",
                          },
                        ].map(({ icon, label, value }) => (
                          <div key={label} className="glass rounded-xl px-4 py-3">
                            <p className="text-white/30 text-xs mb-1">{icon} {label}</p>
                            <p className="text-white text-sm font-medium break-all">{value || "—"}</p>
                          </div>
                        ))}
                      </div>

                      {/* QIE Pass DID row */}
                      {qiePassDid && (
                        <div className="glass rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
                          <span className="text-green-400 shrink-0">🪪</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-white/30 text-xs mb-0.5">QIE Pass DID</p>
                            <p className="text-green-300/70 text-xs font-mono truncate">{qiePassDid}</p>
                          </div>
                        </div>
                      )}

                      {/* ── What's next section ── */}
                      <div className="border-t border-white/[0.06] pt-5">
                        <p className="text-white/30 text-xs uppercase tracking-widest mb-4 font-semibold">
                          What would you like to do?
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {[
                            {
                              icon: "✍️",
                              label: "Issue Credential",
                              desc: "Issue a new credential to a candidate",
                              color: "sky",
                              tab: "issue" as const,
                              disabled: !isVerified,
                            },
                            {
                              icon: "⬆️",
                              label: "Upgrade Tier 2→1",
                              desc: "Upgrade a self-attested credential to Tier 1",
                              color: "purple",
                              tab: "upgrade" as const,
                              disabled: !isVerified,
                            },
                            {
                              icon: "🗑️",
                              label: "Revoke Credential",
                              desc: "Revoke a credential you issued",
                              color: "red",
                              tab: "revoke" as const,
                              disabled: !isVerified,
                            },
                          ].map(({ icon, label, desc, color, tab: targetTab, disabled }) => (
                            <button
                              key={label}
                              onClick={() => { setTab(targetTab); setErr(""); }}
                              disabled={disabled}
                              className={`text-left rounded-2xl p-4 border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] ${
                                color === "red"
                                  ? "border-red-500/20 hover:border-red-500/40"
                                  : color === "purple"
                                  ? "border-purple-500/20 hover:border-purple-500/40"
                                  : "border-sky-500/20 hover:border-sky-500/40"
                              }`}
                              style={{
                                background: color === "red"
                                  ? "rgba(220,38,38,0.06)"
                                  : color === "purple"
                                  ? "rgba(124,58,237,0.06)"
                                  : "rgba(14,165,233,0.06)",
                              }}
                            >
                              <span className="text-xl block mb-2">{icon}</span>
                              <p className={`text-sm font-semibold mb-1 ${
                                color === "red" ? "text-red-400" : color === "purple" ? "text-purple-400" : "text-sky-400"
                              }`}>{label}</p>
                              <p className="text-white/30 text-xs leading-relaxed">{desc}</p>
                              {disabled && (
                                <p className="text-amber-400/60 text-xs mt-2">⚠️ Requires admin verification</p>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Pending verification notice */}
                  {!isVerified && (
                    <div className="glass rounded-2xl px-6 py-4 flex items-start gap-4 border border-amber-500/20"
                      style={{ background: "rgba(245,158,11,0.06)" }}>
                      <span className="text-2xl mt-0.5">⏳</span>
                      <div>
                        <p className="text-amber-300 font-semibold text-sm">Awaiting Admin Verification</p>
                        <p className="text-amber-300/50 text-xs mt-1 leading-relaxed">
                          Your institution is registered and under review. Once an admin verifies it,
                          you&apos;ll be able to issue credentials, upgrade tiers, and revoke credentials.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

              ) : (
                /* ══════════════════════════════════════════════════
                   NOT YET REGISTERED — show registration form
                   ══════════════════════════════════════════════════ */
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  <div className="lg:col-span-3 glass rounded-3xl p-8 space-y-5">
                    <div className="mb-2">
                      <h2 className="text-white font-bold text-xl">{ins.regTitle}</h2>
                      <p className="text-white/40 text-sm mt-1">{ins.regDesc}</p>
                    </div>

                    {/* ── GATE: QIE Pass required — server-verified ── */}
                    {kycCheckLoading ? (
                      <div className="rounded-2xl px-5 py-4 border border-sky-500/15 flex items-center gap-3"
                        style={{ background: "rgba(14,165,233,0.05)" }}>
                        <span className="inline-block w-4 h-4 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin shrink-0" />
                        <p className="text-sky-300/60 text-sm">Verifying KYC status…</p>
                      </div>
                    ) : isBlockedByRole ? (
                      /* ── Blocked: this wallet is already a candidate ── */
                      <div className="rounded-2xl px-5 py-4 border border-red-500/20 flex items-start gap-3"
                        style={{ background: "rgba(239,68,68,0.05)" }}>
                        <span className="text-xl mt-0.5">🚫</span>
                        <div>
                          <p className="text-red-400 font-semibold text-sm">Candidate wallet — institution access blocked</p>
                          <p className="text-red-300/50 text-xs mt-1 leading-relaxed">
                            This wallet is already registered as a <strong className="text-red-300/70">candidate</strong> on VeridiChain.
                            A single wallet cannot hold both candidate and institution roles.
                            Please connect a different wallet to register as an institution.
                          </p>
                        </div>
                      </div>
                    ) : !isQIEPassVerified ? (
                      <div className="space-y-4">
                        <div className="rounded-2xl px-5 py-4 border border-sky-500/20 flex items-start gap-3"
                          style={{ background: "rgba(14,165,233,0.07)" }}>
                          <span className="text-xl mt-0.5">🪪</span>
                          <div>
                            <p className="text-sky-300 font-semibold text-sm">QIE Pass Identity Required</p>
                            <p className="text-sky-300/60 text-xs mt-1 leading-relaxed">
                              Verify your identity with QIE Pass before registering your institution on-chain.
                              This links your real-world identity to your institution wallet.
                            </p>
                          </div>
                        </div>
                        <QIEPassVerify
                          address={address}
                          role="institution"
                          variant="full"
                          locked
                          requestedClaims={["firstName", "lastName", "nationality"]}
                          onVerified={(did) => { setIsQIEPassVerified(true); setQiePassDid(did); }}
                        />
                      </div>
                    ) : (
                      /* ── QIE Verified — show registration form ── */
                      <div className="space-y-5">
                        <div className="flex items-center gap-3 rounded-xl px-4 py-2.5 border border-green-500/20"
                          style={{ background: "rgba(34,197,94,0.06)" }}>
                          <span className="text-green-400">✅</span>
                          <span className="text-green-400 text-sm font-medium">Identity verified via QIE Pass</span>
                          {qiePassDid && (
                            <span className="text-green-300/30 text-xs font-mono ml-auto hidden sm:block">
                              {qiePassDid.slice(0, 22)}…
                            </span>
                          )}
                        </div>

                        <Field label={ins.fieldName}    value={reg.name}
                          onChange={(v) => setReg({ ...reg, name: v })}    placeholder={ins.namePlaceholder} />
                        <Field label={ins.fieldDomain}   value={reg.domain}
                          onChange={(v) => setReg({ ...reg, domain: v })}   placeholder={ins.domainPlaceholder}
                          hint={ins.domainHint} />
                        <div className="grid grid-cols-2 gap-4">
                          <Field label={ins.fieldCountry} value={reg.country}
                            onChange={(v) => setReg({ ...reg, country: v })} placeholder={ins.countryPlaceholder} />
                          <Field label={ins.fieldWebsite} value={reg.website}
                            onChange={(v) => setReg({ ...reg, website: v })} placeholder={ins.websitePlaceholder} />
                        </div>

                        {(err || regTxError) && (
                          <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                            <span>⚠️</span>
                            <div>
                              <p className="text-red-300 text-sm font-semibold">{err || "Transaction failed"}</p>
                              {regTxError && !err && <p className="text-red-300/60 text-xs mt-1 break-all">{regTxError}</p>}
                            </div>
                          </div>
                        )}
                        {regOk && (
                          <div className="rounded-xl px-4 py-3 border border-green-500/25" style={{ background: "rgba(34,197,94,0.08)" }}>
                            <p className="text-green-400 text-sm font-semibold">{ins.regOk}</p>
                          </div>
                        )}

                        <button onClick={handleRegister}
                          disabled={regPending || regWaiting}
                          className="btn-primary w-full text-white py-3.5 rounded-2xl font-semibold text-sm mt-2">
                          {regPending ? ins.regPending : regWaiting ? ins.regWaiting : ins.regBtn}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Info panel */}
                  <div className="lg:col-span-2 space-y-4">
                    {[
                      { icon: "🪙", title: ins.infoPass,  desc: ins.infoPassDesc  },
                      { icon: "🔐", title: ins.infoStake, desc: ins.infoStakeDesc },
                      { icon: "✅", title: ins.infoAdmin, desc: ins.infoAdminDesc },
                    ].map(({ icon, title, desc }) => (
                      <div key={title} className="glass rounded-2xl p-5 flex gap-4 items-start hover:border-sky-500/15 transition-all">
                        <span className="text-2xl mt-0.5">{icon}</span>
                        <div>
                          <p className="text-white font-semibold text-sm mb-1">{title}</p>
                          <p className="text-white/40 text-xs leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}

            {/* ── Revoke credential form ── */}
            {tab === "revoke" && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3 glass rounded-3xl p-8 space-y-5"
                  style={{ borderColor: "rgba(220,38,38,0.15)" }}>
                  <h2 className="text-white font-bold text-xl mb-1">{ins.revokeTabTitle}</h2>
                  <p className="text-white/40 text-sm mb-4">{ins.revokeTabDesc}</p>

                  {!isVerified && (
                    <div className="rounded-2xl px-5 py-4 flex items-center gap-3 border border-amber-500/20"
                      style={{ background: "rgba(245,158,11,0.08)" }}>
                      <span className="text-2xl">⚠️</span>
                      <div>
                        <p className="text-amber-300 text-sm font-semibold">{ins.upgradeNotVerified}</p>
                        <p className="text-amber-300/60 text-xs">{ins.upgradeNotVerifiedDesc}</p>
                      </div>
                    </div>
                  )}

                  {/* Credential ID input */}
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                      {ins.fieldCredentialId}
                    </label>
                    <input
                      value={rev.credentialId}
                      onChange={(e) => { setRev({ credentialId: e.target.value }); setRevLookupId(null); instRevokeReset(); setRevReason(""); }}
                      placeholder={ins.credIdPlaceholder}
                      className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono"
                    />
                    <p className="text-white/25 text-xs mt-1.5">{ins.credIdHint}</p>
                  </div>

                  <button
                    onClick={handleRevokeLookup}
                    disabled={revLookupLoading || !isVerified}
                    className="w-full text-white py-3 rounded-2xl font-semibold text-sm border border-red-500/30 hover:border-red-500/50 transition-all"
                    style={{ background: "rgba(220,38,38,0.15)" }}>
                    {revLookupLoading ? ins.lookupLoading : ins.lookupBtn}
                  </button>

                  {/* ── Lookup result ── */}
                  {revLookupId && !revLookupLoading && (
                    <>
                      {/* Not found */}
                      {(revLookupFetchErr || (revLookup && revLookup[5] === 0n)) && (
                        <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                          <span>⚠️</span>
                          <p className="text-red-300 text-sm">{ins.lookupNotFound}</p>
                        </div>
                      )}

                      {/* Found */}
                      {revLookup && revLookup[5] > 0n && (
                        <div className="glass rounded-2xl p-5 space-y-3"
                          style={{ borderColor: "rgba(220,38,38,0.15)" }}>
                          {/* Credential preview */}
                          <div className="space-y-2 text-sm pb-3 border-b border-white/10">
                            <div className="flex justify-between">
                              <span className="text-white/40">{ins.lookupCandidate}</span>
                              <span className="text-white font-mono text-xs break-all text-right max-w-[60%]">
                                {String(revLookup[3])}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-white/40">{ins.lookupIssuedAt}</span>
                              <span className="text-white text-xs">
                                {new Date(Number(revLookup[5]) * 1000).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-white/40">{ins.lookupTier}</span>
                              <span className={`text-xs font-bold ${revLookup[4] === 1 ? "text-green-400" : "text-amber-400"}`}>
                                Tier {revLookup[4]}
                              </span>
                            </div>
                          </div>

                          {/* Already revoked */}
                          {revLookup[6] && (
                            <div className="rounded-xl px-4 py-3 border border-red-500/25"
                              style={{ background: "rgba(239,68,68,0.08)" }}>
                              <p className="text-red-400 text-sm font-semibold">{ins.revokeAlreadyRevoked}</p>
                            </div>
                          )}

                          {/* Not the issuer */}
                          {!revLookup[6] && String(revLookup[1]).toLowerCase() !== address?.toLowerCase() && (
                            <div className="rounded-2xl px-5 py-4 flex items-start gap-3 border border-amber-500/20"
                              style={{ background: "rgba(245,158,11,0.08)" }}>
                              <span className="text-2xl">🚫</span>
                              <div>
                                <p className="text-amber-300 text-sm font-semibold">{ins.revokeNotIssuer}</p>
                                <p className="text-amber-300/60 text-xs mt-1">{ins.revokeNotIssuerDesc}</p>
                                <p className="text-white/25 text-xs mt-2 font-mono break-all">
                                  Issuer: {String(revLookup[1])}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* You ARE the issuer — show revoke form */}
                          {!revLookup[6] && String(revLookup[1]).toLowerCase() === address?.toLowerCase() && (
                            <>
                              <div className="rounded-xl px-4 py-3 border border-green-500/20"
                                style={{ background: "rgba(34,197,94,0.06)" }}>
                                <p className="text-green-400 text-sm">{ins.revokeEligible}</p>
                              </div>

                              {/* Reason textarea */}
                              <div>
                                <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                                  {ins.revokeReasonLabel}
                                </label>
                                <textarea
                                  value={revReason}
                                  onChange={(e) => setRevReason(e.target.value)}
                                  placeholder={ins.revokeReasonPlaceholder}
                                  rows={3}
                                  className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm resize-none"
                                />
                              </div>

                              {/* Warning */}
                              <div className="rounded-xl px-4 py-3 border border-red-500/20"
                                style={{ background: "rgba(239,68,68,0.06)" }}>
                                <p className="text-red-300/80 text-xs">
                                  ⚠️ This action is permanent and cannot be undone. The revocation reason will be recorded forever on the blockchain.
                                </p>
                              </div>

                              {instRevokeTxError && (
                                <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                                  <span>⚠️</span>
                                  <div>
                                    <p className="text-red-300 text-sm font-semibold">Transaction failed</p>
                                    <p className="text-red-300/60 text-xs mt-1 break-all">{instRevokeTxError}</p>
                                  </div>
                                </div>
                              )}

                              {instRevokeOk ? (
                                <div className="rounded-xl px-4 py-3 border border-green-500/25"
                                  style={{ background: "rgba(34,197,94,0.08)" }}>
                                  <p className="text-green-400 text-sm font-semibold">{ins.revokeInstOk}</p>
                                </div>
                              ) : (
                                <button
                                  onClick={handleInstRevoke}
                                  disabled={!isVerified || instRevokePending || instRevokeWaiting}
                                  className="w-full text-white py-3.5 rounded-2xl font-semibold text-sm"
                                  style={{
                                    background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                                    boxShadow: "0 4px 14px rgba(220,38,38,0.3)",
                                    opacity: (instRevokePending || instRevokeWaiting) ? 0.7 : 1,
                                  }}>
                                  {instRevokePending
                                    ? ins.revokeInstPending
                                    : instRevokeWaiting
                                    ? ins.revokeInstWaiting
                                    : ins.revokeConfirmBtn}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Info panel */}
                <div className="lg:col-span-2 space-y-4">
                  {[
                    { icon: "🔐", title: ins.revokeInfo1Title, desc: ins.revokeInfo1Desc },
                    { icon: "📜", title: ins.revokeInfo2Title, desc: ins.revokeInfo2Desc },
                    { icon: "🪪", title: ins.revokeInfo3Title, desc: ins.revokeInfo3Desc },
                  ].map(({ icon, title, desc }) => (
                    <div key={title} className="glass rounded-2xl p-5 flex gap-4 items-start">
                      <span className="text-2xl mt-0.5">{icon}</span>
                      <div>
                        <p className="text-white font-semibold text-sm mb-1">{title}</p>
                        <p className="text-white/40 text-xs leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Upgrade Tier 2→1 form ── */}
            {tab === "upgrade" && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3 glass rounded-3xl p-8 space-y-5">
                  <h2 className="text-white font-bold text-xl mb-1">{ins.upgradeTitle}</h2>
                  <p className="text-white/40 text-sm mb-4">{ins.upgradeDesc}</p>

                  {!isVerified && (
                    <div className="rounded-2xl px-5 py-4 flex items-center gap-3 border border-amber-500/20"
                      style={{ background: "rgba(245,158,11,0.08)" }}>
                      <span className="text-2xl">⚠️</span>
                      <div>
                        <p className="text-amber-300 text-sm font-semibold">{ins.upgradeNotVerified}</p>
                        <p className="text-amber-300/60 text-xs">{ins.upgradeNotVerifiedDesc}</p>
                      </div>
                    </div>
                  )}

                  {/* Credential ID input */}
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                      {ins.fieldCredentialId}
                    </label>
                    <input
                      value={upg.credentialId}
                      onChange={(e) => { setUpg({ credentialId: e.target.value }); setLookupId(null); upgradeReset(); }}
                      placeholder={ins.credIdPlaceholder}
                      className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono"
                    />
                    <p className="text-white/25 text-xs mt-1.5">{ins.credIdHint}</p>
                  </div>

                  <button
                    onClick={handleLookup}
                    disabled={lookupLoading || !isVerified}
                    className="btn-primary w-full text-white py-3 rounded-2xl font-semibold text-sm"
                    style={{ background: "linear-gradient(135deg, #0ea5e9, #0284c7)" }}>
                    {lookupLoading ? ins.lookupLoading : ins.lookupBtn}
                  </button>

                  {/* ── Lookup result ── */}
                  {lookupId && !lookupLoading && (
                    <>
                      {/* Not found */}
                      {(lookupFetchErr || (lookup && lookup[5] === 0n)) && (
                        <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                          <span>⚠️</span>
                          <p className="text-red-300 text-sm">{ins.lookupNotFound}</p>
                        </div>
                      )}

                      {/* Found */}
                      {lookup && lookup[5] > 0n && (
                        <div className="glass rounded-2xl p-5 space-y-3">
                          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                            <span className="text-xl">
                              {lookup[6] ? "🚫" : lookup[4] === 1 ? "✅" : "🟡"}
                            </span>
                            <div>
                              <p className="text-white font-semibold text-sm">
                                {lookup[6]
                                  ? ins.lookupRevoked
                                  : lookup[4] === 1
                                  ? ins.lookupTier1Label
                                  : ins.lookupTier2Label}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-white/40">{ins.lookupCandidate}</span>
                              <span className="text-white font-mono text-xs break-all text-right max-w-[60%]">
                                {String(lookup[3])}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-white/40">{ins.lookupIssuedAt}</span>
                              <span className="text-white text-xs">
                                {new Date(Number(lookup[5]) * 1000).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-white/40">{ins.lookupTier}</span>
                              <span className={`text-xs font-bold ${lookup[4] === 1 ? "text-green-400" : lookup[4] === 2 ? "text-amber-400" : "text-white/40"}`}>
                                Tier {lookup[4]}
                              </span>
                            </div>
                          </div>

                          {/* Already Tier 1 */}
                          {lookup[4] === 1 && !lookup[6] && (
                            <div className="rounded-xl px-4 py-3 mt-2 border border-green-500/25"
                              style={{ background: "rgba(34,197,94,0.08)" }}>
                              <p className="text-green-400 text-sm">{ins.lookupAlreadyTier1}</p>
                            </div>
                          )}

                          {/* Revoked */}
                          {lookup[6] && (
                            <div className="glass rounded-xl px-4 py-3 border border-red-500/25">
                              <p className="text-red-300 text-sm">{ins.lookupRevoked}</p>
                            </div>
                          )}

                          {/* Eligible for upgrade — Tier 2, not revoked */}
                          {lookup[4] === 2 && !lookup[6] && (
                            <>
                              {upgradeTxError && (
                                <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                                  <span>⚠️</span>
                                  <div>
                                    <p className="text-red-300 text-sm font-semibold">Transaction failed</p>
                                    <p className="text-red-300/60 text-xs mt-1 break-all">{upgradeTxError}</p>
                                  </div>
                                </div>
                              )}
                              {upgradeOk && (
                                <div className="rounded-xl px-4 py-3 border border-green-500/25"
                                  style={{ background: "rgba(34,197,94,0.08)" }}>
                                  <p className="text-green-400 text-sm font-semibold">{ins.upgradeOk}</p>
                                </div>
                              )}
                              {!upgradeOk && (
                                <button
                                  onClick={handleUpgrade}
                                  disabled={!isVerified || upgradePending || upgradeWaiting}
                                  className="btn-primary w-full text-white py-3.5 rounded-2xl font-semibold text-sm mt-1"
                                  style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}>
                                  {upgradePending
                                    ? ins.upgradePending
                                    : upgradeWaiting
                                    ? ins.upgradeWaiting
                                    : ins.upgradeBtn}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Info panel */}
                <div className="lg:col-span-2 space-y-4">
                  {[
                    { icon: "🔍", title: ins.upgradeInfoTitle,  desc: ins.upgradeInfoDesc  },
                    { icon: "🪙", title: ins.upgradeInfo2Title, desc: ins.upgradeInfo2Desc },
                    { icon: "📜", title: ins.upgradeInfo3Title, desc: ins.upgradeInfo3Desc },
                  ].map(({ icon, title, desc }) => (
                    <div key={title} className="glass rounded-2xl p-5 flex gap-4 items-start hover:border-sky-500/15 transition-all">
                      <span className="text-2xl mt-0.5">{icon}</span>
                      <div>
                        <p className="text-white font-semibold text-sm mb-1">{title}</p>
                        <p className="text-white/40 text-xs leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Issue credential form ── */}
            {tab === "issue" && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3 glass rounded-3xl p-8 space-y-5">
                  <h2 className="text-white font-bold text-xl mb-1">{ins.issueTitle}</h2>
                  <p className="text-white/40 text-sm mb-4">{ins.issueDesc}</p>

                  {!isVerified && (
                    <div className="rounded-2xl px-5 py-4 flex items-center gap-3 border border-amber-500/20"
                      style={{ background: "rgba(245,158,11,0.08)" }}>
                      <span className="text-2xl">⚠️</span>
                      <div>
                        <p className="text-amber-300 text-sm font-semibold">{ins.issueNotVerified}</p>
                        <p className="text-amber-300/60 text-xs">{ins.issueNotVerifiedDesc}</p>
                      </div>
                    </div>
                  )}

                  <Field label={ins.fieldCandidate}  value={iss.candidate}
                    onChange={(v) => setIss({ ...iss, candidate: v })}
                    placeholder={ins.candidatePlaceholder} />
                  <Field label={ins.fieldCredData}   value={iss.data}
                    onChange={(v) => setIss({ ...iss, data: v })}
                    placeholder={ins.credDataPlaceholder}
                    hint={ins.credDataHint} />
                  <Field label={ins.fieldIPFS}        value={iss.ipfsCID}
                    onChange={(v) => setIss({ ...iss, ipfsCID: v })}
                    placeholder={ins.ipfsPlaceholder}
                    hint={ins.ipfsHint} />

                  {/* Candidate QIE Pass DID — optional, for on-chain KYC proof */}
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                      {ins.fieldCandidateDid}
                      <span className="ml-2 text-white/20 font-normal normal-case tracking-normal">(optional)</span>
                    </label>
                    <input
                      value={iss.candidatePassDid}
                      onChange={(e) => setIss({ ...iss, candidatePassDid: e.target.value })}
                      placeholder={ins.candidateDidPlaceholder}
                      className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono"
                    />
                    <p className="text-white/25 text-xs mt-1.5">{ins.candidateDidHint}</p>
                  </div>

                  {issTxError && (
                    <div className="glass rounded-xl px-4 py-3 flex items-start gap-3 border border-red-500/25">
                      <span>⚠️</span>
                      <div>
                        <p className="text-red-300 text-sm font-semibold">Transaction failed</p>
                        <p className="text-red-300/60 text-xs mt-1 break-all">{issTxError}</p>
                      </div>
                    </div>
                  )}
                  {issOk && (
                    <div className="rounded-xl px-4 py-3 border border-green-500/25" style={{ background: "rgba(34,197,94,0.08)" }}>
                      <p className="text-green-400 text-sm font-semibold">{ins.issueOk}</p>
                    </div>
                  )}

                  <button onClick={handleIssue}
                    disabled={!isVerified || issPending || issWaiting}
                    className="btn-primary w-full text-white py-3.5 rounded-2xl font-semibold text-sm">
                    {issPending
                      ? ins.issuePending
                      : issWaiting
                      ? ins.issueWaiting
                      : issOk
                      ? ins.issueOk
                      : ins.issueBtn}
                  </button>
                </div>

                {/* NFT Preview card */}
                <div className="lg:col-span-2">
                  <div className="glass rounded-3xl p-6 border-sky-500/10"
                    style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.06), rgba(129,140,248,0.04))" }}>
                    <p className="text-white/30 text-xs uppercase tracking-widest mb-5">{ins.nftPreview}</p>
                    <div className="glass rounded-2xl p-5 mb-4">
                      <p className="text-white/30 text-xs mb-1">{ins.institution}</p>
                      <p className="text-white font-bold">{reg.name || "Your Institution"}</p>
                    </div>
                    <div className="glass rounded-2xl p-5 mb-4">
                      <p className="text-white/30 text-xs mb-1">{ins.credential}</p>
                      <p className="text-white text-sm">{iss.data || "—"}</p>
                    </div>
                    <div className="flex gap-3">
                      <div className="glass rounded-xl p-3 flex-1 text-center">
                        <p className="text-sky-400 text-xs font-bold">Tier 1</p>
                        <p className="text-white/30 text-xs">Verified</p>
                      </div>
                      <div className="glass rounded-xl p-3 flex-1 text-center">
                        <p className="text-sky-400 text-xs font-bold">QIE</p>
                        <p className="text-white/30 text-xs">Soulbound</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
