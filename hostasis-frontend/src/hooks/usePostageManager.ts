import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { type Hex } from 'viem';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';

export function useDeposit() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deposit = (sDAIAmount: bigint, stampId: Hex) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'deposit',
      args: [sDAIAmount, stampId],
    });
  };

  return {
    deposit,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdraw = (depositIndex: bigint, sDAIAmount: bigint) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'withdraw',
      args: [depositIndex, sDAIAmount],
    });
  };

  return {
    withdraw,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useUpdateStampId() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const updateStampId = (depositIndex: bigint, newStampId: Hex) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'updateStampId',
      args: [depositIndex, newStampId],
    });
  };

  return {
    updateStampId,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useTopUp() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const topUp = (depositIndex: bigint, sDAIAmount: bigint) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'topUp',
      args: [depositIndex, sDAIAmount],
    });
  };

  return {
    topUp,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}
