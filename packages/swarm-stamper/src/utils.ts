import { MantarayNode } from '@ethersphere/bee-js';
import { Binary, Chunk, MerkleTree } from 'cafe-utility';
import { CID } from 'multiformats/cid';
import * as digest from 'multiformats/hashes/digest';
import type { LimitFunction } from 'p-limit';
import type { FileEntry, UploadOptions, UploadResult } from './types.js';

/**
 * Get MIME type for a file based on its extension
 */
export function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'html': 'text/html; charset=utf-8',
    'htm': 'text/html; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'txt': 'text/plain; charset=utf-8',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'wasm': 'application/wasm',
    'xml': 'application/xml',
    'csv': 'text/csv',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Normalize a batch ID by removing 0x prefix and validating format
 */
export function normalizeBatchId(batchId: string): string {
  const normalized = batchId.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Invalid batch ID format: ${batchId} (expected 64 hex characters)`);
  }
  return normalized;
}

/**
 * Convert Swarm hash to CIDv1
 * Uses base32 encoding for subdomain compatibility
 */
export function swarmHashToCid(swarmHash: string): string {
  const hex = swarmHash.replace(/^0x/, '');
  const hashBytes = Binary.hexToUint8Array(hex);

  // Create a multihash digest for keccak-256
  // 0x1b = keccak-256 multihash code
  const mhdigest = digest.create(0x1b, hashBytes);

  // Create CID v1 with swarm-manifest codec (0xfa)
  const cid = CID.createV1(0xfa, mhdigest);

  // Return as base32 string for subdomain routing
  return cid.toString();
}

/**
 * Convert a CID back to a Swarm reference hash
 * Inverse operation of swarmHashToCid
 */
export function cidToSwarmHash(cidString: string): string {
  const cid = CID.parse(cidString);

  // Extract the hash bytes from the multihash
  const hashBytes = cid.multihash.digest;

  // Convert to hex string (without 0x prefix)
  return Binary.uint8ArrayToHex(hashBytes);
}

/**
 * Build a Swarm mantaray manifest for a collection of files
 */
export async function buildMantarayManifest(
  fileEntries: FileEntry[],
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

  // Add website metadata if index or error document is specified
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

/**
 * Recursively save a MantarayNode with client-side stamping
 * @param node - MantarayNode to save
 * @param uploadChunkFn - Function to upload a single chunk
 * @param limit - Optional concurrency limiter for parallel uploads
 */
export async function saveMantarayNodeRecursively(
  node: MantarayNode,
  uploadChunkFn: (chunk: Chunk) => Promise<string>,
  limit?: LimitFunction
): Promise<string> {
  // Upload child nodes first (depth-first)
  for (const fork of node.forks.values()) {
    await saveMantarayNodeRecursively(fork.node, uploadChunkFn, limit);
  }

  // Serialize and upload this node
  const nodeData = await node.marshal();
  const nodeRootHash = await uploadWithMerkleTree(nodeData, uploadChunkFn, limit);
  const nodeReference = Binary.uint8ArrayToHex(nodeRootHash);

  // Store the self-address for parent nodes to reference
  node.selfAddress = nodeRootHash;

  return nodeReference;
}

/**
 * Upload data using a Merkle tree structure
 * Returns the root hash of the tree
 * @param data - Raw bytes to upload
 * @param uploadChunkFn - Function to upload a single chunk
 * @param limit - Optional concurrency limiter for parallel uploads
 */
export async function uploadWithMerkleTree(
  data: Uint8Array,
  uploadChunkFn: (chunk: Chunk) => Promise<string>,
  limit?: LimitFunction
): Promise<Uint8Array> {
  const { MerkleTree } = await import('cafe-utility');

  const chunks: Chunk[] = [];
  const onChunk = async (chunk: Chunk) => {
    chunks.push(chunk);
  };

  const tree = new MerkleTree(onChunk);
  await tree.append(data);
  const rootChunk = await tree.finalize();

  // Upload all chunks with optional concurrency limiting
  if (limit) {
    await Promise.all(chunks.map(chunk => limit(() => uploadChunkFn(chunk))));
  } else {
    await Promise.all(chunks.map(chunk => uploadChunkFn(chunk)));
  }

  return rootChunk.hash();
}

/**
 * Resolve file paths from File objects, stripping common root folders.
 * Handles webkitRelativePath for directory uploads.
 * @returns Array of resolved paths (one per file)
 */
export function resolveFilePaths(files: File[]): string[] {
  if (files.length === 1) {
    return [(files[0] as any).webkitRelativePath || files[0].name];
  }

  // Detect common root folder to strip (from directory uploads)
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

  return files.map(f => {
    let filePath = (f as any).webkitRelativePath || f.name;
    if (rootFolderToStrip && filePath.startsWith(rootFolderToStrip)) {
      filePath = filePath.substring(rootFolderToStrip.length);
    }
    return filePath;
  });
}

/**
 * Detect index and error documents from file entries.
 * @param fileEntries - Array of file entries with paths
 * @param options - Upload options (isSPA, indexDocument, errorDocument)
 * @returns Resolved index and error document paths
 */
export function detectDocuments(
  fileEntries: FileEntry[],
  options: Pick<UploadOptions, 'isSPA' | 'indexDocument' | 'errorDocument'> = {}
): { indexDocument?: string; errorDocument?: string } {
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

  let errorDocument = options.errorDocument;
  if (options.isSPA && indexDocument) {
    errorDocument = indexDocument;
  } else if (!errorDocument) {
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

  return { indexDocument, errorDocument };
}

/**
 * Build an UploadResult from a manifest reference and gateway URL.
 * @param manifestReference - Hex Swarm reference
 * @param gatewayUrl - Gateway URL (e.g., "https://swarm.o8.is")
 * @param filePath - For single-file uploads, the filename to append to the URL
 */
export function buildUploadResult(
  manifestReference: string,
  gatewayUrl: string,
  filePath?: string
): UploadResult {
  const cid = swarmHashToCid(manifestReference);
  const domain = gatewayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = filePath
    ? `https://${cid}.${domain}/${filePath}`
    : `https://${cid}.${domain}/`;
  return { reference: manifestReference, url, cid };
}

/**
 * Compute the Swarm reference, CID, and gateway URL for files without uploading.
 *
 * Uses the same path resolution, document detection, manifest building, and
 * BMT hashing as `StampedUploader.uploadFiles()`, so the returned URL is
 * guaranteed to match what the real upload produces.
 *
 * @param files - Array of File objects (same as uploadFiles)
 * @param gatewayUrl - Swarm gateway URL (e.g., "https://swarm.o8.is")
 * @param options - Same upload options as uploadFiles (isSPA, indexDocument, errorDocument)
 * @returns Upload result with reference, CID, and URL
 */
export async function computeReference(
  files: File[],
  gatewayUrl: string,
  options: Pick<UploadOptions, 'isSPA' | 'indexDocument' | 'errorDocument'> = {}
): Promise<UploadResult> {
  if (files.length === 0) {
    throw new Error('No files provided');
  }

  const filePaths = resolveFilePaths(files);

  // No-op upload function — we only need the hash
  const noopUpload = async (chunk: Chunk): Promise<string> => {
    return Binary.uint8ArrayToHex(chunk.hash());
  };

  // Chunk each file to get root hashes
  const fileEntries: FileEntry[] = await Promise.all(
    files.map(async (file, i) => {
      const fileData = new Uint8Array(await file.arrayBuffer());
      const tree = new MerkleTree(async () => {});
      await tree.append(fileData);
      const rootChunk = await tree.finalize();
      return {
        path: `/${filePaths[i]}`,
        reference: Binary.uint8ArrayToHex(rootChunk.hash()),
        contentType: getContentType(filePaths[i])
      };
    })
  );

  // Single file: no index/error documents
  if (files.length === 1) {
    const mantarayNode = await buildMantarayManifest(fileEntries);
    const manifestReference = await saveMantarayNodeRecursively(mantarayNode, noopUpload);
    return buildUploadResult(manifestReference, gatewayUrl, filePaths[0]);
  }

  // Multi-file: detect documents, build manifest
  const { indexDocument, errorDocument } = detectDocuments(fileEntries, options);
  const mantarayNode = await buildMantarayManifest(fileEntries, indexDocument, errorDocument);
  const manifestReference = await saveMantarayNodeRecursively(mantarayNode, noopUpload);
  return buildUploadResult(manifestReference, gatewayUrl);
}