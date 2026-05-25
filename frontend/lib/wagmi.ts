import { createConfig, http, fallback } from "wagmi";
import { defineChain, custom } from "viem";
import { injected } from "wagmi/connectors";

// Define QIE Testnet as a custom chain
export const qieTestnet = defineChain({
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "QIE",
    symbol: "QIE",   // Official symbol per docs.qie.digital — OKX shows KROWN but that's OKX's DB error
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_QIE_RPC_URL || "https://rpc1testnet.qie.digital/"],
    },
  },
  blockExplorers: {
    default: {
      name: "QIE Explorer",
      url: process.env.NEXT_PUBLIC_QIE_EXPLORER_URL || "https://testnet.qie.digital",
    },
  },
  testnet: true,
});

// QIE RPC URL with fallback
const QIE_RPC = process.env.NEXT_PUBLIC_QIE_RPC_URL || "https://rpc1testnet.qie.digital/";

// Build transport: try the wallet's own provider first (so wagmi polls the same RPC
// OKX uses to broadcast txs), then fall back to our hardcoded QIE RPC.
function makeTransport() {
  // On the server (SSR), window.ethereum doesn't exist — use http only.
  if (typeof window === "undefined") {
    return http(QIE_RPC);
  }
  // On the client, delegate to the injected wallet provider first so that
  // useWaitForTransactionReceipt polls the same node OKX broadcasts to.
  return fallback([
    custom(window.ethereum as any),
    http(QIE_RPC),
  ]);
}

// Wagmi config — QIE Wallet first, injected as fallback
export const wagmiConfig = createConfig({
  chains: [qieTestnet],
  connectors: [
    // Supports any injected wallet: OKX, MetaMask, Rabby, etc.
    injected(),
  ],
  transports: {
    [qieTestnet.id]: makeTransport(),
  },
  // Poll every 3 seconds (slightly under QIE testnet's ~4.2s block time)
  pollingInterval: 3_000,
});

// Contract addresses
export const CONTRACTS = {
  INSTITUTION_REGISTRY: process.env.NEXT_PUBLIC_INSTITUTION_REGISTRY   as `0x${string}`,
  CREDENTIAL_REGISTRY:  process.env.NEXT_PUBLIC_CREDENTIAL_REGISTRY    as `0x${string}`,
  CREDENTIAL_NFT:       process.env.NEXT_PUBLIC_CREDENTIAL_NFT         as `0x${string}`,
  QIE_PASS:             process.env.NEXT_PUBLIC_QIE_PASS_ADDRESS        as `0x${string}`,
  QIE_STABLE_COIN:      process.env.NEXT_PUBLIC_QIE_STABLE_COIN_ADDRESS as `0x${string}`,
  QIE_DEX:              process.env.NEXT_PUBLIC_QIE_DEX_ADDRESS         as `0x${string}`,
};

export const QIE_EXPLORER = process.env.NEXT_PUBLIC_QIE_EXPLORER_URL || "https://testnet.qie.digital";
