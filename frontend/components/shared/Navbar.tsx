"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useState, useEffect } from "react";
import { showToast } from "../../lib/toast";

// ── Role pill colours ─────────────────────────────────────────
const ROLE_CONFIG = {
  candidate:   { label: "Candidate",   icon: "🎓", color: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.3)", text: "#c084fc" },
  institution: { label: "Institution", icon: "🏛️", color: "rgba(14,165,233,0.15)",  border: "rgba(14,165,233,0.3)",  text: "#38bdf8" },
} as const;

export function Navbar() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();

  const [mounted,    setMounted]    = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const [walletRole, setWalletRole] = useState<"candidate" | "institution" | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Detect wallet role from localStorage — updates when address changes
  useEffect(() => {
    if (!address || !mounted) { setWalletRole(null); return; }
    try {
      const inst = localStorage.getItem(`qiepass:institution:${address.toLowerCase()}`);
      if (inst && (JSON.parse(inst) as { verified?: boolean })?.verified) {
        setWalletRole("institution"); return;
      }
      const cand = localStorage.getItem(`qiepass:candidate:${address.toLowerCase()}`);
      if (cand && (JSON.parse(cand) as { verified?: boolean })?.verified) {
        setWalletRole("candidate"); return;
      }
    } catch { /* ignore */ }
    setWalletRole(null);
  }, [address, mounted]);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setAddrCopied(true);
      showToast("Address copied to clipboard", "info");
      setTimeout(() => setAddrCopied(false), 2000);
    }).catch(() => {});
  }

  const links = [
    { href: "/verify",      label: "Verify",      icon: "🔍" },
    { href: "/institution", label: "Institution",  icon: "🏛️" },
    { href: "/candidate",   label: "Candidate",    icon: "🎓" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* ── Logo ── */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "linear-gradient(135deg, #0ea5e9, #818cf8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, boxShadow: "0 4px 14px rgba(14,165,233,0.4)",
          }}>✦</div>
          <span className="font-bold text-white text-lg tracking-tight group-hover:opacity-80 transition-opacity">
            VeridiChain
          </span>
        </Link>

        {/* ── Nav links ── */}
        <div className="hidden md:flex items-center gap-1">
          {links.map(({ href, label, icon }) => (
            <Link
              key={href} href={href}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                pathname === href
                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/20"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          ))}
        </div>

        {/* ── Right side ── */}
        <div className="flex items-center gap-2">

          {/* Network badge */}
          <div className="hidden sm:flex items-center gap-1.5 rounded-full px-3 py-1.5 border border-green-500/20"
            style={{ background: "rgba(34,197,94,0.08)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-medium">QIE Testnet</span>
          </div>

          {/* Admin link — visible, labelled, clearly secondary */}
          <Link
            href="/admin"
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              pathname === "/admin"
                ? "border-indigo-500/30 text-indigo-300 bg-indigo-500/10"
                : "border-white/[0.08] text-white/35 hover:text-white/60 hover:border-white/20 hover:bg-white/[0.03]"
            }`}
          >
            <span className="text-sm leading-none">⚙️</span>
            <span>Admin</span>
          </Link>

          {/* Wallet section — client only */}
          {mounted && isConnected ? (
            <div className="flex items-center gap-1.5">

              {/* Role badge — shown when QIE Pass is verified */}
              {walletRole && (() => {
                const rc = ROLE_CONFIG[walletRole];
                return (
                  <div
                    className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border"
                    style={{ background: rc.color, borderColor: rc.border, color: rc.text }}
                    title={`This wallet is verified as a ${walletRole}`}
                  >
                    <span>{rc.icon}</span>
                    <span>{rc.label}</span>
                  </div>
                );
              })()}

              {/* Address pill — click to copy */}
              <button
                onClick={copyAddress}
                title="Click to copy wallet address"
                className="glass glass-hover flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-mono transition-all hover:border-sky-500/30"
              >
                <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                {address?.slice(0, 6)}…{address?.slice(-4)}
                {addrCopied && (
                  <span className="text-green-400 text-xs font-sans font-semibold">✓</span>
                )}
              </button>

              {/* Disconnect */}
              <button
                onClick={() => disconnect()}
                title="Disconnect wallet"
                className="glass glass-hover w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:border-red-500/20 transition-all text-sm leading-none"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => connect({ connector: injected() })}
              className="btn-primary text-white px-5 py-2 rounded-xl text-sm font-semibold"
            >
              {mounted ? "Connect Wallet" : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
