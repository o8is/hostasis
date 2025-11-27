/**
 * Progress information during upload
 */
export interface UploadProgress {
  phase: 'idle' | 'chunking' | 'stamping' | 'uploading' | 'complete' | 'error';
  message: string;
  percentage?: number;
  chunksProcessed?: number;
  totalChunks?: number;
}

/**
 * Result of a successful upload
 */
export interface UploadResult {
  reference: string; // Swarm hash (hex)
  url: string; // Full URL with CID subdomain routing
  cid: string; // CIDv1 representation
}

/**
 * Options for configuring uploads
 */
export interface UploadOptions {
  /** Single Page App mode - sets error document to index.html */
  isSPA?: boolean;
  /** Custom index document path (defaults to auto-detection) */
  indexDocument?: string;
  /** Custom error document path */
  errorDocument?: string;
  /** Progress callback for tracking upload status */
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * Configuration for StampedUploader
 */
export interface StampedUploaderConfig {
  /** Swarm gateway URL (e.g., https://gateway.ethswarm.org) */
  gatewayUrl: string;
  /** Postage batch ID (hex string, with or without 0x prefix) */
  batchId: string;
  /** Private key for signing (hex string with or without 0x prefix) */
  privateKey: string;
  /** Batch depth */
  depth: number;
}

/**
 * File entry in a manifest
 */
export interface FileEntry {
  path: string;
  reference: string;
  contentType: string;
}
