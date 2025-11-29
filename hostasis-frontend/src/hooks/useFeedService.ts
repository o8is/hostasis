import { useState, useCallback } from 'react';
import { hexToBytes, bytesToHex, pad } from 'viem';
import { keccak_256 } from '@noble/hashes/sha3';
import { usePasskeyWallet } from './usePasskeyWallet';
import { SWARM_GATEWAY_URL } from '../contracts/addresses';
import { hasFeed as checkHasFeed, setFeedOwner, setCurrentVersion, getFeedOwner, setFeedManifestUrl, getFeedManifestUrl as getStoredManifestUrl, getCurrentFeedIndex, setCurrentFeedIndex } from '../utils/feedStorage';
import { MantarayNode } from '@ethersphere/bee-js';
import { saveMantarayNodeRecursively, uploadWithStamper } from '../utils/swarmUpload';
import { swarmHashToCid } from '../utils/swarmCid';
import { hasPasskeyWallet } from '../utils/passkeyStorage';
import {
  deriveProjectKey,
  writeFeedUpdate as stamperWriteFeedUpdate,
  makeFeedIdentifier,
  makeSOCAddress,
  getAddressFromPrivateKey,
} from '@hostasis/swarm-stamper';
import { deriveReserveKey } from '../utils/reserveKeys';
import { getProject, updateProject } from '../utils/projectStorage';

// Feed types
export interface FeedInfo {
  address: string;  // Feed address (derived from owner + topic)
  owner: string;    // Owner address (derived from feed private key)
  topic: string;    // Topic (we use NULL_TOPIC)
  index: number;    // Current feed index
}

// NULL_TOPIC for feeds (32 zero bytes)
const NULL_TOPIC = new Uint8Array(32);

/**
 * Derive feed private key from passkey private key and reserve index
 * feedPrivateKey = keccak256(passkeyPrivateKey || reserveIndex)
 *
 * NOTE: This is the legacy derivation for single-project reserves.
 * For multi-project support, use deriveReserveKey + deriveProjectKey instead.
 */
function deriveFeedPrivateKey(passkeyPrivateKey: string, reserveIndex: number): string {
  const hexKey = passkeyPrivateKey.startsWith('0x') ? passkeyPrivateKey as `0x${string}` : `0x${passkeyPrivateKey}` as `0x${string}`;
  const privateKeyBytes = pad(hexToBytes(hexKey), { size: 32 });

  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, reserveIndex, false);

  const combined = new Uint8Array(privateKeyBytes.length + 4);
  combined.set(privateKeyBytes, 0);
  combined.set(indexBytes, privateKeyBytes.length);

  const derivedKey = keccak_256(combined);
  return bytesToHex(derivedKey);
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
 * Fetch the current feed index from the Swarm gateway
 * Returns the latest index from the feed endpoint, or null if not found
 */
async function fetchFeedIndex(reserveIndex: number): Promise<number | null> {
  const feedUrl = getFeedUrl(reserveIndex);
  if (!feedUrl) return null;

  try {
    const response = await fetch(feedUrl);
    if (!response.ok) {
      return null;
    }

    const indexHeader = response.headers.get('swarm-feed-index');
    if (indexHeader) {
      return parseInt(indexHeader, 10);
    }

    return null;
  } catch (err) {
    console.error('[fetchFeedIndex] Error fetching feed index:', err);
    return null;
  }
}

/**
 * Fetch the current feed index for a project by owner address
 * Returns the latest index from the feed endpoint, or null if not found
 */
async function fetchFeedIndexByOwner(ownerAddress: string): Promise<number | null> {
  try {
    let ownerHex = ownerAddress.replace(/^0x/, '');
    if (ownerHex.length === 64) ownerHex = ownerHex.slice(0, 40);
    const topicHex = '0'.repeat(64);
    const feedUrl = `${SWARM_GATEWAY_URL}/feeds/${ownerHex}/${topicHex}`;

    const response = await fetch(feedUrl);
    if (!response.ok) {
      return null;
    }

    const indexHeader = response.headers.get('swarm-feed-index');
    if (indexHeader) {
      return parseInt(indexHeader, 10);
    }

    return null;
  } catch (err) {
    console.error('[fetchFeedIndexByOwner] Error fetching feed index:', err);
    return null;
  }
}

/**
 * Create and upload a feed manifest for a feed
 * A feed manifest uses special metadata to reference a feed by owner and topic
 * Returns the manifest reference (hash)
 */
async function createFeedManifest(ownerAddress: string, topic: string, uploadChunk: (chunk: any) => Promise<string>): Promise<string> {
  const mantaray = new MantarayNode();
  const NULL_REFERENCE = new Uint8Array(32);

  // Normalize owner address (remove 0x, ensure 40 chars)
  let ownerHex = ownerAddress.replace(/^0x/, '');
  if (ownerHex.length === 64) ownerHex = ownerHex.slice(0, 40);

  // Normalize topic (remove 0x, ensure 64 chars)
  let topicHex = topic.replace(/^0x/, '');
  if (topicHex.length < 64) topicHex = topicHex.padStart(64, '0');

  const metadata: Record<string, string> = {
    'swarm-feed-owner': ownerHex,
    'swarm-feed-topic': topicHex
  };

  mantaray.addFork('/', NULL_REFERENCE, metadata);
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
 * Helper to convert bytes to hex string (for addresses from swarm-stamper)
 */
function addressBytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
    if (walletInfo) {
      return walletInfo.privateKey;
    }

    const passkeyExists = hasPasskeyWallet();

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

      const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);
      const owner = getAddressFromPrivateKey(feedPrivateKeyHex);
      const identifier = makeFeedIdentifier(NULL_TOPIC, 0);
      const feedAddress = makeSOCAddress(identifier, owner);

      return {
        address: addressBytesToHex(feedAddress),
        owner: addressBytesToHex(owner),
        topic: addressBytesToHex(NULL_TOPIC),
        index: 0,
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
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }

      console.log('[FeedService] Using stamp depth:', depth);

      // Derive feed private key (legacy single-project mode)
      const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);
      const owner = getAddressFromPrivateKey(feedPrivateKeyHex);

      const initialRef = contentHash || '0'.repeat(64);

      // Write initial feed update at index 0 using swarm-stamper
      // In legacy mode, the feed key is also the stamp key
      await stamperWriteFeedUpdate({
        reservePrivateKey: feedPrivateKeyHex,
        contentReference: initialRef,
        feedIndex: 0,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

      const ownerHex = addressBytesToHex(owner);
      setFeedOwner(reserveIndex, ownerHex);
      setCurrentFeedIndex(reserveIndex, 0);
      if (contentHash) {
        setCurrentVersion(reserveIndex, contentHash);
      }

      console.log('[FeedService] Feed initialized for owner:', ownerHex);

      // Create and upload feed manifest
      const uploadChunk = async (chunk: any) => {
        const results = await uploadWithStamper([chunk], stampId, feedPrivateKeyHex, depth);
        return results[0];
      };

      const topicHex = '0'.repeat(64);
      const manifestReference = await createFeedManifest(ownerHex, topicHex, uploadChunk);
      const manifestUrl = manifestReferenceToUrl(manifestReference);

      setFeedManifestUrl(reserveIndex, manifestUrl, manifestReference);
      console.log('[FeedService] Feed manifest URL:', manifestUrl);
      console.log('[FeedService] Feed manifest reference:', manifestReference);
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
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }

      console.log('[FeedService] Using stamp depth:', depth);

      const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);

      const currentIndex = getCurrentFeedIndex(reserveIndex);
      const feedIndex = currentIndex + 1;

      console.log('[FeedService] Current index:', currentIndex, '→ Deploying to index:', feedIndex);

      // In legacy mode, the feed key is also the stamp key
      await stamperWriteFeedUpdate({
        reservePrivateKey: feedPrivateKeyHex,
        contentReference: contentHash,
        feedIndex,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

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
    const passkeyPrivateKey = await ensurePasskey();
    if (!passkeyPrivateKey) {
      throw new Error('Passkey authentication required');
    }

    const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, reserveIndex);
    const owner = getAddressFromPrivateKey(feedPrivateKeyHex);

    return {
      privateKey: feedPrivateKeyHex,
      address: addressBytesToHex(owner),
    };
  }, [ensurePasskey]);

  /**
   * Get the feed manifest URL for a reserve
   */
  const getFeedManifestUrl = useCallback((reserveIndex: number): string | null => {
    return getStoredManifestUrl(reserveIndex);
  }, []);

  /**
   * Fetch the current feed index from Swarm gateway
   */
  const fetchCurrentFeedIndex = useCallback(async (reserveIndex: number): Promise<number | null> => {
    return fetchFeedIndex(reserveIndex);
  }, []);

  /**
   * Fetch the current feed index for a project by owner address
   */
  const fetchProjectFeedIndex = useCallback(async (ownerAddress: string): Promise<number | null> => {
    return fetchFeedIndexByOwner(ownerAddress);
  }, []);

  // ============================================
  // PROJECT-AWARE FUNCTIONS (Multi-project support)
  // ============================================

  /**
   * Initialize a feed for a specific project within a reserve
   * Uses project key derivation: projectKey = keccak256(reserveKey || projectSlug)
   *
   * @param reserveIndex - The reserve index
   * @param projectSlug - The project slug (normalized name)
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth
   * @param contentHash - Optional initial content hash
   * @returns Feed manifest URL
   */
  const initializeProjectFeed = useCallback(async (
    reserveIndex: number,
    projectSlug: string,
    stampId: string,
    depth: number,
    contentHash?: string
  ): Promise<string> => {
    setIsLoading(true);
    setError(null);

    try {
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }

      // Normalize passkey to 0x format
      const passkeyHex = passkeyPrivateKey.startsWith('0x')
        ? passkeyPrivateKey as `0x${string}`
        : `0x${passkeyPrivateKey}` as `0x${string}`;

      // Derive reserve key, then project key
      const reserveKey = deriveReserveKey(passkeyHex, reserveIndex);
      const projectKey = deriveProjectKey(reserveKey.privateKey, projectSlug);

      const initialRef = contentHash || '0'.repeat(64);

      // Write initial feed update at index 0
      // Project key signs the SOC, reserve key stamps the chunks
      await stamperWriteFeedUpdate({
        reservePrivateKey: reserveKey.privateKey,
        signerPrivateKey: projectKey.privateKey,
        contentReference: initialRef,
        feedIndex: 0,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

      const ownerHex = projectKey.address.replace(/^0x/, '');
      console.log('[FeedService] Project feed initialized for:', projectSlug, 'owner:', ownerHex);

      // Create and upload feed manifest
      const uploadChunk = async (chunk: any) => {
        const results = await uploadWithStamper([chunk], stampId, reserveKey.privateKey, depth);
        return results[0];
      };

      const topicHex = '0'.repeat(64);
      const manifestReference = await createFeedManifest(ownerHex, topicHex, uploadChunk);
      const manifestUrl = manifestReferenceToUrl(manifestReference);

      // Update project data with manifest URL and reference
      updateProject(reserveIndex, projectSlug, {
        manifestUrl,
        manifestReference,
        feedOwnerAddress: ownerHex,
        currentVersion: contentHash,
        currentIndex: 0,
      });

      console.log('[FeedService] Project manifest URL:', manifestUrl);
      console.log('[FeedService] Project manifest reference:', manifestReference);
      return manifestUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initialize project feed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensurePasskey]);

  /**
   * Deploy a new version to a project's feed
   *
   * @param reserveIndex - The reserve index
   * @param projectSlug - The project slug
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth
   * @param contentHash - The content hash to deploy
   */
  const deployToProject = useCallback(async (
    reserveIndex: number,
    projectSlug: string,
    stampId: string,
    depth: number,
    contentHash: string
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }

      // Get project data
      const project = getProject(reserveIndex, projectSlug);
      if (!project) {
        throw new Error(`Project "${projectSlug}" not found in reserve ${reserveIndex}`);
      }

      // Normalize passkey to 0x format
      const passkeyHex = passkeyPrivateKey.startsWith('0x')
        ? passkeyPrivateKey as `0x${string}`
        : `0x${passkeyPrivateKey}` as `0x${string}`;

      // Derive keys
      const reserveKey = deriveReserveKey(passkeyHex, reserveIndex);
      const projectKey = deriveProjectKey(reserveKey.privateKey, projectSlug);

      // Increment feed index
      const nextIndex = project.currentIndex + 1;

      console.log('[FeedService] Deploying to project:', projectSlug, 'index:', nextIndex);

      // Write feed update - reserve key stamps, project key signs
      await stamperWriteFeedUpdate({
        reservePrivateKey: reserveKey.privateKey,
        signerPrivateKey: projectKey.privateKey,
        contentReference: contentHash,
        feedIndex: nextIndex,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

      // Update project data
      updateProject(reserveIndex, projectSlug, {
        currentVersion: contentHash,
        currentIndex: nextIndex,
      });

      console.log('[FeedService] Version deployed to project:', projectSlug);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to deploy to project';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [ensurePasskey]);

  /**
   * Export project key for CLI/CD use
   *
   * @param reserveIndex - The reserve index
   * @param projectSlug - The project slug
   * @returns Object with privateKey and address
   */
  const exportProjectKey = useCallback(async (
    reserveIndex: number,
    projectSlug: string
  ): Promise<{ privateKey: string; address: string }> => {
    const passkeyPrivateKey = await ensurePasskey();
    if (!passkeyPrivateKey) {
      throw new Error('Passkey authentication required');
    }

    // Normalize passkey to 0x format
    const passkeyHex = passkeyPrivateKey.startsWith('0x')
      ? passkeyPrivateKey as `0x${string}`
      : `0x${passkeyPrivateKey}` as `0x${string}`;

    const reserveKey = deriveReserveKey(passkeyHex, reserveIndex);
    const projectKey = deriveProjectKey(reserveKey.privateKey, projectSlug);

    return {
      privateKey: projectKey.privateKey,
      address: projectKey.address,
    };
  }, [ensurePasskey]);

  /**
   * Get project manifest URL
   */
  const getProjectManifestUrl = useCallback((reserveIndex: number, projectSlug: string): string | null => {
    const project = getProject(reserveIndex, projectSlug);
    return project?.manifestUrl || null;
  }, []);

  return {
    isLoading,
    error,
    // Legacy reserve-based functions
    getFeedInfo,
    initializeFeed,
    deployVersion,
    getFeedUrl,
    getFeedManifestUrl,
    hasFeed,
    exportFeedKey,
    fetchCurrentFeedIndex,
    // Project-aware functions
    initializeProjectFeed,
    deployToProject,
    exportProjectKey,
    getProjectManifestUrl,
    fetchProjectFeedIndex,
  };
}

export { manifestReferenceToUrl };
