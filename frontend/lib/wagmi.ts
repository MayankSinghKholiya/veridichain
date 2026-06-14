import { createConfig, http, fallback } from "wagmi";
import { defineChain, custom } from "viem";
import { injected, walletConnect } from "wagmi/connectors";

export const QIE_CHAIN_ID   = Number(process.env.NEXT_PUBLIC_QIE_CHAIN_ID   ?? "1983");
export const QIE_CHAIN_NAME = process.env.NEXT_PUBLIC_QIE_CHAIN_NAME         ?? "QIE Testnet";
export const QIE_RPC        = process.env.NEXT_PUBLIC_QIE_RPC_URL             ?? "https://rpc1testnet.qie.digital/";
export const QIE_EXPLORER   = process.env.NEXT_PUBLIC_QIE_EXPLORER_URL        ?? "https://testnet.qie.digital";

export const IS_MAINNET = QIE_CHAIN_ID === 1990;

export const qieTestnet = defineChain({
  id: QIE_CHAIN_ID,
  name: QIE_CHAIN_NAME,
  nativeCurrency: { decimals: 18, name: "QIE", symbol: "QIE" },
  rpcUrls: {
    default: { http: [QIE_RPC] },
  },
  blockExplorers: {
    default: { name: "QIE Explorer", url: QIE_EXPLORER },
  },
  testnet: !IS_MAINNET,
});

function makeTransport() {
  if (typeof window === "undefined") return http(QIE_RPC);
  const eth = (window as any).ethereum;
  // Avoid custom(undefined) — crashes on iOS Safari when the fallback is reached
  if (eth && typeof eth.request === "function") {
    return fallback([http(QIE_RPC), custom(eth)]);
  }
  return http(QIE_RPC);
}

export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://veridichain-ivory.vercel.app";

export const IS_MOBILE_CLIENT =
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const connectors = [
  injected(),
  ...(WC_PROJECT_ID
    ? [
        walletConnect({
          projectId: WC_PROJECT_ID,
          showQrModal: false,
          metadata: {
            name: "VeridiChain",
            description: "Decentralized credential verification on QIE Blockchain",
            url: APP_URL,
            icons: [`${APP_URL}/icon.png`],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [qieTestnet],
  connectors,
  transports: { [qieTestnet.id]: makeTransport() },
  pollingInterval: 3_000,
  reconnectOnMount: false,
});

export const CONTRACTS = {
  INSTITUTION_REGISTRY:         process.env.NEXT_PUBLIC_INSTITUTION_REGISTRY          as `0x${string}`,
  CREDENTIAL_REGISTRY:          process.env.NEXT_PUBLIC_CREDENTIAL_REGISTRY           as `0x${string}`,
  CREDENTIAL_NFT:               process.env.NEXT_PUBLIC_CREDENTIAL_NFT                as `0x${string}`,
  MANUAL_VERIFICATION_REGISTRY: process.env.NEXT_PUBLIC_MANUAL_VERIFICATION_REGISTRY  as `0x${string}`,
  QIE_PASS:                     process.env.NEXT_PUBLIC_QIE_PASS_ADDRESS              as `0x${string}`,
  QIE_STABLE_COIN:              process.env.NEXT_PUBLIC_QIE_STABLE_COIN_ADDRESS       as `0x${string}`,
  QIE_DEX:                      process.env.NEXT_PUBLIC_QIE_DEX_ADDRESS               as `0x${string}`,
};
