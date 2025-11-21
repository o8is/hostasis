import { useMemo } from 'react';
import { useSparkAPYWithFallback } from './useSparkAPY';
import { useSwarmPricingWithFallback } from './useSwarmPricing';
import { calculateDepthForSize, calculateBalanceForTTL, calculateTotalBZZ, EFFECTIVE_CAPACITY_BYTES } from './useCreatePostageBatch';
import { formatBZZ } from '../utils/bzzFormat';

export interface StorageCalculation {
  storageGB: number;
  initialStampCost: number;
  recommendedReserve: number;
  totalUpfrontCost: number;
  dailyYield: number;
  monthlyYield: number;
  yearlyYield: number;
  hostingLifespan: string;
  // Batch parameters (only populated when fileSizeBytes is provided)
  bzzAmount?: bigint;
  depth?: number;
  balancePerChunk?: bigint;
}

export interface BufferFactors {
  bzzPriceBuffer: number;
  storagePriceBuffer: number;
  yieldDeclineBuffer: number;
  combinedBuffer: number;
}

export interface StorageCalculatorResult {
  calculate: (storageGB: number, fileSizeBytes?: number) => StorageCalculation | null;
  bufferFactors: BufferFactors;
  apy: number;
  apyPercentage: string;
  isAPYRealTime: boolean;
  pricePerGBPerYearDAI: number | null;
  pricePerGBPerMonthBZZ: number | null;
  bzzPriceUSD: number | null;
  currentPricePerChunk: bigint | null;
  isPricingRealTime: boolean;
  isPricingLoading: boolean;
}

export function useStorageCalculator(): StorageCalculatorResult {
  // Fetch real-time Sky Savings Rate (via sDAI) with fallback
  const { apy: SKY_APY, apyPercentage, isRealTimeData: isAPYRealTime } = useSparkAPYWithFallback(0.05);

  // Fetch real-time Swarm pricing with fallback
  const {
    pricePerGBPerYearDAI,
    pricePerGBPerMonthBZZ,
    bzzPriceUSD,
    currentPricePerChunk,
    isRealTimeData: isPricingRealTime,
    isLoading: isPricingLoading
  } = useSwarmPricingWithFallback(0.1); // Fallback: 0.1 DAI/GB/year

  // Multi-factor buffer calculation for long-term protection
  const bufferFactors = useMemo<BufferFactors>(() => {
    // Factor 1: BZZ price volatility buffer (assume 5x potential increase)
    const bzzPriceBuffer = 1;

    // Factor 2: Network storage cost increase (assume 2x potential increase)
    const storagePriceBuffer = 2.0;

    // Factor 3: APY decline protection (assume APY could drop to 60% of current)
    const yieldDeclineBuffer = 1 / 0.7; // ~1.67x

    // Combined buffer: accounts for all risks happening together
    // We use geometric mean to avoid over-buffering while staying safe
    const combinedBuffer = Math.pow(
      bzzPriceBuffer * storagePriceBuffer * yieldDeclineBuffer,
      1/3 // Take cube root to get geometric mean
    ) * 1.2; // Add 20% safety margin on top

    return {
      bzzPriceBuffer,
      storagePriceBuffer,
      yieldDeclineBuffer,
      combinedBuffer: Math.round(combinedBuffer * 10) / 10, // Round to 1 decimal
    };
  }, []);

  const calculate = useMemo(() => {
    return (storageGB: number, fileSizeBytes?: number): StorageCalculation | null => {
      if (isNaN(storageGB) || storageGB <= 0 || !pricePerGBPerYearDAI) return null;

      let yearlyStorageCost = storageGB * pricePerGBPerYearDAI;
      let initialStampCost: number;

      let depth: number | undefined;
      let balancePerChunk: bigint | undefined;
      let totalBzzNeeded: bigint | undefined;

      if (fileSizeBytes && currentPricePerChunk && bzzPriceUSD) {
        // Calculate actual on-chain stamp cost (pays for entire batch capacity)
        depth = calculateDepthForSize(fileSizeBytes);
        balancePerChunk = calculateBalanceForTTL(7, currentPricePerChunk);
        totalBzzNeeded = calculateTotalBZZ(balancePerChunk, depth);

        // Convert BZZ to DAI
        const totalBzzFloat = parseFloat(formatBZZ(totalBzzNeeded));
        initialStampCost = totalBzzFloat * bzzPriceUSD;

        // Calculate implied price per GB per year from on-chain pricing
        // Use EFFECTIVE capacity (not theoretical) since you pay for the full effective capacity
        const batchCapacityBytes = EFFECTIVE_CAPACITY_BYTES[depth] || (Math.pow(2, depth) * 4096);
        const batchCapacityGB = batchCapacityBytes / (1024 * 1024 * 1024);
        const impliedPricePerGBPerYear = (initialStampCost / batchCapacityGB) * (365 / 7);

        // Reserve must cover the FULL batch capacity cost (not just file size)
        // You pay for the entire batch, regardless of how much you use
        yearlyStorageCost = batchCapacityGB * impliedPricePerGBPerYear;
      } else if (currentPricePerChunk && bzzPriceUSD) {
        // When we don't have exact file size, estimate from storage GB
        // Convert GB to bytes and calculate appropriate depth
        const estimatedBytes = Math.round(storageGB * 1024 * 1024 * 1024);
        depth = calculateDepthForSize(estimatedBytes);

        // Ensure minimum depth of 18 (our supported minimum)
        depth = Math.max(depth, 18);

        balancePerChunk = calculateBalanceForTTL(7, currentPricePerChunk);
        totalBzzNeeded = calculateTotalBZZ(balancePerChunk, depth);

        // Convert BZZ to DAI
        const totalBzzFloat = parseFloat(formatBZZ(totalBzzNeeded));
        initialStampCost = totalBzzFloat * bzzPriceUSD;

        // Use EFFECTIVE capacity (not theoretical) for cost per GB calculation
        const batchCapacityBytes = EFFECTIVE_CAPACITY_BYTES[depth] || (Math.pow(2, depth) * 4096);
        const batchCapacityGB = batchCapacityBytes / (1024 * 1024 * 1024);
        const impliedPricePerGBPerYear = (initialStampCost / batchCapacityGB) * (365 / 7);

        // Reserve must cover the FULL batch capacity cost
        yearlyStorageCost = batchCapacityGB * impliedPricePerGBPerYear;
      } else {
        // Fallback: estimate from yearly cost (no pricing data available)
        initialStampCost = yearlyStorageCost * (7 / 365);
      }

      // Calculate required reserve to generate enough yield with multi-factor buffer
      const requiredReserve = (yearlyStorageCost / SKY_APY) * bufferFactors.combinedBuffer;

      // Total upfront cost = initial stamp + reserve deposit
      const totalUpfrontCost = initialStampCost + requiredReserve;

      // Calculate yields
      const yearlyYield = requiredReserve * SKY_APY;
      const monthlyYield = yearlyYield / 12;
      const dailyYield = yearlyYield / 365;

      return {
        storageGB,
        initialStampCost,
        recommendedReserve: requiredReserve,
        totalUpfrontCost,
        dailyYield,
        monthlyYield,
        yearlyYield,
        hostingLifespan: 'Permanent',
        // Include batch parameters if calculated
        bzzAmount: totalBzzNeeded,
        depth,
        balancePerChunk
      };
    };
  }, [pricePerGBPerYearDAI, SKY_APY, bufferFactors.combinedBuffer, currentPricePerChunk, bzzPriceUSD]);

  return {
    calculate,
    bufferFactors,
    apy: SKY_APY,
    apyPercentage,
    isAPYRealTime,
    pricePerGBPerYearDAI,
    pricePerGBPerMonthBZZ,
    bzzPriceUSD,
    currentPricePerChunk,
    isPricingRealTime,
    isPricingLoading
  };
}
