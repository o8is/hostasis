import { useState, useEffect, useMemo } from 'react';
import { usePublicClient } from 'wagmi';
import { POSTAGE_STAMP_ADDRESS, BZZ_ADDRESS } from '../contracts/addresses';
import PostageStampABI from '../contracts/abis/PostageStamp.json';

interface SwarmStatsResponse {
  pricePerGBPerMonth: number;
}

interface SwarmPricingData {
  pricePerGBPerMonthBZZ: number | null;
  pricePerGBPerYearDAI: number | null;
  bzzPriceUSD: number | null;
  currentPricePerChunk: bigint | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch real-time Swarm storage pricing
 *
 * Fetches:
 * - Storage cost per GB per month in BZZ from Swarmscan API
 * - BZZ token price in USD
 * - Current on-chain price per chunk from PostageStamp contract
 *
 * Calculates:
 * - Annual storage cost per GB in DAI (assuming DAI = USD)
 */
export function useSwarmPricing(): SwarmPricingData {
  const publicClient = usePublicClient();
  const [pricePerGBPerMonthBZZ, setPricePerGBPerMonthBZZ] = useState<number | null>(null);
  const [bzzPriceUSD, setBzzPriceUSD] = useState<number | null>(null);
  const [currentPricePerChunk, setCurrentPricePerChunk] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchPricing = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch API data and on-chain price in parallel
        const bzzContractAddress = BZZ_ADDRESS.toLowerCase();
        const [swarmStatsResponse, bzzPriceResponse, onChainPrice] = await Promise.all([
          fetch('https://api.swarmscan.io/v1/postage-stamps/stats'),
          // Using CoinGecko API for BZZ price on Gnosis Chain (platform ID: xdai)
          fetch(`https://api.coingecko.com/api/v3/simple/token_price/xdai?contract_addresses=${bzzContractAddress}&vs_currencies=usd`),
          // Fetch on-chain price from PostageStamp contract
          publicClient?.readContract({
            address: POSTAGE_STAMP_ADDRESS,
            abi: PostageStampABI,
            functionName: 'lastPrice',
          }).catch(() => null) // Don't fail if contract read fails
        ]);

        if (!swarmStatsResponse.ok) {
          throw new Error(`Failed to fetch Swarm stats: ${swarmStatsResponse.statusText}`);
        }

        if (!bzzPriceResponse.ok) {
          throw new Error(`Failed to fetch BZZ price: ${bzzPriceResponse.statusText}`);
        }

        const swarmStats: SwarmStatsResponse = await swarmStatsResponse.json();
        const bzzPriceData = await bzzPriceResponse.json();

        setPricePerGBPerMonthBZZ(swarmStats.pricePerGBPerMonth);
        const fetchedBzzPrice = bzzPriceData[bzzContractAddress]?.usd || null;
        setBzzPriceUSD(fetchedBzzPrice);
        setCurrentPricePerChunk(onChainPrice as bigint | null);

      } catch (err) {
        console.error('Error fetching Swarm pricing:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchPricing();

    // Refresh every 5 minutes
    const interval = setInterval(fetchPricing, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [publicClient]);

  // Calculate yearly cost in DAI (assuming DAI ≈ USD)
  const pricePerGBPerYearDAI = useMemo(() => {
    if (pricePerGBPerMonthBZZ === null || bzzPriceUSD === null) {
      return null;
    }

    // Convert monthly BZZ cost to yearly USD/DAI cost
    const yearlyBZZCost = pricePerGBPerMonthBZZ * 12;
    const yearlyDAICost = yearlyBZZCost * bzzPriceUSD;

    return yearlyDAICost;
  }, [pricePerGBPerMonthBZZ, bzzPriceUSD]);

  return {
    pricePerGBPerMonthBZZ,
    pricePerGBPerYearDAI,
    bzzPriceUSD,
    currentPricePerChunk,
    isLoading,
    error,
  };
}

/**
 * Hook with fallback pricing if real-time fetch fails
 */
export function useSwarmPricingWithFallback(
  fallbackPricePerGBPerYear: number = 0.5,
  fallbackBzzPriceUSD: number = 0.10
): SwarmPricingData & { isRealTimeData: boolean } {
  const { pricePerGBPerYearDAI, pricePerGBPerMonthBZZ, bzzPriceUSD, currentPricePerChunk, isLoading, error } = useSwarmPricing();

  const effectivePrice = useMemo(() => {
    return pricePerGBPerYearDAI !== null ? pricePerGBPerYearDAI : fallbackPricePerGBPerYear;
  }, [pricePerGBPerYearDAI, fallbackPricePerGBPerYear]);

  const effectiveBzzPrice = useMemo(() => {
    return bzzPriceUSD !== null ? bzzPriceUSD : fallbackBzzPriceUSD;
  }, [bzzPriceUSD, fallbackBzzPriceUSD]);

  return {
    pricePerGBPerMonthBZZ,
    pricePerGBPerYearDAI: effectivePrice,
    bzzPriceUSD: effectiveBzzPrice,
    currentPricePerChunk,
    isLoading,
    error,
    isRealTimeData: pricePerGBPerYearDAI !== null && bzzPriceUSD !== null,
  };
}
