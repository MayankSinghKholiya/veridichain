import { createConfig, http, fallback } from "wagmi";
import { defineChain, custom } from "viem";
import { injected, walletConnect } from "wagmi/connectors";

// To deploy on mainnet, just change these env vars:
//   NEXT_PUBLIC_QIE_CHAIN_ID=1990
//   NEXT_PUBLIC_QIE_CHAIN_NAME=QIE Mainnet
//   NEXT_PUBLIC_QIE_RPC_URL=https://rpc.qie.digital/
//   NEXT_PUBLIC_QIE_EXPLORER_URL=https://explorer.qie.digital
// Nothing else in the codebase needs to change.
export const QIE_CHAIN_ID   = Number(process.env.NEXT_PUBLIC_QIE_CHAIN_ID   ?? "1983");
export const QIE_CHAIN_NAME = process.env.NEXT_PUBLIC_QIE_CHAIN_NAME         ?? "QIE Testnet";
export const QIE_RPC        = process.env.NEXT_PUBLIC_QIE_RPC_URL             ?? "https://rpc1testnet.qie.digital/";
export const QIE_EXPLORER   = process.env.NEXT_PUBLIC_QIE_EXPLORER_URL        ?? "https://testnet.qie.digital";

/** true when deployed on QIE Mainnet (chain 1990) */
export const IS_MAINNET = QIE_CHAIN_ID === 1990;

// Define QIE chain from env — works for both testnet and mainnet
export const qieTestnet = defineChain({
  id: QIE_CHAIN_ID,
  name: QIE_CHAIN_NAME,
  nativeCurrency: {
    decimals: 18,
    name: "QIE",
    symbol: "QIE",   // Official symbol per docs.qie.digital
  },
  rpcUrls: {
    default: { http: [QIE_RPC] },
  },
  blockExplorers: {
    default: {
      name: "QIE Explorer",
      url: QIE_EXPLORER,
    },
  },
  testnet: !IS_MAINNET,
});

// Build transport: use the hardcoded QIE RPC first for reliable contract reads,
// then fall back to the wallet's own injected provider.
//
// WHY http first: wagmi's fallback() only falls back on transport *errors* — if
// the injected wallet provider silently returns empty data (not an error) for
// eth_call, wagmi never retries.  The QIE Wallet provider can return stale /
// incorrect results for `getCredentialsByCandidate`, causing credentials to show
// as 0 even when they exist on-chain.  Using the HTTP RPC first avoids this.
//
// WHY keep custom() at all: if the QIE RPC is temporarily unreachable the wallet
// provider acts as a backup so reads don't break completely.
// Writes always go through the injected connector — the transport only matters
// for reads and receipt polling, so this change does not affect sending txs.
function makeTransport() {
  // On the server (SSR), window.ethereum doesn't exist — use http only.
  if (typeof window === "undefined") {
    return http(QIE_RPC);
  }
  // HTTP RPC first → reliable eth_call results.
  // Wallet provider second → fallback if RPC is down.
  return fallback([
    http(QIE_RPC),
    custom(window.ethereum as any),
  ]);
}

// WalletConnect project ID — get a free one at https://cloud.reown.com
// (formerly cloud.walletconnect.com). Required ONLY for mobile / QR connections.
// When empty, the WalletConnect connector is simply not added, so the desktop
// injected flow keeps working exactly as before — no regression.
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// Where the dApp is hosted — used in WalletConnect metadata shown to the wallet.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://veridichain-ivory.vercel.app";

// Connectors:
//   • injected()      — desktop extensions + any wallet in-app browser (window.ethereum)
//   • walletConnect() — mobile wallets via QR scan (desktop) or app deep-link (mobile)
// WalletConnect is added only when a project ID is configured.
const connectors = [
  injected(),
  ...(WC_PROJECT_ID
    ? [
        walletConnect({
          projectId: WC_PROJECT_ID,
          showQrModal: true,
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

// Wagmi config — QIE Wallet / any injected wallet + WalletConnect (mobile)
export const wagmiConfig = createConfig({
  chains: [qieTestnet],
  connectors,
  transports: {
    [qieTestnet.id]: makeTransport(),
  },
  // Poll every 3 seconds (slightly under QIE block time ~4.2s)
  pollingInterval: 3_000,
  // Don't auto-reconnect on page load — user must explicitly click "Connect Wallet"
  // This ensures disconnect is permanent and not bypassed on refresh
  reconnectOnMount: false,
});

// Contract addresses — from env, works the same for testnet and mainnet
export const CONTRACTS = {
  INSTITUTION_REGISTRY:        process.env.NEXT_PUBLIC_INSTITUTION_REGISTRY         as `0x${string}`,
  CREDENTIAL_REGISTRY:         process.env.NEXT_PUBLIC_CREDENTIAL_REGISTRY          as `0x${string}`,
  CREDENTIAL_NFT:              process.env.NEXT_PUBLIC_CREDENTIAL_NFT               as `0x${string}`,
  MANUAL_VERIFICATION_REGISTRY:process.env.NEXT_PUBLIC_MANUAL_VERIFICATION_REGISTRY as `0x${string}`,
  QIE_PASS:                    process.env.NEXT_PUBLIC_QIE_PASS_ADDRESS              as `0x${string}`,
  QIE_STABLE_COIN:             process.env.NEXT_PUBLIC_QIE_STABLE_COIN_ADDRESS      as `0x${string}`,
  QIE_DEX:                     process.env.NEXT_PUBLIC_QIE_DEX_ADDRESS              as `0x${string}`,
};
