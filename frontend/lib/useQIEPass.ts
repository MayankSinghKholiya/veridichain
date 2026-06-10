// Reads QIE Pass status for any wallet address.
//
// When QIE_PASS address is 0x000...000 (testnet / not yet deployed):
//   - All contract reads are DISABLED (query.enabled = false)
//   - passConfigured = false → UI shows "Testnet mode" badge
//   - Nothing blocks — soft integration only
//
// When real address is set in NEXT_PUBLIC_QIE_PASS_ADDRESS:
//   - Reads hasValidPass, getDID, getPassExpiry automatically
//   - UI upgrades to full KYC badge with DID and expiry
import { useReadContract } from "wagmi";
import { CONTRACTS, QIEPASS_ABI } from "./contracts";

const ZERO = "0x0000000000000000000000000000000000000000";
export const PASS_CONFIGURED =
  !!CONTRACTS.QIE_PASS && CONTRACTS.QIE_PASS !== ZERO;

export interface QIEPassInfo {
  /** true when NEXT_PUBLIC_QIE_PASS_ADDRESS is a real contract address */
  passConfigured: boolean;
  /** undefined while loading or unconfigured; true/false once read */
  hasPass: boolean | undefined;
  /** QIE Pass DID string, e.g. "qie:did:0xabc..." */
  did: string | undefined;
  /** Unix timestamp of pass expiry */
  expiry: bigint | undefined;
  /** true while any read is in-flight */
  passLoading: boolean;
}

export function useQIEPass(address: `0x${string}` | undefined): QIEPassInfo {
  const enabled = PASS_CONFIGURED && !!address;

  const { data: hasPass, isLoading: loadingPass } = useReadContract({
    address: CONTRACTS.QIE_PASS,
    abi: QIEPASS_ABI,
    functionName: "hasValidPass",
    args: [address!],
    query: { enabled },
  });

  const { data: did, isLoading: loadingDid } = useReadContract({
    address: CONTRACTS.QIE_PASS,
    abi: QIEPASS_ABI,
    functionName: "getDID",
    args: [address!],
    // Only fetch DID when pass is confirmed valid (saves an RPC call)
    query: { enabled: enabled && hasPass === true },
  });

  const { data: expiry, isLoading: loadingExpiry } = useReadContract({
    address: CONTRACTS.QIE_PASS,
    abi: QIEPASS_ABI,
    functionName: "getPassExpiry",
    args: [address!],
    query: { enabled: enabled && hasPass === true },
  });

  return {
    passConfigured: PASS_CONFIGURED,
    hasPass:        PASS_CONFIGURED ? (hasPass as boolean | undefined) : undefined,
    did:            did as string | undefined,
    expiry:         expiry as bigint | undefined,
    passLoading:    loadingPass || loadingDid || loadingExpiry,
  };
}
