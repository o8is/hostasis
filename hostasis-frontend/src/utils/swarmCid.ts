/**
 * Swarm CID Conversion Utilities
 *
 * Converts Swarm reference hashes to CIDs (Content Identifiers) for use with
 * subdomain-based gateways like bzz.sh
 */

import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';

// Swarm-specific multicodec and multihash codes
const SWARM_MANIFEST_CODEC = 0xfa; // Swarm manifest multicodec
const KECCAK_256_CODE = 0x1b; // keccak-256 multihash code

/**
 * Convert a Swarm reference hash to a CIDv1 string
 *
 * @param reference - Swarm reference hash (with or without 0x prefix)
 * @returns CIDv1 string encoded in base32
 */
export function swarmHashToCid(reference: string): string {
  // Remove 0x prefix if present
  const hex = reference.startsWith('0x') ? reference.slice(2) : reference;

  // Convert hex string to Uint8Array
  const hashBytes = new Uint8Array(
    hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );

  // Create a multihash digest for keccak-256
  const multihashDigest = Digest.create(KECCAK_256_CODE, hashBytes);

  // Create CIDv1 with Swarm manifest codec
  const cid = CID.createV1(SWARM_MANIFEST_CODEC, multihashDigest);

  // Return as base32 string (required for subdomain usage)
  return cid.toString();
}

/**
 * Convert a CID back to a Swarm reference hash
 *
 * @param cidString - CIDv1 string
 * @returns Swarm reference hash (without 0x prefix)
 */
export function cidToSwarmHash(cidString: string): string {
  const cid = CID.parse(cidString);

  // Extract the hash bytes from the multihash
  const hashBytes = cid.multihash.digest;

  // Convert to hex string
  return Array.from(hashBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
