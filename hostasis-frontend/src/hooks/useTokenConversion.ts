import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { type Address } from 'viem';
import { useDAIBalance, useDAIAllowance, useNativeXDAIBalance } from './useDAI';
import { useSDAIBalance, useSDAIExchangeRate } from './useSDAI';
import { SDAI_ADDRESS, DAI_ADDRESS } from '../contracts/addresses';
import ERC20_ABI from '../contracts/abis/IERC20.json';
import sDAI_ABI from '../contracts/abis/ISavingsDai.json';

export type TokenType = 'NATIVE_XDAI' | 'WRAPPED_DAI' | 'SDAI';

type FlowStep = 'idle' | 'wrapping' | 'approving' | 'converting' | 'complete';

/**
 * Generic hook for converting any supported token to sDAI
 * Uses a simple state machine approach with wagmi hooks
 */
export function useTokenConversion() {
  const { address } = useAccount();

  // Balances
  const { data: nativeBalance, refetch: refetchNative } = useNativeXDAIBalance(address);
  const { data: daiBalance, refetch: refetchDAI } = useDAIBalance(address);
  const { data: sdaiBalance, refetch: refetchSDAI } = useSDAIBalance(address);
  const { data: daiAllowance, refetch: refetchAllowance } = useDAIAllowance(address, SDAI_ADDRESS);
  const { data: exchangeRate } = useSDAIExchangeRate();

  // Single writeContract hook for all transactions
  const { writeContract, data: txHash, isPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // State machine
  const [flowStep, setFlowStep] = useState<FlowStep>('idle');
  const [targetAmount, setTargetAmount] = useState<bigint>(0n);
  const [currentToken, setCurrentToken] = useState<TokenType | null>(null);
  const [tokenOverride, setTokenOverride] = useState<TokenType | null>(null);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState('');
  const [onCompleteCallback, setOnCompleteCallback] = useState<((sdaiAmount: bigint) => void) | null>(null);
  const [initialSDAIBalance, setInitialSDAIBalance] = useState<bigint>(0n);

  // Get all available tokens with balances
  const availableTokens: TokenType[] = [];
  if (sdaiBalance && (sdaiBalance as bigint) > 0n) availableTokens.push('SDAI');
  if (daiBalance && (daiBalance as bigint) > 0n) availableTokens.push('WRAPPED_DAI');
  if (nativeBalance?.value && nativeBalance.value > 0n) availableTokens.push('NATIVE_XDAI');

  // Detect available token (with override support)
  useEffect(() => {
    if (flowStep !== 'idle') return; // Don't change during conversion

    // If user has manually selected a token and it has balance, use it
    if (tokenOverride && availableTokens.includes(tokenOverride)) {
      setCurrentToken(tokenOverride);
      return;
    }

    // Auto-detect: prioritize sDAI > wxDAI > xDAI
    if (sdaiBalance && (sdaiBalance as bigint) > 0n) setCurrentToken('SDAI');
    else if (daiBalance && (daiBalance as bigint) > 0n) setCurrentToken('WRAPPED_DAI');
    else if (nativeBalance?.value && nativeBalance.value > 0n) setCurrentToken('NATIVE_XDAI');
    else setCurrentToken(null);
  }, [nativeBalance, daiBalance, sdaiBalance, flowStep, tokenOverride, availableTokens.length]);

  // State machine: Handle transaction success
  useEffect(() => {
    if (!txSuccess || !address) return;

    const advance = async () => {
      if (flowStep === 'wrapping') {
        // Wrapped! Now approve or convert
        setCurrentStep('Approving wxDAI...');
        await refetchDAI();
        await refetchAllowance();

        // Use targetAmount instead of total balance
        const allowance = (daiAllowance as bigint) || 0n;

        if (allowance < targetAmount) {
          setFlowStep('approving');
          writeContract({
            address: DAI_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [SDAI_ADDRESS, targetAmount],
          });
        } else {
          setFlowStep('converting');
          setCurrentStep('Converting wxDAI to sDAI...');
          writeContract({
            address: SDAI_ADDRESS,
            abi: sDAI_ABI,
            functionName: 'deposit',
            args: [targetAmount, address],
          });
        }
      } else if (flowStep === 'approving') {
        // Approved! Now convert
        setFlowStep('converting');
        setCurrentStep('Converting wxDAI to sDAI...');
        await refetchAllowance();
        writeContract({
          address: SDAI_ADDRESS,
          abi: sDAI_ABI,
          functionName: 'deposit',
          args: [targetAmount, address],
        });
      } else if (flowStep === 'converting') {
        // Done!
        setFlowStep('complete');
        setCurrentStep('Conversion complete!');

        // Execute callback if provided
        if (onCompleteCallback) {
          // Refetch balance to get the ACTUAL sDAI received (not calculated)
          // This handles rounding differences between our calculation and the contract
          const refetchResult = await refetchSDAI();
          const balanceAfter = refetchResult.data ? (refetchResult.data as bigint) : 0n;

          // Calculate actual sDAI received from this conversion
          // Use the snapshot we took before starting the conversion
          const sdaiReceived = balanceAfter - initialSDAIBalance;

          onCompleteCallback(sdaiReceived);
          setOnCompleteCallback(null);
        }
      }
    };

    advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSuccess]);

  /**
   * Convert any token to sDAI with optional callback on completion
   */
  const convertToSDAI = async (
    amount: bigint,
    sourceToken: TokenType,
    onComplete?: (sdaiAmount: bigint) => void
  ): Promise<void> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    setTargetAmount(amount);
    setInitialSDAIBalance((sdaiBalance as bigint) || 0n);
    setError('');
    if (onComplete) {
      setOnCompleteCallback(() => onComplete);
    }

    try {
      if (sourceToken === 'SDAI') {
        setFlowStep('complete');
        if (onComplete) {
          onComplete(amount);
        }
        return;
      }

      if (sourceToken === 'WRAPPED_DAI') {
        const allowance = (daiAllowance as bigint) || 0n;
        if (allowance < amount) {
          setFlowStep('approving');
          setCurrentStep('Approving wxDAI...');
          writeContract({
            address: DAI_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [SDAI_ADDRESS, amount],
          });
        } else {
          setFlowStep('converting');
          setCurrentStep('Converting wxDAI to sDAI...');
          writeContract({
            address: SDAI_ADDRESS,
            abi: sDAI_ABI,
            functionName: 'deposit',
            args: [amount, address],
          });
        }
        return;
      }

      if (sourceToken === 'NATIVE_XDAI') {
        setFlowStep('wrapping');
        setCurrentStep('Wrapping xDAI to wxDAI...');
        writeContract({
          address: DAI_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'deposit',
          value: amount,
        });
        return;
      }

      throw new Error('Unsupported token type');
    } catch (err: any) {
      setError(err.message || 'Conversion failed');
      setFlowStep('idle');
      throw err;
    }
  };

  const resetConversion = () => {
    setFlowStep('idle');
    setTargetAmount(0n);
    setInitialSDAIBalance(0n);
    setCurrentStep('');
    setError('');
  };

  const previewConversion = (amount: bigint, sourceToken: TokenType): bigint => {
    if (!exchangeRate) return 0n;
    if (sourceToken === 'NATIVE_XDAI' || sourceToken === 'WRAPPED_DAI') {
      return (amount * 10n ** 18n) / (exchangeRate as bigint);
    }
    if (sourceToken === 'SDAI') return amount;
    return 0n;
  };

  const getTokenLabel = (token: TokenType | null): string => {
    switch (token) {
      case 'NATIVE_XDAI': return 'xDAI';
      case 'WRAPPED_DAI': return 'wxDAI';
      case 'SDAI': return 'sDAI';
      default: return 'Unknown';
    }
  };

  const getBalance = (token: TokenType | null): bigint => {
    switch (token) {
      case 'NATIVE_XDAI': return nativeBalance?.value || 0n;
      case 'WRAPPED_DAI': return (daiBalance as bigint) || 0n;
      case 'SDAI': return (sdaiBalance as bigint) || 0n;
      default: return 0n;
    }
  };

  const detectTokenType = (): TokenType | null => {
    if (sdaiBalance && (sdaiBalance as bigint) > 0n) return 'SDAI';
    if (daiBalance && (daiBalance as bigint) > 0n) return 'WRAPPED_DAI';
    if (nativeBalance?.value && nativeBalance.value > 0n) return 'NATIVE_XDAI';
    return null;
  };

  return {
    currentToken,
    currentStep,
    error,
    isConverting: flowStep !== 'idle' && flowStep !== 'complete',
    isComplete: flowStep === 'complete',
    isLoading: isPending || isConfirming,
    nativeBalance: nativeBalance?.value,
    daiBalance,
    sdaiBalance,
    availableTokens,
    setTokenOverride,
    convertToSDAI,
    resetConversion,
    previewConversion,
    getTokenLabel,
    getBalance,
    detectTokenType,
  };
}
