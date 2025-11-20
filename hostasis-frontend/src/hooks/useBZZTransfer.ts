import { useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { type Hex, erc20Abi } from 'viem';
import { BZZ_ADDRESS } from '../contracts/addresses';
import { formatBZZ } from '../utils/bzzFormat';

export interface UseBZZTransferReturn {
  transferBZZ: (to: Hex, amount: bigint) => Promise<Hex>;
  isTransferring: boolean;
  isConfirming: boolean;
  error: Error | null;
}

/**
 * Hook for transferring BZZ tokens from main wallet to passkey wallet
 */
export function useBZZTransfer(): UseBZZTransferReturn {
  const { address } = useAccount();

  const {
    writeContract,
    data: transferHash,
    isPending: isTransferring,
    error: transferError
  } = useWriteContract();

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: transferHash
  });

  const transferBZZ = useCallback(async (to: Hex, amount: bigint): Promise<Hex> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    if (amount === 0n) {
      throw new Error('Transfer amount must be greater than zero');
    }

    return new Promise((resolve, reject) => {
      writeContract(
        {
          address: BZZ_ADDRESS,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [to, amount]
        },
        {
          onSuccess: (hash) => {
            resolve(hash);
          },
          onError: (err) => {
            console.error('BZZ transfer failed:', err);
            reject(err instanceof Error ? err : new Error('BZZ transfer failed'));
          }
        }
      );
    });
  }, [address, writeContract]);

  return {
    transferBZZ,
    isTransferring,
    isConfirming,
    error: transferError as Error | null
  };
}
