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
import { showToast } from "./toast";

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
    // A real injected wallet exposes an EIP-1193 provider with a `.request()`
    // function. Some mobile browsers (esp. iOS Safari) inject a truthy stub on
    // window.ethereum that has NO .request — connecting to it throws
    // "undefined is not an object (evaluating 'e.request')". Require .request so
    // those stubs are ignored and the user gets WalletConnect instead.
    const eth = (window as unknown as { ethereum?: { request?: unknown } }).ethereum;
    setEnv({
      hasInjected: typeof window !== "undefined" && !!eth && typeof eth.request === "function",
      mobile: typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    });
  }, []);

  // wagmi's connect() swallows errors into mutation state — surface them so a
  // failed WalletConnect init (the usual "nothing happens" cause on mobile) is
  // visible instead of silent.
  const connectWith = (connector: Parameters<typeof connect>[0]["connector"]) =>
    connect(
      { connector },
      {
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[wallet-connect] connect failed:", err);
          showToast(`Wallet connect failed: ${msg}`, "error");
        },
      },
    );

  const options: WalletOption[] = [];

  if (env) {
    const injectedConn = connectors.find((c) => c.type === "injected" || c.id === "injected");
    const wcConn       = connectors.find((c) => c.type === "walletConnect" || c.id === "walletConnect");

    const injectedOption: WalletOption | null = injectedConn && env.hasInjected ? {
      id: "injected",
      label: "Browser Wallet",
      sublabel: "MetaMask · OKX · QIE Wallet extension",
      icon: "🦊",
      kind: "injected",
      run: () => connectWith(injectedConn),
    } : null;

    const wcOption: WalletOption | null = wcConn ? {
      id: "walletconnect",
      label: "WalletConnect",
      sublabel: env.mobile ? "Open your wallet app" : "Scan QR with your phone",
      icon: "📱",
      kind: "walletconnect",
      run: () => connectWith(wcConn),
    } : null;

    // On mobile, WalletConnect is the reliable path → make it primary.
    // On desktop, the browser extension (injected) is the natural primary.
    const ordered = env.mobile ? [wcOption, injectedOption] : [injectedOption, wcOption];
    for (const opt of ordered) if (opt) options.push(opt);

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
        run: () => connectWith(injectedConn),
      });
    }
  }

  return { options, ready: env !== null };
}
