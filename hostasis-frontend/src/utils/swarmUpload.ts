import { Chunk } from 'cafe-utility';
import { Stamper } from '@ethersphere/bee-js';
import axios from 'axios';

/**
 * Upload one or more chunks to Swarm with client-side stamping
 * @param chunks - Array of Chunk objects (usually length 1 for single chunk)
 * @param batchId - Hex string of the postage batch
 * @param privateKey - Hex string of the batch owner's private key (reserve key, NOT passkey!)
 * @param depth - Batch depth
 * @param gatewayUrl - Optional Swarm gateway URL
 * @returns Array of references (hashes) for uploaded chunks
 */
export async function uploadWithStamper(
  chunks: Chunk[],
  batchId: string,
  privateKey: string, // Should be the batch owner (reserve key)
  depth: number,
  gatewayUrl?: string
): Promise<string[]> {
  const url = gatewayUrl || 'https://bzz.sh';
  // Remove 0x prefix if present (for both privateKey and batchId)
  const privateKeyWithoutPrefix = privateKey.replace(/^0x/, '');
  const normalizedBatchId = batchId.replace(/^0x/, '');
  const stamper = Stamper.fromBlank(privateKeyWithoutPrefix, normalizedBatchId, depth);
  const results: string[] = [];
  for (const chunk of chunks) {
    // Runtime check: must be a Chunk object
    if (!(chunk instanceof Chunk)) {
      throw new Error('uploadWithStamper: All items must be Chunk objects, not raw arrays or buffers.');
    }
    const envelope = stamper.stamp(chunk);
    const indexHex = Buffer.from(envelope.index).toString('hex');
    const timestampHex = Buffer.from(envelope.timestamp).toString('hex');
    const signatureHex = Buffer.from(envelope.signature).toString('hex');
    const postageStampHeader = normalizedBatchId + indexHex + timestampHex + signatureHex;
    const chunkData = chunk.build();
    const resp = await axios.post(
      `${url}/chunks`,
      chunkData,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'swarm-postage-stamp': postageStampHeader
        },
        timeout: 10000
      }
    );
    results.push(resp.data?.reference || resp.data || '');
  }
  return results;
}
