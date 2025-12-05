import { EFFECTIVE_CAPACITY_BYTES } from '../hooks/useCreatePostageBatch';
import { VAULT_TIERS } from './projectStorage';

// Map depth to tier name
const DEPTH_TO_TIER_NAME: Record<number, string> = Object.fromEntries(
  Object.values(VAULT_TIERS).map(tier => [tier.depth, tier.name])
);

/**
 * Get the tier name (Starter, Basic, etc.) based on depth
 */
export function getTierNameByDepth(depth: number | undefined): string | null {
  if (!depth) return null;
  return DEPTH_TO_TIER_NAME[depth] || null;
}

/**
 * Get plan tier name based on batch depth and effective capacity
 */
export function getPlanTierName(depth: number | undefined): string | null {
  if (!depth || !EFFECTIVE_CAPACITY_BYTES[depth]) return null;

  const capacityBytes = EFFECTIVE_CAPACITY_BYTES[depth];
  const capacityMB = capacityBytes / (1024 * 1024);
  const capacityGB = capacityBytes / (1024 * 1024 * 1024);

  // Format based on size
  if (capacityGB >= 1) {
    return `${capacityGB.toFixed(capacityGB >= 10 ? 1 : 2)} GB Plan`;
  } else {
    return `${capacityMB.toFixed(capacityMB >= 100 ? 0 : 1)} MB Plan`;
  }
}
