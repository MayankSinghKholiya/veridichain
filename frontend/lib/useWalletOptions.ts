"use client";

import { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { showToast } from "./toast";

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
    const eth = (window as unknown as { ethereum?: unknown }).ethereum;
    setEnv({ hasInjected: !!eth });
  }, []);

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
        label:    "WalletConnect",
        sublabel: "Scan QR or open in wallet app",
        icon:     "📱",
        kind:     "walletconnect",
        run:      () => connectWith(wcConn),
      });
    }
  }

  return { options, ready: env !== null };
}
