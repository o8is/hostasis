import { Stamper, MantarayNode } from '@ethersphere/bee-js';
import { Chunk, Binary, MerkleTree } from 'cafe-utility';
import axios from 'axios';
import type {
  StampedUploaderConfig,
  UploadOptions,
  UploadProgress,
  UploadResult,
  FileEntry
} from './types.js';
import {
  normalizeBatchId,
  swarmHashToCid,
  getContentType,
  buildMantarayManifest,
  saveMantarayNodeRecursively,
  uploadWithMerkleTree
} from './utils.js';

/**
 * Main class for uploading files to Swarm with client-side stamping
 */
export class StampedUploader {
  private config: StampedUploaderConfig;
  private stamper: Stamper;
  private normalizedBatchId: string;

  constructor(config: StampedUploaderConfig) {
    this.config = config;

    // Normalize and validate batch ID
    this.normalizedBatchId = normalizeBatchId(config.batchId);

    // Remove 0x prefix from private key
    const privateKeyWithoutPrefix = config.privateKey.replace(/^0x/, '');

    // Create stamper
    this.stamper = Stamper.fromBlank(
      privateKeyWithoutPrefix,
      this.normalizedBatchId,
      config.depth
    );
  }

  /**
   * Wait for the postage stamp to propagate to the gateway
   * Attempts to upload a test chunk until the gateway accepts the stamp
   * Default: 40 retries × 3 seconds = 120 seconds (2 min) max wait
   */
  private async waitForStampPropagation(
    maxRetries = 40,
    retryDelayMs = 3000,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Create a UNIQUE test chunk for each attempt to avoid bucket exhaustion
        // The Stamper tracks used indices per bucket, so same chunk = same bucket = fills up fast
        const testData = new Uint8Array(32);
        crypto.getRandomValues(testData); // Random data = different bucket each time
        const tree = new MerkleTree(() => Promise.resolve());
        await tree.append(testData);
        const testChunk = await tree.finalize();

        const envelope = this.stamper.stamp(testChunk);

        const indexHex = Binary.uint8ArrayToHex(envelope.index);
        const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
        const signatureHex = Binary.uint8ArrayToHex(envelope.signature);
        const postageStampHeader = this.normalizedBatchId + indexHex + timestampHex + signatureHex;

        const chunkData = testChunk.build();

        // Try to upload the test chunk
        await axios.post(
          `${this.config.gatewayUrl}/chunks`,
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
        // Extract error message from various possible locations
        const responseData = err?.response?.data;
        const dataMessage = typeof responseData === 'string'
          ? responseData
          : responseData?.message || responseData?.error;
        const errorMessage = (dataMessage || err?.message || '').toLowerCase();
        const statusCode = err?.response?.status;

        // Consider it a stamp propagation issue if:
        // - Error mentions batch, stamp, or bucket (common gateway errors during propagation)
        // - Or it's a 400 Bad Request (gateway hasn't synced the stamp yet)
        // - Or it's a non-axios error containing bucket/stamp (from Stamper class)
        const isStampError = errorMessage.includes('batch') ||
                            errorMessage.includes('stamp') ||
                            errorMessage.includes('bucket') ||
                            statusCode === 400;

        if (isStampError && attempt < maxRetries - 1) {
          // Stamp not propagated yet, wait and retry
          if (onProgress) {
            onProgress({
              phase: 'stamping',
              message: `Waiting for stamp to propagate (attempt ${attempt + 1}/${maxRetries})...`,
              percentage: 5 + (attempt / maxRetries) * 10
            });
          }
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          continue;
        }

        // If we've exhausted retries, throw with details
        if (attempt === maxRetries - 1) {
          const detail = errorMessage || `status ${statusCode}`;
          throw new Error(
            `Stamp did not propagate to gateway after ${maxRetries} attempts (${maxRetries * retryDelayMs / 1000}s). Last error: ${detail}`
          );
        }

        // For non-stamp errors (like network issues), also throw
        throw err;
      }
    }

    throw new Error('Stamp propagation check failed');
  }

  /**
   * Upload a single chunk to the gateway with retry logic
   * Uses 5 retries with exponential backoff (1s, 2s, 4s, 8s, 16s = 31s total)
   */
  private async uploadChunk(chunk: Chunk, maxRetries = 5): Promise<string> {
    const envelope = this.stamper.stamp(chunk);

    const indexHex = Binary.uint8ArrayToHex(envelope.index);
    const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
    const signatureHex = Binary.uint8ArrayToHex(envelope.signature);
    const postageStampHeader = this.normalizedBatchId + indexHex + timestampHex + signatureHex;

    const chunkData = chunk.build();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const uploadResponse = await axios.post(
          `${this.config.gatewayUrl}/chunks`,
          chunkData,
          {
            headers: {
              'Content-Type': 'application/octet-stream',
              'swarm-postage-stamp': postageStampHeader
            }
          }
        );

        return uploadResponse.data.reference;
      } catch (err: any) {
        lastError = err;
        const errorMessage = err?.response?.data?.message?.toLowerCase() || '';
        const statusCode = err?.response?.status;

        // Retry on bucket/stamp errors or 400s (transient gateway sync issues)
        const isRetryable = errorMessage.includes('bucket') ||
                           errorMessage.includes('batch') ||
                           errorMessage.includes('stamp') ||
                           statusCode === 400;

        if (isRetryable && attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new Error('Upload failed after retries');
  }

  /**
   * Upload multiple files to Swarm
   * @param files - Array of File objects (browser File API)
   * @param options - Upload options
   * @returns Upload result with reference and URL
   */
  async uploadFiles(files: File[], options: UploadOptions = {}): Promise<UploadResult> {
    const onProgress = options.onProgress || (() => {});

    if (files.length === 0) {
      throw new Error('No files provided for upload');
    }

    // Wait for the stamp to propagate to the gateway
    onProgress({
      phase: 'stamping',
      message: 'Waiting for stamp to propagate to gateway...',
      percentage: 10
    });

    await this.waitForStampPropagation(40, 3000, onProgress);

    onProgress({
      phase: 'stamping',
      message: 'Stamp ready!',
      percentage: 15
    });

    // Track upload performance
    let uploadStartTime: number;
    let chunksUploaded = 0;
    const totalChunksToUpload: { count: number } = { count: 0 };

    // Helper to upload a chunk with progress tracking
    const uploadChunkTracked = async (chunk: Chunk): Promise<string> => {
      if (!uploadStartTime) {
        uploadStartTime = Date.now();
      }

      const result = await this.uploadChunk(chunk);

      chunksUploaded++;
      if (chunksUploaded % 50 === 0 || chunksUploaded === totalChunksToUpload.count) {
        const elapsed = Date.now() - uploadStartTime;
        const rate = chunksUploaded / (elapsed / 1000);
        const percentage = 30 + (chunksUploaded / totalChunksToUpload.count) * 50;

        onProgress({
          phase: 'uploading',
          message: `Uploading chunks (${chunksUploaded}/${totalChunksToUpload.count} at ${rate.toFixed(1)}/sec)...`,
          percentage,
          chunksProcessed: chunksUploaded,
          totalChunks: totalChunksToUpload.count
        });
      }

      return result;
    };

    // Handle single file upload
    if (files.length === 1) {
      const file = files[0];
      const filePath = (file as any).webkitRelativePath || file.name;

      onProgress({
        phase: 'uploading',
        message: 'Uploading file...',
        percentage: 30
      });

      const fileData = new Uint8Array(await file.arrayBuffer());
      const rootHash = await uploadWithMerkleTree(fileData, uploadChunkTracked);
      const fileReference = Binary.uint8ArrayToHex(rootHash);

      // Create a manifest for the single file
      onProgress({
        phase: 'uploading',
        message: 'Creating manifest...',
        percentage: 70
      });

      const fileEntries: FileEntry[] = [{
        path: `/${filePath}`,
        reference: fileReference,
        contentType: getContentType(filePath)
      }];

      const mantarayNode = await buildMantarayManifest(fileEntries);
      const manifestReference = await saveMantarayNodeRecursively(mantarayNode, uploadChunkTracked);

      onProgress({
        phase: 'complete',
        message: 'Upload successful!',
        percentage: 100
      });

      const cid = swarmHashToCid(manifestReference);
      const domain = this.config.gatewayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const url = `https://${cid}.${domain}/${filePath}`;

      return {
        reference: manifestReference,
        url,
        cid
      };
    }

    // Handle multiple files
    onProgress({
      phase: 'chunking',
      message: 'Processing files...',
      percentage: 20
    });

    // Determine if we need to strip a common root folder
    let rootFolderToStrip = '';
    const firstFileRelativePath = (files[0] as any).webkitRelativePath;

    if (firstFileRelativePath && firstFileRelativePath.includes('/')) {
      const potentialRoot = firstFileRelativePath.split('/')[0] + '/';
      const allHaveRoot = files.every(f => {
        const path = (f as any).webkitRelativePath || f.name;
        return path.startsWith(potentialRoot);
      });
      if (allHaveRoot) {
        rootFolderToStrip = potentialRoot;
      }
    }

    // Pre-read all files in parallel
    onProgress({
      phase: 'chunking',
      message: `Reading ${files.length} files...`,
      percentage: 25
    });

    const fileDataPromises = files.map(file => file.arrayBuffer().then(buf => new Uint8Array(buf)));
    const allFileData = await Promise.all(fileDataPromises);

    // Chunk all files
    onProgress({
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
      let filePath = (file as any).webkitRelativePath || file.name;

      // Strip root folder if detected
      if (rootFolderToStrip && filePath.startsWith(rootFolderToStrip)) {
        filePath = filePath.substring(rootFolderToStrip.length);
      }

      // Chunk the file without uploading yet
      const chunks: Chunk[] = [];
      const onChunk = async (chunk: Chunk) => {
        chunks.push(chunk);
      };

      const tree = new MerkleTree(onChunk);
      await tree.append(allFileData[index]);
      const rootChunk = await tree.finalize();

      return {
        filePath,
        chunks,
        rootHash: rootChunk.hash()
      };
    });

    const allFileChunks = await Promise.all(fileChunkPromises);

    // Calculate total chunks for progress tracking
    totalChunksToUpload.count = allFileChunks.reduce((sum, f) => sum + f.chunks.length, 0);

    // Upload all chunks in parallel
    onProgress({
      phase: 'uploading',
      message: `Uploading ${totalChunksToUpload.count} chunks in parallel...`,
      percentage: 30
    });

    const allChunkUploads = allFileChunks.flatMap(fileData =>
      fileData.chunks.map(chunk => uploadChunkTracked(chunk))
    );

    await Promise.all(allChunkUploads);

    // Build file entries
    const fileEntries: FileEntry[] = allFileChunks.map(fileData => ({
      path: `/${fileData.filePath}`,
      reference: Binary.uint8ArrayToHex(fileData.rootHash),
      contentType: getContentType(fileData.filePath)
    }));

    // Determine index document
    let indexDocument = options.indexDocument;
    if (!indexDocument) {
      const rootIndex = fileEntries.find(entry => {
        const path = entry.path.startsWith('/') ? entry.path.slice(1) : entry.path;
        return (path.toLowerCase() === 'index.html' || path.toLowerCase() === 'index.htm');
      });

      if (rootIndex) {
        indexDocument = rootIndex.path.startsWith('/') ? rootIndex.path.slice(1) : rootIndex.path;
      }
    }

    // Determine error document
    let errorDocument = options.errorDocument;

    if (options.isSPA && indexDocument) {
      // SPA mode: rewrite all URLs to index.html
      errorDocument = indexDocument;
    } else if (!errorDocument) {
      // Find 404 error page
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

    // Build and upload mantaray manifest
    onProgress({
      phase: 'uploading',
      message: 'Creating collection manifest...',
      percentage: 80
    });

    const mantarayNode = await buildMantarayManifest(fileEntries, indexDocument, errorDocument);

    onProgress({
      phase: 'uploading',
      message: 'Uploading manifest...',
      percentage: 85
    });

    const manifestReference = await saveMantarayNodeRecursively(mantarayNode, uploadChunkTracked);

    onProgress({
      phase: 'complete',
      message: 'Collection uploaded successfully!',
      percentage: 100
    });

    // Convert to CID and use subdomain routing
    const cid = swarmHashToCid(manifestReference);
    const domain = this.config.gatewayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const url = `https://${cid}.${domain}/`;

    return {
      reference: manifestReference,
      url,
      cid
    };
  }

  /**
   * Upload raw data as a single chunk or Merkle tree
   * @param data - Raw bytes to upload
   * @returns Upload result with reference
   */
  async uploadData(data: Uint8Array): Promise<{ reference: string }> {
    const rootHash = await uploadWithMerkleTree(data, (chunk) => this.uploadChunk(chunk));
    const reference = Binary.uint8ArrayToHex(rootHash);

    return { reference };
  }
}
