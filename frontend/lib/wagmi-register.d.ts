// wagmi v2 — register our config globally so `chain` and `account`
// become optional in writeContract / readContract calls.
// See: https://wagmi.sh/react/typescript#register-your-config
import { wagmiConfig } from "./wagmi";

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
