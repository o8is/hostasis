import { useState, useCallback } from 'react';
import { hexToBytes, bytesToHex, pad } from 'viem';
import { keccak_256 } from '@noble/hashes/sha3';
import { usePasskeyWallet } from './usePasskeyWallet';
import { SWARM_GATEWAY_URL } from '../contracts/addresses';
import { hasFeed as checkHasFeed, setFeedOwner, setCurrentVersion, getFeedOwner, setFeedManifestUrl, getFeedManifestUrl as getStoredManifestUrl, getCurrentFeedIndex, setCurrentFeedIndex } from '../utils/feedStorage';
import { MantarayNode } from '@ethersphere/bee-js';
import { hasPasskeyWallet } from '../utils/passkeyStorage';
import {
  deriveProjectKey,
  writeFeedUpdate as stamperWriteFeedUpdate,
  makeFeedIdentifier,
  makeSOCAddress,
  getAddressFromPrivateKey,
  swarmHashToCid,
  saveMantarayNodeRecursively,
  StampedUploader,
} from '@hostasis/swarm-stamper';
import { deriveVaultKey } from '../utils/vaultKeys';
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
 * Derive feed private key from passkey private key and vault index
 * feedPrivateKey = keccak256(passkeyPrivateKey || vaultIndex)
 *
 * NOTE: This is the legacy derivation for single-project vaults.
 * For multi-project support, use deriveVaultKey + deriveProjectKey instead.
 */
function deriveFeedPrivateKey(passkeyPrivateKey: string, vaultIndex: number): string {
  const hexKey = passkeyPrivateKey.startsWith('0x') ? passkeyPrivateKey as `0x${string}` : `0x${passkeyPrivateKey}` as `0x${string}`;
  const privateKeyBytes = pad(hexToBytes(hexKey), { size: 32 });

  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, vaultIndex, false);

  const combined = new Uint8Array(privateKeyBytes.length + 4);
  combined.set(privateKeyBytes, 0);
  combined.set(indexBytes, privateKeyBytes.length);

  const derivedKey = keccak_256(combined);
  return bytesToHex(derivedKey);
}

/**
 * Get feed URL for a vault from stored owner address
 * Returns the /feeds/{owner}/{topic} URL (raw feed data)
 */
function getFeedUrl(vaultIndex: number): string | null {
  const ownerAddress = getFeedOwner(vaultIndex);
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
async function fetchFeedIndex(vaultIndex: number): Promise<number | null> {
  const feedUrl = getFeedUrl(vaultIndex);
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
 * - initializeFeed(vaultIndex, stampId, depth, contentHash?) - Initialize a new feed
 * - deployVersion(vaultIndex, stampId, depth, contentHash) - Deploy content to feed
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
   * Get feed info for a vault (derived from passkey + vault index)
   */
  const getFeedInfo = useCallback(async (vaultIndex: number): Promise<FeedInfo | null> => {
    try {
      const passkeyPrivateKey = await ensurePasskey();
      if (!passkeyPrivateKey) {
        throw new Error('Passkey authentication required');
      }

      const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, vaultIndex);
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
   * Initialize a new feed for a vault
   * @param vaultIndex - The vault index to create feed for
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth (from useStampInfo)
   * @param contentHash - Optional initial content hash (defaults to zeros)
   * @returns Feed manifest URL
   */
  const initializeFeed = useCallback(async (
    vaultIndex: number,
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
      const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, vaultIndex);
      const owner = getAddressFromPrivateKey(feedPrivateKeyHex);

      const initialRef = contentHash || '0'.repeat(64);

      // Write initial feed update at index 0 using swarm-stamper
      // In legacy mode, the feed key is also the stamp key
      await stamperWriteFeedUpdate({
        vaultPrivateKey: feedPrivateKeyHex,
        contentReference: initialRef,
        feedIndex: 0,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

      const ownerHex = addressBytesToHex(owner);
      setFeedOwner(vaultIndex, ownerHex);
      setCurrentFeedIndex(vaultIndex, 0);
      if (contentHash) {
        setCurrentVersion(vaultIndex, contentHash);
      }

      console.log('[FeedService] Feed initialized for owner:', ownerHex);

      // Create uploader for manifest chunks
      const uploader = new StampedUploader({
        gatewayUrl: SWARM_GATEWAY_URL,
        batchId: stampId,
        privateKey: feedPrivateKeyHex,
        depth,
      });

      const topicHex = '0'.repeat(64);
      const manifestReference = await createFeedManifest(ownerHex, topicHex, uploader.createChunkUploader());
      const manifestUrl = manifestReferenceToUrl(manifestReference);

      setFeedManifestUrl(vaultIndex, manifestUrl, manifestReference);
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
   * Deploy a new version to a vault's feed
   * @param vaultIndex - The vault index
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth (from useStampInfo)
   * @param contentHash - The content hash to deploy
   */
  const deployVersion = useCallback(async (
    vaultIndex: number,
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

      const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, vaultIndex);

      const currentIndex = getCurrentFeedIndex(vaultIndex);
      const feedIndex = currentIndex + 1;

      console.log('[FeedService] Current index:', currentIndex, '→ Deploying to index:', feedIndex);

      // In legacy mode, the feed key is also the stamp key
      await stamperWriteFeedUpdate({
        vaultPrivateKey: feedPrivateKeyHex,
        contentReference: contentHash,
        feedIndex,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

      setCurrentVersion(vaultIndex, contentHash);
      setCurrentFeedIndex(vaultIndex, feedIndex);

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
   * Check if a feed exists for a vault
   */
  const hasFeed = useCallback((vaultIndex: number): boolean => {
    return checkHasFeed(vaultIndex);
  }, []);

  /**
   * Export feed key for a vault (for CI/CD or external use)
   * @param vaultIndex - The vault index
   * @returns Object with privateKey and address
   */
  const exportFeedKey = useCallback(async (vaultIndex: number): Promise<{ privateKey: string; address: string }> => {
    const passkeyPrivateKey = await ensurePasskey();
    if (!passkeyPrivateKey) {
      throw new Error('Passkey authentication required');
    }

    const feedPrivateKeyHex = deriveFeedPrivateKey(passkeyPrivateKey, vaultIndex);
    const owner = getAddressFromPrivateKey(feedPrivateKeyHex);

    return {
      privateKey: feedPrivateKeyHex,
      address: addressBytesToHex(owner),
    };
  }, [ensurePasskey]);

  /**
   * Get the feed manifest URL for a vault
   */
  const getFeedManifestUrl = useCallback((vaultIndex: number): string | null => {
    return getStoredManifestUrl(vaultIndex);
  }, []);

  /**
   * Fetch the current feed index from Swarm gateway
   */
  const fetchCurrentFeedIndex = useCallback(async (vaultIndex: number): Promise<number | null> => {
    return fetchFeedIndex(vaultIndex);
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
   * Initialize a feed for a specific project within a vault
   * Uses project key derivation: projectKey = keccak256(vaultKey || projectSlug)
   *
   * @param vaultIndex - The vault index
   * @param projectSlug - The project slug (normalized name)
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth
   * @param contentHash - Optional initial content hash
   * @returns Feed manifest URL
   */
  const initializeProjectFeed = useCallback(async (
    vaultIndex: number,
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

      // Derive vault key, then project key
      const vaultKey = deriveVaultKey(passkeyHex, vaultIndex);
      const projectKey = deriveProjectKey(vaultKey.privateKey, projectSlug);

      const initialRef = contentHash || '0'.repeat(64);

      // Write initial feed update at index 0
      // Project key signs the SOC, vault key stamps the chunks
      await stamperWriteFeedUpdate({
        vaultPrivateKey: vaultKey.privateKey,
        signerPrivateKey: projectKey.privateKey,
        contentReference: initialRef,
        feedIndex: 0,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

      const ownerHex = projectKey.address.replace(/^0x/, '');
      console.log('[FeedService] Project feed initialized for:', projectSlug, 'owner:', ownerHex);

      // Create uploader for manifest chunks
      const uploader = new StampedUploader({
        gatewayUrl: SWARM_GATEWAY_URL,
        batchId: stampId,
        privateKey: vaultKey.privateKey,
        depth,
      });

      const topicHex = '0'.repeat(64);
      const manifestReference = await createFeedManifest(ownerHex, topicHex, uploader.createChunkUploader());
      const manifestUrl = manifestReferenceToUrl(manifestReference);

      // Update project data with manifest URL and reference
      updateProject(vaultIndex, projectSlug, {
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
   * @param vaultIndex - The vault index
   * @param projectSlug - The project slug
   * @param stampId - The postage stamp batch ID
   * @param depth - The stamp depth
   * @param contentHash - The content hash to deploy
   */
  const deployToProject = useCallback(async (
    vaultIndex: number,
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
      const project = getProject(vaultIndex, projectSlug);
      if (!project) {
        throw new Error(`Project "${projectSlug}" not found in vault ${vaultIndex}`);
      }

      // Normalize passkey to 0x format
      const passkeyHex = passkeyPrivateKey.startsWith('0x')
        ? passkeyPrivateKey as `0x${string}`
        : `0x${passkeyPrivateKey}` as `0x${string}`;

      // Derive keys
      const vaultKey = deriveVaultKey(passkeyHex, vaultIndex);
      const projectKey = deriveProjectKey(vaultKey.privateKey, projectSlug);

      // Increment feed index
      const nextIndex = project.currentIndex + 1;

      console.log('[FeedService] Deploying to project:', projectSlug, 'index:', nextIndex);

      // Write feed update - vault key stamps, project key signs
      await stamperWriteFeedUpdate({
        vaultPrivateKey: vaultKey.privateKey,
        signerPrivateKey: projectKey.privateKey,
        contentReference: contentHash,
        feedIndex: nextIndex,
        batchId: stampId,
        depth,
        gatewayUrl: SWARM_GATEWAY_URL,
      });

      // Update project data
      updateProject(vaultIndex, projectSlug, {
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
   * @param vaultIndex - The vault index
   * @param projectSlug - The project slug
   * @returns Object with privateKey and address
   */
  const exportProjectKey = useCallback(async (
    vaultIndex: number,
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

    const vaultKey = deriveVaultKey(passkeyHex, vaultIndex);
    const projectKey = deriveProjectKey(vaultKey.privateKey, projectSlug);

    return {
      privateKey: projectKey.privateKey,
      address: projectKey.address,
    };
  }, [ensurePasskey]);

  /**
   * Get project manifest URL
   */
  const getProjectManifestUrl = useCallback((vaultIndex: number, projectSlug: string): string | null => {
    const project = getProject(vaultIndex, projectSlug);
    return project?.manifestUrl || null;
  }, []);

  return {
    isLoading,
    error,
    // Legacy vault-based functions
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
