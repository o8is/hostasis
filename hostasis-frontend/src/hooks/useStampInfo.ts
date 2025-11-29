import { useReadContract } from 'wagmi';
import { POSTAGE_STAMP_ADDRESS } from '../contracts/addresses';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import { EFFECTIVE_CAPACITY_BYTES } from './useCreatePostageBatch';

export interface StampInfo {
  // On-chain data
  remainingBalance: bigint;
  depth: number;
  currentPrice: bigint;

  // Calculated fields
  capacity: number; // 2^depth chunks
  timeRemainingSeconds: number | null;
  storageCapacityBytes: number;

  // Loading states
  isLoading: boolean;
}

const CHUNK_SIZE = 4096; // 4KB per chunk in Swarm
const BLOCKS_PER_DAY = 17280; // Gnosis Chain: ~5 second blocks

/**
 * Hook to fetch stamp information from blockchain only
 * @param batchId The batch ID (with or without 0x prefix)
 */
export function useStampInfo(batchId: string | undefined): StampInfo {
  // Ensure batchId has 0x prefix for blockchain calls
  const prefixedBatchId = batchId?.startsWith('0x') ? batchId : batchId ? `0x${batchId}` : undefined;

  // Fetch remaining balance from blockchain
  const { data: remainingBalance, isLoading: isLoadingBalance } = useReadContract({
    address: POSTAGE_STAMP_ADDRESS,
    abi: PostageStampABI,
    functionName: 'remainingBalance',
    args: prefixedBatchId ? [prefixedBatchId] : undefined,
    query: {
      enabled: !!prefixedBatchId,
    },
  });

  // Fetch depth from blockchain
  const { data: depth, isLoading: isLoadingDepth } = useReadContract({
    address: POSTAGE_STAMP_ADDRESS,
    abi: PostageStampABI,
    functionName: 'batchDepth',
    args: prefixedBatchId ? [prefixedBatchId] : undefined,
    query: {
      enabled: !!prefixedBatchId,
    },
  });

  // Fetch current price from blockchain
  const { data: currentPrice, isLoading: isLoadingPrice } = useReadContract({
    address: POSTAGE_STAMP_ADDRESS,
    abi: PostageStampABI,
    functionName: 'lastPrice',
    query: {
      enabled: true,
    },
  });

  // Calculate derived values
  const depthNum = depth ? Number(depth) : 0;
  const capacity = depthNum > 0 ? Math.pow(2, depthNum) : 0;

  // Use effective capacity if available in lookup table, otherwise fall back to theoretical
  const storageCapacityBytes = depthNum > 0 && EFFECTIVE_CAPACITY_BYTES[depthNum]
    ? EFFECTIVE_CAPACITY_BYTES[depthNum]
    : capacity * CHUNK_SIZE;

  // Calculate time remaining
  // Note: remainingBalance is the "normalized balance" (balance per chunk)
  // Formula: blocks remaining = remainingBalance / currentPrice
  let timeRemainingSeconds: number | null = null;
  if (remainingBalance && currentPrice) {
    const balanceBigInt = BigInt(remainingBalance as bigint);
    const priceBigInt = BigInt(currentPrice as bigint);

    if (priceBigInt > 0n) {
      // Calculate blocks remaining
      // remainingBalance is already normalized (per chunk), so we don't multiply by capacity
      const blocksRemaining = balanceBigInt / priceBigInt;
      // Convert to seconds (5 second blocks on Gnosis)
      timeRemainingSeconds = Number(blocksRemaining) * 5;
    }
  }

  const isLoading = isLoadingBalance || isLoadingDepth || isLoadingPrice;

  return {
    remainingBalance: remainingBalance ? BigInt(remainingBalance as bigint) : 0n,
    depth: depthNum,
    currentPrice: currentPrice ? BigInt(currentPrice as bigint) : 0n,
    capacity,
    timeRemainingSeconds,
    storageCapacityBytes,
    isLoading,
  };
}

/**
 * Format time remaining in a human-readable format
 */
export function formatTimeRemaining(seconds: number | null): string {
  if (seconds === null || seconds <= 0) {
    return 'Expired';
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 365) {
    const years = Math.floor(days / 365);
    const remainingDays = days % 365;
    return `${years}y ${remainingDays}d`;
  } else if (days > 30) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    return `${months}mo ${remainingDays}d`;
  } else if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format bytes in a human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
