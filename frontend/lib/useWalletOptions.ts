"use client";

// Shared connect logic for Navbar + ConnectWalletPrompt.
// Decides which wallet-connect methods to offer based on the runtime:
//   • Browser Wallet   — injected provider present (desktop extension or in-app browser)
//   • WalletConnect    — QR scan on desktop / app deep-link on mobile (needs project ID)
//   • Open in QIE Wallet — mobile deep-link into QIE Wallet's in-app dApp browser
//
// Why a hook: window/navigator are only valid after mount, so we read them in an
// effect and rebuild the option list — avoids SSR/hydration mismatches.

import { useEffect, useState } from "react";
import { useConnect } from "wagmi";

export type WalletOptionKind = "injected" | "walletconnect" | "qie-deeplink";

export interface WalletOption {
  id:        string;
  label:     string;
  sublabel?: string;
  icon:      string;
  kind:      WalletOptionKind;
  run:       () => void;
}

// QIE Wallet in-app browser deep-link template (env-configured so we never ship a
// broken/guessed scheme). Supports {url}, {host}, {path} placeholders.
//   e.g. NEXT_PUBLIC_QIE_WALLET_DEEPLINK="qiewallet://browser?url={url}"
const QIE_DEEPLINK_TEMPLATE = process.env.NEXT_PUBLIC_QIE_WALLET_DEEPLINK ?? "";

function buildQieDeeplink(): string | null {
  if (!QIE_DEEPLINK_TEMPLATE || typeof window === "undefined") return null;
  return QIE_DEEPLINK_TEMPLATE
    .replace("{url}",  encodeURIComponent(window.location.href))
    .replace("{host}", window.location.host)
    .replace("{path}", window.location.pathname + window.location.search);
}

export function useWalletOptions(): { options: WalletOption[]; ready: boolean } {
  const { connect, connectors } = useConnect();
  const [env, setEnv] = useState<{ hasInjected: boolean; mobile: boolean } | null>(null);

  useEffect(() => {
    setEnv({
      hasInjected: typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum,
      mobile: typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    });
  }, []);

  const options: WalletOption[] = [];

  if (env) {
    const injectedConn = connectors.find((c) => c.type === "injected" || c.id === "injected");
    const wcConn       = connectors.find((c) => c.type === "walletConnect" || c.id === "walletConnect");

    // 1. Browser wallet — only when an injected provider actually exists.
    if (injectedConn && env.hasInjected) {
      options.push({
        id: "injected",
        label: "Browser Wallet",
        sublabel: "MetaMask · OKX · QIE Wallet extension",
        icon: "🦊",
        kind: "injected",
        run: () => connect({ connector: injectedConn }),
      });
    }

    // 2. WalletConnect — works everywhere (QR on desktop, deep-link on mobile).
    if (wcConn) {
      options.push({
        id: "walletconnect",
        label: "WalletConnect",
        sublabel: env.mobile ? "Open your wallet app" : "Scan QR with your phone",
        icon: "📱",
        kind: "walletconnect",
        run: () => connect({ connector: wcConn }),
      });
    }

    // 3. Open in QIE Wallet in-app browser (mobile + configured scheme only).
    const qieLink = env.mobile ? buildQieDeeplink() : null;
    if (qieLink) {
      options.push({
        id: "qie-deeplink",
        label: "Open in QIE Wallet",
        sublabel: "Opens this page in QIE Wallet's browser",
        icon: "🪪",
        kind: "qie-deeplink",
        run: () => { window.location.href = qieLink; },
      });
    }

    // Fallback: nothing offered yet (e.g. mobile, no WC project ID, no QIE scheme)
    // — still attempt the injected connector so the button is never a dead end.
    if (options.length === 0 && injectedConn) {
      options.push({
        id: "injected",
        label: "Connect Wallet",
        icon: "🔗",
        kind: "injected",
        run: () => connect({ connector: injectedConn }),
      });
    }
  }

  return { options, ready: env !== null };
}
