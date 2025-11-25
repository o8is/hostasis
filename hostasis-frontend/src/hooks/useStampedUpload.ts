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

export interface UploadOptions {
  isSPA?: boolean; // Single Page App mode - sets error document to index.html
}

export interface UseStampedUploadReturn {
  uploadWithStamper: (
    files: File[],
    batchId: string,
    passkeyPrivateKey: Hex,
    depth: number,
    gatewayUrl?: string,
    options?: UploadOptions
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
 * Chunks are collected first, then uploaded in true parallel for maximum performance
 */
async function uploadWithMerkleTree(
  data: Uint8Array,
  uploadChunkFn: (chunk: Chunk) => Promise<string>
): Promise<Uint8Array> {
  // Collect all chunks first (fast, no I/O)
  const chunks: Chunk[] = [];
  const onChunk = async (chunk: Chunk) => {
    chunks.push(chunk);
  };

  // Create MerkleTree with collection callback
  const tree = new MerkleTree(onChunk);

  // Append data to tree (chunks but doesn't upload yet)
  await tree.append(data);

  // Finalize and get root chunk
  const rootChunk = await tree.finalize();

  console.log(`📦 File chunked into ${chunks.length} chunks`);

  // Upload ALL chunks in true parallel with Promise.all
  // Modern browsers use HTTP/2 multiplexing which handles this efficiently
  // The browser and gateway will manage optimal concurrency automatically
  await Promise.all(chunks.map(chunk => uploadChunkFn(chunk)));

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
async function buildMantarayManifest(
  fileEntries: { path: string; reference: string; contentType: string }[], 
  indexDocument?: string,
  errorDocument?: string
): Promise<MantarayNode> {
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

  // Add root path with website metadata if we have an index and/or error document
  if (indexDocument || errorDocument) {
    const NULL_ADDRESS = new Uint8Array(32); // 32 bytes of zeros
    const metadata: Record<string, string> = {};
    
    if (indexDocument) {
      // Remove leading slash from indexDocument to match how paths are stored in manifest
      const indexDocPath = indexDocument.startsWith('/') ? indexDocument.slice(1) : indexDocument;
      metadata['website-index-document'] = indexDocPath;
      console.log('🏠 Setting website index document:', indexDocPath);
    }
    
    if (errorDocument) {
      // Remove leading slash from errorDocument to match how paths are stored in manifest
      const errorDocPath = errorDocument.startsWith('/') ? errorDocument.slice(1) : errorDocument;
      metadata['website-error-document'] = errorDocPath;
      console.log('❌ Setting website error document:', errorDocPath);
    }
    
    mantaray.addFork('/', NULL_ADDRESS, metadata);
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
    gatewayUrl: string = SWARM_GATEWAY_URL,
    options: UploadOptions = {}
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

      // Track parallel upload performance
      let uploadStartTime: number;
      let chunksUploaded = 0;
      const totalChunksToUpload: { count: number } = { count: 0 };

      // Helper function to upload a chunk with stamping
      const uploadChunk = async (chunk: Chunk): Promise<string> => {
        if (!uploadStartTime) {
          uploadStartTime = Date.now();
          console.log('🚀 Starting parallel chunk uploads...');
        }

        const envelope = stamper.stamp(chunk);

        const indexHex = Binary.uint8ArrayToHex(envelope.index);
        const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
        const signatureHex = Binary.uint8ArrayToHex(envelope.signature);
        const postageStampHeader = normalizedBatchId + indexHex + timestampHex + signatureHex;

        // Use cafe-utility Chunk methods: hash() and build()
        const chunkData = chunk.build();

        const chunkStartTime = Date.now();
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
        const chunkDuration = Date.now() - chunkStartTime;

        chunksUploaded++;
        if (chunksUploaded % 50 === 0 || chunksUploaded === totalChunksToUpload.count) {
          const elapsed = Date.now() - uploadStartTime;
          const rate = chunksUploaded / (elapsed / 1000);
          console.log(`📊 Progress: ${chunksUploaded}/${totalChunksToUpload.count} chunks (${rate.toFixed(1)}/sec, last: ${chunkDuration}ms)`);
        }

        return uploadResponse.data.reference;
      };

      // For single file, also create a manifest so it can be accessed with proper MIME type
      // This allows /bzz/{reference}/{filename} to work and serve with correct Content-Type
      if (files.length === 1) {
        const file = files[0];
        // Use webkitRelativePath if available (for folder uploads), otherwise use name
        const filePath = (file as any).webkitRelativePath || file.name;

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
          path: `/${filePath}`,
          reference: fileReference,
          contentType: getContentType(filePath)
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
        const url = `https://${cid}.${domain}/${filePath}`;

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

      let indexDocument: string | undefined;

      // Determine if we need to strip a common root folder
      // This happens when uploading a folder via webkitdirectory
      let rootFolderToStrip = '';
      const firstFileRelativePath = (files[0] as any).webkitRelativePath;
      
      console.log('📁 First file info:', {
        name: files[0].name,
        webkitRelativePath: firstFileRelativePath,
        totalFiles: files.length
      });

      if (firstFileRelativePath && firstFileRelativePath.includes('/')) {
        const potentialRoot = firstFileRelativePath.split('/')[0] + '/';
        // Check if all files start with this root
        const allHaveRoot = files.every(f => {
          const path = (f as any).webkitRelativePath || f.name;
          return path.startsWith(potentialRoot);
        });
        if (allHaveRoot) {
          rootFolderToStrip = potentialRoot;
          console.log('✂️  Stripping root folder:', rootFolderToStrip);
        }
      }

      // Pre-read all files in parallel (I/O optimization)
      setProgress({
        phase: 'chunking',
        message: `Reading ${files.length} files...`,
        percentage: 25
      });

      const fileDataPromises = files.map(file => file.arrayBuffer().then(buf => new Uint8Array(buf)));
      const allFileData = await Promise.all(fileDataPromises);

      // Chunk ALL files first (CPU-bound, but fast)
      setProgress({
        phase: 'chunking',
        message: `Chunking ${files.length} files...`,
        percentage: 28
      });

      interface FileChunkData {
        filePath: string;
        chunks: Chunk[];
        rootHash: Uint8Array;
      }

      const fileChunkPromises = files.map(async (file, index): Promise<FileChunkData> => {
        // Use webkitRelativePath if available (for folder uploads), otherwise use name
        let filePath = (file as any).webkitRelativePath || file.name;
        const originalPath = filePath;
        
        // Strip root folder if detected
        if (rootFolderToStrip && filePath.startsWith(rootFolderToStrip)) {
          filePath = filePath.substring(rootFolderToStrip.length);
        }

        // Log first few files for debugging
        if (index < 5) {
          console.log('📄 File path mapping:', {
            original: originalPath,
            final: filePath,
            name: file.name
          });
        }

        // Chunk the file without uploading yet
        const chunks: Chunk[] = [];
        const onChunk = async (chunk: Chunk) => {
          chunks.push(chunk);
        };

        const tree = new MerkleTree(onChunk);
        await tree.append(allFileData[index]);
        const rootChunk = await tree.finalize();

        console.log(`📦 ${filePath}: ${chunks.length} chunks`);

        return {
          filePath,
          chunks,
          rootHash: rootChunk.hash()
        };
      });

      const allFileChunks = await Promise.all(fileChunkPromises);
      
      // Calculate total chunks for progress tracking
      totalChunksToUpload.count = allFileChunks.reduce((sum, f) => sum + f.chunks.length, 0);
      console.log(`📊 Total chunks to upload: ${totalChunksToUpload.count}`);

      // Now upload ALL chunks from ALL files in parallel!
      setProgress({
        phase: 'uploading',
        message: `Uploading ${totalChunksToUpload.count} chunks in parallel...`,
        percentage: 30
      });

      const allChunkUploads = allFileChunks.flatMap(fileData =>
        fileData.chunks.map(chunk => uploadChunk(chunk))
      );

      await Promise.all(allChunkUploads);

      // Build file entries with the root hashes
      const fileEntries = allFileChunks.map(fileData => ({
        path: `/${fileData.filePath}`,
        reference: Binary.uint8ArrayToHex(fileData.rootHash),
        contentType: getContentType(fileData.filePath)
      }));

      // Only use root-level index.html or index.htm as the website index
      // Never use subdirectory index files (like 404/index.html)
      const rootIndex = fileEntries.find(entry => {
        const path = entry.path.startsWith('/') ? entry.path.slice(1) : entry.path;
        return (path.toLowerCase() === 'index.html' || path.toLowerCase() === 'index.htm');
      });
      
      if (rootIndex) {
        indexDocument = rootIndex.path.startsWith('/') ? rootIndex.path.slice(1) : rootIndex.path;
      }

      // Find error document. For SPA mode, use index.html so all routes resolve to it
      let errorDocument: string | undefined;
      
      if (options.isSPA && indexDocument) {
        // SPA mode: rewrite all URLs to index.html
        errorDocument = indexDocument;
        console.log('🚀 SPA mode enabled: all routes will resolve to', indexDocument);
      } else {
        // Normal mode: find 404 error page (check common patterns)
        const errorPage = fileEntries.find(entry => {
          const path = entry.path.startsWith('/') ? entry.path.slice(1) : entry.path;
          return (
            path.toLowerCase() === '404.html' ||
            path.toLowerCase() === '404/index.html' ||
            path.toLowerCase() === 'error.html'
          );
        });
        
        if (errorPage) {
          errorDocument = errorPage.path.startsWith('/') ? errorPage.path.slice(1) : errorPage.path;
        }
      }

      console.log('📋 All file entries:', fileEntries.map(e => e.path));
      console.log('🏠 Index document detected:', indexDocument);
      console.log('❌ Error document detected:', errorDocument);

      // Build and upload mantaray manifest
      setProgress({
        phase: 'uploading',
        message: 'Creating collection manifest...',
        percentage: 80
      });

      const mantarayNode = await buildMantarayManifest(fileEntries, indexDocument, errorDocument);

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
