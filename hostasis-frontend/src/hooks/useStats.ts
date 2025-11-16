import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';

export function useStats() {
  // Read preview yield
  const { data: previewYield, refetch: refetchPreviewYield } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'previewYield',
  });

  // Read distribution state
  const { data: distributionState, refetch: refetchDistributionState } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'distributionState',
  });

  // Read active user count
  const { data: activeUserCount, refetch: refetchActiveUserCount } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getActiveUserCount',
  });

  // Read total sDAI
  const { data: totalSDAI, refetch: refetchTotalSDAI } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'totalSDAI',
  });

  // Read total principal DAI
  const { data: totalPrincipalDAI, refetch: refetchTotalPrincipalDAI } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'totalPrincipalDAI',
  });

  // Read keeper fee pool
  const { data: keeperFeePool, refetch: refetchKeeperFeePool } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'keeperFeePool',
  });

  // Read last harvest time
  const { data: lastHarvestTime, refetch: refetchLastHarvestTime } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'lastHarvestTime',
  });

  // Read min yield threshold
  const { data: minYieldThreshold, refetch: refetchMinYieldThreshold } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'minYieldThreshold',
  });

  // Read harvester fee bps
  const { data: harvesterFeeBps, refetch: refetchHarvesterFeeBps } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'harvesterFeeBps',
  });

  // Read keeper fee bps
  const { data: keeperFeeBps, refetch: refetchKeeperFeeBps } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'keeperFeeBps',
  });

  // Refetch all function
  const refetchAll = () => {
    refetchPreviewYield();
    refetchDistributionState();
    refetchActiveUserCount();
    refetchTotalSDAI();
    refetchTotalPrincipalDAI();
    refetchKeeperFeePool();
    refetchLastHarvestTime();
    refetchMinYieldThreshold();
    refetchHarvesterFeeBps();
    refetchKeeperFeeBps();
  };

  return {
    previewYield: previewYield as bigint | undefined,
    distributionState: distributionState as [bigint, bigint, bigint, bigint, bigint, boolean] | undefined,
    activeUserCount: activeUserCount as bigint | undefined,
    totalSDAI: totalSDAI as bigint | undefined,
    totalPrincipalDAI: totalPrincipalDAI as bigint | undefined,
    keeperFeePool: keeperFeePool as bigint | undefined,
    lastHarvestTime: lastHarvestTime as bigint | undefined,
    minYieldThreshold: minYieldThreshold as bigint | undefined,
    harvesterFeeBps: harvesterFeeBps as bigint | undefined,
    keeperFeeBps: keeperFeeBps as bigint | undefined,
    refetchAll,
  };
}

export function useHarvest() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const harvest = () => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'harvest',
    });
  };

  return {
    harvest,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useProcessBatch() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const processBatch = (batchSize: bigint) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'processBatch',
      args: [batchSize],
    });
  };

  return {
    processBatch,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useGetBatchIncentive(batchSize: bigint) {
  const { data, refetch } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getBatchIncentive',
    args: [batchSize],
  });

  return {
    data: data as [boolean, bigint, bigint] | undefined,
    refetch,
  };
}
