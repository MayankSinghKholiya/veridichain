"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useReadContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { Navbar } from "../components/shared/Navbar";
import {
  CONTRACTS,
  INSTITUTION_REGISTRY_ABI,
  CREDENTIAL_REGISTRY_ABI,
  CREDENTIAL_NFT_ABI,
} from "../lib/contracts";
import { QIE_CHAIN_ID, QIE_CHAIN_NAME, QIE_EXPLORER } from "../lib/wagmi";

/* Credential card preview shown in hero section */
function CredentialCardMockup() {
  return (
    <div className="animate-float relative" style={{ perspective: "1000px" }}>
      <div
        className="absolute animate-orb pointer-events-none"
        style={{
          top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: 380, height: 380,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(14,165,233,0.35) 0%, rgba(129,140,248,0.15) 50%, transparent 70%)",
          filter: "blur(30px)",
        }}
      />
      <div
        className="glass absolute rounded-3xl"
        style={{ width: 340, height: 80, bottom: -18, right: -14, opacity: 0.4, transform: "rotate(3deg)" }}
      />
      <div
        className="glass-strong rounded-3xl p-7 relative z-10"
        style={{ width: 340, boxShadow: "0 25px 60px rgba(14,165,233,0.2), 0 0 0 1px rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div style={{
              width: 46, height: 46, borderRadius: 14,
              background: "linear-gradient(135deg, #0ea5e9, #818cf8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, boxShadow: "0 8px 24px rgba(14,165,233,0.4)",
            }}>🎓</div>
            <div>
              <p className="text-white font-semibold text-sm">B.Tech Degree</p>
              <p className="text-white/40 text-xs font-mono">NFT #0042 · QIE</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-green-500/15 border border-green-500/25 rounded-full px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-green-400 text-xs font-semibold">Verified</span>
          </div>
        </div>
        <div className="glass rounded-2xl p-4 mb-4">
          <p className="text-white/35 text-xs uppercase tracking-widest mb-1.5">Institution</p>
          <p className="text-white font-bold text-lg">IIT Delhi</p>
          <p className="text-white/50 text-sm">Computer Science &amp; Engineering</p>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          {[{ label: "Issued", value: "Jun 2024" }, { label: "Tier", value: "Tier 1" }].map(({ label, value }) => (
            <div key={label} className="glass rounded-xl p-3">
              <p className="text-white/35 text-xs mb-1">{label}</p>
              <p className="text-white text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
          <div>
            <p className="text-white/30 text-xs mb-0.5">Blockchain</p>
            <p className="text-sky-400 text-xs font-bold">QIE Blockchain</p>
          </div>
          <div className="text-right">
            <p className="text-white/30 text-xs mb-0.5">Status</p>
            <p className="text-sky-400 text-xs font-bold">Soulbound NFT</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Stats badge component */
function StatBadge({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="glass rounded-2xl p-6 flex items-center gap-4 hover:border-sky-500/20 transition-all">
      <div style={{
        width: 48, height: 48, borderRadius: 14, fontSize: 22,
        background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</div>
      <div>
        {value === "—" ? (
          <div className="h-8 w-14 rounded-lg bg-white/8 animate-pulse mb-1" />
        ) : (
          <p className="text-2xl font-bold text-white">{value}</p>
        )}
        <p className="text-white/40 text-sm">{label}</p>
      </div>
    </div>
  );
}

/* FAQ accordion item with open/close toggle */
function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="glass rounded-2xl overflow-hidden cursor-pointer hover:border-sky-500/20 transition-all"
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center justify-between px-6 py-5">
        <p className="text-white font-semibold text-sm pr-4">{q}</p>
        <span
          className="text-sky-400 text-lg font-bold shrink-0 transition-transform duration-300"
          style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
        >+</span>
      </div>
      {open && (
        <div className="px-6 pb-5 border-t border-white/[0.06]">
          <p className="text-white/50 text-sm leading-relaxed pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

/* Tutorial video card with thumbnail support */
function VideoCard({
  icon, title, desc, duration, link, tag, thumbnail,
}: {
  icon: string; title: string; desc: string; duration: string; link: string; tag: string; thumbnail?: string;
}) {
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="glass rounded-3xl overflow-hidden hover:border-sky-500/20 hover:scale-[1.02] transition-all duration-300 group block"
    >
      {/* Thumbnail */}
      <div className="relative flex items-center justify-center" style={{ height: 160, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {thumbnail ? (
          <>
            <Image src={thumbnail} alt={title} fill style={{ objectFit: "cover" }} />
            {/* Play overlay */}
            <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-all" />
            <div style={{
              position: "absolute", width: 52, height: 52, borderRadius: "50%",
              background: "rgba(0,0,0,0.55)", border: "2px solid rgba(255,255,255,0.7)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, transition: "transform 0.2s",
            }} className="group-hover:scale-110">▶</div>
          </>
        ) : (
          <>
            <div style={{
              background: "linear-gradient(135deg, rgba(14,165,233,0.15) 0%, rgba(129,140,248,0.1) 100%)",
              position: "absolute", inset: 0,
            }} />
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "rgba(14,165,233,0.2)", border: "2px solid rgba(14,165,233,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, boxShadow: "0 0 30px rgba(14,165,233,0.3)", transition: "transform 0.2s",
            }} className="group-hover:scale-110">▶</div>
          </>
        )}
        <span className="absolute top-3 left-3 text-xs font-semibold px-3 py-1 rounded-full z-10"
          style={{ background: "rgba(14,165,233,0.85)", color: "white" }}>{tag}</span>
        <span className="absolute bottom-3 right-3 text-xs font-mono z-10"
          style={{ background: "rgba(0,0,0,0.6)", color: "rgba(255,255,255,0.8)", padding: "2px 8px", borderRadius: 6 }}>{duration}</span>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">{icon}</span>
          <h3 className="text-white font-bold text-sm">{title}</h3>
        </div>
        <p className="text-white/40 text-xs leading-relaxed">{desc}</p>
      </div>
    </a>
  );
}

/* Main landing page */
export default function HomePage() {
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const hasContracts = !!(CONTRACTS.INSTITUTION_REGISTRY && CONTRACTS.CREDENTIAL_REGISTRY && CONTRACTS.CREDENTIAL_NFT);

  const { data: totalInst }  = useReadContract({ address: CONTRACTS.INSTITUTION_REGISTRY, abi: INSTITUTION_REGISTRY_ABI, functionName: "getTotalInstitutions", query: { enabled: hasContracts } });
  const { data: totalCreds } = useReadContract({ address: CONTRACTS.CREDENTIAL_REGISTRY,  abi: CREDENTIAL_REGISTRY_ABI,  functionName: "getTotalCredentials",   query: { enabled: hasContracts } });
  const { data: totalNFTs }  = useReadContract({ address: CONTRACTS.CREDENTIAL_NFT,        abi: CREDENTIAL_NFT_ABI,        functionName: "totalSupply",           query: { enabled: hasContracts } });

  const contracts = [
    { name: "InstitutionRegistry", addr: process.env.NEXT_PUBLIC_INSTITUTION_REGISTRY },
    { name: "CredentialRegistry",  addr: process.env.NEXT_PUBLIC_CREDENTIAL_REGISTRY },
    { name: "CredentialNFT",       addr: process.env.NEXT_PUBLIC_CREDENTIAL_NFT },
  ];

  const features = [
    { icon: "🏛️", title: "Institution Registry", desc: "Verified institutions register with QIE Pass identity + WQIE staking. Fraudulent actors get slashed automatically.", color: "from-sky-500/20 to-indigo-500/10", border: "border-sky-500/20" },
    { icon: "🪙", title: "Soulbound NFT",         desc: "Every credential is minted as a non-transferable ERC-721 NFT. Permanently tied to the candidate's wallet.",           color: "from-purple-500/20 to-pink-500/10", border: "border-purple-500/20" },
    { icon: "🔍", title: "Instant Verification",  desc: "Anyone can verify any credential on-chain in milliseconds. No login, no API keys, no central authority.",             color: "from-emerald-500/20 to-teal-500/10", border: "border-emerald-500/20" },
  ];

  const steps = [
    { n: "01", title: "Institution Registers",  desc: "Stakes WQIE as a security deposit and pays QUSDC fee. Identity verified via QIE Pass. Approved by admin." },
    { n: "02", title: "Credential is Issued",   desc: "Institution fills candidate details. Metadata encrypted & uploaded to IPFS. Soulbound NFT minted on-chain." },
    { n: "03", title: "Anyone Can Verify",      desc: "Paste credential ID or open a share link. Details decrypt instantly. No login, no middleman. Forever." },
  ];

  const problems = [
    { icon: "📄", title: "Paper Certificates",   desc: "Can be printed, forged or photocopied by anyone. HR teams spend days making phone calls just to confirm one degree." },
    { icon: "🏢", title: "Centralized Databases", desc: "One company controls your credentials. If they shut down, get hacked, or simply decide to delete records — your proof is gone." },
    { icon: "🔗", title: "Other Blockchains",    desc: "Most blockchain certificates are just PDFs stored on IPFS with no privacy, no institution accountability, and no standard for verification." },
    { icon: "🕐", title: "Manual Verification",  desc: "HR calls the university. University puts them on hold. Takes 3–10 business days. Still no guarantee of authenticity." },
  ];

  const solutions = [
    {
      icon: "⛓️",
      title: "Immutable On-Chain Proof",
      desc: "Every credential is permanently recorded on the QIE blockchain. No one — not even us — can delete or modify it. It exists as long as the blockchain does.",
      tag: "Blockchain",
      color: "rgba(14,165,233,0.12)",
      border: "rgba(14,165,233,0.25)",
    },
    {
      icon: "🎫",
      title: "QIE Pass Identity Verification",
      desc: "Institutions must hold a valid QIE Pass (on-chain identity) to register. This eliminates fake universities — if your institution isn't KYC-verified on QIE, you cannot issue credentials.",
      tag: "Identity",
      color: "rgba(168,85,247,0.12)",
      border: "rgba(168,85,247,0.25)",
    },
    {
      icon: "🪙",
      title: "WQIE Stake = Real Accountability",
      desc: "Every institution locks WQIE tokens as a security deposit. Issue a fraudulent credential? Your stake gets slashed and burned. This creates real financial consequences for bad actors.",
      tag: "Accountability",
      color: "rgba(234,179,8,0.12)",
      border: "rgba(234,179,8,0.25)",
    },
    {
      icon: "🔐",
      title: "Privacy-Preserving Metadata",
      desc: "Candidate details (name, degree, year) are encrypted with AES-256-GCM before being uploaded to IPFS. The blockchain only stores a hash. Only someone with a valid share token can decrypt the real data.",
      tag: "Privacy",
      color: "rgba(34,197,94,0.12)",
      border: "rgba(34,197,94,0.25)",
    },
    {
      icon: "🏅",
      title: "Dual-Tier Credential System",
      desc: "Tier 1 = Soulbound NFT (highest trust, institution-issued, non-transferable). Tier 2 = On-chain hash only (affordable self-attestation). Both are permanently verifiable — you choose based on your needs.",
      tag: "Flexibility",
      color: "rgba(249,115,22,0.12)",
      border: "rgba(249,115,22,0.25)",
    },
    {
      icon: "⚡",
      title: "Instant Permissionless Verification",
      desc: "No login. No API key. No waiting. Any HR team, anywhere in the world, can verify a credential in under 2 seconds by simply visiting the verify page. Zero dependence on any central server.",
      tag: "Accessibility",
      color: "rgba(20,184,166,0.12)",
      border: "rgba(20,184,166,0.25)",
    },
  ];

  const videos = [
    {
      icon: "🎓",
      title: "Candidate Guide",
      desc: "How to connect your wallet, get QIE Pass, self-attest your documents, and share your credential link with employers.",
      duration: "~3 min",
      tag: "For Students",
      link: "https://youtu.be/oGxTsqlyAGg",
      thumbnail: "/thumb-candidate.jpg",
    },
    {
      icon: "🏛️",
      title: "Institution Guide",
      desc: "How to register as a verified institution, stake WQIE, upload degree certificates via Pinata, and issue credentials to students.",
      duration: "~5 min",
      tag: "For Institutions",
      link: "https://youtu.be/BY8DemEDubU?si=TQ38iZg36n2WywAL",
      thumbnail: "/thumb-institution.jpg",
    },
    {
      icon: "💰",
      title: "Getting WQIE & QUSDC",
      desc: "Step-by-step: how to get WQIE and QUSDC tokens on the QIE network using QIEDEX. Required for institution registration.",
      duration: "~3 min",
      tag: "Token Setup",
      link: "https://youtu.be/aYENpOwszSE?si=2X-bN8FAfU5siWJz",
      thumbnail: "/thumb-tokens.jpg",
    },
  ];

  const faqs = [
    {
      q: "What is a Soulbound NFT and why can't I transfer it?",
      a: "A Soulbound NFT is a non-transferable token permanently tied to your wallet. This is intentional — credentials represent your personal achievements and cannot be sold or gifted. If credentials were transferable, the entire verification system would be meaningless.",
    },
    {
      q: "Do I need to pay to verify someone's credential?",
      a: "No. Verification is completely free and requires no wallet, no login, and no account. Simply open the share link or go to the Verify page and enter the credential ID. Anyone in the world can verify in seconds.",
    },
    {
      q: "What is QIE Pass and do I need it?",
      a: "QIE Pass is an on-chain identity system on the QIE blockchain — similar to a KYC verification. Institutions must have a QIE Pass to register. Candidates do not strictly need one, but having it provides stronger identity backing for their credentials.",
    },
    {
      q: "Why do institutions need to stake WQIE tokens?",
      a: "WQIE staking creates financial accountability. If an institution issues fraudulent credentials, their stake can be slashed (burned). This is a strong economic disincentive against fraud. The stake is fully returned when an institution is in good standing or voluntarily exits.",
    },
    {
      q: "Is my personal data (name, degree details) visible on the blockchain?",
      a: "No. Your personal details are encrypted with AES-256-GCM before being stored on IPFS. The blockchain only records a hash and a pointer (CID). Only you — using a secure share token — can grant access to decrypt the actual details.",
    },
    {
      q: "What is the difference between Tier 1 and Tier 2 credentials?",
      a: "Tier 1 credentials are Soulbound NFTs issued by a verified institution — the highest level of trust. Tier 2 credentials are on-chain hashes issued either by institutions or self-attested by candidates. Both are permanently verifiable, but Tier 1 carries the institution's digital signature and stake-backed reputation.",
    },
    {
      q: "What happens if a credential is revoked?",
      a: "If an institution revokes a credential (e.g., due to an error or fraud), the on-chain record is marked as revoked and the WQIE stake is returned. Anyone verifying the credential will immediately see it marked as revoked — the system is transparent and real-time.",
    },
    {
      q: "Can I use VeridiChain without a crypto wallet?",
      a: "You can verify any credential without a wallet — just open the share link or visit the Verify page. To issue or receive credentials, you need a MetaMask wallet connected to the QIE network. We provide guides to help you set up in minutes.",
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      <Navbar />

      {/* Hero section */}
      <section className="relative grid-bg min-h-screen flex items-center overflow-hidden pt-16">
        <div className="pointer-events-none absolute inset-0">
          <div style={{ position: "absolute", top: "20%", left: "30%", width: 600, height: 600, background: "radial-gradient(circle, rgba(14,165,233,0.12) 0%, transparent 65%)", borderRadius: "50%", filter: "blur(1px)" }} />
          <div style={{ position: "absolute", top: "40%", right: "15%", width: 400, height: 400, background: "radial-gradient(circle, rgba(129,140,248,0.1) 0%, transparent 60%)", borderRadius: "50%" }} />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-20 w-full grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="animate-slide-up">
            <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 mb-8 border-sky-500/20">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span className="text-sky-400 text-sm font-medium">Deployed on QIE Blockchain · Fully Live</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black leading-[1.08] tracking-tight mb-6">
              <span className="gradient-text">Decentralized<br />Credential</span>
              <br />
              <span className="text-white">Verification</span>
            </h1>
            <p className="text-lg text-white/50 leading-relaxed mb-10 max-w-lg">
              Issue, verify, and own academic credentials as <strong className="text-white/80">soulbound NFTs</strong> on the QIE blockchain. Tamper-proof. Permanent. No middleman.
            </p>
            <div className="flex flex-wrap gap-4 mb-10">
              <Link href="/institution" className="btn-primary text-white px-7 py-3.5 rounded-2xl font-semibold text-sm inline-flex items-center gap-2">Institution Portal <span>→</span></Link>
              <Link href="/candidate" className="glass glass-hover text-white px-7 py-3.5 rounded-2xl font-semibold text-sm inline-flex items-center gap-2 hover:border-purple-500/30 transition-all" style={{ borderColor: "rgba(168,85,247,0.15)" }}>Candidate Portal <span>🎓</span></Link>
              <Link href="/verify" className="glass glass-hover text-white px-7 py-3.5 rounded-2xl font-semibold text-sm inline-flex items-center gap-2 hover:border-sky-500/30 transition-all">Verify Credential <span className="text-white/40">↗</span></Link>
            </div>
            <div className="flex items-center gap-6 text-sm text-white/30">
              <div className="flex items-center gap-2"><span>🔒</span><span>On-chain security</span></div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2"><span>⚡</span><span>Instant verification</span></div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2"><span>🌐</span><span>QIE Ecosystem</span></div>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <CredentialCardMockup />
          </div>
        </div>
      </section>

      {/* Live stats from blockchain */}
      <section className="relative py-16 border-y border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <StatBadge icon="🏛️" label="Institutions Registered" value={totalInst  != null ? String(totalInst)  : "—"} />
          <StatBadge icon="📄" label="Credentials Issued"      value={totalCreds != null ? String(totalCreds) : "—"} />
          <StatBadge icon="🪙" label="Soulbound NFTs Minted"   value={totalNFTs  != null ? String(totalNFTs)  : "—"} />
          <StatBadge icon="⛓️" label="Blockchain"              value="QIE Chain" />
        </div>
      </section>

      {/* Core features */}
      <section className="py-24 max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-4">Core Features</p>
          <h2 className="text-4xl font-bold text-white mb-4">Built for the next era of trust</h2>
          <p className="text-white/40 max-w-xl mx-auto">Every component is designed to be transparent, permissionless, and verifiable by anyone in the world.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className={`rounded-3xl p-8 border bg-gradient-to-br ${f.color} ${f.border} hover:scale-[1.02] transition-all duration-300`}>
              <div style={{ width: 56, height: 56, borderRadius: 16, fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.07)", marginBottom: 20 }}>{f.icon}</div>
              <h3 className="text-white font-bold text-xl mb-3">{f.title}</h3>
              <p className="text-white/50 leading-relaxed text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why VeridiChain */}
      <section className="py-24 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6">

          {/* Header */}
          <div className="text-center mb-20">
            <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-4">Why VeridiChain</p>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-6 leading-tight">
              The world doesn&apos;t need<br />
              <span className="gradient-text">another certificate tool.</span>
            </h2>
            <p className="text-white/40 max-w-2xl mx-auto text-lg leading-relaxed">
              It needs one that cannot be faked, cannot be deleted, and doesn&apos;t depend on any company staying online.
              Here&apos;s exactly how VeridiChain is different from everything else.
            </p>
          </div>

          {/* Problem vs Solution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-20">

            {/* Problems column */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center text-sm">✗</div>
                <h3 className="text-red-400 font-bold text-sm uppercase tracking-widest">The Problem Today</h3>
              </div>
              <div className="space-y-4">
                {problems.map((p) => (
                  <div key={p.title} className="rounded-2xl p-5 flex gap-4" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)" }}>
                    <span className="text-2xl shrink-0 mt-0.5">{p.icon}</span>
                    <div>
                      <p className="text-red-300/80 font-semibold text-sm mb-1">{p.title}</p>
                      <p className="text-white/35 text-xs leading-relaxed">{p.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Solutions column */}
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center text-sm">✓</div>
                <h3 className="text-green-400 font-bold text-sm uppercase tracking-widest">The VeridiChain Way</h3>
              </div>
              <div className="space-y-4">
                {[
                  { icon: "⛓️", title: "Tamper-proof on-chain record", desc: "Once issued, no one can edit or delete a credential — not even us. It lives on the blockchain forever." },
                  { icon: "🎫", title: "Real institution identity via QIE Pass", desc: "Only KYC-verified institutions with a QIE Pass can issue credentials. Fake universities simply cannot register." },
                  { icon: "🪙", title: "Financial stake = real accountability", desc: "Institutions lock WQIE tokens. Fraud = tokens burned. This makes bad behavior economically self-destructive." },
                  { icon: "⚡", title: "2-second free verification — no account needed", desc: "Any HR team opens a link, sees verified/revoked status instantly. Zero setup, zero cost, zero waiting." },
                ].map((s) => (
                  <div key={s.title} className="rounded-2xl p-5 flex gap-4" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.12)" }}>
                    <span className="text-2xl shrink-0 mt-0.5">{s.icon}</span>
                    <div>
                      <p className="text-green-300/80 font-semibold text-sm mb-1">{s.title}</p>
                      <p className="text-white/35 text-xs leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detailed differentiators grid */}
          <div className="text-center mb-12">
            <p className="text-white/40 text-sm uppercase tracking-widest font-semibold">Deep Dive</p>
            <h3 className="text-white font-bold text-2xl mt-2">6 things that make VeridiChain unique</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {solutions.map((s) => (
              <div
                key={s.title}
                className="rounded-3xl p-7 hover:scale-[1.02] transition-all duration-300"
                style={{ background: s.color, border: `1px solid ${s.border}` }}
              >
                <div className="flex items-center justify-between mb-5">
                  <span className="text-3xl">{s.icon}</span>
                  <span
                    className="text-xs font-bold px-3 py-1 rounded-full"
                    style={{ background: s.color, border: `1px solid ${s.border}`, color: "rgba(255,255,255,0.6)" }}
                  >{s.tag}</span>
                </div>
                <h3 className="text-white font-bold text-base mb-3">{s.title}</h3>
                <p className="text-white/45 text-xs leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          {/* Comparison table */}
          <div className="mt-20 glass rounded-3xl overflow-hidden">
            <div className="px-8 py-6 border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
              <h3 className="text-white font-bold text-lg">At a glance: VeridiChain vs. the alternatives</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left px-8 py-4 text-white/30 font-semibold text-xs uppercase tracking-wider w-1/4">Feature</th>
                    <th className="text-center px-4 py-4 text-white/30 font-semibold text-xs uppercase tracking-wider">Paper Cert</th>
                    <th className="text-center px-4 py-4 text-white/30 font-semibold text-xs uppercase tracking-wider">LinkedIn / Credly</th>
                    <th className="text-center px-4 py-4 text-white/30 font-semibold text-xs uppercase tracking-wider">Other Blockchain</th>
                    <th className="text-center px-4 py-4 text-sky-400 font-bold text-xs uppercase tracking-wider bg-sky-500/5">VeridiChain</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { feature: "Cannot be forged",           vals: ["❌", "⚠️ Editable", "✅", "✅"] },
                    { feature: "Free to verify",             vals: ["❌ Manual call", "❌ Login required", "⚠️ Varies", "✅ Always free"] },
                    { feature: "Privacy control",            vals: ["❌", "❌", "❌ Public", "✅ AES-256 encrypted"] },
                    { feature: "Institution accountability", vals: ["❌", "❌", "❌", "✅ WQIE stake + slash"] },
                    { feature: "Works if company shuts down",vals: ["✅ (paper)", "❌", "✅", "✅"] },
                    { feature: "Identity-verified issuers",  vals: ["❌", "⚠️ Self-reported", "❌", "✅ QIE Pass KYC"] },
                    { feature: "Soulbound (non-transferable)",vals: ["✅ (physical)", "❌", "❌ Most transferable", "✅ ERC-721 soulbound"] },
                  ].map((row, i) => (
                    <tr key={row.feature} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-8 py-4 text-white/60 font-medium">{row.feature}</td>
                      {row.vals.map((v, vi) => (
                        <td
                          key={vi}
                          className={`text-center px-4 py-4 text-xs ${vi === 3 ? "text-sky-300 font-semibold bg-sky-500/[0.04]" : "text-white/40"}`}
                        >{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-4">Process</p>
            <h2 className="text-4xl font-bold text-white">How It Works</h2>
            <p className="text-white/40 mt-4 max-w-lg mx-auto">Three steps. End-to-end on the blockchain. No paperwork, no waiting.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="hidden md:block absolute top-10 left-1/6 right-1/6 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(14,165,233,0.3), transparent)" }} />
            {steps.map((s, i) => (
              <div key={s.n} className="glass rounded-3xl p-8 relative hover:border-sky-500/20 transition-all">
                <div className="flex items-center gap-4 mb-5">
                  <span className="text-5xl font-black gradient-text-sky leading-none">{s.n}</span>
                  {i < 2 && (
                    <div className="hidden md:block ml-auto">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12h14M13 6l6 6-6 6" stroke="rgba(14,165,233,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                </div>
                <h3 className="text-white font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tutorial videos */}
      <section className="py-24 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-4">Get Started</p>
            <h2 className="text-4xl font-bold text-white mb-4">Step-by-step video guides</h2>
            <p className="text-white/40 max-w-xl mx-auto">
              Never used blockchain before? No problem. Watch our short guides and be up and running in minutes.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {videos.map((v) => (
              <VideoCard key={v.title} {...v} />
            ))}
          </div>
          <div className="mt-10 text-center">
            <p className="text-white/25 text-sm">
              All videos are free · No account needed to watch ·{" "}
              <a href="https://www.youtube.com/playlist?list=PL3yFQknU9XcAK58xG5GUf734j27HPfqEN" target="_blank" rel="noopener noreferrer" className="text-sky-400/60 hover:text-sky-400 transition-colors">View full playlist ↗</a>
            </p>
          </div>
        </div>
      </section>

      {/* Deployed contract addresses */}
      <section className="py-16 max-w-7xl mx-auto px-6">
        <div className="glass rounded-3xl overflow-hidden border-sky-500/10">
          <div className="flex items-center gap-2 px-6 py-4 border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.03)" }}>
            <span className="w-3 h-3 rounded-full bg-red-400/60" />
            <span className="w-3 h-3 rounded-full bg-yellow-400/60" />
            <span className="w-3 h-3 rounded-full bg-green-400/60" />
            <span className="text-white/30 text-xs font-mono ml-3">Deployed Contracts — {QIE_CHAIN_NAME} (chain: {QIE_CHAIN_ID})</span>
          </div>
          <div className="p-6 space-y-3 font-mono text-sm">
            {contracts.map(({ name, addr }) => (
              <div key={name} className="flex items-center gap-4 flex-wrap">
                <span className="text-sky-400 w-56 shrink-0">{name}</span>
                <span className="text-white/30">=</span>
                <a href={`${QIE_EXPLORER}/address/${addr}`} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300 break-all hover:underline transition-colors">{addr}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ section */}
      <section className="py-24 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-4">Help Desk</p>
            <h2 className="text-4xl font-bold text-white mb-4">Frequently Asked Questions</h2>
            <p className="text-white/40 max-w-lg mx-auto">
              Everything you need to know about VeridiChain. Can&apos;t find your answer?
              Reach out on our community channels.
            </p>
          </div>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <FAQItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>

          {/* Still have questions */}
          <div className="mt-12 rounded-3xl p-8 text-center" style={{ background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)" }}>
            <p className="text-2xl mb-2">💬</p>
            <h3 className="text-white font-bold mb-2">Still have questions?</h3>
            <p className="text-white/40 text-sm mb-5">Join our community or watch the video guides above — we have walkthroughs for every step.</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <a href="https://youtube.com" target="_blank" rel="noopener noreferrer"
                className="glass glass-hover text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all">
                📺 Watch Guides
              </a>
              <Link href="/verify" className="glass glass-hover text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all">
                🔍 Try Verifying
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="py-24 max-w-7xl mx-auto px-6">
        <div className="rounded-3xl p-12 text-center relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.15) 0%, rgba(129,140,248,0.1) 100%)", border: "1px solid rgba(14,165,233,0.2)" }}>
          <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(14,165,233,0.1), transparent 70%)" }} />
          <div className="relative z-10">
            <h2 className="text-4xl font-bold text-white mb-4">Ready to get started?</h2>
            <p className="text-white/50 mb-8 max-w-md mx-auto">Join the decentralized credential ecosystem on QIE blockchain. Free to verify. Always online. Forever yours.</p>
            <div className="flex flex-wrap gap-4 justify-center">
              {mounted && isConnected ? (
                <>
                  <Link href="/institution" className="btn-primary text-white px-8 py-3.5 rounded-2xl font-semibold">Open Institution Portal</Link>
                  <Link href="/candidate"   className="glass glass-hover text-white px-8 py-3.5 rounded-2xl font-semibold transition-all">View My Credentials</Link>
                </>
              ) : (
                <button onClick={() => connect({ connector: injected() })} className="btn-primary text-white px-10 py-4 rounded-2xl font-semibold text-lg">
                  Connect Wallet to Start
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.05] py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/icon.png" alt="VeridiChain" width={28} height={28} style={{ flexShrink: 0 }} />
            <span className="text-white/60 text-sm font-medium">VeridiChain</span>
          </div>
          <a
            href="https://x.com/yoursheartie"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/30 hover:text-white/60 text-xs transition-colors"
          >
            Built by @yoursheartie
          </a>
          <div className="flex gap-6">
            {["/verify", "/institution", "/candidate"].map((href) => (
              <Link key={href} href={href} className="text-white/30 hover:text-white/60 text-sm capitalize transition-colors">{href.slice(1)}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
