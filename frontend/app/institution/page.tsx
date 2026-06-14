"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ethers } from "ethers";
import {
  useAccount, useConnect, useDisconnect, useChainId, useSwitchChain,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
} from "wagmi";
import { qieTestnet } from "../../lib/wagmi";
import { Navbar } from "../../components/shared/Navbar";
import { useLang } from "../../lib/LangContext";
import { CONTRACTS, INSTITUTION_REGISTRY_ABI, CREDENTIAL_REGISTRY_ABI, ERC20_ABI, WQIE_ADDRESS, QUSDC_ADDRESS } from "../../lib/contracts";
import { QIE_CHAIN_ID, QIE_CHAIN_NAME, QIE_RPC, QIE_EXPLORER } from "../../lib/wagmi";
import { useQIEPass } from "../../lib/useQIEPass";
import { QIEPassVerify } from "../../components/shared/QIEPassVerify";
import { ConnectWalletPrompt } from "../../components/shared/ConnectWalletPrompt";
import { showToast } from "../../lib/toast";
import { CRED_DOC_TYPES, type CredDocType, type CredMetaDetails } from "../../lib/credentialMeta";

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

  const { hasPass, did: passDid, passConfigured } = useQIEPass(address);
  const [isQIEPassVerified,     setIsQIEPassVerified]     = useState(false);
  const [qiePassDid,            setQiePassDid]            = useState("");
  const [kycCheckLoading,       setKycCheckLoading]       = useState(false);
  const [isBlockedByRole,       setIsBlockedByRole]       = useState(false);

  useEffect(() => {
    if (address) return;
    setIsQIEPassVerified(false);
    setQiePassDid("");
    setIsBlockedByRole(false);
    setKycCheckLoading(false);
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!address) return;

    try {
      const candKey    = `qiepass:candidate:${QIE_CHAIN_ID}:${address.toLowerCase()}`;
      const candLegacy = `qiepass:candidate:${address.toLowerCase()}`;
      const candidateRaw = localStorage.getItem(candKey) ?? localStorage.getItem(candLegacy);
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

    try {
      const newKey    = `qiepass:institution:${QIE_CHAIN_ID}:${address.toLowerCase()}`;
      const legacyKey = `qiepass:institution:${address.toLowerCase()}`;
      const raw = localStorage.getItem(newKey) ?? localStorage.getItem(legacyKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { verified?: boolean; did?: string };
        if (parsed?.verified) {
          setIsQIEPassVerified(true);
          setQiePassDid(parsed.did ?? "");
        }
      }
    } catch { /* ignore */ }

    setKycCheckLoading(true);
    fetch(`/api/qiepass/institution-verify?wallet=${address.toLowerCase()}`)
      .then((r) => r.json())
      .then((data: { verified: boolean; did?: string | null }) => {
        if (data.verified) {
          setIsQIEPassVerified(true);
          if (data.did) setQiePassDid(data.did);
        } else {
          setIsQIEPassVerified(false);
          setQiePassDid("");
        }
      })
      .catch(() => { /* fall back to localStorage hint set above */ })
      .finally(() => setKycCheckLoading(false));
  }, [address]);

  const [tab, setTab] = useState<Tab>("register");
  const [reg, setReg] = useState({ name: "", domain: "", country: "", website: "" });
  const [iss, setIss] = useState({
    candidate:        "",
    candidatePassDid: "",
    // Structured metadata fields
    docType:          "" as CredDocType | "",
    candidateName:    "",
    issueYear:        "",
    degreeType:       "",   // DEGREE only
    courseName:       "",   // CERTIFICATE / COURSE_COMPLETION
    role:             "",   // EXPERIENCE_LETTER
    dateFrom:         "",   // EXPERIENCE_LETTER
    dateTo:           "",   // EXPERIENCE_LETTER
    title:            "",   // ACHIEVEMENT / OTHER
    documentCID:      "",   // optional — IPFS CID of the physical document
  });
  const [issLoading, setIssLoading] = useState(false); // IPFS upload in progress
  const [upg, setUpg] = useState({ credentialId: "" });
  const [lookupId, setLookupId] = useState<`0x${string}` | null>(null);
  const [rev, setRev] = useState({ credentialId: "" });
  const [revLookupId, setRevLookupId] = useState<`0x${string}` | null>(null);
  const [revReason, setRevReason] = useState("");
  const [err, setErr] = useState("");

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

  const { data: lookupRaw, isLoading: lookupLoading, error: lookupFetchErr, refetch: lookupRefetch } = useReadContract({
    address: CONTRACTS.CREDENTIAL_REGISTRY,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "verifyCredential",
    args: [lookupId!],
    query: { enabled: !!lookupId },
  });
  const lookup = lookupRaw as any;

  const { data: revLookupRaw, isLoading: revLookupLoading, error: revLookupFetchErr, refetch: revLookupRefetch } = useReadContract({
    address: CONTRACTS.CREDENTIAL_REGISTRY,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "verifyCredential",
    args: [revLookupId!],
    query: { enabled: !!revLookupId },
  });
  const revLookup = revLookupRaw as any;

  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

  // WQIE stake amount (1 WQIE = 1e18)
  const { data: stakeAmountRaw, isLoading: stakeLoading } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "STAKE_AMOUNT",
  });
  // QUSDC registration fee (1 QUSDC = 1e6)
  const { data: regFeeRaw, isLoading: feeLoading } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "REGISTRATION_FEE",
  });
  // Token addresses from contract (fallback to known mainnet addresses)
  const { data: wqieAddrRaw, isLoading: wqieAddrLoading } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "wqieToken",
  });
  const { data: qusdcAddrRaw, isLoading: qusdcAddrLoading } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "qieStableCoin",
  });

  // True while any staking-config read is still in-flight
  // Register button is blocked until these resolve to avoid the race condition
  // where STAKE_AMOUNT reads as 0n before the RPC responds → skips approval UI
  const stakingConfigLoading = stakeLoading || feeLoading || wqieAddrLoading || qusdcAddrLoading;

  const stakeAmount = (stakeAmountRaw as bigint | undefined) ?? 0n;
  const regFee      = (regFeeRaw      as bigint | undefined) ?? 0n;
  const wqieAddr    = ((wqieAddrRaw  as string | undefined) ?? WQIE_ADDRESS)  as `0x${string}`;
  const qusdcAddr   = ((qusdcAddrRaw as string | undefined) ?? QUSDC_ADDRESS) as `0x${string}`;

  const wqieActive  = stakeAmount > 0n && wqieAddr.toLowerCase()  !== ZERO_ADDR;
  const qusdcActive = regFee      > 0n && qusdcAddr.toLowerCase() !== ZERO_ADDR;
  const stakingActive = wqieActive || qusdcActive;

  // WQIE balance + allowance
  const { data: wqieBalRaw }  = useReadContract({ address: wqieAddr,  abi: ERC20_ABI, functionName: "balanceOf",  args: [address!], query: { enabled: !!address && wqieActive } });
  const { data: wqieAllowRaw, refetch: refetchWqieAllowance } = useReadContract({ address: wqieAddr, abi: ERC20_ABI, functionName: "allowance", args: [address!, CONTRACTS.INSTITUTION_REGISTRY], query: { enabled: !!address && wqieActive } });

  // QUSDC balance + allowance
  const { data: qusdcBalRaw }  = useReadContract({ address: qusdcAddr, abi: ERC20_ABI, functionName: "balanceOf",  args: [address!], query: { enabled: !!address && qusdcActive } });
  const { data: qusdcAllowRaw, refetch: refetchQusdcAllowance } = useReadContract({ address: qusdcAddr, abi: ERC20_ABI, functionName: "allowance", args: [address!, CONTRACTS.INSTITUTION_REGISTRY], query: { enabled: !!address && qusdcActive } });

  // Decimals
  const { data: wqieDecRaw }   = useReadContract({ address: wqieAddr,  abi: ERC20_ABI, functionName: "decimals", query: { enabled: wqieActive  } });
  const { data: qusdcDecRaw }  = useReadContract({ address: qusdcAddr, abi: ERC20_ABI, functionName: "decimals", query: { enabled: qusdcActive } });

  const wqieBal    = (wqieBalRaw    as bigint | undefined) ?? 0n;
  const wqieAllow  = (wqieAllowRaw  as bigint | undefined) ?? 0n;
  const qusdcBal   = (qusdcBalRaw   as bigint | undefined) ?? 0n;
  const qusdcAllow = (qusdcAllowRaw as bigint | undefined) ?? 0n;

  const wqieDec  = typeof wqieDecRaw  === "number" ? wqieDecRaw  : typeof wqieDecRaw  === "bigint" ? Number(wqieDecRaw)  : 18;
  const qusdcDec = typeof qusdcDecRaw === "number" ? qusdcDecRaw : typeof qusdcDecRaw === "bigint" ? Number(qusdcDecRaw) : 6;

  const qusdcApproved = !qusdcActive || qusdcAllow >= regFee;
  const wqieApproved  = !wqieActive  || wqieAllow  >= stakeAmount;
  const hasQusdcBal   = !qusdcActive || qusdcBal   >= regFee;
  const hasWqieBal    = !wqieActive  || wqieBal    >= stakeAmount;

  // Legacy aliases (used by existing code below)
  const isApproved       = qusdcApproved && wqieApproved;
  const hasStableBalance = hasQusdcBal && hasWqieBal;
  const stableBalance    = qusdcBal;
  const qieusdDecimals   = qusdcDec;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const stableCoinAddr   = qusdcAddr;

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

  const { writeContract: doApprove, data: approveHash, isPending: approvePending, error: approveError, reset: approveReset } = useWriteContract();
  const { isLoading: approveWaiting, isSuccess: approveOk } = useWaitForTransactionReceipt({ hash: approveHash });

  const { writeContract: doApproveWqie, data: approveWqieHash, isPending: approveWqiePending, error: approveWqieError, reset: approveWqieReset } = useWriteContract();
  const { isLoading: approveWqieWaiting, isSuccess: approveWqieOk } = useWaitForTransactionReceipt({ hash: approveWqieHash });

  const instRevokeTxError  = instRevokeError  ? ((instRevokeError  as any)?.shortMessage || (instRevokeError  as any)?.message) : null;
  const approveTxError     = approveError     ? ((approveError     as any)?.shortMessage || (approveError     as any)?.message) : null;
  const approveWqieTxError = approveWqieError ? ((approveWqieError as any)?.shortMessage || (approveWqieError as any)?.message) : null;

  const inst         = instRaw as any;
  const isRegistered = inst && inst.registeredAt > 0n;

  // Fire success/error toasts when on-chain transactions confirm or fail.
  useEffect(() => { if (regOk)          showToast("Institution registered on-chain! 🏛️", "success"); }, [regOk]);
  useEffect(() => { if (issOk)          showToast("Credential issued successfully! 🎓", "success"); }, [issOk]);
  useEffect(() => { if (upgradeOk)      showToast("Credential upgraded to Tier 1! ⭐", "success"); }, [upgradeOk]);
  useEffect(() => { if (instRevokeOk)   showToast("Credential revoked on-chain.", "info"); }, [instRevokeOk]);
  useEffect(() => { if (regTxError)     showToast(`Registration failed: ${regTxError}`, "error"); }, [regTxError]);
  useEffect(() => { if (issTxError)     showToast(`Issue failed: ${issTxError}`, "error"); }, [issTxError]);
  useEffect(() => { if (upgradeTxError) showToast(`Upgrade failed: ${upgradeTxError}`, "error"); }, [upgradeTxError]);
  useEffect(() => { if (instRevokeTxError) showToast(`Revoke failed: ${instRevokeTxError}`, "error"); }, [instRevokeTxError]);
  useEffect(() => { if (approveOk)          { showToast("QUSDC approved! ✅", "success"); refetchQusdcAllowance(); } }, [approveOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (approveTxError)     showToast(`QUSDC approval failed: ${approveTxError}`, "error"); }, [approveTxError]);
  useEffect(() => { if (approveWqieOk)      { showToast("WQIE approved! ✅", "success"); refetchWqieAllowance(); } }, [approveWqieOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (approveWqieTxError) showToast(`WQIE approval failed: ${approveWqieTxError}`, "error"); }, [approveWqieTxError]);

  // Force switch to correct QIE chain before any write (works for testnet & mainnet)
  async function ensureQieChain(): Promise<boolean> {
    const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
    if (!eth) return true;
    const chainHex = "0x" + QIE_CHAIN_ID.toString(16);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainHex }],
      });
      return true;
    } catch (switchErr: any) {
      if (switchErr?.code === 4902) {
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

  async function handleApproveQusdc() {
    setErr(""); approveReset();
    const switched = await ensureQieChain();
    if (!switched) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doApprove as any)({
      address: qusdcAddr,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.INSTITUTION_REGISTRY, regFee],
    });
  }

  async function handleApproveWqie() {
    setErr(""); approveWqieReset();
    const switched = await ensureQieChain();
    if (!switched) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doApproveWqie as any)({
      address: wqieAddr,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.INSTITUTION_REGISTRY, stakeAmount],
    });
  }

  async function handleRegister() {
    if (!reg.name || !reg.domain || !reg.country || !reg.website) {
      setErr(ins.errFields); return;
    }
    if (qusdcActive && !hasQusdcBal) {
      setErr(`Insufficient QUSDC balance. You need ${parseFloat(ethers.formatUnits(regFee, qusdcDec)).toLocaleString()} QUSDC for the registration fee.`);
      return;
    }
    if (wqieActive && !hasWqieBal) {
      setErr(`Insufficient WQIE balance. You need ${parseFloat(ethers.formatUnits(stakeAmount, wqieDec)).toLocaleString()} WQIE for the security stake.`);
      return;
    }
    if (qusdcActive && !qusdcApproved) {
      setErr("Please approve QUSDC fee first (Step 1 above)."); return;
    }
    if (wqieActive && !wqieApproved) {
      setErr("Please approve WQIE stake first (Step 2 above)."); return;
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
    if (!iss.candidate) { setErr(ins.errFields); return; }
    if (!iss.candidate.startsWith("0x")) { setErr(ins.err0x); return; }
    if (!iss.docType)       { setErr("Please select a credential type."); return; }
    if (!iss.candidateName.trim()) { setErr("Please enter the candidate's full name."); return; }
    if (!iss.issueYear.trim())    { setErr("Please enter the issue / passing year."); return; }

    setErr(""); issReset();
    const switched = await ensureQieChain();
    if (!switched) return;

    setIssLoading(true);
    try {
      const instName = (inst as any)?.name ?? "";
      const details: CredMetaDetails = {
        candidateName:   iss.candidateName.trim(),
        institutionName: instName,
        issueYear:       iss.issueYear.trim(),
        hasBarcode:      false,
        barcodeValue:    "",
        documentCID:     iss.documentCID.trim(),
      };
      if (iss.docType === "DEGREE" && iss.degreeType.trim())
        details.degreeType = iss.degreeType.trim();
      if (iss.docType === "EXPERIENCE_LETTER") {
        if (iss.role.trim())     details.role     = iss.role.trim();
        if (iss.dateFrom.trim()) details.dateFrom  = iss.dateFrom.trim();
        if (iss.dateTo.trim())   details.dateTo    = iss.dateTo.trim();
      }
      if ((iss.docType === "COURSE_COMPLETION" || iss.docType === "CERTIFICATE") && iss.courseName.trim())
        details.courseName = iss.courseName.trim();
      if ((iss.docType === "ACHIEVEMENT" || iss.docType === "OTHER") && iss.title.trim())
        details.title = iss.title.trim();

      const encRes = await fetch("/api/metadata/encrypt", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: iss.docType, details }),
      });
      const encJson = await encRes.json() as { cid?: string; error?: string };
      if (!encRes.ok || !encJson.cid) {
        setErr(encJson.error ?? "Failed to upload credential metadata to IPFS. Check PINATA_JWT in Vercel env.");
        setIssLoading(false);
        return;
      }

      const typeInfo = CRED_DOC_TYPES[iss.docType as CredDocType];
      const dataStr  = [
        typeInfo?.short || iss.docType,
        iss.candidateName.trim(),
        instName,
        iss.issueYear.trim(),
        iss.degreeType.trim() || iss.courseName.trim() || iss.title.trim() || iss.role.trim(),
      ].filter(Boolean).join(" | ");

      const hash = ethers.keccak256(ethers.toUtf8Bytes(dataStr)) as `0x${string}`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doIssue as any)({
        address: CONTRACTS.CREDENTIAL_REGISTRY,
        abi:     CREDENTIAL_REGISTRY_ABI,
        functionName: "issueCredential",
        args: [iss.candidate as `0x${string}`, hash, encJson.cid, iss.candidatePassDid.trim()],
      });
    } catch (e: unknown) {
      setErr((e as Error)?.message ?? "Failed to prepare credential");
    }
    setIssLoading(false);
  }

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      <Navbar />
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
          <ConnectWalletPrompt
            title={ins.connectTitle}
            description={ins.connectDesc}
          />
        ) : (
          <>
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
            {isRegistered && (
              <div className={`rounded-2xl p-5 mb-8 flex flex-wrap gap-3 items-start ${
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
            <div className="flex flex-wrap w-full gap-2 mb-8 glass rounded-2xl p-1.5">
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
            {err && (
              <div className="glass rounded-xl px-5 py-3.5 mb-6 flex items-center gap-3 border border-red-500/25">
                <span className="text-red-400">⚠️</span>
                <span className="text-red-300 text-sm">{err}</span>
              </div>
            )}
            {tab === "register" && (
              isRegistered ? (
                /* ══════════════════════════════════════════════════
                   ALREADY REGISTERED — show status dashboard
                   ══════════════════════════════════════════════════ */
                <div className="space-y-6">
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
                    {kycCheckLoading ? (
                      <div className="rounded-2xl px-5 py-4 border border-sky-500/15 flex items-center gap-3"
                        style={{ background: "rgba(14,165,233,0.05)" }}>
                        <span className="inline-block w-4 h-4 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin shrink-0" />
                        <p className="text-sky-300/60 text-sm">Verifying KYC status…</p>
                      </div>
                    ) : isBlockedByRole ? (
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
                      <div className="rounded-2xl px-5 py-5 border border-amber-500/20 space-y-3"
                        style={{ background: "rgba(245,158,11,0.06)" }}>
                        <div className="flex items-start gap-3">
                          <span className="text-2xl mt-0.5">🪪</span>
                          <div>
                            <p className="text-amber-300 font-semibold text-sm">QIE Pass KYC Required</p>
                            <p className="text-amber-300/60 text-xs mt-1 leading-relaxed">
                              Your wallet is not KYC verified yet. Open <strong className="text-amber-300/80">QIE Wallet</strong> → complete identity verification → come back and click Check below.
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setKycCheckLoading(true);
                            fetch(`/api/qiepass/institution-verify?wallet=${address?.toLowerCase()}`)
                              .then(r => r.json())
                              .then((d: { verified: boolean; did?: string | null }) => {
                                if (d.verified) { setIsQIEPassVerified(true); if (d.did) setQiePassDid(d.did); }
                              })
                              .catch(() => {})
                              .finally(() => setKycCheckLoading(false));
                          }}
                          className="w-full text-amber-300 border border-amber-500/30 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-500/10 transition-all">
                          🔄 Check KYC Status
                        </button>
                      </div>
                    ) : (
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
                        {stakingConfigLoading ? (
                          <div className="glass rounded-2xl px-5 py-4 flex items-center gap-3 border border-sky-500/15">
                            <span className="inline-block w-4 h-4 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin shrink-0" />
                            <p className="text-sky-300/60 text-sm">Loading registration requirements…</p>
                          </div>
                        ) : stakingActive ? (
                          <div className="glass rounded-2xl p-5 space-y-4" style={{ borderColor: "rgba(14,165,233,0.2)" }}>
                            <p className="text-white/40 text-xs uppercase tracking-widest font-semibold">🪙 Registration Requirements</p>

                            {/* Token summary cards */}
                            <div className={`grid gap-2 ${qusdcActive && wqieActive ? "grid-cols-2" : "grid-cols-1"}`}>
                              {qusdcActive && (
                                <div className="glass rounded-xl px-3 py-3 space-y-1" style={{ borderColor: qusdcApproved ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)" }}>
                                  <p className="text-white/30 text-xs font-semibold uppercase tracking-wider">QUSDC Fee</p>
                                  <p className="text-white font-bold text-sm">{parseFloat(ethers.formatUnits(regFee, qusdcDec)).toLocaleString()} QUSDC</p>
                                  <p className="text-red-400/60 text-xs">Non-refundable → Treasury</p>
                                  <p className={`text-xs font-medium ${hasQusdcBal ? "text-white/40" : "text-red-400"}`}>
                                    Balance: {parseFloat(ethers.formatUnits(qusdcBal, qusdcDec)).toLocaleString()} QUSDC
                                  </p>
                                  <p className={`text-xs font-semibold ${qusdcApproved ? "text-green-400" : "text-amber-400"}`}>
                                    {qusdcApproved ? "✅ Approved" : "⏳ Needs approval"}
                                  </p>
                                </div>
                              )}
                              {wqieActive && (
                                <div className="glass rounded-xl px-3 py-3 space-y-1" style={{ borderColor: wqieApproved ? "rgba(34,197,94,0.2)" : "rgba(14,165,233,0.2)" }}>
                                  <p className="text-white/30 text-xs font-semibold uppercase tracking-wider">WQIE Stake</p>
                                  <p className="text-white font-bold text-sm">{parseFloat(ethers.formatUnits(stakeAmount, wqieDec)).toLocaleString()} WQIE</p>
                                  <p className="text-green-400/60 text-xs">Refundable — returned on exit</p>
                                  <p className={`text-xs font-medium ${hasWqieBal ? "text-white/40" : "text-red-400"}`}>
                                    Balance: {parseFloat(ethers.formatUnits(wqieBal, wqieDec)).toLocaleString()} WQIE
                                  </p>
                                  <p className={`text-xs font-semibold ${wqieApproved ? "text-green-400" : "text-amber-400"}`}>
                                    {wqieApproved ? "✅ Approved" : "⏳ Needs approval"}
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Step 1 — Approve QUSDC (only if active) */}
                            {qusdcActive && (
                              <>
                                <div className="flex items-start gap-3">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                                    qusdcApproved
                                      ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                      : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                  }`}>{qusdcApproved ? "✓" : "1"}</div>
                                  <div className="flex-1">
                                    {qusdcApproved ? (
                                      <p className="text-green-400 text-sm font-semibold pt-1">QUSDC fee approved ✅</p>
                                    ) : (
                                      <>
                                        <p className="text-white/70 text-sm font-semibold mb-1">Approve QUSDC Registration Fee</p>
                                        <p className="text-white/30 text-xs mb-2">One-time fee sent to treasury — non-refundable</p>
                                        {approveTxError && (
                                          <p className="text-red-400/80 text-xs mb-2 break-all">⚠️ {approveTxError}</p>
                                        )}
                                        <button
                                          onClick={handleApproveQusdc}
                                          disabled={approvePending || approveWaiting || !hasQusdcBal}
                                          className="w-full text-white py-2.5 rounded-xl font-semibold text-sm border border-amber-500/30 hover:border-amber-500/50 transition-all"
                                          style={{ background: "rgba(245,158,11,0.15)", opacity: !hasQusdcBal ? 0.5 : 1 }}>
                                          {approvePending ? "📱 Confirm in wallet…" : approveWaiting ? "⏳ Approving…" : `Approve ${parseFloat(ethers.formatUnits(regFee, qusdcDec)).toLocaleString()} QUSDC`}
                                        </button>
                                        {!hasQusdcBal && (
                                          <p className="text-red-400/60 text-xs mt-1.5">⚠️ Insufficient QUSDC balance</p>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="border-t border-white/[0.06]" />
                              </>
                            )}

                            {/* Step 2 — Approve WQIE (only if active) */}
                            {wqieActive && (
                              <>
                                <div className="flex items-start gap-3">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                                    wqieApproved
                                      ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                      : qusdcActive && !qusdcApproved
                                      ? "bg-white/5 text-white/20 border border-white/10"
                                      : "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                                  }`}>{wqieApproved ? "✓" : qusdcActive ? "2" : "1"}</div>
                                  <div className="flex-1">
                                    {wqieApproved ? (
                                      <p className="text-green-400 text-sm font-semibold pt-1">WQIE stake approved ✅</p>
                                    ) : (
                                      <>
                                        <p className={`text-sm font-semibold mb-1 ${qusdcActive && !qusdcApproved ? "text-white/25" : "text-white/70"}`}>
                                          Approve WQIE Security Stake
                                        </p>
                                        <p className={`text-xs mb-2 ${qusdcActive && !qusdcApproved ? "text-white/20" : "text-white/30"}`}>
                                          Held in contract — refunded if rejected, revoked, or you voluntarily exit
                                        </p>
                                        {approveWqieTxError && (
                                          <p className="text-red-400/80 text-xs mb-2 break-all">⚠️ {approveWqieTxError}</p>
                                        )}
                                        <button
                                          onClick={handleApproveWqie}
                                          disabled={approveWqiePending || approveWqieWaiting || !hasWqieBal || (qusdcActive && !qusdcApproved)}
                                          className="w-full text-white py-2.5 rounded-xl font-semibold text-sm border border-sky-500/30 hover:border-sky-500/50 transition-all"
                                          style={{ background: "rgba(14,165,233,0.15)", opacity: (!hasWqieBal || (qusdcActive && !qusdcApproved)) ? 0.4 : 1 }}>
                                          {approveWqiePending ? "📱 Confirm in wallet…" : approveWqieWaiting ? "⏳ Approving…" : `Approve ${parseFloat(ethers.formatUnits(stakeAmount, wqieDec)).toLocaleString()} WQIE`}
                                        </button>
                                        {!hasWqieBal && (
                                          <p className="text-red-400/60 text-xs mt-1.5">⚠️ Insufficient WQIE balance</p>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="border-t border-white/[0.06]" />
                              </>
                            )}

                            {/* Final step — Register Institution */}
                            <div className="flex items-start gap-3">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                                isApproved
                                  ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                                  : "bg-white/5 text-white/20 border border-white/10"
                              }`}>{qusdcActive && wqieActive ? "3" : (qusdcActive || wqieActive) ? "2" : "1"}</div>
                              <div className="flex-1">
                                <p className={`text-sm font-semibold mb-2 ${isApproved ? "text-white/70" : "text-white/25"}`}>Register Institution</p>
                                {(err || regTxError) && isApproved && (
                                  <div className="glass rounded-xl px-4 py-3 mb-2 flex items-start gap-3 border border-red-500/25">
                                    <span>⚠️</span>
                                    <div>
                                      <p className="text-red-300 text-sm font-semibold">{err || "Transaction failed"}</p>
                                      {regTxError && !err && <p className="text-red-300/60 text-xs mt-1 break-all">{regTxError}</p>}
                                    </div>
                                  </div>
                                )}
                                {regOk && (
                                  <div className="rounded-xl px-4 py-3 mb-2 border border-green-500/25" style={{ background: "rgba(34,197,94,0.08)" }}>
                                    <p className="text-green-400 text-sm font-semibold">{ins.regOk}</p>
                                  </div>
                                )}
                                <button
                                  onClick={handleRegister}
                                  disabled={!isApproved || regPending || regWaiting}
                                  className="btn-primary w-full text-white py-3.5 rounded-2xl font-semibold text-sm"
                                  style={{ opacity: !isApproved ? 0.4 : 1 }}>
                                  {regPending ? ins.regPending : regWaiting ? ins.regWaiting : ins.regBtn}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          /* No staking required (testnet / both amounts = 0) — direct register */
                          <>
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
                            <button
                              onClick={handleRegister}
                              disabled={regPending || regWaiting || stakingConfigLoading}
                              className="btn-primary w-full text-white py-3.5 rounded-2xl font-semibold text-sm mt-2">
                              {stakingConfigLoading ? "⏳ Loading…" : regPending ? ins.regPending : regWaiting ? ins.regWaiting : ins.regBtn}
                            </button>
                          </>
                        )}
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
            {tab === "issue" && (() => {
              const typeInfo = iss.docType ? CRED_DOC_TYPES[iss.docType as CredDocType] : null;
              const instName = (inst as any)?.name ?? "";
              // Preview label
              const previewLabel = iss.docType
                ? [
                    iss.degreeType || iss.courseName || iss.title || iss.role || typeInfo?.short || iss.docType,
                    iss.issueYear,
                  ].filter(Boolean).join(" · ")
                : "—";

              return (
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
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">
                      Credential Type <span className="text-red-400">*</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {(Object.keys(CRED_DOC_TYPES) as CredDocType[]).map((key) => {
                        const t = CRED_DOC_TYPES[key];
                        const sel = iss.docType === key;
                        return (
                          <button key={key} type="button"
                            onClick={() => setIss({ ...iss, docType: key, degreeType: "", courseName: "", role: "", dateFrom: "", dateTo: "", title: "" })}
                            className={`rounded-xl px-3 py-2.5 text-xs font-semibold text-left border transition-all ${sel ? "text-white" : "text-white/40 hover:text-white/70"}`}
                            style={sel ? {
                              background:   "linear-gradient(135deg, rgba(14,165,233,0.2), rgba(129,140,248,0.15))",
                              borderColor:  "rgba(14,165,233,0.4)",
                            } : {
                              background:   "rgba(255,255,255,0.03)",
                              borderColor:  "rgba(255,255,255,0.08)",
                            }}>
                            <span className="block text-base mb-0.5">{t.icon}</span>
                            {t.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <Field label={ins.fieldCandidate}  value={iss.candidate}
                    onChange={(v) => setIss({ ...iss, candidate: v })}
                    placeholder={ins.candidatePlaceholder} />

                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                      Candidate Full Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={iss.candidateName}
                      onChange={(e) => setIss({ ...iss, candidateName: e.target.value })}
                      placeholder="e.g. Rahul Sharma"
                      className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                    />
                    <p className="text-white/25 text-xs mt-1.5">Name exactly as it appears on the document</p>
                  </div>

                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                      Issue / Passing Year <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={iss.issueYear}
                      onChange={(e) => setIss({ ...iss, issueYear: e.target.value })}
                      placeholder={iss.docType === "EXPERIENCE_LETTER" ? "e.g. 2022" : "e.g. 2024"}
                      className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                    />
                  </div>
                  {iss.docType === "DEGREE" && (
                    <div>
                      <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">Degree / Program</label>
                      <input
                        value={iss.degreeType}
                        onChange={(e) => setIss({ ...iss, degreeType: e.target.value })}
                        placeholder="e.g. B.Tech, MBA, M.Sc, PhD"
                        className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                      />
                    </div>
                  )}
                  {(iss.docType === "CERTIFICATE" || iss.docType === "COURSE_COMPLETION") && (
                    <div>
                      <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                        {iss.docType === "CERTIFICATE" ? "Certificate Title" : "Course Name"}
                      </label>
                      <input
                        value={iss.courseName}
                        onChange={(e) => setIss({ ...iss, courseName: e.target.value })}
                        placeholder={iss.docType === "CERTIFICATE" ? "e.g. AWS Solutions Architect" : "e.g. Full Stack Web Development"}
                        className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                      />
                    </div>
                  )}
                  {iss.docType === "EXPERIENCE_LETTER" && (
                    <>
                      <div>
                        <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">Role / Designation</label>
                        <input
                          value={iss.role}
                          onChange={(e) => setIss({ ...iss, role: e.target.value })}
                          placeholder="e.g. Software Engineer, Intern"
                          className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">From</label>
                          <input
                            value={iss.dateFrom}
                            onChange={(e) => setIss({ ...iss, dateFrom: e.target.value })}
                            placeholder="e.g. Jan 2022"
                            className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">To</label>
                          <input
                            value={iss.dateTo}
                            onChange={(e) => setIss({ ...iss, dateTo: e.target.value })}
                            placeholder="e.g. Dec 2023 or Present"
                            className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                          />
                        </div>
                      </div>
                    </>
                  )}
                  {(iss.docType === "ACHIEVEMENT" || iss.docType === "OTHER") && (
                    <div>
                      <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">Title / Description</label>
                      <input
                        value={iss.title}
                        onChange={(e) => setIss({ ...iss, title: e.target.value })}
                        placeholder="e.g. First Prize — HackIndia 2024"
                        className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">
                      Document IPFS CID
                      <span className="ml-2 text-white/20 font-normal normal-case tracking-normal">(optional)</span>
                    </label>
                    <input
                      value={iss.documentCID}
                      onChange={(e) => setIss({ ...iss, documentCID: e.target.value })}
                      placeholder="bafkreiXXXXXXXXX… — paste CID after uploading PDF to Pinata"
                      className="input-field w-full rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm font-mono"
                    />
                    <p className="text-white/25 text-xs mt-1.5">
                      Upload the degree / certificate PDF to{" "}
                      <a href="https://app.pinata.cloud" target="_blank" rel="noopener noreferrer"
                        className="text-sky-400/60 hover:text-sky-400 underline">app.pinata.cloud</a>{" "}
                      first, then paste the CID here. HR can download the original document when verifying.
                    </p>
                  </div>
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

                  {/* IPFS upload info note */}
                  <div className="rounded-xl px-4 py-3 border border-sky-500/15 flex items-start gap-3"
                    style={{ background: "rgba(14,165,233,0.05)" }}>
                    <span className="text-sky-400 shrink-0 mt-0.5">🔐</span>
                    <p className="text-sky-300/60 text-xs leading-relaxed">
                      Credential details are <strong className="text-sky-300/80">AES-256-GCM encrypted</strong> and pinned to IPFS automatically when you issue.
                      The candidate can then share a private verify link that reveals their name and details to HR.
                    </p>
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
                    disabled={!isVerified || issLoading || issPending || issWaiting}
                    className="btn-primary w-full text-white py-3.5 rounded-2xl font-semibold text-sm">
                    {issLoading
                      ? "⬆️ Encrypting & uploading to IPFS…"
                      : issPending
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
                  <div className="glass rounded-3xl p-6 border-sky-500/10 sticky top-24"
                    style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.06), rgba(129,140,248,0.04))" }}>
                    <p className="text-white/30 text-xs uppercase tracking-widest mb-5">{ins.nftPreview}</p>

                    {/* Type badge */}
                    {typeInfo && (
                      <div className="mb-3 flex items-center gap-2">
                        <span className="text-2xl">{typeInfo.icon}</span>
                        <span className="text-sky-400 text-sm font-semibold">{typeInfo.label}</span>
                      </div>
                    )}

                    <div className="glass rounded-2xl p-5 mb-4">
                      <p className="text-white/30 text-xs mb-1">{ins.institution}</p>
                      <p className="text-white font-bold">{instName || reg.name || "Your Institution"}</p>
                    </div>

                    {iss.candidateName && (
                      <div className="glass rounded-2xl p-5 mb-3">
                        <p className="text-white/30 text-xs mb-1">Candidate</p>
                        <p className="text-white text-sm font-semibold">{iss.candidateName}</p>
                      </div>
                    )}

                    <div className="glass rounded-2xl p-5 mb-4">
                      <p className="text-white/30 text-xs mb-1">{ins.credential}</p>
                      <p className="text-white text-sm">{previewLabel}</p>
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
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
