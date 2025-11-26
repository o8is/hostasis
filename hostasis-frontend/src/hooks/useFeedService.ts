import { useState, useCallback } from 'react';
import { keccak_256 } from '@noble/hashes/sha3';
import { hexToBytes, bytesToHex, pad } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Stamper } from '@ethersphere/bee-js';
import { Binary } from 'cafe-utility';
import { usePasskeyWallet } from './usePasskeyWallet';
import { SWARM_GATEWAY_URL } from '../contracts/addresses';
import { hasFeed as checkHasFeed, setFeedOwner, setCurrentVersion, getFeedOwner, setFeedManifestUrl, getFeedManifestUrl as getStoredManifestUrl, getCurrentFeedIndex, setCurrentFeedIndex } from '../utils/feedStorage';
import { MantarayNode } from '@ethersphere/bee-js';
import { saveMantarayNodeRecursively, uploadWithStamper } from '../utils/swarmUpload';
import { swarmHashToCid } from '../utils/swarmCid';
import { hasPasskeyWallet } from '../utils/passkeyStorage';

// Feed types
export interface FeedInfo {
  address: string;  // Feed address (derived from owner + topic)
  owner: string;    // Owner address (derived from feed private key)
  topic: string;    // Topic (we use NULL_TOPIC)
  index: number;    // Current feed index
}

// NULL_TOPIC for feeds (32 zero bytes)
const NULL_TOPIC = new Uint8Array(32);

// BMT constants
const MAX_CHUNK_PAYLOAD_SIZE = 4096;
const SEGMENT_SIZE = 32;
const SPAN_SIZE = 8;

/**
 * Calculate BMT (Binary Merkle Tree) root hash for chunk payload
 * This implements the Swarm BMT algorithm:
 * 1. Pad payload to 4096 bytes
 * 2. Partition into 32-byte segments
 * 3. Recursively hash pairs in a binary tree
 */
function calculateBmtRootHash(payload: Uint8Array): Uint8Array {
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
function calculateChunkAddress(span: Uint8Array, payload: Uint8Array): Uint8Array {
  const rootHash = calculateBmtRootHash(payload);
  const combined = new Uint8Array(SPAN_SIZE + 32);
  combined.set(span, 0);
  combined.set(rootHash, SPAN_SIZE);
  return keccak_256(combined);
}

/**
 * Create a feed identifier from topic and index
 * identifier = keccak256(topic || indexBytes)
 */
function makeFeedIdentifier(topic: Uint8Array, index: number): Uint8Array {
  // Index is encoded as 8 bytes big-endian
  const indexBytes = new Uint8Array(8);
  const view = new DataView(indexBytes.buffer);
  view.setBigUint64(0, BigInt(index), false); // false = big-endian
  
  // Concatenate topic (32 bytes) + index (8 bytes)
  const combined = new Uint8Array(40);
  combined.set(topic, 0);
  combined.set(indexBytes, 32);
  
  return keccak_256(combined);
}

/**
 * Compute SOC address from identifier and owner
 * SOC address = keccak256(identifier || owner)
 */
function makeSOCAddress(identifier: Uint8Array, owner: Uint8Array): Uint8Array {
  // owner should be 20 bytes (Ethereum address without 0x prefix)
  const combined = new Uint8Array(52);
  combined.set(identifier, 0);
  combined.set(owner, 32);
  
  return keccak_256(combined);
}

/**
 * Sign data with a private key using viem (standard Ethereum signing)
 * 
 * IMPORTANT: Bee's signature verification in soc.RecoverAddress works as follows:
 * 1. It takes the raw data (identifier + chunkAddress for SOC)
 * 2. It calls crypto.Recover(signature, data)
 * 3. crypto.Recover internally: hashWithEthereumPrefix(data) then RecoverCompact
 * 
 * Bee's hashWithEthereumPrefix does: keccak256("\x19Ethereum Signed Message:\n" + len(data) + data)
 * 
 * So we need to:
 * 1. First hash the data ourselves: toSign = keccak256(identifier || chunkAddress)
 * 2. Then sign that hash - but viem's signMessage will add the prefix
 * 
 * The key insight: Bee's Sign() hashes the data BEFORE the prefix is added.
 * Looking at Bee's signer.go Sign() method:
 *   return d.sign(hashWithEthereumPrefix(data), false)
 * 
 * And hashWithEthereumPrefix does:
 *   addEthereumPrefix(data) -> keccak256(prefix + len + data)
 * 
 * So Bee signs: keccak256(prefix + len + data)
 * And Recover verifies the same way.
 * 
 * With viem's signMessage({ message: { raw: data } }):
 * - It adds the prefix and hashes: keccak256(prefix + len + data)
 * - This matches what Bee does!
 * 
 * The issue is we were pre-hashing the data. We should pass the RAW data to signMessage.
 */
async function signWithPrivateKey(privateKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Use viem to sign the data directly
  // viem's signMessage with { raw: ... } will:
  // 1. Add Ethereum prefix: "\x19Ethereum Signed Message:\n" + length
  // 2. Hash everything with keccak256
  // 3. Sign the hash
  // This matches exactly what Bee's signer.Sign() does
  const account = privateKeyToAccount(bytesToHex(privateKey));
  const signatureHex = await account.signMessage({
    message: { raw: data }
  });
  
  const signature = hexToBytes(signatureHex);
  
  // Bee expects V value of 27 or 28 (standard Ethereum format)
  // viem already returns 27/28, so no adjustment needed!
  // Bee's crypto.Recover converts it internally when calling RecoverCompact:
  //   btcsig[0] = signature[64]  // moves V to front for btcec
  
  console.log('[signWithPrivateKey] Signature V value:', signature[64]);
  
  return signature;
}

/**
 * Get address from private key using viem
 */
function getAddressFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  const account = privateKeyToAccount(bytesToHex(privateKey));
  return hexToBytes(account.address);
}

/**
 * Derive feed private key from passkey private key and reserve index
 * feedPrivateKey = keccak256(passkeyPrivateKey || reserveIndex)
 */
function deriveFeedPrivateKey(passkeyPrivateKey: string, reserveIndex: number): Uint8Array {
  const hexKey = passkeyPrivateKey.startsWith('0x') ? passkeyPrivateKey as `0x${string}` : `0x${passkeyPrivateKey}` as `0x${string}`;
  const privateKeyBytes = pad(hexToBytes(hexKey), { size: 32 });
  
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, reserveIndex, false);
  
  const combined = new Uint8Array(privateKeyBytes.length + 4);
  combined.set(privateKeyBytes, 0);
  combined.set(indexBytes, privateKeyBytes.length);
  
  return keccak_256(combined);
}

/**
 * Upload a Single Owner Chunk (SOC) to the gateway
 * 
 * Uses bee-js Stamper for client-side stamping, exactly like the working file uploads.
 */
async function uploadSOC(
  owner: Uint8Array,
  identifier: Uint8Array,
  signature: Uint8Array,
  payload: Uint8Array,
  stampId: string,
  depth: number,
  stampPrivateKey: string
): Promise<string> {
  const normalizedStampId = stampId.startsWith('0x') ? stampId.slice(2) : stampId;
  
  // Build URL
  const ownerHex = bytesToHex(owner).slice(2); // Remove 0x prefix
  const identifierHex = bytesToHex(identifier).slice(2); // Remove 0x prefix
  const signatureHex = bytesToHex(signature).slice(2); // Remove 0x prefix
  
  const url = `${SWARM_GATEWAY_URL}/soc/${ownerHex}/${identifierHex}?sig=${signatureHex}`;
  
  console.log('[SOC Upload] URL:', url);
  console.log('[SOC Upload] Payload size:', payload.length);
  console.log('[SOC Upload] Owner:', ownerHex);
  
  // Calculate SOC address for stamping
  const socAddress = makeSOCAddress(identifier, owner);
  console.log('[SOC Upload] SOC Address:', bytesToHex(socAddress));
  
  // Use bee-js Stamper - same as working file uploads
  const privateKeyWithoutPrefix = stampPrivateKey.replace(/^0x/, '');
  const stamper = Stamper.fromBlank(privateKeyWithoutPrefix, normalizedStampId, depth);
  
  // Create a mock Chunk that returns the SOC address when hash() is called
  // The Stamper only uses chunk.hash() to get the address for stamping
  const mockChunk = {
    hash: () => socAddress,
    build: () => payload, // Not actually used for stamping
    span: BigInt(payload.length),
    writer: null as any
  };
  
  // Use bee-js Stamper to create the stamp - this matches exactly what works for file uploads
  const envelope = stamper.stamp(mockChunk as any);
  
  const indexHex = Binary.uint8ArrayToHex(envelope.index);
  const timestampHex = Binary.uint8ArrayToHex(envelope.timestamp);
  const signatureStampHex = Binary.uint8ArrayToHex(envelope.signature);
  const postageStampHeader = normalizedStampId + indexHex + timestampHex + signatureStampHex;
  
  console.log('[SOC Upload] Stamp Index:', indexHex);
  console.log('[SOC Upload] Stamp Timestamp:', timestampHex);
  console.log('[SOC Upload] Stamp Issuer:', bytesToHex(envelope.issuer));
  console.log('[SOC Upload] Postage Header Length:', postageStampHeader.length / 2, 'bytes');
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'swarm-postage-stamp': postageStampHeader,
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: new Uint8Array(payload).buffer as ArrayBuffer,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SOC upload failed: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  return result.reference;
}

/**
 * Write a feed update at a specific index
 */
async function writeFeedUpdate(
  feedPrivateKey: Uint8Array,
  contentReference: string,
  feedIndex: number,
  stampId: string,
  depth: number,
  stampPrivateKey: string
): Promise<string> {
  // Get owner address from feed private key
  const owner = getAddressFromPrivateKey(feedPrivateKey);
  
  // Create feed identifier
  const identifier = makeFeedIdentifier(NULL_TOPIC, feedIndex);
  
  // Create content: timestamp (8 bytes BE) + reference (32 bytes)
  const content = new Uint8Array(40);
  const timestampView = new DataView(content.buffer);
  timestampView.setBigUint64(0, BigInt(Date.now()), false);
  
  // Parse reference (should be 64 hex chars = 32 bytes)
  const normalizedRef = contentReference.startsWith('0x') ? contentReference : `0x${contentReference}`;
  const refBytes = hexToBytes(normalizedRef as `0x${string}`);
  content.set(refBytes, 8);

  // Create span (8 bytes LE) = content length
  const span = new Uint8Array(8);
  const spanView = new DataView(span.buffer);
  spanView.setBigUint64(0, BigInt(content.length), true); // true = little-endian

  // Calculate chunk address using proper BMT hash
  // chunkAddress = keccak256(span || bmtRootHash(content))
  const chunkAddress = calculateChunkAddress(span, content);
  
  console.log('[writeFeedUpdate] Content length:', content.length);
  console.log('[writeFeedUpdate] Span (hex):', bytesToHex(span));
  console.log('[writeFeedUpdate] Chunk address:', bytesToHex(chunkAddress));
  
  // Sign the SOC: hash(identifier || chunkAddress) with Ethereum prefix
  // Bee does: signer.Sign(hash(id, ch.Address())) where hash is keccak256
  const toSignBytes = keccak_256(new Uint8Array([...identifier, ...chunkAddress]));
  console.log('[writeFeedUpdate] ToSign bytes (hash of id+addr):', bytesToHex(toSignBytes));
  
  const signature = await signWithPrivateKey(feedPrivateKey, toSignBytes);
  console.log('[writeFeedUpdate] Signature V value:', signature[64]);
  
  // Create chunk payload (span + content) for the SOC body
  const chunkPayload = new Uint8Array(span.length + content.length);
  chunkPayload.set(span, 0);
  chunkPayload.set(content, span.length);
  
  // Upload SOC - pass stampPrivateKey for the postage stamp signature
  return uploadSOC(owner, identifier, signature, chunkPayload, stampId, depth, stampPrivateKey);
}

/**
 * Get feed URL for a reserve from stored owner address
 * Returns the /feeds/{owner}/{topic} URL (raw feed data)
 */
function getFeedUrl(reserveIndex: number): string | null {
  const ownerAddress = getFeedOwner(reserveIndex);
  if (!ownerAddress) return null;
  let ownerHex = ownerAddress.replace(/^0x/, '');
  if (ownerHex.length === 64) ownerHex = ownerHex.slice(0, 40);
  const topicHex = '0'.repeat(64);
  return `${SWARM_GATEWAY_URL}/feeds/${ownerHex}/${topicHex}`;
}

/**
 * Create and upload a feed manifest for a feed
 * A feed manifest uses special metadata to reference a feed by owner and topic
 * Returns the manifest reference (hash)
 */
async function createFeedManifest(ownerAddress: string, topic: string, uploadChunk: (chunk: any) => Promise<string>): Promise<string> {
  // Build mantaray manifest with feed metadata
  const mantaray = new MantarayNode();

  // Use a null reference (32 zero bytes) and set feed metadata on root fork
  const NULL_REFERENCE = new Uint8Array(32);

  // Normalize owner address (remove 0x, ensure 40 chars)
  let ownerHex = ownerAddress.replace(/^0x/, '');
  if (ownerHex.length === 64) ownerHex = ownerHex.slice(0, 40);

  // Normalize topic (remove 0x, ensure 64 chars)
  let topicHex = topic.replace(/^0x/, '');
  if (topicHex.length < 64) topicHex = topicHex.padStart(64, '0');

  // Add root fork with feed metadata
  const metadata: Record<string, string> = {
    'swarm-feed-owner': ownerHex,
    'swarm-feed-topic': topicHex
  };

  mantaray.addFork('/', NULL_REFERENCE, metadata);

  // Upload recursively
  const manifestReference = await saveMantarayNodeRecursively(mantaray, uploadChunk);
  return manifestReference;
}

/**
 * Convert a manifest reference to a /bzz/{cid}/ URL
 */
function manifestReferenceToUrl(manifestReference: string): string {
  const cid = swarmHashToCid(manifestReference);
  const domain = SWARM_GATEWAY_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${cid}.${domain}/`;
}

/**
 * Hook for managing Swarm feeds with client-side SOC stamping
 *
 * SIMPLIFIED API:
 * - initializeFeed(reserveIndex, stampId, depth, contentHash?) - Initialize a new feed
 * - deployVersion(reserveIndex, stampId, depth, contentHash) - Deploy content to feed
 *
 * The hook gets passkey internally. Stamp depth should be fetched from useStampInfo.
 */
export function useFeedService() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { walletInfo, createPasskeyWallet, authenticatePasskeyWallet } = usePasskeyWallet();
  
  /**
   * Ensure passkey is authenticated, creating or authenticating as needed
   */
  const ensurePasskey = useCallback(async (): Promise<string | null> => {
    // If already authenticated, return the private key
    if (walletInfo) {
      return walletInfo.privateKey;
    }
    
    // Check localStorage directly to avoid race condition with useEffect
    const passkeyExists = hasPasskeyWallet();
    
    // Authenticate or create passkey
    try {
      const info = passkeyExists 
        ? await authenticatePasskeyWallet()
        : await createPasskeyWallet();
      return info.privateKey;
    } catch (err) {
      console.error('[FeedService] Passkey authentication failed:', err);
      return null;
    }
  }, [walletInfo, authenticatePasskeyWallet, createPasskeyWallet]);

  /**
   * Get feed info for a reserve (derived from passkey + reserve index)
   */
  const getFeedInfo = useCallback(async (reserveIndex: number): Promise<FeedInfo | null> => {
    try {
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }
      
      const feedPrivateKey = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);
      const owner = getAddressFromPrivateKey(feedPrivateKey);
      const identifier = makeFeedIdentifier(NULL_TOPIC, 0);
      const feedAddress = makeSOCAddress(identifier, owner);
      
      return {
        address: bytesToHex(feedAddress),
        owner: bytesToHex(owner),
        topic: bytesToHex(NULL_TOPIC),
        index: 0, // We'd need to query the actual index
      };
    } catch (err) {
      console.error('[FeedService] getFeedInfo error:', err);
      return null;
    }
  }, [ensurePasskey]);

  /**
   * Initialize a new feed for a reserve
   * @param reserveIndex - The reserve index to create feed for
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth (from useStampInfo)
   * @param contentHash - Optional initial content hash (defaults to zeros)
   * @returns Feed manifest URL
   */
  const initializeFeed = useCallback(async (
    reserveIndex: number,
    stampId: string,
    depth: number,
    contentHash?: string
  ): Promise<string> => {
    setIsLoading(true);
    setError(null);

    try {
      // Get passkey internally
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }

      console.log('[FeedService] Using stamp depth:', depth);
      
      // Derive feed private key
      const feedPrivateKey = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);
      const owner = getAddressFromPrivateKey(feedPrivateKey);
      
      // Use provided content hash or zeros
      const initialRef = contentHash || '0'.repeat(64);
      
      // Write initial feed update at index 0
      // We pass passkeyPrivateKey as the stampPrivateKey because the passkey wallet owns the stamp
      await writeFeedUpdate(feedPrivateKey, initialRef, 0, stampId, depth, passkeyPrivateKey);

      // Save owner address to feedStorage for persistence (used to construct feed URL)
      const ownerHex = bytesToHex(owner);
      setFeedOwner(reserveIndex, ownerHex);
      setCurrentFeedIndex(reserveIndex, 0); // Set initial index to 0
      if (contentHash) {
        setCurrentVersion(reserveIndex, contentHash);
      }
      
      console.log('[FeedService] Feed initialized for owner:', ownerHex);
      // Now create and upload feed manifest
      // Use the correct uploadChunk from useStampedUpload
      const uploadChunk = async (chunk: any) => {
        // Use the same logic as in useStampedUpload
        const results = await uploadWithStamper([chunk], stampId, passkeyPrivateKey, depth);
        return results[0]; // Return the first (and only) result
      };

      // Create feed manifest with owner and topic metadata
      // NULL_TOPIC is 32 zero bytes = 64 zero hex chars
      const topicHex = '0'.repeat(64);
      const manifestReference = await createFeedManifest(ownerHex, topicHex, uploadChunk);

      // Convert the manifest reference to a /bzz/ URL
      const manifestUrl = manifestReferenceToUrl(manifestReference);
      // Store the manifest URL for future use
      setFeedManifestUrl(reserveIndex, manifestUrl);
      console.log('[FeedService] Feed manifest URL:', manifestUrl);
      return manifestUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize feed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensurePasskey]);

  /**
   * Deploy a new version to a reserve's feed
   * @param reserveIndex - The reserve index
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth (from useStampInfo)
   * @param contentHash - The content hash to deploy
   */
  const deployVersion = useCallback(async (
    reserveIndex: number,
    stampId: string,
    depth: number,
    contentHash: string
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      // Get passkey internally
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }

      console.log('[FeedService] Using stamp depth:', depth);
      
      // Derive feed private key
      const feedPrivateKey = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);

      // Get current feed index and increment for this deployment
      const currentIndex = getCurrentFeedIndex(reserveIndex);
      const feedIndex = currentIndex + 1;

      console.log('[FeedService] Current index:', currentIndex, '→ Deploying to index:', feedIndex);
      
      // We pass passkeyPrivateKey as the stampPrivateKey because the passkey wallet owns the stamp
      await writeFeedUpdate(feedPrivateKey, contentHash, feedIndex, stampId, depth, passkeyPrivateKey);

      // Save to feedStorage for persistence
      setCurrentVersion(reserveIndex, contentHash);
      setCurrentFeedIndex(reserveIndex, feedIndex);

      console.log('[FeedService] Version deployed at index:', feedIndex);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to deploy version';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensurePasskey]);

  /**
   * Check if a feed exists for a reserve
   */
  const hasFeed = useCallback((reserveIndex: number): boolean => {
    return checkHasFeed(reserveIndex);
  }, []);

  /**
   * Export feed key for a reserve (for CI/CD or external use)
   * @param reserveIndex - The reserve index
   * @returns Object with privateKey and address
   */
  const exportFeedKey = useCallback(async (reserveIndex: number): Promise<{ privateKey: string; address: string }> => {
    // Get passkey internally
    const passkeyPrivateKey = await ensurePasskey();
    if (!passkeyPrivateKey) {
      throw new Error('Passkey authentication required');
    }
    
    // Derive feed private key
    const feedPrivateKey = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);
    const owner = getAddressFromPrivateKey(feedPrivateKey);
    
    return {
      privateKey: bytesToHex(feedPrivateKey),
      address: bytesToHex(owner),
    };
  }, [ensurePasskey]);

  /**
   * Get the feed manifest URL for a reserve
   */
  const getFeedManifestUrl = useCallback((reserveIndex: number): string | null => {
    return getStoredManifestUrl(reserveIndex);
  }, []);

  return {
    isLoading,
    error,
    getFeedInfo,
    initializeFeed,
    deployVersion,
    getFeedUrl,
    getFeedManifestUrl,
    hasFeed,
    exportFeedKey,
  };
}

export { manifestReferenceToUrl };
