"use client";

import { useQIEPass, PASS_CONFIGURED } from "../../lib/useQIEPass";

interface Props {
  address: `0x${string}` | undefined;
  /** "full" = DID + expiry; "compact" = icon + KYC only (default) */
  variant?: "full" | "compact";
}

export function QIEPassBadge({ address, variant = "compact" }: Props) {
  const { hasPass, did, expiry, passLoading } = useQIEPass(address);

  if (!PASS_CONFIGURED) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-white/10 text-white/25">
        🪪 QIE Pass · Testnet
      </span>
    );
  }

  if (passLoading || hasPass === undefined) {
    return (
      <span className="inline-flex h-6 w-28 rounded-full animate-pulse"
        style={{ background: "rgba(255,255,255,0.06)" }} />
    );
  }

  if (hasPass) {
    const expiryStr = expiry
      ? new Date(Number(expiry) * 1000).toLocaleDateString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
        })
      : null;

    if (variant === "full") {
      return (
        <div className="inline-flex flex-col gap-1">
          <span
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-green-500/30 text-sm font-semibold"
            style={{ background: "rgba(34,197,94,0.10)" }}
          >
            <span className="text-green-400">✅ KYC Done</span>
            <span className="text-green-300/40 text-xs font-normal">via QIE Pass</span>
          </span>
          {did && (
            <span className="text-green-300/50 text-xs font-mono px-1 break-all">
              {did}
            </span>
          )}
          {expiryStr && (
            <span className="text-white/25 text-xs px-1">
              Expires: {expiryStr}
            </span>
          )}
        </div>
      );
    }

    // compact
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-green-500/30 text-xs font-semibold"
        style={{ background: "rgba(34,197,94,0.10)" }}
      >
        <span className="text-green-400">✅ KYC Done</span>
        {did && (
          <span className="text-green-300/50 font-mono font-normal">
            · {did.length > 16 ? did.slice(0, 16) + "…" : did}
          </span>
        )}
      </span>
    );
  }

  return (
    <a
      href="https://qiepass.qie.digital"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-amber-500/30 hover:border-amber-500/50 transition-all cursor-pointer"
      style={{ background: "rgba(245,158,11,0.08)" }}
    >
      <span className="text-amber-400 font-semibold">🪪 Get QIE Pass</span>
      <span className="text-amber-300/40">→</span>
    </a>
  );
}
