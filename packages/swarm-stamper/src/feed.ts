/**
 * Swarm Feed Update Logic (SOC - Single Owner Chunk)
 *
 * Shared between CLI and frontend for updating Swarm feeds.
 * Implements the full SOC creation, signing, stamping, and upload flow.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';
import { Stamper } from '@ethersphere/bee-js';
import { Binary } from 'cafe-utility';
import { privateKeyToAccount } from 'viem/accounts';

// BMT constants
const MAX_CHUNK_PAYLOAD_SIZE = 4096;
const SEGMENT_SIZE = 32;

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
 * Get Ethereum address from private key (20 bytes)
 */
export function getAddressFromPrivateKey(privateKeyHex: string): Uint8Array {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const publicKey = secp256k1.getPublicKey(privateKeyBytes, false);
  const publicKeyHash = keccak_256(publicKey.slice(1));
  return publicKeyHash.slice(-20);
}

/**
 * Create feed identifier from topic and index
 * identifier = keccak256(topic || indexBytes)
 */
export function makeFeedIdentifier(topic: Uint8Array, index: number): Uint8Array {
  const indexBytes = new Uint8Array(8);
  const view = new DataView(indexBytes.buffer);
  view.setBigUint64(0, BigInt(index), false); // big-endian

  const combined = new Uint8Array(40);
  combined.set(topic, 0);
  combined.set(indexBytes, 32);

  return keccak_256(combined);
}

/**
 * Calculate BMT (Binary Merkle Tree) root hash for chunk payload
 * This implements the Swarm BMT algorithm:
 * 1. Pad payload to 4096 bytes
 * 2. Partition into 32-byte segments
 * 3. Recursively hash pairs in a binary tree
 */
export function calculateBmtRootHash(payload: Uint8Array): Uint8Array {
  // Pad to MAX_CHUNK_PAYLOAD_SIZE (4096 bytes)
  const input = new Uint8Array(MAX_CHUNK_PAYLOAD_SIZE);
  input.set(payload);

  // Partition into 32-byte segments (128 segments)
  const segments: Uint8Array[] = [];
  for (let i = 0; i < MAX_CHUNK_PAYLOAD_SIZE; i += SEGMENT_SIZE) {
    segments.push(input.slice(i, i + SEGMENT_SIZE));
  }

  // Binary tree reduction: hash pairs until we have one root
  let level = segments;
  while (level.length > 1) {
    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const combined = new Uint8Array(64);
      combined.set(level[i], 0);
      combined.set(level[i + 1], 32);
      nextLevel.push(keccak_256(combined));
    }
    level = nextLevel;
  }

  return level[0];
}

/**
 * Calculate chunk address using BMT hash
 * chunkAddress = keccak256(span || bmtRootHash)
 */
export function calculateChunkAddress(span: Uint8Array, payload: Uint8Array): Uint8Array {
  const rootHash = calculateBmtRootHash(payload);
  const combined = new Uint8Array(8 + 32);
  combined.set(span, 0);
  combined.set(rootHash, 8);
  return keccak_256(combined);
}

/**
 * Compute SOC address from identifier and owner
 * SOC address = keccak256(identifier || owner)
 */
export function makeSOCAddress(identifier: Uint8Array, owner: Uint8Array): Uint8Array {
  const combined = new Uint8Array(52);
  combined.set(identifier, 0);
  combined.set(owner, 32);
  return keccak_256(combined);
}

export interface WriteFeedUpdateOptions {
  /** Vault private key (hex string, with or without 0x prefix) - used for stamping */
  vaultPrivateKey: string;
  /**
   * Signer private key (hex string, with or without 0x prefix) - used for SOC signing.
   * If not provided, vaultPrivateKey is used for both signing and stamping.
   * Use this when the feed owner is different from the batch owner (multi-project support).
   */
  signerPrivateKey?: string;
  /** Content reference to point feed to (Swarm hash, 64 hex chars) */
  contentReference: string;
  /** Feed index (incrementing integer) */
  feedIndex: number;
  /** Postage batch ID (hex string, with or without 0x prefix) */
  batchId: string;
  /** Batch depth (from contract or default 20) */
  depth: number;
  /** Swarm gateway URL */
  gatewayUrl: string;
  /** Feed topic (32 bytes, defaults to NULL_TOPIC) */
  topic?: Uint8Array;
}

/**
 * Write a feed update to Swarm using SOC (Single Owner Chunk)
 *
 * This function:
 * 1. Creates feed content: timestamp (8 bytes BE) + reference (32 bytes)
 * 2. Calculates chunk address using BMT
 * 3. Signs keccak256(identifier || chunkAddress) with Ethereum prefix
 * 4. Stamps the SOC using client-side stamping
 * 5. Uploads to /soc/{owner}/{identifier}?sig={signature}
 *
 * @returns Promise that resolves when upload is complete
 */
export async function writeFeedUpdate(options: WriteFeedUpdateOptions): Promise<void> {
  const {
    vaultPrivateKey,
    signerPrivateKey,
    contentReference,
    feedIndex,
    batchId,
    depth,
    gatewayUrl,
    topic = new Uint8Array(32) // NULL_TOPIC by default
  } = options;

  // Use signerPrivateKey for SOC owner/signing if provided, otherwise use vaultPrivateKey
  const socPrivateKey = signerPrivateKey || vaultPrivateKey;
  const owner = getAddressFromPrivateKey(socPrivateKey);
  const identifier = makeFeedIdentifier(topic, feedIndex);

  // Create content: timestamp (8 bytes BE) + reference (32 bytes)
  const content = new Uint8Array(40);
  const timestampView = new DataView(content.buffer);
  timestampView.setBigUint64(0, BigInt(Date.now()), false); // big-endian

  const normalizedRef = contentReference.startsWith('0x') ? contentReference : `0x${contentReference}`;
  const refBytes = hexToBytes(normalizedRef);
  content.set(refBytes, 8);

  // Create span (8 bytes LE) = content length
  const span = new Uint8Array(8);
  const spanView = new DataView(span.buffer);
  spanView.setBigUint64(0, BigInt(content.length), true); // little-endian

  // Calculate chunk address using BMT
  const chunkAddress = calculateChunkAddress(span, content);

  // Sign: keccak256(identifier || chunkAddress) with Ethereum prefix
  // Use the SOC private key (project key) for signing the feed update
  const toSignBytes = keccak_256(new Uint8Array([...identifier, ...chunkAddress]));

  // Use viem to sign with Ethereum prefix
  const account = privateKeyToAccount(`0x${socPrivateKey.replace(/^0x/, '')}`);
  const signatureHex = await account.signMessage({
    message: { raw: toSignBytes }
  });
  const signature = hexToBytes(signatureHex);

  // Create chunk payload (span + content) for the SOC body
  const chunkPayload = new Uint8Array(span.length + content.length);
  chunkPayload.set(span, 0);
  chunkPayload.set(content, span.length);

  // Calculate SOC address for stamping
  const socAddress = makeSOCAddress(identifier, owner);

  // Stamp the SOC using the vault key (batch owner)
  const normalizedBatchId = batchId.replace(/^0x/, '');
  const stampPrivateKey = vaultPrivateKey.replace(/^0x/, '');
  const stamper = Stamper.fromBlank(stampPrivateKey, normalizedBatchId, depth);

  // Create a mock chunk for stamping
  const mockChunk = {
    hash: () => socAddress,
    build: () => chunkPayload,
    span: BigInt(chunkPayload.length),
    writer: null as any
  };

  const envelope = stamper.stamp(mockChunk as any);
  const indexHex = Binary.uint8ArrayToHex(envelope.index);
  const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
  const signatureStampHex = Binary.uint8ArrayToHex(envelope.signature);
  const postageStampHeader = normalizedBatchId + indexHex + timestampHex + signatureStampHex;

  // Upload SOC with sig query parameter
  const ownerHex = bytesToHex(owner);
  const identifierHex = bytesToHex(identifier);
  const signatureSOCHex = bytesToHex(signature);

  const url = `${gatewayUrl}/soc/${ownerHex}/${identifierHex}?sig=${signatureSOCHex}`;

  // Use fetch API (works in both Node.js 18+ and browser)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'swarm-postage-stamp': postageStampHeader
    },
    body: chunkPayload
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SOC upload failed: ${response.status} - ${errorText}`);
  }
}
