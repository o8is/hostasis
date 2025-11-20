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

// Calculate required depth for given file size
export function calculateDepthForSize(sizeInBytes: number): number {
  // Each chunk is 4096 bytes
  // Number of chunks = 2^depth
  // Total capacity = 4096 * 2^depth bytes

  // Add 20% buffer for metadata
  const bufferedSize = sizeInBytes * 1.2;
  const requiredChunks = Math.ceil(bufferedSize / 4096);
  const depth = Math.ceil(Math.log2(requiredChunks));

  // Minimum depth is 17 (practical minimum)
  // Maximum depth is 31
  return Math.max(17, Math.min(31, depth));
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
