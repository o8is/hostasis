import { useMemo, useState, useEffect, useRef } from 'react';

// Cache for Enso API responses (module-level singleton)
interface EnsoCache {
  data: EnsoTokenResponse | null;
  timestamp: number;
  promise: Promise<EnsoTokenResponse> | null;
}

interface EnsoTokenResponse {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  apy?: number;
  apyBase?: number | null;
  apyReward?: number | null;
  tvl?: number;
}

const ensoCache: EnsoCache = {
  data: null,
  timestamp: 0,
  promise: null,
};

// Cache duration: 5 minutes (much longer than 1 req/sec limit)
const CACHE_DURATION_MS = 5 * 60 * 1000;

// sDAI address on Gnosis
const SDAI_ADDRESS_GNOSIS = '0xaf204776c7245bf4147c2612bf6e5972ee483701';

async function fetchEnsoTokenData(): Promise<EnsoTokenResponse> {
  // Check if we have cached data that's still valid
  const now = Date.now();
  if (ensoCache.data && now - ensoCache.timestamp < CACHE_DURATION_MS) {
    return ensoCache.data;
  }

  // If there's already a request in flight, wait for it
  if (ensoCache.promise) {
    return ensoCache.promise;
  }

  // Create new request
  ensoCache.promise = (async () => {
    try {
      const response = await fetch(
        `https://api.enso.finance/api/v1/tokens?address=${SDAI_ADDRESS_GNOSIS}&chainId=100&includeMetadata=true`
      );

      if (!response.ok) {
        throw new Error(`Enso API error: ${response.status}`);
      }

      const data = await response.json();

  // API response has a 'data' array property
  const tokenData = data?.data?.[0] ?? null;

      // Update cache
      ensoCache.data = tokenData;
      ensoCache.timestamp = Date.now();
      ensoCache.promise = null;

      return tokenData;
    } catch (error) {
      ensoCache.promise = null;
      throw error;
    }
  })();

  return ensoCache.promise;
}

/**
 * Hook to fetch the current Sky Savings Rate (SSR / APY) from Enso API
 *
 * This hook fetches the sDAI APY directly from Enso's token metadata API.
 * sDAI (Savings Dai) is an ERC4626 vault from Sky (formerly MakerDAO) where 1 share
 * equals more DAI over time as yield accrues from the Dai Savings Rate (DSR).
 *
 * The Enso API provides pre-calculated APY based on current protocol rates.
 */
export function useSparkAPY() {
  const [data, setData] = useState<EnsoTokenResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        const tokenData = await fetchEnsoTokenData();
        if (mountedRef.current) {
          setData(tokenData);
          setError(null);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error('Failed to fetch APY'));
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = async () => {
    // Clear cache to force refetch
    ensoCache.data = null;
    ensoCache.timestamp = 0;

    try {
      setIsLoading(true);
      const tokenData = await fetchEnsoTokenData();
      setData(tokenData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch APY'));
    } finally {
      setIsLoading(false);
    }
  };

  // Convert APY from percentage (5.43) to decimal (0.0543)
  const apy = useMemo(() => {
    if (!data?.apy) return null;
    return data.apy / 100;
  }, [data]);

  // Format for display
  const apyPercentage = useMemo(() => {
    if (!data?.apy) return null;
    return data.apy.toFixed(2); // e.g., "5.43"
  }, [data]);

  return {
    apy, // For calculations (e.g., 0.0543)
    apyPercentage, // For display (e.g., "5.43")
    tvl: data?.tvl,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Hook that returns a fallback APY if the real-time fetch fails
 * This ensures the calculator always has a reasonable value
 */
export function useSparkAPYWithFallback(fallbackAPY: number = 0.05) {
  const { apy, apyPercentage, tvl, isLoading, error } = useSparkAPY();

  const effectiveAPY = useMemo(() => {
    // Use fetched APY if available, otherwise use fallback
    return apy !== null ? apy : fallbackAPY;
  }, [apy, fallbackAPY]);

  const effectiveAPYPercentage = useMemo(() => {
    return (effectiveAPY * 100).toFixed(2);
  }, [effectiveAPY]);

  return {
    apy: effectiveAPY,
    apyPercentage: effectiveAPYPercentage,
    tvl,
    isRealTimeData: apy !== null,
    isLoading,
    error,
  };
}
