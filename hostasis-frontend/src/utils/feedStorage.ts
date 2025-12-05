/**
 * Feed Storage - localStorage persistence for feed data per vault
 *
 * Stores:
 * - Feed owner address (the Ethereum address that owns the feed)
 * - Current content version (the latest deployed content hash)
 */

const STORAGE_PREFIX = 'hostasis_feed_';

interface FeedData {
  ownerAddress: string;     // Feed owner address (20 bytes hex, for /feeds/{owner}/{topic} URL)
  manifestUrl?: string;     // Feed manifest URL (/bzz/{hash}/ - the public URL for the feed)
  manifestReference?: string; // Feed manifest reference hash
  currentVersion?: string;  // Current content hash
  currentIndex?: number;    // Current feed index (increments with each deployment)
  updatedAt?: number;       // Last update timestamp
}

/**
 * Get the storage key for a vault's feed data
 */
function getStorageKey(vaultIndex: number): string {
  return `${STORAGE_PREFIX}${vaultIndex}`;
}

/**
 * Get all feed data for a vault
 */
function getFeedData(vaultIndex: number): FeedData | null {
  if (typeof window === 'undefined') return null;

  try {
    const data = localStorage.getItem(getStorageKey(vaultIndex));
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Save feed data for a vault
 */
function setFeedData(vaultIndex: number, data: FeedData): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(getStorageKey(vaultIndex), JSON.stringify(data));
}

/**
 * Get the feed owner address for a vault
 * Used to construct /feeds/{owner}/{topic} URL
 */
export function getFeedOwner(vaultIndex: number): string | null {
  const data = getFeedData(vaultIndex);
  // Support both old (manifestRef) and new (ownerAddress) format
  return data?.ownerAddress ?? (data as any)?.manifestRef ?? null;
}

/**
 * Set the feed owner address for a vault
 * Called once when the feed is initialized
 */
export function setFeedOwner(vaultIndex: number, ownerAddress: string): void {
  const existing = getFeedData(vaultIndex);
  setFeedData(vaultIndex, {
    ...existing,
    ownerAddress,
    updatedAt: Date.now(),
  });
}

/**
 * Get the current content version (hash) for a vault
 */
export function getCurrentVersion(vaultIndex: number): string | null {
  const data = getFeedData(vaultIndex);
  return data?.currentVersion ?? null;
}

/**
 * Set the current content version for a vault
 * Called after each deploy
 */
export function setCurrentVersion(vaultIndex: number, contentRef: string): void {
  const existing = getFeedData(vaultIndex);
  if (!existing) {
    console.warn(`Cannot set current version for vault ${vaultIndex}: no feed manifest found`);
    return;
  }

  setFeedData(vaultIndex, {
    ...existing,
    currentVersion: contentRef,
    updatedAt: Date.now(),
  });
}

/**
 * Get the feed manifest URL for a vault
 * Returns the /bzz/{hash}/ URL for accessing the feed
 */
export function getFeedManifestUrl(vaultIndex: number): string | null {
  const data = getFeedData(vaultIndex);
  return data?.manifestUrl ?? null;
}

/**
 * Set the feed manifest URL for a vault
 * Called once when the feed is initialized
 */
export function setFeedManifestUrl(vaultIndex: number, manifestUrl: string, manifestReference?: string): void {
  const existing = getFeedData(vaultIndex);
  if (!existing) {
    console.warn(`Cannot set manifest URL for vault ${vaultIndex}: no feed data found`);
    return;
  }

  setFeedData(vaultIndex, {
    ...existing,
    manifestUrl,
    ...(manifestReference && { manifestReference }),
    updatedAt: Date.now(),
  });
}

/**
 * Get the feed manifest reference for a vault
 * Returns the hash that can be used with any gateway
 */
export function getFeedManifestReference(vaultIndex: number): string | null {
  const data = getFeedData(vaultIndex);
  return data?.manifestReference ?? null;
}

/**
 * Get the current feed index for a vault
 * Returns 0 if not set (feed just initialized)
 */
export function getCurrentFeedIndex(vaultIndex: number): number {
  const data = getFeedData(vaultIndex);
  return data?.currentIndex ?? 0;
}

/**
 * Set the current feed index for a vault
 * Called after each deployment to track the latest index
 */
export function setCurrentFeedIndex(vaultIndex: number, index: number): void {
  const existing = getFeedData(vaultIndex);
  if (!existing) {
    console.warn(`Cannot set feed index for vault ${vaultIndex}: no feed data found`);
    return;
  }

  setFeedData(vaultIndex, {
    ...existing,
    currentIndex: index,
    updatedAt: Date.now(),
  });
}

/**
 * Check if a vault has a feed initialized
 */
export function hasFeed(vaultIndex: number): boolean {
  return getFeedOwner(vaultIndex) !== null;
}
