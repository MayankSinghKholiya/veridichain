"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { useState, useEffect, useRef } from "react";
import { showToast } from "../../lib/toast";
import { QIE_CHAIN_ID } from "../../lib/wagmi";
import { useWalletOptions } from "../../lib/useWalletOptions";

const ROLE_CONFIG = {
  candidate:   { label: "Candidate",   icon: "🎓", color: "rgba(139,92,246,0.15)", border: "rgba(139,92,246,0.3)", text: "#c084fc" },
  institution: { label: "Institution", icon: "🏛️", color: "rgba(14,165,233,0.15)",  border: "rgba(14,165,233,0.3)",  text: "#38bdf8" },
} as const;

export function Navbar() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { options: walletOptions } = useWalletOptions();

  // Show "wrong network" warning if user is on neither testnet nor mainnet
  const isOnQIEChain = !isConnected || chainId === QIE_CHAIN_ID;

  const [mounted,    setMounted]    = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const [walletRole, setWalletRole] = useState<"candidate" | "institution" | null>(null);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const connectRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Close connect popover when clicking outside
  useEffect(() => {
    if (!connectOpen) return;
    function handleClick(e: MouseEvent) {
      if (connectRef.current && !connectRef.current.contains(e.target as Node)) {
        setConnectOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [connectOpen]);

  // One option → connect directly; multiple → open the chooser popover.
  function handleConnectClick() {
    if (walletOptions.length === 1) {
      walletOptions[0].run();
    } else if (walletOptions.length > 1) {
      setConnectOpen((o) => !o);
    }
  }

  // Detect wallet role from localStorage — updates when address changes
  // Checks new chain-scoped key first, then legacy key (migration)
  useEffect(() => {
    if (!address || !mounted) { setWalletRole(null); return; }
    try {
      const addr = address.toLowerCase();
      const inst = localStorage.getItem(`qiepass:institution:${QIE_CHAIN_ID}:${addr}`)
                ?? localStorage.getItem(`qiepass:institution:${addr}`);
      if (inst && (JSON.parse(inst) as { verified?: boolean })?.verified) {
        setWalletRole("institution"); return;
      }
      const cand = localStorage.getItem(`qiepass:candidate:${QIE_CHAIN_ID}:${addr}`)
                ?? localStorage.getItem(`qiepass:candidate:${addr}`);
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
    <nav ref={menuRef} className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group shrink-0 hover:opacity-90 transition-opacity">
          <Image src="/icon.png" alt="VeridiChain icon" width={48} height={48}
            style={{ flexShrink: 0 }} priority />
          {/* Wordmark */}
          <span className="text-2xl font-black tracking-tight leading-none">
            <span style={{ color: "#ffffff" }}>Veridi</span><span style={{
              background: "linear-gradient(90deg, #38bdf8, #818cf8)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>Chain</span>
          </span>
        </Link>
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
        <div className="flex items-center gap-2">

          {/* Wrong-network warning only — no chain name badge */}
          {mounted && !isOnQIEChain && (
            <div className="hidden sm:flex items-center gap-1.5 rounded-full px-3 py-1.5 border border-red-500/30"
              style={{ background: "rgba(239,68,68,0.08)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-red-400 text-xs font-medium">Wrong Network</span>
            </div>
          )}

          {/* Admin link */}
          <Link
            href="/admin"
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.03]"
            style={pathname === "/admin" ? {
              background: "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.2))",
              border: "1px solid rgba(139,92,246,0.45)",
              color: "#c4b5fd",
              boxShadow: "0 0 16px rgba(99,102,241,0.2)",
            } : {
              background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.1))",
              border: "1px solid rgba(99,102,241,0.28)",
              color: "#a5b4fc",
              boxShadow: "0 0 10px rgba(99,102,241,0.08)",
            }}
          >
            <span className="text-sm leading-none">⚙️</span>
            <span>Admin</span>
          </Link>
          <button
            className="md:hidden flex items-center justify-center w-9 h-9 rounded-xl glass glass-hover text-white/60 hover:text-white transition-all text-lg leading-none"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? "✕" : "☰"}
          </button>

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
                onClick={() => {
                  try {
                    Object.keys(localStorage)
                      .filter(k => k.startsWith("qiepass:"))
                      .forEach(k => localStorage.removeItem(k));
                  } catch { /* ignore */ }
                  disconnect();
                  window.location.href = "/";
                }}
                title="Disconnect wallet"
                className="glass glass-hover w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-red-400 hover:border-red-500/20 transition-all text-sm leading-none"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="relative" ref={connectRef}>
              <button
                onClick={handleConnectClick}
                disabled={isPending}
                className="btn-primary text-white px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              >
                {isPending ? "Connecting…" : "Connect Wallet"}
              </button>

              {/* Connect method chooser */}
              {connectOpen && walletOptions.length > 1 && (
                <div
                  className="absolute right-0 mt-2 w-64 rounded-2xl border border-white/[0.08] p-1.5 z-50"
                  style={{ background: "rgba(2,8,23,0.98)", backdropFilter: "blur(16px)", boxShadow: "0 16px 40px rgba(0,0,0,0.5)" }}
                >
                  <p className="text-white/35 text-[10px] font-bold uppercase tracking-[0.15em] px-3 pt-2 pb-1.5">
                    Connect with
                  </p>
                  {walletOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { opt.run(); setConnectOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="text-xl leading-none shrink-0">{opt.icon}</span>
                      <span className="min-w-0">
                        <span className="block text-white text-sm font-semibold">{opt.label}</span>
                        {opt.sublabel && (
                          <span className="block text-white/35 text-xs truncate">{opt.sublabel}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {menuOpen && (
        <div
          className="md:hidden w-full glass border-t border-white/[0.06] px-4 py-3 space-y-1"
          style={{ background: "rgba(2,8,23,0.97)", backdropFilter: "blur(16px)" }}
        >
          {/* Nav links */}
          {links.map(({ href, label, icon }) => (
            <Link
              key={href} href={href}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                pathname === href
                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/20"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="text-lg leading-none">{icon}</span>
              {label}
            </Link>
          ))}

          {/* Admin link */}
          <Link
            href="/admin"
            onClick={() => setMenuOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              pathname === "/admin"
                ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                : "text-white/40 hover:text-white/70 hover:bg-white/5"
            }`}
          >
            <span className="text-lg leading-none">⚙️</span>
            Admin
          </Link>

          {/* Wrong-network warning — mobile */}
          {mounted && !isOnQIEChain && (
            <div className="px-4 py-2">
              <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 border border-red-500/30"
                style={{ background: "rgba(239,68,68,0.08)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-red-400 text-xs font-medium">Wrong Network</span>
              </div>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
