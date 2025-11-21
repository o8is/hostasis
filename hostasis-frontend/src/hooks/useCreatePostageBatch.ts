import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { type Hex, keccak256, encodePacked, toBytes, maxUint256, erc20Abi } from 'viem';
import { BZZ_ADDRESS, POSTAGE_STAMP_ADDRESS } from '../contracts/addresses';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import { formatBZZ } from '../utils/bzzFormat';

interface CreateBatchParams {
  initialBalancePerChunk: bigint;
  depth: number;
  bucketDepth?: number;
  immutable?: boolean;
}

interface UseCreatePostageBatchReturn {
  approveBZZ: (amount: bigint) => Promise<Hex | null>;
  checkBZZAllowance: () => Promise<bigint>;
  createBatch: (params: CreateBatchParams) => Promise<Hex>;
  getBatchIdFromReceipt: (hash: Hex) => Promise<Hex>;
  calculateTotalBZZ: (balancePerChunk: bigint, depth: number) => bigint;
  isApproving: boolean;
  isCreating: boolean;
  isConfirming: boolean;
  error: Error | null;
}

/**
 * Effective storage capacity by batch depth (in bytes)
 *
 * Note: These are EFFECTIVE capacities, not theoretical maximums.
 * Swarm uses a bucket system (2^16 buckets) where chunks are distributed via hashing.
 * A batch becomes full when ANY single bucket reaches capacity (birthday paradox).
 *
 * Theoretical capacity = 2^depth × 4KB, but actual usable capacity is much lower
 * at small depths due to bucket saturation. For example:
 * - Depth 18: Theoretical 1 GB, Effective 6.66 MB (0.61% utilization)
 * - Depth 24: Theoretical 68.72 GB, Effective 47.06 GB (68.48% utilization)
 *
 * Source: Official Swarm documentation - Unencrypted, no erasure coding
 * https://docs.ethswarm.org/docs/concepts/incentives/postage-stamps/
 */
export const EFFECTIVE_CAPACITY_BYTES: Record<number, number> = {
  18: 6.66 * 1024 * 1024,              // 6.66 MB (0.61% utilization)
  19: 112.06 * 1024 * 1024,            // 112 MB (5.09% utilization)
  20: 687.62 * 1024 * 1024,            // 688 MB (15.65% utilization)
  21: 2.60 * 1024 * 1024 * 1024,       // 2.60 GB (30.27% utilization)
  22: 7.73 * 1024 * 1024 * 1024,       // 7.73 GB (44.99% utilization)
  23: 19.94 * 1024 * 1024 * 1024,      // 19.94 GB (58.03% utilization)
  24: 47.06 * 1024 * 1024 * 1024,      // 47.06 GB (68.48% utilization)
  25: 105.51 * 1024 * 1024 * 1024,     // 105.51 GB (76.77% utilization)
  26: 227.98 * 1024 * 1024 * 1024,     // 227.98 GB (82.94% utilization)
  27: 476.68 * 1024 * 1024 * 1024,     // 476.68 GB (86.71% utilization)
};

/**
 * Calculate required batch depth for a given file size.
 * Uses effective capacity (not theoretical) to account for bucket saturation.
 *
 * @param sizeInBytes - File size in bytes
 * @returns Minimum depth that can accommodate the file
 */
export function calculateDepthForSize(sizeInBytes: number): number {
  // Add 20% buffer for metadata overhead
  const bufferedSize = sizeInBytes * 1.2;

  // Find the minimum depth where effective capacity >= buffered file size
  const supportedDepths = Object.keys(EFFECTIVE_CAPACITY_BYTES)
    .map(Number)
    .sort((a, b) => a - b);

  for (const depth of supportedDepths) {
    if (EFFECTIVE_CAPACITY_BYTES[depth] >= bufferedSize) {
      return depth;
    }
  }

  // If file is larger than depth 27, fall back to theoretical calculation
  // (for very large files, effective capacity approaches theoretical)
  const requiredChunks = Math.ceil(bufferedSize / 4096);
  const depth = Math.ceil(Math.log2(requiredChunks));
  return Math.max(27, Math.min(31, depth));
}

// Calculate initial balance per chunk for desired TTL
// TTL in blocks = initialBalancePerChunk / pricePerChunkPerBlock
export function calculateBalanceForTTL(
  ttlDays: number,
  pricePerChunkPerBlock: bigint
): bigint {
  // Ensure price is not zero
  if (pricePerChunkPerBlock === 0n) {
    throw new Error('Price per chunk per block is zero. Cannot calculate balance.');
  }

  // Gnosis chain: ~5 second blocks = ~17280 blocks per day
  const blocksPerDay = 17280n;
  const totalBlocks = BigInt(ttlDays) * blocksPerDay;

  // Balance needed = blocks * price per block
  // Add 20% buffer to account for price fluctuations
  const baseBalance = totalBlocks * pricePerChunkPerBlock;
  const bufferedBalance = baseBalance + (baseBalance * 20n) / 100n;

  // Add minimum increment to prevent expiration due to rounding (bee.js does this)
  return bufferedBalance + 1n;
}

export function calculateTotalBZZ(balancePerChunk: bigint, depth: number): bigint {
  // Total BZZ = balancePerChunk * 2^depth
  return balancePerChunk * (1n << BigInt(depth));
}

export function useCreatePostageBatch(): UseCreatePostageBatchReturn {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [error, setError] = useState<Error | null>(null);

  const {
    writeContract: approveBZZWrite,
    data: approveHash,
    isPending: isApprovePending,
  } = useWriteContract();

  const { isLoading: isApproveConfirming } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  const {
    writeContract: createBatchWrite,
    data: createHash,
    isPending: isCreatePending,
  } = useWriteContract();

  const { isLoading: isCreateConfirming } = useWaitForTransactionReceipt({
    hash: createHash,
  });

  const calculateTotalBZZ = useCallback((balancePerChunk: bigint, depth: number): bigint => {
    // Total BZZ = balancePerChunk * 2^depth
    return balancePerChunk * (1n << BigInt(depth));
  }, []);

  const checkBZZAllowance = useCallback(async (): Promise<bigint> => {
    if (!publicClient || !address) return 0n;

    const allowance = await publicClient.readContract({
      address: BZZ_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, POSTAGE_STAMP_ADDRESS],
    });

    return allowance as bigint;
  }, [publicClient, address]);

  const approveBZZ = useCallback(async (amount: bigint): Promise<Hex | null> => {
    setError(null);

    // Check current allowance first
    const currentAllowance = await checkBZZAllowance();
    if (currentAllowance >= amount) {
      return null; // No approval needed
    }

    return new Promise((resolve, reject) => {
      approveBZZWrite(
        {
          address: BZZ_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [POSTAGE_STAMP_ADDRESS, maxUint256], // Approve unlimited
        },
        {
          onSuccess: (hash) => resolve(hash),
          onError: (err) => {
            setError(err instanceof Error ? err : new Error('BZZ approval failed'));
            reject(err);
          },
        }
      );
    });
  }, [approveBZZWrite, checkBZZAllowance]);

  const createBatch = useCallback(async (params: CreateBatchParams): Promise<Hex> => {
    if (!address) throw new Error('Wallet not connected');

    setError(null);

    const {
      initialBalancePerChunk,
      depth,
      bucketDepth = 16,
      immutable = true,
    } = params;

    // Validate parameters
    if (initialBalancePerChunk === 0n) {
      throw new Error('Initial balance per chunk cannot be zero');
    }

    const totalBZZ = calculateTotalBZZ(initialBalancePerChunk, depth);

    // Generate random nonce
    const nonce = keccak256(
      encodePacked(
        ['address', 'uint256', 'uint256'],
        [address, BigInt(Date.now()), BigInt(Math.floor(Math.random() * 1000000))]
      )
    );

    return new Promise((resolve, reject) => {
      createBatchWrite(
        {
          address: POSTAGE_STAMP_ADDRESS,
          abi: PostageStampABI,
          functionName: 'createBatch',
          args: [address, initialBalancePerChunk, depth, bucketDepth, nonce, immutable],
        },
        {
          onSuccess: (hash) => resolve(hash),
          onError: (err) => {
            setError(err instanceof Error ? err : new Error('Batch creation failed'));
            reject(err);
          },
        }
      );
    });
  }, [address, createBatchWrite]);

  const getBatchIdFromReceipt = useCallback(async (hash: Hex): Promise<Hex> => {
    if (!publicClient) throw new Error('Public client not available');

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Verify transaction succeeded
    if (receipt.status !== 'success') {
      throw new Error(`Transaction failed with status: ${receipt.status}`);
    }

    // Event signature: keccak256("BatchCreated(bytes32,uint256,uint256,address,uint8,uint8,bool)")
    const batchCreatedTopic = keccak256(
      toBytes('BatchCreated(bytes32,uint256,uint256,address,uint8,uint8,bool)')
    );

    // Find BatchCreated event
    const batchCreatedEvent = receipt.logs.find((log) => {
      return log.topics[0] === batchCreatedTopic;
    });

    if (!batchCreatedEvent) {
      throw new Error('BatchCreated event not found in receipt');
    }

    if (!batchCreatedEvent.topics[1]) {
      throw new Error('Batch ID not found in BatchCreated event');
    }

    const batchId = batchCreatedEvent.topics[1] as Hex;

    return batchId;
  }, [publicClient]);

  return {
    approveBZZ,
    checkBZZAllowance,
    createBatch,
    getBatchIdFromReceipt,
    calculateTotalBZZ,
    isApproving: isApprovePending || isApproveConfirming,
    isCreating: isCreatePending,
    isConfirming: isCreateConfirming,
    error,
  };
}
