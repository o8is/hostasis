/**
 * Batch ID Utilities
 *
 * Helper functions for normalizing and formatting Swarm postage batch IDs
 * between different formats (with/without 0x prefix)
 */

/**
 * Normalize batch ID by removing 0x prefix if present
 * Used for bee-js and Swarm API calls which expect hex without prefix
 *
 * @param batchId - Batch ID with or without 0x prefix
 * @returns Batch ID without 0x prefix
 */
export function normalizeBatchId(batchId: string): string {
  return batchId.startsWith('0x') ? batchId.slice(2) : batchId;
}

/**
 * Ensure batch ID has 0x prefix
 * Used for blockchain/viem calls which expect 0x prefixed hex
 *
 * @param batchId - Batch ID with or without 0x prefix
 * @returns Batch ID with 0x prefix
 */
export function ensureBatchIdPrefix(batchId: string): string {
  return batchId.startsWith('0x') ? batchId : `0x${batchId}`;
}
