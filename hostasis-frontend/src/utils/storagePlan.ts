import { EFFECTIVE_CAPACITY_BYTES } from '../hooks/useCreatePostageBatch';

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
