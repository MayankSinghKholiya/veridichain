import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../components/shared/Providers";

export const metadata: Metadata = {
  title: "VeridiChain — Decentralized Credential Verification",
  description: "Issue and verify credentials as soulbound NFTs on QIE blockchain",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
