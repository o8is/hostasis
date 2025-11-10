import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, type Address } from 'viem';
import { SDAI_ADDRESS, POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import sDAI_ABI from '../contracts/abis/ISavingsDai.json';

export function useSDAIBalance(address?: Address) {
  return useReadContract({
    address: SDAI_ADDRESS,
    abi: sDAI_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });
}

export function useSDAIAllowance(owner?: Address, spender: Address = POSTAGE_MANAGER_ADDRESS) {
  return useReadContract({
    address: SDAI_ADDRESS,
    abi: sDAI_ABI,
    functionName: 'allowance',
    args: owner ? [owner, spender] : undefined,
    query: {
      enabled: !!owner,
    },
  });
}

export function useApproveSDAI() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = (amount: bigint) => {
    writeContract({
      address: SDAI_ADDRESS,
      abi: sDAI_ABI,
      functionName: 'approve',
      args: [POSTAGE_MANAGER_ADDRESS, amount],
    });
  };

  return {
    approve,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useSDAIExchangeRate() {
  return useReadContract({
    address: SDAI_ADDRESS,
    abi: sDAI_ABI,
    functionName: 'convertToAssets',
    args: [parseEther('1')],
  });
}
