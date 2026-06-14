"use client";

import { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { showToast } from "./toast";
import { IS_MOBILE_CLIENT } from "./wagmi";

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
  // Get the raw WC EthereumProvider via getProvider(), listen to its display_uri
  // event, then deep-link directly into the QIE Wallet app.
  const connectViaDeeplink = (hookConn: Parameters<typeof connect>[0]["connector"]) => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let provider: any;
      try {
        provider = await (hookConn as any).getProvider();
      } catch {
        connectWith(hookConn);
        return;
      }

      let done = false;
      const uriHandler = (uri: string) => {
        if (!done) {
          done = true;
          provider.off?.("display_uri", uriHandler);
          window.location.href = QIE_DEEPLINK + encodeURIComponent(uri);
        }
      };

      provider.on("display_uri", uriHandler);
      const cleanup = setTimeout(() => {
        if (!done) provider.off?.("display_uri", uriHandler);
      }, 60_000);

      connect({ connector: hookConn }, {
        onError: (err) => {
          if (!done) {
            clearTimeout(cleanup);
            provider.off?.("display_uri", uriHandler);
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[wallet] WC connect error:", err);
            showToast(`Wallet connect failed: ${msg}`, "error");
          }
        },
      });
    })();
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

    // WalletConnect deep-link only on mobile — desktop users use browser extension.
    if (wcConn && IS_MOBILE_CLIENT) {
      options.push({
        id:       "walletconnect",
        label:    "Connect QIE Wallet",
        sublabel: "Opens QIE Wallet app",
        icon:     "📱",
        kind:     "walletconnect",
        run:      () => connectViaDeeplink(wcConn),
      });
    }
  }

  return { options, ready: env !== null };
}
