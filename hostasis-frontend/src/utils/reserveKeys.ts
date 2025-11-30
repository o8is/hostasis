import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';
import { type Hex } from 'viem';

export interface ReserveKeyInfo {
  privateKey: Hex;
  address: Hex;
}


/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: Hex): Uint8Array {
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
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive a reserve key from passkey private key and reserve index.
 *
 * This key is used for BOTH:
 * - Creating and owning the postage batch (batch owner)
 * - Signing feed updates (feed owner)
 *
 * Formula: reservePrivateKey = keccak256(passkeyPrivateKey || reserveIndex)
 *
 * This creates a unique, deterministic key for each reserve that:
 * - Is recoverable if the user has access to their passkey
 * - Is unique per reserve (no collisions)
 * - Requires no additional storage (can be derived on demand)
 * - Is safe to export for CLI/CI/CD use (doesn't reveal master passkey)
 * - Is scoped to a single reserve (can't affect other reserves)
 *
 * @param passkeyPrivateKey - The user's passkey-derived private key (hex)
 * @param reserveIndex - The reserve index (deposit index from contract)
 * @returns ReserveKeyInfo with privateKey and address
 */
export function deriveReserveKey(passkeyPrivateKey: Hex, reserveIndex: number): ReserveKeyInfo {
  // Convert passkey private key to bytes
  const passkeyBytes = hexToBytes(passkeyPrivateKey);

  // Convert reserve index to 4 bytes (big-endian)
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, reserveIndex, false); // big-endian

  // Combine: passkeyPrivateKey || reserveIndex
  const combined = new Uint8Array(passkeyBytes.length + indexBytes.length);
  combined.set(passkeyBytes);
  combined.set(indexBytes, passkeyBytes.length);

  // Derive reserve private key via keccak256
  const reservePrivateKeyBytes = keccak_256(combined);

  // Get uncompressed public key (65 bytes: 0x04 prefix + 64 bytes)
  const publicKeyBytes = secp256k1.getPublicKey(reservePrivateKeyBytes, false);

  // Derive Ethereum address: last 20 bytes of keccak256(publicKey without 0x04 prefix)
  const publicKeyHash = keccak_256(publicKeyBytes.slice(1));
  const addressBytes = publicKeyHash.slice(-20);

  return {
    privateKey: `0x${bytesToHex(reservePrivateKeyBytes)}` as Hex,
    address: `0x${bytesToHex(addressBytes)}` as Hex,
  };
}
