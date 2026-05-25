// ── Paginated getLogs utility for QIE testnet ─────────────────────
// QIE testnet RPC limits eth_getLogs to max 10,000 blocks per request.
// Two helpers are provided:
//
// getLogsChunked  – searches backwards from latest, one chunk at a time.
//   accumulate:false (default) → returns on the first chunk that has results.
//     Fast for single-event lookups (verify page).
//   accumulate:true            → collects ALL logs across all chunks.
//     Use this when you need complete history but don't know fromBlock.
//
// getLogsInRange  – fetches a KNOWN fromBlock→toBlock range with up to
//   PARALLEL=5 concurrent chunk requests at a time.
//   Use this for delta syncs (fast) and anywhere fromBlock is known.

import type { PublicClient } from "viem";

const CHUNK    = 9_000n;
const PARALLEL = 5;          // concurrent RPC calls in getLogsInRange

// ── getLogsChunked ──────────────────────────────────────────────────────────

/**
 * Like publicClient.getLogs() but transparently paginates backwards
 * through block history to handle the 10,000-block RPC limit on QIE testnet.
 *
 * @param maxChunks  – how many 9 000-block windows to search (default 30)
 * @param accumulate – when true, collect ALL logs across chunks; when false
 *                     (default) return early after the first non-empty chunk.
 */
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
      // Range rejected by RPC — skip and try the next older chunk
    }

    if (fromBlock <= 1n) break;
  }

  return acc;
}

// ── getLogsInRange ──────────────────────────────────────────────────────────

/**
 * Fetch ALL logs between fromBlock and toBlock, splitting into 9 000-block
 * chunks and firing up to PARALLEL=5 chunks simultaneously.
 *
 * Use this whenever you know the block range (delta sync, specific range).
 * Much faster than sequential getLogsChunked for large known ranges.
 *
 * Chunks that the RPC rejects are silently skipped.
 */
export async function getLogsInRange(
  publicClient: PublicClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: Record<string, any>,
  fromBlock: bigint,
  toBlock: bigint,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  if (fromBlock > toBlock) return [];

  // Build the full list of (from, to) chunk pairs
  const chunks: [bigint, bigint][] = [];
  for (let b = fromBlock; b <= toBlock; b += CHUNK) {
    const end = b + CHUNK - 1n;
    chunks.push([b, end > toBlock ? toBlock : end]);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];

  // Fire PARALLEL chunks at once, move to the next batch when all settle
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
