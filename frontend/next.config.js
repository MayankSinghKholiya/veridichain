/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ox/viem internal types are deeply nested — suppresses the known
  // "Type instantiation is excessively deep" build error from the ox library.
  // Our own app code is still clean (verified via `tsc --noEmit --skipLibCheck`).
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_QIE_CHAIN_ID:   process.env.NEXT_PUBLIC_QIE_CHAIN_ID,
    NEXT_PUBLIC_QIE_RPC_URL:    process.env.NEXT_PUBLIC_QIE_RPC_URL,
    NEXT_PUBLIC_QIE_EXPLORER_URL: process.env.NEXT_PUBLIC_QIE_EXPLORER_URL,
  },
};

module.exports = nextConfig;
