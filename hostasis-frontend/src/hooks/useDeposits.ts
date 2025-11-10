import { useReadContract } from 'wagmi';
import { type Address } from 'viem';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';

export type Deposit = {
  sDAIAmount: bigint;
  principalDAI: bigint;
  stampId: string;
  depositTime: bigint;
};

export function useUserDepositCount(address?: Address) {
  return useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDepositCount',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });
}

export function useUserDeposit(address?: Address, depositIndex?: bigint) {
  return useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: address && depositIndex !== undefined ? [address, depositIndex] : undefined,
    query: {
      enabled: !!address && depositIndex !== undefined,
    },
  }) as { data?: Deposit; isLoading: boolean; error: Error | null };
}

export function usePreviewYield() {
  return useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'previewYield',
  });
}

export function usePreviewUserYield(address?: Address, depositIndex?: bigint) {
  return useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'previewUserYield',
    args: address && depositIndex !== undefined ? [address, depositIndex] : undefined,
    query: {
      enabled: !!address && depositIndex !== undefined,
    },
  });
}
