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

// QIE Wallet's WalletConnect deep-link scheme (from the WalletConnect wallet
// registry). On mobile we skip the WC modal entirely and open the QIE Wallet app
// directly with the pairing URI — far more reliable than the in-browser modal,
// which fails to initialize inside mobile browsers.
const QIE_WC_DEEPLINK = "qiemobilewalletconnect://wc?uri=";

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

  // Mobile WalletConnect: don't rely on the modal (it fails inside mobile
  // browsers). Capture the pairing URI the connector emits and deep-link
  // straight into the QIE Wallet app.
  const connectViaQieDeeplink = (connector: Parameters<typeof connect>[0]["connector"]) => {
    type WcMessage = { type: string; data?: unknown };
    const emitter = (connector as unknown as {
      emitter?: {
        on:  (e: "message", l: (p: WcMessage) => void) => void;
        off: (e: "message", l: (p: WcMessage) => void) => void;
      };
    }).emitter;
    if (!emitter) { connectWith(connector); return; }
    const onMessage = (payload: WcMessage) => {
      if (payload?.type === "display_uri" && typeof payload.data === "string") {
        emitter.off("message", onMessage);
        window.location.href = QIE_WC_DEEPLINK + encodeURIComponent(payload.data);
      }
    };
    emitter.on("message", onMessage);
    // Safety: stop listening if no URI arrives (e.g. user cancels).
    setTimeout(() => emitter.off("message", onMessage), 60_000);
    connectWith(connector);
  };

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
      label: env.mobile ? "Connect QIE Wallet" : "WalletConnect",
      sublabel: env.mobile ? "Opens the QIE Wallet app" : "Scan QR with your phone",
      icon: "📱",
      kind: "walletconnect",
      // Mobile → deep-link into the QIE Wallet app; desktop → WC modal/QR.
      run: () => (env.mobile ? connectViaQieDeeplink(wcConn) : connectWith(wcConn)),
    } : null;

    if (env.mobile) {
      // Mobile: WalletConnect (deep-link) is the only reliable path. Injected
      // providers on mobile browsers are unreliable stubs, so don't offer them.
      if (wcOption) options.push(wcOption);

      // Optional: open this page inside QIE Wallet's in-app browser (env-scheme).
      const qieLink = buildQieDeeplink();
      if (qieLink) {
        options.push({
          id: "qie-deeplink",
          label: "Open in QIE Wallet browser",
          sublabel: "Opens this page inside QIE Wallet",
          icon: "🪪",
          kind: "qie-deeplink",
          run: () => { window.location.href = qieLink; },
        });
      }

      // Last resort only if WC isn't configured — still let a real in-app wallet try.
      if (options.length === 0 && injectedOption) options.push(injectedOption);
    } else {
      // Desktop: browser extension first, WalletConnect (QR) second.
      if (injectedOption) options.push(injectedOption);
      if (wcOption) options.push(wcOption);
    }
  }

  return { options, ready: env !== null };
}
