import { Stamper } from '@ethersphere/bee-js';
import { Chunk, Binary, MerkleTree } from 'cafe-utility';
import pLimit, { LimitFunction } from 'p-limit';
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
 * A chunk with its pre-computed stamp header, ready for network upload
 * Separating stamping (CPU) from uploading (I/O) enables true parallelism
 */
interface StampedChunk {
  chunkData: Uint8Array;
  stampHeader: string;
}

/**
 * Main class for uploading files to Swarm with client-side stamping
 * Uses native fetch for HTTP/2 multiplexing support
 */
export class StampedUploader {
  private config: StampedUploaderConfig;
  private stamper: Stamper;
  private normalizedBatchId: string;
  private limit: LimitFunction;

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

    // Create concurrency limiter for parallel uploads
    // With HTTP/2, browser handles multiplexing - use high limit or let browser manage
    // Setting to Infinity lets the browser's native connection pooling take over
    // Treat 0 or falsy as "unlimited" (Infinity)
    this.limit = pLimit(config.concurrency || Infinity);
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

        // Try to upload the test chunk with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const response = await fetch(`${this.config.gatewayUrl}/chunks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'swarm-postage-stamp': postageStampHeader
            },
            body: chunkData,
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            // Stamp is recognized!
            return;
          }

          // Handle non-OK response
          const responseText = await response.text();
          let responseData: any;
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }

          const dataMessage = typeof responseData === 'string'
            ? responseData
            : responseData?.message || responseData?.error;
          const errorMessage = (dataMessage || '').toLowerCase();
          const statusCode = response.status;

          // Consider it a stamp propagation issue if:
          // - Error mentions batch, stamp, or bucket (common gateway errors during propagation)
          // - Or it's a 400 Bad Request (gateway hasn't synced the stamp yet)
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

          // For non-stamp errors, throw
          throw new Error(`Gateway error: ${errorMessage || statusCode}`);
        } catch (fetchErr: any) {
          clearTimeout(timeoutId);

          // Handle AbortController timeout or network errors
          if (fetchErr.name === 'AbortError') {
            // Timeout - treat as retryable
            if (attempt < maxRetries - 1) {
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
          }

          // Re-throw for handling below
          throw fetchErr;
        }
      } catch (err: any) {
        const errorMessage = (err?.message || '').toLowerCase();

        // Check if it's a stamp-related error from the Stamper class
        const isStampError = errorMessage.includes('batch') ||
                            errorMessage.includes('stamp') ||
                            errorMessage.includes('bucket');

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
          throw new Error(
            `Stamp did not propagate to gateway after ${maxRetries} attempts (${maxRetries * retryDelayMs / 1000}s). Last error: ${errorMessage || err.message}`
          );
        }

        // For non-stamp errors (like network issues), also throw
        throw err;
      }
    }

    throw new Error('Stamp propagation check failed');
  }

  /**
   * Stamp a chunk (CPU-bound operation)
   * Call this for all chunks first, then upload the stamped chunks in parallel
   */
  private stampChunk(chunk: Chunk): StampedChunk {
    const envelope = this.stamper.stamp(chunk);
    const indexHex = Binary.uint8ArrayToHex(envelope.index);
    const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
    const signatureHex = Binary.uint8ArrayToHex(envelope.signature);
    const stampHeader = this.normalizedBatchId + indexHex + timestampHex + signatureHex;

    return {
      chunkData: chunk.build(),
      stampHeader
    };
  }

  /**
   * Upload a pre-stamped chunk (network I/O only, no CPU work)
   * This enables true parallel uploads when called with Promise.all()
   */
  private async uploadStampedChunk(stamped: StampedChunk): Promise<string> {
    const maxRetries = this.config.retryAttempts ?? 5;
    const timeout = this.config.timeout ?? 30000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${this.config.gatewayUrl}/chunks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'swarm-postage-stamp': stamped.stampHeader
          },
          body: stamped.chunkData,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json() as { reference: string };
          return data.reference;
        }

        // Handle non-OK response
        const responseText = await response.text();
        let errorMessage = '';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = (errorData?.message || errorData?.error || '').toLowerCase();
        } catch {
          errorMessage = responseText.toLowerCase();
        }

        const statusCode = response.status;

        // Retry on bucket/stamp errors or 400s (transient gateway sync issues)
        const isRetryable = errorMessage.includes('bucket') ||
                           errorMessage.includes('batch') ||
                           errorMessage.includes('stamp') ||
                           statusCode === 400;

        if (isRetryable && attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          continue;
        }

        throw new Error(`Chunk upload failed: ${errorMessage || `status ${statusCode}`}`);
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        if (err.name === 'AbortError' && attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          continue;
        }

        if (attempt < maxRetries - 1) {
          const errorMessage = (err?.message || '').toLowerCase();
          const isRetryable = errorMessage.includes('bucket') ||
                             errorMessage.includes('batch') ||
                             errorMessage.includes('stamp');
          if (isRetryable) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            continue;
          }
        }

        throw err;
      }
    }

    throw lastError || new Error('Upload failed after retries');
  }

  /**
   * Upload a single chunk to the gateway with retry logic (stamps + uploads)
   * Used for compatibility with existing code paths
   * Native fetch enables HTTP/2 multiplexing for better performance
   */
  private async uploadChunk(chunk: Chunk): Promise<string> {
    const stamped = this.stampChunk(chunk);
    return this.uploadStampedChunk(stamped);
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

    const stampRetries = this.config.stampPropagationRetries ?? 40;
    const stampDelay = this.config.stampPropagationDelayMs ?? 3000;
    const progressInterval = this.config.progressUpdateInterval ?? 10;

    // Start stamp propagation check in background (don't await yet)
    // This allows file reading/chunking to happen in parallel
    onProgress({
      phase: 'stamping',
      message: 'Waiting for stamp to propagate to gateway...',
      percentage: 5
    });

    const stampReadyPromise = this.waitForStampPropagation(stampRetries, stampDelay, onProgress);

    // Track upload performance
    let uploadStartTime: number;
    let chunksUploaded = 0;
    const totalChunksToUpload: { count: number } = { count: 0 };

    // Handle single file upload
    if (files.length === 1) {
      const file = files[0];
      const filePath = (file as any).webkitRelativePath || file.name;

      // Read file while stamp propagates (parallel)
      onProgress({
        phase: 'chunking',
        message: 'Reading file...',
        percentage: 10
      });

      const fileData = new Uint8Array(await file.arrayBuffer());

      // Chunk the file
      onProgress({
        phase: 'chunking',
        message: 'Chunking file...',
        percentage: 15
      });

      const chunks: Chunk[] = [];
      const tree = new MerkleTree(async (chunk: Chunk) => { chunks.push(chunk); });
      await tree.append(fileData);
      const rootChunk = await tree.finalize();
      const fileReference = Binary.uint8ArrayToHex(rootChunk.hash());

      totalChunksToUpload.count = chunks.length;

      // Wait for stamp to be ready before uploading
      await stampReadyPromise;

      // Streaming pipeline: stamp and upload each chunk together
      // This keeps UI responsive and provides accurate progress tracking
      onProgress({
        phase: 'uploading',
        message: `Uploading ${chunks.length} chunks...`,
        percentage: 20
      });

      uploadStartTime = Date.now();
      let pendingRequests = 0;
      const chunkUploads = chunks.map(chunk =>
        this.limit(async () => {
          // Stamp and upload in one operation (CPU + I/O overlap across concurrent tasks)
          const stamped = this.stampChunk(chunk);
          pendingRequests++;
          await this.uploadStampedChunk(stamped);
          pendingRequests--;
          chunksUploaded++;
          console.log(`Chunk done: ${chunksUploaded}/${totalChunksToUpload.count}, still pending: ${pendingRequests}`);
          if (chunksUploaded % progressInterval === 0 || chunksUploaded === totalChunksToUpload.count) {
            const elapsed = Date.now() - uploadStartTime;
            const rate = chunksUploaded / (elapsed / 1000);
            const remaining = totalChunksToUpload.count - chunksUploaded;
            const eta = rate > 0 ? remaining / rate : 0;
            const percentage = 20 + (chunksUploaded / totalChunksToUpload.count) * 50;

            onProgress({
              phase: 'uploading',
              message: `Uploading chunks (${chunksUploaded}/${totalChunksToUpload.count} at ${rate.toFixed(1)}/sec)...`,
              percentage,
              chunksProcessed: chunksUploaded,
              totalChunks: totalChunksToUpload.count,
              rate,
              eta
            });
          }
        })
      );

      await Promise.all(chunkUploads);
      console.log(`All chunk uploads resolved. Pending requests: ${pendingRequests}`);

      // Create a manifest for the single file
      onProgress({
        phase: 'uploading',
        message: 'Creating manifest...',
        percentage: 75
      });

      const fileEntries: FileEntry[] = [{
        path: `/${filePath}`,
        reference: fileReference,
        contentType: getContentType(filePath)
      }];

      const mantarayNode = await buildMantarayManifest(fileEntries);
      // Manifest chunks are small, use the simple uploadChunk method
      const manifestReference = await saveMantarayNodeRecursively(mantarayNode, (chunk) => this.uploadChunk(chunk), this.limit);

      onProgress({
        phase: 'complete',
        message: 'Upload successful!',
        percentage: 100
      });

      const cid = swarmHashToCid(manifestReference);
      const domain = this.config.gatewayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

      return {
        reference: manifestReference,
        url: `https://${cid}.${domain}/${filePath}`,
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

    // Collect all chunks for uploading
    const allChunks = allFileChunks.flatMap(fileData => fileData.chunks);
    totalChunksToUpload.count = allChunks.length;

    // Wait for stamp to be ready before uploading (may already be done if chunking took a while)
    await stampReadyPromise;

    // Streaming pipeline: stamp and upload each chunk together
    // This keeps UI responsive and provides accurate progress tracking
    onProgress({
      phase: 'uploading',
      message: `Uploading ${totalChunksToUpload.count} chunks...`,
      percentage: 20
    });

    uploadStartTime = Date.now();
    let pendingRequests = 0;
    const allChunkUploads = allChunks.map(chunk =>
      this.limit(async () => {
        // Stamp and upload in one operation (CPU + I/O overlap across concurrent tasks)
        const stamped = this.stampChunk(chunk);
        pendingRequests++;
        await this.uploadStampedChunk(stamped);
        pendingRequests--;
        chunksUploaded++;
        console.log(`Chunk done: ${chunksUploaded}/${totalChunksToUpload.count}, still pending: ${pendingRequests}`);
        if (chunksUploaded % progressInterval === 0 || chunksUploaded === totalChunksToUpload.count) {
          const elapsed = Date.now() - uploadStartTime;
          const rate = chunksUploaded / (elapsed / 1000);
          const remaining = totalChunksToUpload.count - chunksUploaded;
          const eta = rate > 0 ? remaining / rate : 0;
          const percentage = 20 + (chunksUploaded / totalChunksToUpload.count) * 60;

          onProgress({
            phase: 'uploading',
            message: `Uploading chunks (${chunksUploaded}/${totalChunksToUpload.count} at ${rate.toFixed(1)}/sec)...`,
            percentage,
            chunksProcessed: chunksUploaded,
            totalChunks: totalChunksToUpload.count,
            rate,
            eta
          });
        }
      })
    );

    await Promise.all(allChunkUploads);
    console.log(`All chunk uploads resolved. Pending requests: ${pendingRequests}`);

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

    // Manifest chunks are small, use the simple uploadChunk method
    const manifestReference = await saveMantarayNodeRecursively(mantarayNode, (chunk) => this.uploadChunk(chunk), this.limit);

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
    const rootHash = await uploadWithMerkleTree(data, (chunk) => this.uploadChunk(chunk), this.limit);
    const reference = Binary.uint8ArrayToHex(rootHash);

    return { reference };
  }

  /**
   * Upload a single pre-built Chunk object directly
   * Useful for uploading manifest chunks or other pre-chunked data
   * @param chunk - A Chunk object from cafe-utility
   * @returns The chunk reference (hash)
   */
  async uploadSingleChunk(chunk: Chunk): Promise<string> {
    return this.uploadChunk(chunk);
  }

  /**
   * Create a chunk uploader function for use with saveMantarayNodeRecursively
   * @returns A function that uploads chunks using this uploader's configuration
   */
  createChunkUploader(): (chunk: Chunk) => Promise<string> {
    return (chunk: Chunk) => this.uploadChunk(chunk);
  }

  /**
   * Alias for uploadData for backwards compatibility
   * @deprecated Use uploadData instead
   */
  async uploadRawData(data: Uint8Array): Promise<{ reference: string }> {
    const rootHash = await uploadWithMerkleTree(data, (chunk) => this.uploadChunk(chunk), this.limit);
    const reference = Binary.uint8ArrayToHex(rootHash);

    return { reference };
  }
}
