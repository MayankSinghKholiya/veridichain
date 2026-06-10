// QIE RPC limits eth_getLogs to 10,000 blocks per request.
// getLogsChunked searches backwards in 9k-block chunks.
//   accumulate:false (default) — stops on first non-empty chunk (fast, for single lookups)
//   accumulate:true            — collects all logs across all chunks (full history)
// getLogsInRange fetches a known fromBlock→toBlock range with parallel chunk requests.
//   Use for delta syncs where you already know the block range.

import type { PublicClient } from "viem";

const CHUNK    = 9_000n;
const PARALLEL = 5;

export async function getLogsChunked(
  publicClient: PublicClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>,
  maxChunks = 30,
  accumulate = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const latest = await publicClient.getBlockNumber();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acc: any[] = [];

  for (let i = 0; i < maxChunks; i++) {
    const toBlock   = latest - BigInt(i) * CHUNK;
    const fromBlock = toBlock > CHUNK ? toBlock - CHUNK + 1n : 1n;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logs = await (publicClient.getLogs as any)({ ...params, fromBlock, toBlock });

      if (accumulate) {
        if (logs.length > 0) acc.push(...logs);
      } else {
        if (logs.length > 0) return logs;
      }
    } catch {
      // range rejected by RPC, skip
    }

    if (fromBlock <= 1n) break;
  }

  return acc;
}

export async function getLogsInRange(
  publicClient: PublicClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>,
  fromBlock: bigint,
  toBlock: bigint,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  if (fromBlock > toBlock) return [];

  const chunks: [bigint, bigint][] = [];
  for (let b = fromBlock; b <= toBlock; b += CHUNK) {
    const end = b + CHUNK - 1n;
    chunks.push([b, end > toBlock ? toBlock : end]);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];

  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const batch = chunks.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(([from, to]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (publicClient.getLogs as any)({ ...params, fromBlock: from, toBlock: to })
      ),
    );
    for (const r of results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (r.status === "fulfilled") all.push(...(r.value as any[]));
    }
  }

  return all;
}
