"use client";

import Image from "next/image";
import { injected } from "wagmi/connectors";
import { useConnect } from "wagmi";

interface Props {
  title?: string;
  description?: string;
}

const QIE_WALLET_DOWNLOAD = "https://qie.digital";

export function ConnectWalletPrompt({
  title = "Connect Wallet",
  description = "Connect your wallet to view your credentials",
}: Props) {
  const { connect, isPending } = useConnect();

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div
        className="w-full max-w-sm rounded-3xl p-8 text-center relative overflow-hidden"
        style={{
          background: "linear-gradient(145deg, rgba(18,12,40,0.95) 0%, rgba(28,10,52,0.98) 100%)",
          border: "1px solid rgba(247,37,133,0.2)",
          boxShadow: "0 0 60px rgba(124,58,237,0.12), 0 24px 48px rgba(0,0,0,0.4)",
        }}
      >
        {/* Background glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at 50% -10%, rgba(247,37,133,0.12) 0%, transparent 65%)",
          }}
        />

        {/* QIE Logo */}
        <div className="relative z-10 mx-auto mb-6 w-24 h-24 rounded-3xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(247,37,133,0.12), rgba(124,58,237,0.18))",
            border: "1.5px solid rgba(247,37,133,0.25)",
            boxShadow: "0 8px 32px rgba(247,37,133,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <Image
            src="/qie-logo.svg"
            alt="QIE"
            width={60}
            height={60}
            className="drop-shadow-lg"
          />
        </div>

        {/* Label + Title */}
        <div className="relative z-10">
          <p className="text-white/35 text-[10px] font-bold uppercase tracking-[0.2em] mb-2">
            QIE Wallet Verification
          </p>
          <h2 className="text-white text-2xl font-black mb-2 tracking-tight">{title}</h2>
          <p className="text-white/40 text-sm leading-relaxed mb-8">{description}</p>
        </div>

        {/* Connect button */}
        <button
          onClick={() => connect({ connector: injected() })}
          disabled={isPending}
          className="relative z-10 w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-white text-sm transition-all disabled:opacity-60 hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg, #F72585, #7C3AED)",
            boxShadow: "0 4px 24px rgba(247,37,133,0.4), 0 0 0 1px rgba(247,37,133,0.2)",
          }}
        >
          <Image src="/qie-logo.svg" alt="" width={18} height={18} />
          {isPending ? "Connecting…" : "Connect QIE Wallet"}
        </button>

        {/* Divider */}
        <div className="relative z-10 flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/[0.06]" />
          <span className="text-white/20 text-xs">or</span>
          <div className="flex-1 h-px bg-white/[0.06]" />
        </div>

        {/* Download link */}
        <a
          href={QIE_WALLET_DOWNLOAD}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 flex items-center justify-center gap-2 text-sm transition-all group hover:opacity-100"
          style={{ color: "rgba(247,37,133,0.65)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span className="group-hover:underline">Don&apos;t have QIE Wallet? Download here</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>

        <p className="relative z-10 text-white/15 text-[10px] mt-5 leading-relaxed">
          Any EVM-compatible wallet works (MetaMask, OKX, Rabby).
          <br />QIE Wallet recommended for best experience.
        </p>
      </div>
    </div>
  );
}
