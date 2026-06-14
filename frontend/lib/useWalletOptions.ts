"use client";

import { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { showToast } from "./toast";
import { IS_MOBILE_CLIENT } from "./wagmi";

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
    const eth = (window as unknown as { ethereum?: { request?: unknown } }).ethereum;
    // Some mobile browsers inject a stub window.ethereum without .request()
    setEnv({ hasInjected: !!eth && typeof eth.request === "function" });
  }, []);

  const connectWith = (connector: Parameters<typeof connect>[0]["connector"]) =>
    connect({ connector }, {
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[wallet] connect error:", err);
        showToast(`Wallet connect failed: ${msg}`, "error");
      },
    });

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
