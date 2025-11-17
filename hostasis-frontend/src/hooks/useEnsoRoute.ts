import { useState, useEffect } from 'react';
import { useAccount, useChainId, useBalance, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits, type Hex } from 'viem';
import { gnosis } from 'wagmi/chains';

// Common token addresses by chain
const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  // Ethereum Mainnet
  1: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EesdeadbeEF4',
    ETH: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  // Base
  8453: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ETH: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  // Arbitrum
  42161: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    ETH: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  },
  // Gnosis
  100: {
    DAI: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', // wxDAI
    SDAI: '0xaf204776c7245bF4147c2612BF6e5972Ee483701',
  },
};

// Token decimals
const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  ETH: 18,
  SDAI: 18,
};

// Supported source chains for cross-chain deposits
export const SUPPORTED_SOURCE_CHAINS = [
  { id: 1, name: 'Ethereum', symbol: 'ETH' },
  { id: 8453, name: 'Base', symbol: 'ETH' },
  { id: 42161, name: 'Arbitrum', symbol: 'ETH' },
];

interface EnsoRouteResponse {
  tx: {
    to: string;
    data: string;
    value: string;
    gas: string;
  };
  amountOut: string;
  gas: string;
  route: unknown[];
}

interface UseEnsoRouteResult {
  // State
  isLoading: boolean;
  error: string | null;

  // Route info
  estimatedSourceAmount: string | null;
  estimatedFees: string | null;
  routeData: EnsoRouteResponse | null;

  // Source chain/token info
  sourceChainId: number;
  sourceToken: string;
  sourceTokenBalance: bigint | null;

  // Actions
  setSourceToken: (token: string) => void;
  getRoute: (targetDaiAmount: string) => Promise<void>;
  executeRoute: () => Promise<void>;

  // Transaction state
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  txHash: string | null;
}

export function useEnsoRoute(): UseEnsoRouteResult {
  const { address } = useAccount();
  const chainId = useChainId();

  const [sourceToken, setSourceToken] = useState<string>('USDC');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<EnsoRouteResponse | null>(null);
  const [estimatedSourceAmount, setEstimatedSourceAmount] = useState<string | null>(null);
  const [estimatedFees, setEstimatedFees] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Get balance of selected source token
  const tokenAddress = TOKEN_ADDRESSES[chainId]?.[sourceToken];
  const isNativeToken = sourceToken === 'ETH';

  const { data: tokenBalanceData } = useBalance({
    address,
    token: isNativeToken ? undefined : (tokenAddress as Hex),
    chainId,
  });

  const sourceTokenBalance = tokenBalanceData?.value || null;

  // Transaction hooks
  const { sendTransaction, data: txData, isPending } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txData,
  });

  useEffect(() => {
    if (txData) {
      setTxHash(txData);
    }
  }, [txData]);

  // Fetch route from Enso API
  const getRoute = async (targetDaiAmount: string) => {
    if (!address || chainId === gnosis.id) {
      setError('Cross-chain routing only available when connected to source chain');
      return;
    }

    const tokenAddr = TOKEN_ADDRESSES[chainId]?.[sourceToken];
    if (!tokenAddr) {
      setError(`Token ${sourceToken} not supported on this chain`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Target: sDAI on Gnosis
      const targetSDAI = TOKEN_ADDRESSES[100].SDAI;
      const targetAmountWei = parseUnits(targetDaiAmount, 18);

      // We need to estimate how much source token is needed
      // First, get a rough estimate (add 10% buffer for fees)
      const roughEstimate = parseFloat(targetDaiAmount) * 1.1;
      const sourceDecimals = TOKEN_DECIMALS[sourceToken] || 18;
      const sourceAmountWei = parseUnits(roughEstimate.toFixed(sourceDecimals), sourceDecimals);

      const params = new URLSearchParams({
        chainId: chainId.toString(),
        destinationChainId: '100', // Gnosis
        fromAddress: address,
        receiver: address,
        spender: address,
        amountIn: sourceAmountWei.toString(),
        tokenIn: tokenAddr,
        tokenOut: targetSDAI,
        slippage: '500', // 5% for cross-chain
        routingStrategy: 'delegate',
      });

      const response = await fetch(
        `https://api.enso.finance/api/v1/shortcuts/route?${params.toString()}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `API error: ${response.status}`);
      }

      const data: EnsoRouteResponse = await response.json();
      setRouteData(data);

      // Calculate estimated amounts
      const amountOutNum = parseFloat(formatUnits(BigInt(data.amountOut), 18));
      const sourceAmountNum = parseFloat(formatUnits(sourceAmountWei, sourceDecimals));
      const fees = sourceAmountNum - amountOutNum;

      setEstimatedSourceAmount(sourceAmountNum.toFixed(sourceDecimals === 6 ? 2 : 4));
      setEstimatedFees(fees > 0 ? fees.toFixed(2) : '~0.00');

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch route';
      setError(message);
      setRouteData(null);
      setEstimatedSourceAmount(null);
      setEstimatedFees(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Execute the cross-chain transaction
  const executeRoute = async () => {
    if (!routeData) {
      setError('No route data available');
      return;
    }

    try {
      setError(null);

      sendTransaction({
        to: routeData.tx.to as Hex,
        data: routeData.tx.data as Hex,
        value: BigInt(routeData.tx.value),
        gas: BigInt(routeData.tx.gas),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute transaction';
      setError(message);
    }
  };

  return {
    isLoading,
    error,
    estimatedSourceAmount,
    estimatedFees,
    routeData,
    sourceChainId: chainId,
    sourceToken,
    sourceTokenBalance,
    setSourceToken,
    getRoute,
    executeRoute,
    isPending,
    isConfirming,
    isSuccess,
    txHash,
  };
}
