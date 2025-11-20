import { useState, useCallback } from 'react';
import { Stamper, MantarayNode } from '@ethersphere/bee-js';
import { Chunk, Binary, MerkleTree } from 'cafe-utility';
import { type Hex } from 'viem';
import axios from 'axios';
import { SWARM_GATEWAY_URL } from '../contracts/addresses';
import { normalizeBatchId } from '../utils/batchId';
import { swarmHashToCid } from '../utils/swarmCid';

export interface UploadProgress {
  phase: 'idle' | 'chunking' | 'stamping' | 'uploading' | 'complete' | 'error';
  message: string;
  percentage?: number;
  chunksProcessed?: number;
  totalChunks?: number;
}

export interface UploadResult {
  reference: string;
  url: string;
}

export interface UseStampedUploadReturn {
  uploadWithStamper: (
    files: File[],
    batchId: string,
    passkeyPrivateKey: Hex,
    depth: number,
    gatewayUrl?: string
  ) => Promise<UploadResult>;
  progress: UploadProgress;
  error: Error | null;
  reset: () => void;
}

/**
 * Wait for the postage stamp to propagate to the gateway
 * Attempts to upload a test chunk until the gateway accepts the stamp
 */
async function waitForStampPropagation(
  stamper: Stamper,
  batchId: string,
  gatewayUrl: string,
  maxRetries = 15,
  retryDelayMs = 2000
): Promise<void> {
  // Create a small test chunk
  const testData = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]); // 8-byte span for empty payload
  const tree = new MerkleTree(() => Promise.resolve());
  await tree.append(new Uint8Array(0)); // Empty data
  const testChunk = await tree.finalize();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const envelope = stamper.stamp(testChunk);

      const indexHex = Binary.uint8ArrayToHex(envelope.index);
      const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
      const signatureHex = Binary.uint8ArrayToHex(envelope.signature);
      const postageStampHeader = batchId + indexHex + timestampHex + signatureHex;

      const chunkData = testChunk.build();

      // Try to upload the test chunk
      await axios.post(
        `${gatewayUrl}/chunks`,
        chunkData,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'swarm-postage-stamp': postageStampHeader
          },
          timeout: 5000
        }
      );

      // If we get here, the stamp is recognized!
      return;
    } catch (err: any) {
      const isStampError = err?.response?.data?.message?.toLowerCase().includes('batch') ||
                          err?.response?.data?.message?.toLowerCase().includes('stamp');

      if (isStampError && attempt < maxRetries - 1) {
        // Stamp not propagated yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }

      // If it's not a stamp error or we've exhausted retries, throw
      if (attempt === maxRetries - 1) {
        throw new Error(`Stamp did not propagate to gateway after ${maxRetries} attempts (${maxRetries * retryDelayMs / 1000}s)`);
      }

      // For other errors, also throw
      throw err;
    }
  }

  throw new Error('Stamp propagation check failed');
}

/**
 * Upload data using MerkleTree chunking and return root hash
 * This properly handles files of any size by creating intermediate chunks
 */
async function uploadWithMerkleTree(
  data: Uint8Array,
  uploadChunkFn: (chunk: Chunk) => Promise<string>
): Promise<Uint8Array> {
  // Callback that uploads each chunk as it's created
  const onChunk = async (chunk: Chunk) => {
    await uploadChunkFn(chunk);
  };

  // Create MerkleTree with upload callback
  const tree = new MerkleTree(onChunk);

  // Append data to tree (it will chunk and upload automatically)
  await tree.append(data);

  // Finalize and get root chunk
  const rootChunk = await tree.finalize();

  const rootHash = rootChunk.hash();

  // Return the root hash (this is the reference)
  return rootHash;
}

/**
 * Get MIME type for a file
 */
function getContentType(filename: string): string {
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

/**
 * Recursively save a MantarayNode with client-side stamping
 * This replicates MantarayNode.saveRecursively but with our custom upload function
 */
async function saveMantarayNodeRecursively(
  node: MantarayNode,
  uploadChunkFn: (chunk: Chunk) => Promise<string>
): Promise<string> {
  // First, recursively upload all child nodes
  for (const fork of node.forks.values()) {
    await saveMantarayNodeRecursively(fork.node, uploadChunkFn);
  }

  // Now marshal this node (which will include selfAddresses of children that were just uploaded)
  const nodeData = await node.marshal();

  // Upload the marshalled node data using MerkleTree
  const nodeRootHash = await uploadWithMerkleTree(nodeData, uploadChunkFn);
  const nodeReference = Binary.uint8ArrayToHex(nodeRootHash);

  // Set the selfAddress on this node
  node.selfAddress = nodeRootHash;

  return nodeReference;
}

/**
 * Build a Swarm mantaray manifest for a collection of files
 */
async function buildMantarayManifest(fileEntries: { path: string; reference: string; contentType: string }[], indexDocument?: string): Promise<MantarayNode> {
  const mantaray = new MantarayNode();

  // Add each file as a fork
  for (const entry of fileEntries) {
    // Remove leading slash from path for mantaray
    const path = entry.path.startsWith('/') ? entry.path.slice(1) : entry.path;

    const metadata: Record<string, string> = {
      'Content-Type': entry.contentType
    };

    // Add filename metadata
    if (path) {
      metadata['Filename'] = path;
    }

    // Convert hex string to raw Uint8Array bytes (32 bytes)
    const hexWithoutPrefix = entry.reference.replace(/^0x/, '');
    const referenceBytes = Binary.hexToUint8Array(hexWithoutPrefix);

    // Pass raw bytes directly - this is what bee-js does with rootChunk.hash()
    mantaray.addFork(path, referenceBytes, metadata);
  }

  // Add root path with website metadata if we have an index document
  if (indexDocument) {
    const NULL_ADDRESS = new Uint8Array(32); // 32 bytes of zeros
    mantaray.addFork('/', NULL_ADDRESS, {
      'website-index-document': indexDocument
    });
  }

  // Return the node (we'll upload it recursively later)
  return mantaray;
}

/**
 * Hook for uploading files with client-side stamping
 */
export function useStampedUpload(): UseStampedUploadReturn {
  const [progress, setProgress] = useState<UploadProgress>({
    phase: 'idle',
    message: 'Ready to upload'
  });
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setProgress({ phase: 'idle', message: 'Ready to upload' });
    setError(null);
  }, []);

  const uploadWithStamper = useCallback(async (
    files: File[],
    batchId: string,
    passkeyPrivateKey: Hex,
    depth: number,
    gatewayUrl: string = SWARM_GATEWAY_URL
  ): Promise<UploadResult> => {
    setError(null);

    try {
      if (!passkeyPrivateKey) {
        throw new Error('Passkey private key is required for client-side stamping');
      }

      if (files.length === 0) {
        throw new Error('No files provided for upload');
      }

      // Validate batch ID
      const normalizedBatchId = normalizeBatchId(batchId);
      if (!normalizedBatchId || normalizedBatchId.length !== 64) {
        throw new Error(`Invalid batch ID: ${normalizedBatchId} (expected 64 hex characters)`);
      }

      // Remove 0x prefix for Stamper
      const privateKeyWithoutPrefix = passkeyPrivateKey.replace(/^0x/, '');
      const stamper = Stamper.fromBlank(privateKeyWithoutPrefix, normalizedBatchId, depth);

      // Wait for the stamp to propagate to the gateway
      setProgress({
        phase: 'stamping',
        message: 'Waiting for stamp to propagate to gateway...',
        percentage: 10
      });

      await waitForStampPropagation(stamper, normalizedBatchId, gatewayUrl);

      setProgress({
        phase: 'stamping',
        message: 'Stamp ready!',
        percentage: 15
      });

      // Helper function to upload a chunk with stamping
      const uploadChunk = async (chunk: Chunk): Promise<string> => {
        const envelope = stamper.stamp(chunk);

        const indexHex = Binary.uint8ArrayToHex(envelope.index);
        const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
        const signatureHex = Binary.uint8ArrayToHex(envelope.signature);
        const postageStampHeader = normalizedBatchId + indexHex + timestampHex + signatureHex;

        // Use cafe-utility Chunk methods: hash() and build()
        const chunkData = chunk.build();

        const uploadResponse = await axios.post(
          `${gatewayUrl}/chunks`,
          chunkData,
          {
            headers: {
              'Content-Type': 'application/octet-stream',
              'swarm-postage-stamp': postageStampHeader
            }
          }
        );

        return uploadResponse.data.reference;
      };

      // For single file, also create a manifest so it can be accessed with proper MIME type
      // This allows /bzz/{reference}/{filename} to work and serve with correct Content-Type
      if (files.length === 1) {
        const file = files[0];
        const fileName = file.name;

        setProgress({
          phase: 'uploading',
          message: 'Uploading file...',
          percentage: 30
        });

        const fileData = new Uint8Array(await file.arrayBuffer());
        const rootHash = await uploadWithMerkleTree(fileData, uploadChunk);
        const fileReference = Binary.uint8ArrayToHex(rootHash);

        // Create a manifest for the single file
        setProgress({
          phase: 'uploading',
          message: 'Creating manifest...',
          percentage: 70
        });

        const fileEntries = [{
          path: `/${fileName}`,
          reference: fileReference,
          contentType: getContentType(fileName)
        }];

        const mantarayNode = await buildMantarayManifest(fileEntries);
        const manifestReference = await saveMantarayNodeRecursively(mantarayNode, uploadChunk);

        setProgress({
          phase: 'complete',
          message: 'Upload successful!',
          percentage: 100
        });

        // Convert to CID and use subdomain routing
        const cid = swarmHashToCid(manifestReference);
        const domain = gatewayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const url = `https://${cid}.${domain}/${fileName}`;

        return {
          reference: manifestReference,
          url
        };
      }

      // For multiple files, create a manifest collection
      setProgress({
        phase: 'chunking',
        message: 'Processing files...',
        percentage: 20
      });

      const fileEntries: { path: string; reference: string; contentType: string }[] = [];
      let indexDocument: string | undefined;

      // Upload each file and collect references
      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex];
        const fileName = file.name;

        setProgress({
          phase: 'uploading',
          message: `Uploading ${fileName}...`,
          percentage: 20 + (fileIndex / files.length) * 60
        });

        const fileData = new Uint8Array(await file.arrayBuffer());
        const rootHash = await uploadWithMerkleTree(fileData, uploadChunk);
        const fileReference = Binary.uint8ArrayToHex(rootHash);

        // Store file entry for manifest
        fileEntries.push({
          path: `/${fileName}`,
          reference: fileReference,
          contentType: getContentType(fileName)
        });

        // Detect index document for website mode
        if (fileName.toLowerCase() === 'index.html' || fileName.toLowerCase() === 'index.htm') {
          indexDocument = fileName;
        }
      }

      // Build and upload mantaray manifest
      setProgress({
        phase: 'uploading',
        message: 'Creating collection manifest...',
        percentage: 80
      });

      const mantarayNode = await buildMantarayManifest(fileEntries, indexDocument);

      setProgress({
        phase: 'uploading',
        message: 'Uploading manifest...',
        percentage: 85
      });

      // Recursively upload the manifest tree (this uploads child nodes first, then parent)
      // This is what MantarayNode.saveRecursively() does internally
      const manifestReference = await saveMantarayNodeRecursively(mantarayNode, uploadChunk);

      setProgress({
        phase: 'complete',
        message: 'Collection uploaded successfully!',
        percentage: 100
      });

      // Convert to CID and use subdomain routing for collections
      const cid = swarmHashToCid(manifestReference);
      const domain = gatewayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const url = `https://${cid}.${domain}/`;

      return {
        reference: manifestReference,
        url
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';

      setProgress({
        phase: 'error',
        message: errorMessage
      });
      setError(err instanceof Error ? err : new Error(errorMessage));
      throw err;
    }
  }, []);

  return {
    uploadWithStamper,
    progress,
    error,
    reset
  };
}
