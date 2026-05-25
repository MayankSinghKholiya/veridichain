"use client";

import Link from "next/link";
import { useAccount, useConnect, useDisconnect, useReadContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { Navbar } from "../components/shared/Navbar";
import {
  CONTRACTS,
  INSTITUTION_REGISTRY_ABI,
  CREDENTIAL_REGISTRY_ABI,
  CREDENTIAL_NFT_ABI,
} from "../lib/contracts";

/* ── Floating credential card mockup ───────────────────── */
function CredentialCardMockup() {
  return (
    <div className="animate-float relative" style={{ perspective: "1000px" }}>
      {/* Background glow orb */}
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

      {/* Card behind (depth effect) */}
      <div
        className="glass absolute rounded-3xl"
        style={{
          width: 340, height: 80,
          bottom: -18, right: -14,
          opacity: 0.4,
          transform: "rotate(3deg)",
        }}
      />

      {/* Main credential card */}
      <div
        className="glass-strong rounded-3xl p-7 relative z-10"
        style={{ width: 340, boxShadow: "0 25px 60px rgba(14,165,233,0.2), 0 0 0 1px rgba(255,255,255,0.08)" }}
      >
        {/* Header */}
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

        {/* Body */}
        <div className="glass rounded-2xl p-4 mb-4">
          <p className="text-white/35 text-xs uppercase tracking-widest mb-1.5">Institution</p>
          <p className="text-white font-bold text-lg">IIT Delhi</p>
          <p className="text-white/50 text-sm">Computer Science &amp; Engineering</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: "Issued", value: "Jun 2024" },
            { label: "Tier",   value: "Tier 1" },
          ].map(({ label, value }) => (
            <div key={label} className="glass rounded-xl p-3">
              <p className="text-white/35 text-xs mb-1">{label}</p>
              <p className="text-white text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
          <div>
            <p className="text-white/30 text-xs mb-0.5">Blockchain</p>
            <p className="text-sky-400 text-xs font-bold">QIE Testnet · #1983</p>
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

/* ── Stats hook helper ──────────────────────────────────── */
function StatBadge({ label, value, icon }: { label: string; value: string; icon: string }) {
  const isLoading = value === "—";
  return (
    <div className="glass rounded-2xl p-6 flex items-center gap-4 hover:border-sky-500/20 transition-all">
      <div style={{
        width: 48, height: 48, borderRadius: 14, fontSize: 22,
        background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</div>
      <div>
        {isLoading ? (
          <div className="h-8 w-14 rounded-lg bg-white/8 animate-pulse mb-1" />
        ) : (
          <p className="text-2xl font-bold text-white">{value}</p>
        )}
        <p className="text-white/40 text-sm">{label}</p>
      </div>
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────── */
export default function HomePage() {
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();

  const hasContracts = !!(CONTRACTS.INSTITUTION_REGISTRY && CONTRACTS.CREDENTIAL_REGISTRY && CONTRACTS.CREDENTIAL_NFT);

  const { data: totalInst } = useReadContract({
    address: CONTRACTS.INSTITUTION_REGISTRY,
    abi: INSTITUTION_REGISTRY_ABI,
    functionName: "getTotalInstitutions",
    query: { enabled: hasContracts },
  });

  const { data: totalCreds } = useReadContract({
    address: CONTRACTS.CREDENTIAL_REGISTRY,
    abi: CREDENTIAL_REGISTRY_ABI,
    functionName: "getTotalCredentials",
    query: { enabled: hasContracts },
  });

  const { data: totalNFTs } = useReadContract({
    address: CONTRACTS.CREDENTIAL_NFT,
    abi: CREDENTIAL_NFT_ABI,
    functionName: "totalSupply",
    query: { enabled: hasContracts },
  });

  const contracts = [
    { name: "InstitutionRegistry", addr: process.env.NEXT_PUBLIC_INSTITUTION_REGISTRY },
    { name: "CredentialRegistry",  addr: process.env.NEXT_PUBLIC_CREDENTIAL_REGISTRY },
    { name: "CredentialNFT",       addr: process.env.NEXT_PUBLIC_CREDENTIAL_NFT },
  ];

  const features = [
    {
      icon: "🏛️",
      title: "Institution Registry",
      desc: "Verified institutions register with QIE Pass identity + QIEUSD staking. Fraudulent actors get slashed automatically.",
      color: "from-sky-500/20 to-indigo-500/10",
      border: "border-sky-500/20",
    },
    {
      icon: "🪙",
      title: "Soulbound NFT",
      desc: "Every credential is minted as a non-transferable ERC-721 NFT. Permanently tied to the candidate's wallet.",
      color: "from-purple-500/20 to-pink-500/10",
      border: "border-purple-500/20",
    },
    {
      icon: "🔍",
      title: "Instant Verification",
      desc: "Anyone can verify any credential on-chain in milliseconds. No login, no API keys, no central authority.",
      color: "from-emerald-500/20 to-teal-500/10",
      border: "border-emerald-500/20",
    },
  ];

  const steps = [
    { n: "01", title: "Institution Registers",   desc: "Stakes QIEUSD, gets verified by admin with QIE Pass identity." },
    { n: "02", title: "Credential is Issued",    desc: "Institution uploads encrypted data to IPFS and mints a soulbound NFT to the candidate." },
    { n: "03", title: "Anyone Can Verify",       desc: "Paste the credential ID anywhere to get instant on-chain verification. Forever." },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#020817" }}>
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative grid-bg min-h-screen flex items-center overflow-hidden pt-16">
        {/* Background radial glow */}
        <div className="pointer-events-none absolute inset-0">
          <div style={{
            position: "absolute", top: "20%", left: "30%",
            width: 600, height: 600,
            background: "radial-gradient(circle, rgba(14,165,233,0.12) 0%, transparent 65%)",
            borderRadius: "50%", filter: "blur(1px)",
          }} />
          <div style={{
            position: "absolute", top: "40%", right: "15%",
            width: 400, height: 400,
            background: "radial-gradient(circle, rgba(129,140,248,0.1) 0%, transparent 60%)",
            borderRadius: "50%",
          }} />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 py-20 w-full grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: text */}
          <div className="animate-slide-up">
            {/* Live badge */}
            <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 mb-8 border-sky-500/20">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span className="text-sky-400 text-sm font-medium">Live on QIE Testnet · Chain ID 1983</span>
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
              <Link href="/institution"
                className="btn-primary text-white px-7 py-3.5 rounded-2xl font-semibold text-sm inline-flex items-center gap-2">
                Institution Portal
                <span>→</span>
              </Link>
              <Link href="/candidate"
                className="glass glass-hover text-white px-7 py-3.5 rounded-2xl font-semibold text-sm inline-flex items-center gap-2 hover:border-purple-500/30 transition-all"
                style={{ borderColor: "rgba(168,85,247,0.15)" }}>
                Candidate Portal
                <span>🎓</span>
              </Link>
              <Link href="/verify"
                className="glass glass-hover text-white px-7 py-3.5 rounded-2xl font-semibold text-sm inline-flex items-center gap-2 hover:border-sky-500/30 transition-all">
                Verify Credential
                <span className="text-white/40">↗</span>
              </Link>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-6 text-sm text-white/30">
              <div className="flex items-center gap-2">
                <span>🔒</span>
                <span>On-chain security</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2">
                <span>⚡</span>
                <span>Instant verification</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2">
                <span>🌐</span>
                <span>QIE Ecosystem</span>
              </div>
            </div>
          </div>

          {/* Right: floating card */}
          <div className="flex justify-center lg:justify-end">
            <CredentialCardMockup />
          </div>
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────── */}
      <section className="relative py-16 border-y border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBadge icon="🏛️" label="Institutions Registered" value={totalInst != null ? String(totalInst) : "—"} />
          <StatBadge icon="📄" label="Credentials Issued"     value={totalCreds != null ? String(totalCreds) : "—"} />
          <StatBadge icon="🪙" label="Soulbound NFTs Minted"  value={totalNFTs != null ? String(totalNFTs) : "—"} />
          <StatBadge icon="⛓️" label="Blockchain"             value="QIE #1983" />
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────── */}
      <section className="py-24 max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-4">Why VeridiChain</p>
          <h2 className="text-4xl font-bold text-white mb-4">Built for the next era of trust</h2>
          <p className="text-white/40 max-w-xl mx-auto">Every component is designed to be transparent, permissionless, and verifiable by anyone in the world.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title}
              className={`rounded-3xl p-8 border bg-gradient-to-br ${f.color} ${f.border} hover:scale-[1.02] transition-all duration-300`}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, fontSize: 26,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(255,255,255,0.07)",
                marginBottom: 20,
              }}>{f.icon}</div>
              <h3 className="text-white font-bold text-xl mb-3">{f.title}</h3>
              <p className="text-white/50 leading-relaxed text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="py-24 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-sky-400 text-sm font-semibold uppercase tracking-widest mb-4">Process</p>
            <h2 className="text-4xl font-bold text-white">How It Works</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-10 left-1/6 right-1/6 h-px"
              style={{ background: "linear-gradient(to right, transparent, rgba(14,165,233,0.3), transparent)" }} />

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

      {/* ── DEPLOYED CONTRACTS ───────────────────────────────── */}
      <section className="py-16 max-w-7xl mx-auto px-6">
        <div className="glass rounded-3xl overflow-hidden border-sky-500/10">
          {/* Terminal header */}
          <div className="flex items-center gap-2 px-6 py-4 border-b border-white/[0.06]"
            style={{ background: "rgba(255,255,255,0.03)" }}>
            <span className="w-3 h-3 rounded-full bg-red-400/60" />
            <span className="w-3 h-3 rounded-full bg-yellow-400/60" />
            <span className="w-3 h-3 rounded-full bg-green-400/60" />
            <span className="text-white/30 text-xs font-mono ml-3">Deployed Contracts — QIE Testnet (chain: 1983)</span>
          </div>
          <div className="p-6 space-y-3 font-mono text-sm">
            {contracts.map(({ name, addr }) => (
              <div key={name} className="flex items-center gap-4 flex-wrap">
                <span className="text-sky-400 w-56 shrink-0">{name}</span>
                <span className="text-white/30">=</span>
                <a
                  href={`https://testnet.qie.digital/address/${addr}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 break-all hover:underline transition-colors"
                >{addr}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ───────────────────────────────────────── */}
      <section className="py-24 max-w-7xl mx-auto px-6">
        <div className="rounded-3xl p-12 text-center relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.15) 0%, rgba(129,140,248,0.1) 100%)", border: "1px solid rgba(14,165,233,0.2)" }}>
          <div className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(circle at 50% 50%, rgba(14,165,233,0.1), transparent 70%)" }} />
          <div className="relative z-10">
            <h2 className="text-4xl font-bold text-white mb-4">Ready to verify credentials?</h2>
            <p className="text-white/50 mb-8 max-w-md mx-auto">Join the decentralized credential ecosystem on QIE blockchain.</p>
            <div className="flex flex-wrap gap-4 justify-center">
              {isConnected ? (
                <>
                  <Link href="/institution" className="btn-primary text-white px-8 py-3.5 rounded-2xl font-semibold">
                    Open Institution Portal
                  </Link>
                  <Link href="/candidate" className="glass glass-hover text-white px-8 py-3.5 rounded-2xl font-semibold transition-all">
                    View My Credentials
                  </Link>
                </>
              ) : (
                <button onClick={() => connect({ connector: injected() })}
                  className="btn-primary text-white px-10 py-4 rounded-2xl font-semibold text-lg">
                  Connect Wallet to Start
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #0ea5e9, #818cf8)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
            }}>✦</div>
            <span className="text-white/60 text-sm font-medium">VeridiChain</span>
          </div>
          <p className="text-white/25 text-xs">Built on QIE Blockchain · Hackathon 2026</p>
          <div className="flex gap-6">
            {["/verify", "/institution", "/candidate"].map((href) => (
              <Link key={href} href={href}
                className="text-white/30 hover:text-white/60 text-sm capitalize transition-colors">
                {href.slice(1)}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
