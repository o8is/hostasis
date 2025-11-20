import { useState, useCallback } from 'react';
import { useAccount, usePublicClient, useWalletClient, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { parseEther, formatEther, type Hex, maxUint256, erc20Abi } from 'viem';
import { DAI_ADDRESS, BZZ_ADDRESS, GNOSIS_CHAIN_ID, POSTAGE_STAMP_ADDRESS } from '../contracts/addresses';
import { formatBZZ } from '../utils/bzzFormat';

// Native xDAI address for SushiSwap API
const NATIVE_XDAI = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
  isNative: boolean;
  tx: {
    to: Hex;
    data: Hex;
    value: bigint;
    gasPrice: bigint;
  };
}

interface UseSwapDAIForBZZReturn {
  getQuote: (daiAmount: string, useNativeXDAI?: boolean, recipient?: Hex) => Promise<SwapQuote>;
  approveDAI: (amount: bigint, spender: Hex) => Promise<Hex | null>;
  checkDAIAllowance: (spender: Hex) => Promise<bigint>;
  executeSwap: (quote: SwapQuote) => Promise<Hex>;
  isApproving: boolean;
  isSwapping: boolean;
  error: Error | null;
}

export function useSwapDAIForBZZ(): UseSwapDAIForBZZReturn {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { writeContract: approveWrite, data: approveHash, isPending: isApproving } = useWriteContract();
  const { isLoading: isWaitingApproval } = useWaitForTransactionReceipt({ hash: approveHash });

  const checkDAIAllowance = useCallback(async (spender: Hex): Promise<bigint> => {
    if (!publicClient || !address) return 0n;

    const allowance = await publicClient.readContract({
      address: DAI_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, spender],
    });

    return allowance as bigint;
  }, [publicClient, address]);

  const getQuote = useCallback(async (daiAmount: string, useNativeXDAI: boolean = true, recipient?: Hex): Promise<SwapQuote> => {
    if (!address) throw new Error('Wallet not connected');

    const amountIn = parseEther(daiAmount);
    const apiUrl = new URL(`https://api.sushi.com/swap/v7/${GNOSIS_CHAIN_ID}`);

    // Use native xDAI (no approval needed) or wrapped wxDAI (needs approval)
    const tokenIn = useNativeXDAI ? NATIVE_XDAI : DAI_ADDRESS;

    const params = {
      tokenIn,
      tokenOut: BZZ_ADDRESS,
      amount: amountIn.toString(),
      maxSlippage: '0.01', // 1% slippage
      sender: address,
      ...(recipient && { recipient }), // Add recipient if provided
    };

    Object.entries(params).forEach(([key, value]) => apiUrl.searchParams.set(key, value));

    const response = await fetch(apiUrl.toString());
    const data = await response.json();

    if (data.status !== 'Success') {
      throw new Error(`Failed to get swap quote: ${data.status}`);
    }

    return {
      amountIn,
      amountOut: BigInt(data.assumedAmountOut || data.amountOut),
      priceImpact: data.priceImpact || 0,
      isNative: useNativeXDAI,
      tx: {
        to: data.tx.to as Hex,
        data: data.tx.data as Hex,
        value: useNativeXDAI ? amountIn : BigInt(data.tx.value || '0'),
        gasPrice: BigInt(data.tx.gasPrice || '0'),
      },
    };
  }, [address]);

  const approveDAI = useCallback(async (amount: bigint, spender: Hex): Promise<Hex | null> => {
    setError(null);

    // Check current allowance first
    const currentAllowance = await checkDAIAllowance(spender);
    if (currentAllowance >= amount) {
      return null; // No approval needed
    }

    return new Promise((resolve, reject) => {
      approveWrite(
        {
          address: DAI_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [spender, maxUint256], // Approve unlimited to avoid future approvals
        },
        {
          onSuccess: (hash) => resolve(hash),
          onError: (err) => {
            setError(err instanceof Error ? err : new Error('Approval failed'));
            reject(err);
          },
        }
      );
    });
  }, [approveWrite, checkDAIAllowance]);

  const executeSwap = useCallback(async (quote: SwapQuote): Promise<Hex> => {
    if (!walletClient) throw new Error('Wallet not connected');

    setError(null);
    setIsSwapping(true);

    try {
      // Execute swap directly - SushiSwap's quote already validates the swap
      // Simulation would fail if approval isn't confirmed yet
      const hash = await walletClient.sendTransaction({
        to: quote.tx.to,
        data: quote.tx.data,
        value: quote.tx.value,
        gasPrice: quote.tx.gasPrice || undefined,
      });

      setIsSwapping(false);
      return hash;
    } catch (err) {
      setIsSwapping(false);
      const error = err instanceof Error ? err : new Error('Swap failed');
      setError(error);
      throw error;
    }
  }, [walletClient]);

  return {
    getQuote,
    approveDAI,
    checkDAIAllowance,
    executeSwap,
    isApproving: isApproving || isWaitingApproval,
    isSwapping,
    error,
  };
}

// Helper to estimate DAI needed for a specific BZZ amount
// Takes BZZ price as parameter to use single source of truth from useSwarmPricing
export function estimateDAIForBZZ(bzzAmount: bigint, bzzPriceUSD: number): bigint {
  // DAI is ~1 USD, so DAI amount ≈ BZZ amount * BZZ price
  // Add 5% buffer for slippage and price movement
  // BZZ has 16 decimals, not 18!
  const bzzAmountFloat = parseFloat(formatBZZ(bzzAmount));
  const daiNeeded = bzzAmountFloat * bzzPriceUSD * 1.05;

  return parseEther(daiNeeded.toFixed(18));
}
