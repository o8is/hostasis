import { MantarayNode } from '@ethersphere/bee-js';
import { Binary } from 'cafe-utility';
// Helper: Get MIME type for a file
export function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'html': 'text/html; charset=utf-8',
    'htm': 'text/html; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'txt': 'text/plain; charset=utf-8',
    'pdf': 'application/pdf',
    'zip': 'application/zip'
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}
// Helper: Recursively save a MantarayNode with client-side stamping
export async function saveMantarayNodeRecursively(
  node: MantarayNode,
  uploadChunkFn: (chunk: Chunk) => Promise<string>
): Promise<string> {
  for (const fork of node.forks.values()) {
    await saveMantarayNodeRecursively(fork.node, uploadChunkFn);
  }
  const nodeData = await node.marshal();
  const nodeRootHash = await uploadWithMerkleTree(nodeData, uploadChunkFn);
  const nodeReference = Binary.uint8ArrayToHex(nodeRootHash);
  node.selfAddress = nodeRootHash;
  return nodeReference;
}
// Helper: Build a Swarm mantaray manifest for a collection of files
export async function buildMantarayManifest(
  fileEntries: { path: string; reference: string; contentType: string }[],
  indexDocument?: string,
  errorDocument?: string
): Promise<MantarayNode> {
  const mantaray = new MantarayNode();
  for (const entry of fileEntries) {
    const path = entry.path.startsWith('/') ? entry.path.slice(1) : entry.path;
    const metadata: Record<string, string> = {
      'Content-Type': entry.contentType
    };
    if (path) {
      metadata['Filename'] = path;
    }
    const hexWithoutPrefix = entry.reference.replace(/^0x/, '');
    const referenceBytes = Binary.hexToUint8Array(hexWithoutPrefix);
    mantaray.addFork(path, referenceBytes, metadata);
  }
  if (indexDocument || errorDocument) {
    const NULL_ADDRESS = new Uint8Array(32);
    const metadata: Record<string, string> = {};
    if (indexDocument) {
      const indexDocPath = indexDocument.startsWith('/') ? indexDocument.slice(1) : indexDocument;
      metadata['website-index-document'] = indexDocPath;
    }
    if (errorDocument) {
      const errorDocPath = errorDocument.startsWith('/') ? errorDocument.slice(1) : errorDocument;
      metadata['website-error-document'] = errorDocPath;
    }
    mantaray.addFork('/', NULL_ADDRESS, metadata);
  }
  return mantaray;
}
import { Chunk, MerkleTree } from 'cafe-utility';

export { MerkleTree };

import { Stamper } from '@ethersphere/bee-js';
import axios from 'axios';

export async function uploadWithMerkleTree(
  data: Uint8Array,
  uploadChunkFn: (chunk: Chunk) => Promise<string>
): Promise<Uint8Array> {
  const chunks: Chunk[] = [];
  const onChunk = async (chunk: Chunk) => {
    chunks.push(chunk);
  };
  const tree = new MerkleTree(onChunk);
  await tree.append(data);
  const rootChunk = await tree.finalize();
  await Promise.all(chunks.map(chunk => uploadChunkFn(chunk)));
  return rootChunk.hash();
}

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
