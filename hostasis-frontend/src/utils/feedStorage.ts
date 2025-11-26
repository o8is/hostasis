/**
 * Feed Storage - localStorage persistence for feed data per reserve
 * 
 * Stores:
 * - Feed owner address (the Ethereum address that owns the feed)
 * - Current content version (the latest deployed content hash)
 */

const STORAGE_PREFIX = 'hostasis_feed_';

interface FeedData {
  ownerAddress: string;     // Feed owner address (20 bytes hex, for /feeds/{owner}/{topic} URL)
  manifestUrl?: string;     // Feed manifest URL (/bzz/{hash}/ - the public URL for the feed)
  currentVersion?: string;  // Current content hash
  currentIndex?: number;    // Current feed index (increments with each deployment)
  updatedAt?: number;       // Last update timestamp
}

/**
 * Get the storage key for a reserve's feed data
 */
function getStorageKey(reserveIndex: number): string {
  return `${STORAGE_PREFIX}${reserveIndex}`;
}

/**
 * Get all feed data for a reserve
 */
function getFeedData(reserveIndex: number): FeedData | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const data = localStorage.getItem(getStorageKey(reserveIndex));
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Save feed data for a reserve
 */
function setFeedData(reserveIndex: number, data: FeedData): void {
  if (typeof window === 'undefined') return;
  
  localStorage.setItem(getStorageKey(reserveIndex), JSON.stringify(data));
}

/**
 * Get the feed owner address for a reserve
 * Used to construct /feeds/{owner}/{topic} URL
 */
export function getFeedOwner(reserveIndex: number): string | null {
  const data = getFeedData(reserveIndex);
  // Support both old (manifestRef) and new (ownerAddress) format
  return data?.ownerAddress ?? (data as any)?.manifestRef ?? null;
}

/**
 * Set the feed owner address for a reserve
 * Called once when the feed is initialized
 */
export function setFeedOwner(reserveIndex: number, ownerAddress: string): void {
  const existing = getFeedData(reserveIndex);
  setFeedData(reserveIndex, {
    ...existing,
    ownerAddress,
    updatedAt: Date.now(),
  });
}

/**
 * Get the current content version (hash) for a reserve
 */
export function getCurrentVersion(reserveIndex: number): string | null {
  const data = getFeedData(reserveIndex);
  return data?.currentVersion ?? null;
}

/**
 * Set the current content version for a reserve
 * Called after each deploy
 */
export function setCurrentVersion(reserveIndex: number, contentRef: string): void {
  const existing = getFeedData(reserveIndex);
  if (!existing) {
    console.warn(`Cannot set current version for reserve ${reserveIndex}: no feed manifest found`);
    return;
  }
  
  setFeedData(reserveIndex, {
    ...existing,
    currentVersion: contentRef,
    updatedAt: Date.now(),
  });
}

/**
 * Get the feed manifest URL for a reserve
 * Returns the /bzz/{hash}/ URL for accessing the feed
 */
export function getFeedManifestUrl(reserveIndex: number): string | null {
  const data = getFeedData(reserveIndex);
  return data?.manifestUrl ?? null;
}

/**
 * Set the feed manifest URL for a reserve
 * Called once when the feed is initialized
 */
export function setFeedManifestUrl(reserveIndex: number, manifestUrl: string): void {
  const existing = getFeedData(reserveIndex);
  if (!existing) {
    console.warn(`Cannot set manifest URL for reserve ${reserveIndex}: no feed data found`);
    return;
  }

  setFeedData(reserveIndex, {
    ...existing,
    manifestUrl,
    updatedAt: Date.now(),
  });
}

/**
 * Get the current feed index for a reserve
 * Returns 0 if not set (feed just initialized)
 */
export function getCurrentFeedIndex(reserveIndex: number): number {
  const data = getFeedData(reserveIndex);
  return data?.currentIndex ?? 0;
}

/**
 * Set the current feed index for a reserve
 * Called after each deployment to track the latest index
 */
export function setCurrentFeedIndex(reserveIndex: number, index: number): void {
  const existing = getFeedData(reserveIndex);
  if (!existing) {
    console.warn(`Cannot set feed index for reserve ${reserveIndex}: no feed data found`);
    return;
  }

  setFeedData(reserveIndex, {
    ...existing,
    currentIndex: index,
    updatedAt: Date.now(),
  });
}

/**
 * Check if a reserve has a feed initialized
 */
export function hasFeed(reserveIndex: number): boolean {
  return getFeedOwner(reserveIndex) !== null;
}

/**
 * Get the last update timestamp for a reserve's feed
 */
export function getLastUpdated(reserveIndex: number): number | null {
  const data = getFeedData(reserveIndex);
  return data?.updatedAt ?? null;
}

/**
 * Clear feed data for a reserve (e.g., when reserve is cancelled)
 */
export function clearFeedData(reserveIndex: number): void {
  if (typeof window === 'undefined') return;
  
  localStorage.removeItem(getStorageKey(reserveIndex));
}

/**
 * Get all reserves that have feed data
 */
export function getAllFeedReserves(): number[] {
  if (typeof window === 'undefined') return [];
  
  const reserves: number[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      const index = parseInt(key.slice(STORAGE_PREFIX.length), 10);
      if (!isNaN(index)) {
        reserves.push(index);
      }
    }
  }
  return reserves.sort((a, b) => a - b);
}
