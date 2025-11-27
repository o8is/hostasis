import { useState, useCallback } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import {
  type Hex,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  toBytes,
  maxUint256,
  erc20Abi,
  parseEther
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { BZZ_ADDRESS, POSTAGE_STAMP_ADDRESS, GNOSIS_CHAIN_ID } from '../contracts/addresses';
import PostageStampABI from '../contracts/abis/PostageStamp.json';

// Native xDAI address for SushiSwap API
const NATIVE_XDAI = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

// Priority fee for Gnosis Chain transactions (2 Gwei minimum for reliable inclusion)
const GNOSIS_PRIORITY_FEE = 2000000000n; // 2 Gwei

interface CreateBatchWithReserveWalletParams {
  reservePrivateKey: Hex;
  totalXDAI: string; // Total xDAI to send (for gas + swap)
  initialBalancePerChunk: bigint;
  depth: number;
  bucketDepth?: number;
  immutable?: boolean;
}

interface UseReserveWalletBatchCreationReturn {
  createBatchWithReserveWallet: (params: CreateBatchWithReserveWalletParams) => Promise<{ hash: Hex; batchId: Hex; reserveAddress: Hex }>;
  isCreating: boolean;
  error: Error | null;
  currentStep: string;
}

export function calculateTotalBZZ(balancePerChunk: bigint, depth: number): bigint {
  return balancePerChunk * (1n << BigInt(depth));
}

/**
 * Hook for creating postage stamp batches using a reserve wallet
 *
 * This creates batches where the reserve wallet (derived key) is the owner.
 * The flow is:
 * 1. Transfer xDAI from user wallet → reserve wallet
 * 2. Reserve wallet swaps xDAI → BZZ (via SushiSwap)
 * 3. Reserve wallet approves BZZ for PostageStamp contract
 * 4. Reserve wallet creates batch (as owner)
 */
export function useReserveWalletBatchCreation(): UseReserveWalletBatchCreationReturn {
  const publicClient = usePublicClient();
  const { data: userWalletClient } = useWalletClient();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentStep, setCurrentStep] = useState('');

  const createBatchWithReserveWallet = useCallback(async (
    params: CreateBatchWithReserveWalletParams
  ): Promise<{ hash: Hex; batchId: Hex; reserveAddress: Hex }> => {
    setIsCreating(true);
    setError(null);

    try {
      const {
        reservePrivateKey,
        totalXDAI,
        initialBalancePerChunk,
        depth,
        bucketDepth = 16,
        immutable = false // Default to mutable for feed updates
      } = params;

      if (!publicClient) {
        throw new Error('Public client not available');
      }

      if (!userWalletClient) {
        throw new Error('User wallet not connected');
      }

      // Validate parameters
      if (initialBalancePerChunk === 0n) {
        throw new Error('Initial balance per chunk cannot be zero');
      }

      // Create reserve wallet client from private key
      const reserveAccount = privateKeyToAccount(reservePrivateKey);
      const reserveWalletClient = createWalletClient({
        account: reserveAccount,
        chain: gnosis,
        transport: http()
      });

      const totalXDAIWei = parseEther(totalXDAI);

      // Step 1: Transfer xDAI from user wallet to reserve wallet
      setCurrentStep('Transferring xDAI to reserve wallet...');
      const transferHash = await userWalletClient.sendTransaction({
        to: reserveAccount.address,
        value: totalXDAIWei,
        maxPriorityFeePerGas: GNOSIS_PRIORITY_FEE
      });

      await publicClient.waitForTransactionReceipt({ hash: transferHash });

      // Step 2: Get swap quote from SushiSwap (xDAI → BZZ)
      setCurrentStep('Getting swap quote...');

      // Calculate how much xDAI to swap (leave some for gas)
      const gasReserve = parseEther('0.01'); // Reserve 0.01 xDAI for gas
      const swapAmount = totalXDAIWei - gasReserve;

      const apiUrl = new URL(`https://api.sushi.com/swap/v7/${GNOSIS_CHAIN_ID}`);
      const swapParams = {
        tokenIn: NATIVE_XDAI,
        tokenOut: BZZ_ADDRESS,
        amount: swapAmount.toString(),
        maxSlippage: '0.01', // 1% slippage
        sender: reserveAccount.address,
        recipient: reserveAccount.address,
      };

      Object.entries(swapParams).forEach(([key, value]) => apiUrl.searchParams.set(key, value));

      const response = await fetch(apiUrl.toString());
      const swapData = await response.json();

      if (swapData.status !== 'Success') {
        throw new Error(`Failed to get swap quote: ${swapData.status}`);
      }

      // Step 3: Execute swap from reserve wallet
      setCurrentStep('Swapping xDAI for BZZ...');
      const swapHash = await reserveWalletClient.sendTransaction({
        to: swapData.tx.to as Hex,
        data: swapData.tx.data as Hex,
        value: swapAmount,
        maxPriorityFeePerGas: GNOSIS_PRIORITY_FEE
      });

      await publicClient.waitForTransactionReceipt({ hash: swapHash });

      // Step 4: Approve BZZ tokens for PostageStamp contract
      setCurrentStep('Approving BZZ for batch creation...');
      const approveHash = await reserveWalletClient.writeContract({
        address: BZZ_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [POSTAGE_STAMP_ADDRESS, maxUint256],
        maxPriorityFeePerGas: GNOSIS_PRIORITY_FEE
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Step 5: Generate random nonce
      const nonce = keccak256(
        encodePacked(
          ['address', 'uint256', 'uint256'],
          [reserveAccount.address, BigInt(Date.now()), BigInt(Math.floor(Math.random() * 1000000))]
        )
      );

      // Step 6: Create batch with reserve wallet as owner
      setCurrentStep('Creating postage batch...');
      const hash = await reserveWalletClient.writeContract({
        address: POSTAGE_STAMP_ADDRESS,
        abi: PostageStampABI,
        functionName: 'createBatch',
        args: [reserveAccount.address, initialBalancePerChunk, depth, bucketDepth, nonce, immutable],
        maxPriorityFeePerGas: GNOSIS_PRIORITY_FEE
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

      setCurrentStep('Complete!');
      return { hash, batchId, reserveAddress: reserveAccount.address };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Batch creation failed');
      setError(error);
      setCurrentStep('');
      throw error;
    } finally {
      setIsCreating(false);
    }
  }, [publicClient, userWalletClient]);

  return {
    createBatchWithReserveWallet,
    isCreating,
    error,
    currentStep
  };
}
