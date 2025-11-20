import { useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { type Hex, createWalletClient, http, keccak256, encodePacked, toBytes, maxUint256, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { BZZ_ADDRESS, POSTAGE_STAMP_ADDRESS } from '../contracts/addresses';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import { formatBZZ } from '../utils/bzzFormat';

interface CreateBatchWithPasskeyParams {
  passkeyPrivateKey: Hex;
  initialBalancePerChunk: bigint;
  depth: number;
  bucketDepth?: number;
  immutable?: boolean;
}

interface UsePasskeyBatchCreationReturn {
  createBatchWithPasskey: (params: CreateBatchWithPasskeyParams) => Promise<{ hash: Hex; batchId: Hex }>;
  isCreating: boolean;
  error: Error | null;
}

export function calculateTotalBZZ(balancePerChunk: bigint, depth: number): bigint {
  return balancePerChunk * (1n << BigInt(depth));
}

/**
 * Hook for creating postage stamp batches using the passkey wallet
 *
 * This creates batches where the passkey wallet is the owner,
 * allowing it to sign chunks for upload.
 */
export function usePasskeyBatchCreation(): UsePasskeyBatchCreationReturn {
  const publicClient = usePublicClient();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createBatchWithPasskey = useCallback(async (
    params: CreateBatchWithPasskeyParams
  ): Promise<{ hash: Hex; batchId: Hex }> => {
    setIsCreating(true);
    setError(null);

    try {
      const {
        passkeyPrivateKey,
        initialBalancePerChunk,
        depth,
        bucketDepth = 16,
        immutable = true
      } = params;

      if (!publicClient) {
        throw new Error('Public client not available');
      }

      // Validate parameters
      if (initialBalancePerChunk === 0n) {
        throw new Error('Initial balance per chunk cannot be zero');
      }

      // Create wallet client from passkey private key
      const account = privateKeyToAccount(passkeyPrivateKey);
      const walletClient = createWalletClient({
        account,
        chain: gnosis,
        transport: http()
      });

      const totalBZZ = calculateTotalBZZ(initialBalancePerChunk, depth);

      // Step 1: Approve BZZ tokens for PostageStamp contract
      const approveHash = await walletClient.writeContract({
        address: BZZ_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [POSTAGE_STAMP_ADDRESS, maxUint256] // Approve unlimited for future batches
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Step 2: Generate random nonce
      const nonce = keccak256(
        encodePacked(
          ['address', 'uint256', 'uint256'],
          [account.address, BigInt(Date.now()), BigInt(Math.floor(Math.random() * 1000000))]
        )
      );

      // Step 3: Create batch transaction
      const hash = await walletClient.writeContract({
        address: POSTAGE_STAMP_ADDRESS,
        abi: PostageStampABI,
        functionName: 'createBatch',
        args: [account.address, initialBalancePerChunk, depth, bucketDepth, nonce, immutable]
      });

      // Wait for transaction receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Verify transaction succeeded
      if (receipt.status !== 'success') {
        throw new Error(`Transaction failed with status: ${receipt.status}`);
      }

      // Extract batch ID from event
      const batchCreatedTopic = keccak256(
        toBytes('BatchCreated(bytes32,uint256,uint256,address,uint8,uint8,bool)')
      );

      const batchCreatedEvent = receipt.logs.find((log) => {
        return log.topics[0] === batchCreatedTopic;
      });

      if (!batchCreatedEvent || !batchCreatedEvent.topics[1]) {
        throw new Error('BatchCreated event not found in receipt');
      }

      const batchId = batchCreatedEvent.topics[1] as Hex;

      return { hash, batchId };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Batch creation failed');
      setError(error);
      throw error;
    } finally {
      setIsCreating(false);
    }
  }, [publicClient]);

  return {
    createBatchWithPasskey,
    isCreating,
    error
  };
}
