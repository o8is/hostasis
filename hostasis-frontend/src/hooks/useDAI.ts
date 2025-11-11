import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi';
import { type Address } from 'viem';
import { DAI_ADDRESS, SDAI_ADDRESS } from '../contracts/addresses';
import ERC20_ABI from '../contracts/abis/IERC20.json';

// Hook to get native xDAI balance
export function useNativeXDAIBalance(address?: Address) {
  return useBalance({
    address,
    query: {
      enabled: !!address,
    },
  });
}

export function useDAIBalance(address?: Address) {
  return useReadContract({
    address: DAI_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });
}

export function useDAIAllowance(owner?: Address, spender: Address = SDAI_ADDRESS) {
  return useReadContract({
    address: DAI_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner ? [owner, spender] : undefined,
    query: {
      enabled: !!owner,
    },
  });
}

export function useApproveDAI() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = (spender: Address, amount: bigint) => {
    writeContract({
      address: DAI_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, amount],
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

// Hook to wrap native xDAI to wxDAI
export function useWrapXDAI() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const wrap = (amount: bigint) => {
    writeContract({
      address: DAI_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'deposit',
      value: amount, // Send native xDAI
    });
  };

  return {
    wrap,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}
