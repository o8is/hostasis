import { useState, useEffect, useMemo } from 'react';

interface SwarmStatsResponse {
  pricePerGBPerMonth: number;
}

interface BZZPriceResponse {
  price: number;
}

interface SwarmPricingData {
  pricePerGBPerMonthBZZ: number | null;
  pricePerGBPerYearDAI: number | null;
  bzzPriceUSD: number | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to fetch real-time Swarm storage pricing
 *
 * Fetches:
 * - Storage cost per GB per month in BZZ from Swarmscan API
 * - BZZ token price in USD
 *
 * Calculates:
 * - Annual storage cost per GB in DAI (assuming DAI = USD)
 */
export function useSwarmPricing(): SwarmPricingData {
  const [pricePerGBPerMonthBZZ, setPricePerGBPerMonthBZZ] = useState<number | null>(null);
  const [bzzPriceUSD, setBzzPriceUSD] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchPricing = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch both APIs in parallel
        const [swarmStatsResponse, bzzPriceResponse] = await Promise.all([
          fetch('https://api.swarmscan.io/v1/postage-stamps/stats'),
          // Using CoinGecko API for BZZ price (free tier)
          fetch('https://api.coingecko.com/api/v3/simple/price?ids=swarm&vs_currencies=usd')
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
        setBzzPriceUSD(bzzPriceData.swarm?.usd || null);

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
  }, []);

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
    isLoading,
    error,
  };
}

/**
 * Hook with fallback pricing if real-time fetch fails
 */
export function useSwarmPricingWithFallback(fallbackPricePerGBPerYear: number = 0.5): SwarmPricingData & { isRealTimeData: boolean } {
  const { pricePerGBPerYearDAI, pricePerGBPerMonthBZZ, bzzPriceUSD, isLoading, error } = useSwarmPricing();

  const effectivePrice = useMemo(() => {
    return pricePerGBPerYearDAI !== null ? pricePerGBPerYearDAI : fallbackPricePerGBPerYear;
  }, [pricePerGBPerYearDAI, fallbackPricePerGBPerYear]);

  return {
    pricePerGBPerMonthBZZ,
    pricePerGBPerYearDAI: effectivePrice,
    bzzPriceUSD,
    isLoading,
    error,
    isRealTimeData: pricePerGBPerYearDAI !== null,
  };
}
