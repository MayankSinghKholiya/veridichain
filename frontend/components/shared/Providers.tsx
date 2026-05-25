"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "../../lib/wagmi";
import { LangProvider } from "../../lib/LangContext";
import { ToastContainer } from "./Toast";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <LangProvider>
          {children}
          <ToastContainer />
        </LangProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
