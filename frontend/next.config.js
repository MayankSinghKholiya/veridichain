/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_QIE_CHAIN_ID:   process.env.NEXT_PUBLIC_QIE_CHAIN_ID,
    NEXT_PUBLIC_QIE_RPC_URL:    process.env.NEXT_PUBLIC_QIE_RPC_URL,
    NEXT_PUBLIC_QIE_EXPLORER_URL: process.env.NEXT_PUBLIC_QIE_EXPLORER_URL,
  },
  // wagmi v3 bundles optional connectors (Porto, MetaMask SDK, Coinbase SDK) that
  // have dynamic imports. We only use injected() and walletConnect(), so stub the
  // rest to prevent webpack from failing on missing peer deps at build time.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "porto":             false,
      "porto/internal":    false,
      "@metamask/sdk":     false,
      "@coinbase/wallet-sdk": false,
    };
    return config;
  },
};

module.exports = nextConfig;
