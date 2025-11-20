/**
 * Swarm URL Construction Utilities
 *
 * Builds Swarm URLs from references and metadata using subdomain routing with CIDs.
 * Gateway-agnostic - can reconstruct URLs with any gateway.
 */

import { SWARM_GATEWAY_URL } from '../contracts/addresses';
import type { UploadMetadata, UploadRecord } from './uploadHistory';
import { swarmHashToCid } from './swarmCid';

/**
 * Build a Swarm URL from a reference hash and metadata
 *
 * Uses subdomain routing with CIDs: https://cid.bzz.sh/path
 *
 * @param reference - Swarm content hash (32-byte hex string)
 * @param metadata - Upload metadata (isWebsite, indexDocument, filename)
 * @param gatewayUrl - Optional custom gateway URL (defaults to SWARM_GATEWAY_URL)
 * @param uploadRecord - Optional full upload record (for detecting single files)
 * @returns Full Swarm URL using subdomain routing
 */
export function buildSwarmUrl(
  reference: string,
  metadata?: UploadMetadata,
  gatewayUrl: string = SWARM_GATEWAY_URL,
  uploadRecord?: UploadRecord
): string {
  // Convert Swarm hash to CID for subdomain routing
  const cid = swarmHashToCid(reference);

  // Extract the domain from the gateway URL (e.g., "bzz.sh" from "https://bzz.sh")
  const domain = gatewayUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // Build base URL with CID as subdomain
  const baseUrl = `https://${cid}.${domain}`;

  // For website collections with an index document, use root path
  if (metadata?.isWebsite && metadata?.indexDocument) {
    return `${baseUrl}/`;
  }

  // For single files with filename (new manifest-based uploads), use filename path
  if (metadata?.filename) {
    return `${baseUrl}/${metadata.filename}`;
  }

  // For single file uploads (detected from uploadRecord), use filename path
  if (uploadRecord && uploadRecord.files.length === 1) {
    const filename = uploadRecord.files[0].name;
    return `${baseUrl}/${filename}`;
  }

  // For multi-file collections (non-website), use root path
  if (metadata?.isWebsite !== undefined && !metadata.isWebsite) {
    // This was uploaded as a collection but not a website
    return `${baseUrl}/`;
  }

  // For legacy single files without metadata, use root path (no filename available)
  return baseUrl;
}

/**
 * Get a display-friendly link text for a Swarm URL
 *
 * @param metadata - Upload metadata
 * @returns User-friendly link text
 */
export function getSwarmLinkText(metadata?: UploadMetadata): string {
  if (metadata?.isWebsite) {
    return 'View Website →';
  }
  return 'View on Swarm →';
}
