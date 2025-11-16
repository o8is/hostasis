import { useReadContract } from 'wagmi';
import { parseEther, formatUnits } from 'viem';
import { SDAI_ADDRESS } from '../contracts/addresses';
import sDAI_ABI from '../contracts/abis/ISavingsDai.json';
import { useMemo, useState, useEffect } from 'react';

/**
 * Hook to fetch and calculate the current Sky Savings Rate (SSR / APY)
 *
 * This hook fetches the sDAI exchange rate and calculates the APY.
 * sDAI (Savings Dai) is an ERC4626 vault from Sky (formerly MakerDAO) where 1 share
 * equals more DAI over time as yield accrues from the Dai Savings Rate (DSR).
 *
 * Note: While this data may be accessed through Spark interfaces, the actual
 * yield comes from Sky's non-custodial smart contracts. Spark does not control
 * the Sky Savings Rate or the sDAI token.
 *
 * The exchange rate represents how much DAI you get for 1 sDAI.
 * We compare the current rate to a baseline to estimate APY.
 */
export function useSparkAPY() {
  // Fetch current exchange rate: how much DAI you get for 1 sDAI
  const { data: exchangeRate, isLoading, error, refetch } = useReadContract({
    address: SDAI_ADDRESS,
    abi: sDAI_ABI,
    functionName: 'convertToAssets',
    args: [parseEther('1')], // 1 sDAI share
  });

  // Calculate APY based on the exchange rate from Sky's sDAI contract
  // Using the actual deployment date for accurate APY calculation
  const apy = useMemo(() => {
    if (!exchangeRate) return null;

    // sDAI deployment date on Gnosis Chain (contract: 0xaf204776c7245bf4147c2612bf6e5972ee483701)
    // Deployed as part of Spark Protocol expansion: October 10, 2023
    const SDAI_DEPLOYMENT_DATE = new Date('2023-10-10T00:00:00Z');
    const currentDate = new Date();

    // Calculate years elapsed since deployment
    const millisecondsPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const yearsElapsed = (currentDate.getTime() - SDAI_DEPLOYMENT_DATE.getTime()) / millisecondsPerYear;

    // Get current exchange rate (how much DAI you get for 1 sDAI)
    const rate = parseFloat(formatUnits(exchangeRate as bigint, 18));

    // sDAI starts at 1:1 ratio, so the rate above 1.0 represents total accrued value
    // Calculate annualized APY: ((rate / 1.0)^(1/years) - 1)
    const totalReturn = rate; // Current rate vs initial 1.0
    const apy = Math.pow(totalReturn, 1 / yearsElapsed) - 1;

    return apy;
  }, [exchangeRate]);

  // Format for display
  const apyPercentage = useMemo(() => {
    if (apy === null) return null;
    return (apy * 100).toFixed(2); // e.g., "6.50"
  }, [apy]);

  // Format as decimal for calculations
  const apyDecimal = apy;

  return {
    apy: apyDecimal, // For calculations (e.g., 0.065)
    apyPercentage, // For display (e.g., "6.50")
    exchangeRate: exchangeRate as bigint | undefined,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Hook that returns a fallback APY if the real-time fetch fails
 * This ensures the calculator always has a reasonable value
 */
export function useSparkAPYWithFallback(fallbackAPY: number = 0.065) {
  const { apy, apyPercentage, isLoading, error } = useSparkAPY();

  // TODO: The current APY calculation overestimates due to historical high rates
  // We need an indexer to track rate changes over time for accurate calculation
  // For now, disable and use fallback until indexer is ready
  const disableRealTimeAPY = true;

  const effectiveAPY = useMemo(() => {
    // Use fetched APY if available and not disabled, otherwise use fallback
    return (apy !== null && !disableRealTimeAPY) ? apy : fallbackAPY;
  }, [apy, fallbackAPY]);

  const effectiveAPYPercentage = useMemo(() => {
    return (effectiveAPY * 100).toFixed(2);
  }, [effectiveAPY]);

  return {
    apy: effectiveAPY,
    apyPercentage: effectiveAPYPercentage,
    isRealTimeData: apy !== null && !disableRealTimeAPY,
    isLoading,
    error,
  };
}
