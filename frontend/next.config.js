/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_QIE_CHAIN_ID:     process.env.NEXT_PUBLIC_QIE_CHAIN_ID,
    NEXT_PUBLIC_QIE_RPC_URL:      process.env.NEXT_PUBLIC_QIE_RPC_URL,
    NEXT_PUBLIC_QIE_EXPLORER_URL: process.env.NEXT_PUBLIC_QIE_EXPLORER_URL,
  },
  webpack: (config) => {
    // Stub optional wagmi v3 connector deps not used in this project
    config.resolve.alias = {
      ...config.resolve.alias,
      "porto":                false,
      "porto/internal":       false,
      "@metamask/sdk":        false,
      "@coinbase/wallet-sdk": false,
    };
    return config;
  },
};

module.exports = nextConfig;
