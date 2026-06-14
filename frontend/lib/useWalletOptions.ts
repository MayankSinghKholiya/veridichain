"use client";

import { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { showToast } from "./toast";
import { wagmiConfig, IS_MOBILE_CLIENT } from "./wagmi";

// QIE Wallet deep-link scheme (confirmed from WalletConnect registry).
const QIE_DEEPLINK = "qiemobilewalletconnect://wc?uri=";

export type WalletOptionKind = "injected" | "walletconnect";

export interface WalletOption {
  id:        string;
  label:     string;
  sublabel?: string;
  icon:      string;
  kind:      WalletOptionKind;
  run:       () => void;
}

export function useWalletOptions(): { options: WalletOption[]; ready: boolean } {
  const { connect, connectors } = useConnect();
  const [env, setEnv] = useState<{ hasInjected: boolean } | null>(null);

  useEffect(() => {
    // Require .request() — iOS Safari and some apps inject window.ethereum stubs
    // that look truthy but have no .request(), crashing on connect.
    const eth = (window as unknown as { ethereum?: { request?: unknown } }).ethereum;
    setEnv({
      hasInjected: !!eth && typeof eth.request === "function",
    });
  }, []);

  const connectWith = (connector: Parameters<typeof connect>[0]["connector"]) =>
    connect({ connector }, {
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[wallet] connect error:", err);
        showToast(`Wallet connect failed: ${msg}`, "error");
      },
    });

  // Mobile: bypass @reown/appkit modal (it crashes on iOS/Android browsers).
  // Instead, capture the WC pairing URI from the connector emitter and
  // deep-link directly into the QIE Wallet app.
  const connectViaDeeplink = (hookConn: Parameters<typeof connect>[0]["connector"]) => {
    // wagmiConfig.connectors holds the real instances with the emitter property.
    const real = wagmiConfig.connectors.find(
      (c) => c.type === "walletConnect" || c.id === "walletConnect",
    ) ?? hookConn;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitter = (real as any).emitter as
      | { on: (e: string, h: (p: { type: string; data?: unknown }) => void) => void;
          off: (e: string, h: (p: { type: string; data?: unknown }) => void) => void }
      | undefined;

    if (!emitter?.on) {
      // No emitter — fall back to normal connect (may fail on mobile, but at least tries).
      connectWith(hookConn);
      return;
    }

    let done = false;
    const handler = (payload: { type: string; data?: unknown }) => {
      if (payload?.type === "display_uri" && typeof payload.data === "string" && !done) {
        done = true;
        emitter.off("message", handler);
        window.location.href = QIE_DEEPLINK + encodeURIComponent(payload.data);
      }
    };

    emitter.on("message", handler);
    const cleanup = setTimeout(() => emitter.off("message", handler), 60_000);

    connect({ connector: hookConn }, {
      onError: (err) => {
        if (!done) {
          clearTimeout(cleanup);
          emitter.off("message", handler);
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[wallet] WC connect error:", err);
          showToast(`Wallet connect failed: ${msg}`, "error");
        }
      },
    });
  };

  const options: WalletOption[] = [];

  if (env) {
    const injectedConn = connectors.find((c) => c.type === "injected" || c.id === "injected");
    const wcConn       = connectors.find((c) => c.type === "walletConnect" || c.id === "walletConnect");

    // Show injected option when a real wallet is present (e.g. QIE Wallet in-app browser,
    // MetaMask extension). On mobile without a real wallet, hasInjected is false.
    if (env.hasInjected && injectedConn) {
      options.push({
        id:       "injected",
        label:    "Browser Wallet",
        sublabel: "QIE Wallet · MetaMask · OKX",
        icon:     "🦊",
        kind:     "injected",
        run:      () => connectWith(injectedConn),
      });
    }

    if (wcConn) {
      options.push({
        id:       "walletconnect",
        label:    IS_MOBILE_CLIENT ? "Connect QIE Wallet" : "WalletConnect",
        sublabel: IS_MOBILE_CLIENT ? "Opens QIE Wallet app" : "Scan QR with your phone",
        icon:     "📱",
        kind:     "walletconnect",
        // Mobile: deep-link into QIE Wallet (bypasses crashing modal).
        // Desktop: WC QR modal (works fine on desktop).
        run: () => IS_MOBILE_CLIENT ? connectViaDeeplink(wcConn) : connectWith(wcConn),
      });
    }
  }

  return { options, ready: env !== null };
}
