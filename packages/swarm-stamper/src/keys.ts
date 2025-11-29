/**
 * Key Derivation for Hostasis Projects
 *
 * Shared between CLI and frontend for consistent key derivation.
 * Project keys are derived from reserve keys using the project slug.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const hexWithoutPrefix = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(hexWithoutPrefix.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexWithoutPrefix.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Normalize a project name to a slug for key derivation.
 *
 * Rules:
 * - Lowercase
 * - Replace spaces and underscores with hyphens
 * - Remove non-alphanumeric characters (except hyphens)
 * - Collapse multiple hyphens into one
 * - Trim hyphens from start/end
 * - Max 50 characters
 *
 * @example
 * normalizeProjectSlug("My Blog!") // "my-blog"
 * normalizeProjectSlug("Portfolio_2024") // "portfolio-2024"
 * normalizeProjectSlug("  Test  Site  ") // "test-site"
 */
export function normalizeProjectSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')        // spaces and underscores to hyphens
    .replace(/[^a-z0-9-]/g, '')     // remove non-alphanumeric (except hyphens)
    .replace(/-+/g, '-')            // collapse multiple hyphens
    .replace(/^-|-$/g, '')          // trim hyphens from start/end
    .slice(0, 50);                  // max 50 chars
}

/**
 * Validate a project slug
 */
export function isValidProjectSlug(slug: string): boolean {
  if (!slug || slug.length === 0 || slug.length > 50) {
    return false;
  }
  // Must be lowercase alphanumeric with hyphens, no leading/trailing hyphens
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

export interface ProjectKeyInfo {
  privateKey: string;  // Hex string with 0x prefix
  address: string;     // Ethereum address with 0x prefix
}

/**
 * Derive a project key from a reserve key and project slug.
 *
 * Formula: projectKey = keccak256(reserveKey || slugBytes)
 *
 * The project key is used to sign feed updates for that specific project.
 * The reserve key still owns the batch and stamps chunks.
 *
 * @param reserveKey - Reserve private key (hex string, with or without 0x prefix)
 * @param projectSlug - Normalized project slug (use normalizeProjectSlug first)
 * @returns Project key info with private key and derived address
 *
 * @example
 * const slug = normalizeProjectSlug("my-blog");
 * const projectKey = deriveProjectKey(reserveKey, slug);
 * // CLI: hostasis deploy --reserve-key=0x... --project=my-blog
 */
export function deriveProjectKey(reserveKey: string, projectSlug: string): ProjectKeyInfo {
  if (!isValidProjectSlug(projectSlug)) {
    throw new Error(`Invalid project slug: "${projectSlug}". Use normalizeProjectSlug() first.`);
  }

  const reserveKeyBytes = hexToBytes(reserveKey);
  const slugBytes = new TextEncoder().encode(projectSlug);

  // Combine: reserveKey || slugBytes
  const combined = new Uint8Array(reserveKeyBytes.length + slugBytes.length);
  combined.set(reserveKeyBytes, 0);
  combined.set(slugBytes, reserveKeyBytes.length);

  // Derive project private key
  const projectPrivateKeyBytes = keccak_256(combined);

  // Derive address from private key
  const publicKeyBytes = secp256k1.getPublicKey(projectPrivateKeyBytes, false);
  const publicKeyHash = keccak_256(publicKeyBytes.slice(1));
  const addressBytes = publicKeyHash.slice(-20);

  return {
    privateKey: `0x${bytesToHex(projectPrivateKeyBytes)}`,
    address: `0x${bytesToHex(addressBytes)}`,
  };
}
