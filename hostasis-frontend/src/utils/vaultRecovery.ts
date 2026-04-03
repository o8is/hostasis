/**
 * Vault Data Recovery
 *
 * Recovers localStorage vault/project/feed data from on-chain + Swarm sources
 * after localStorage has been cleared.
 *
 * Recovery is possible because:
 * - Number of vaults (deposits) is on-chain
 * - Vault keys are deterministically derived from passkey + vault index
 * - Legacy feed owner = vault key address (checkable on Swarm)
 * - Project feed owners = derived from vault key + project slug (need slug input)
 *
 * What CANNOT be recovered without user input:
 * - Project slugs (needed for project key derivation)
 * - Display names (cosmetic)
 * - Vault tier label (though depth is on-chain and tier can be inferred)
 */

import { type Hex } from 'viem';
import { deriveVaultKey, type VaultKeyInfo } from './vaultKeys';
import {
  deriveProjectKey,
  getAddressFromPrivateKey,
  swarmHashToCid,
} from '@hostasis/swarm-stamper';
import { SWARM_GATEWAY_URL } from '../contracts/addresses';
import {
  type VaultData,
  type VaultTier,
  type ProjectData,
  VAULT_TIERS,
  setVaultData,
  getVaultData,
} from './projectStorage';
import {
  setFeedOwner,
  setFeedManifestUrl,
  setCurrentFeedIndex,
  setCurrentVersion,
} from './feedStorage';

export interface RecoveryResult {
  vaultIndex: number;
  vaultKey: VaultKeyInfo;
  tier: VaultTier;
  /** Whether a legacy (single-project) feed was found on Swarm */
  legacyFeedFound: boolean;
  legacyFeedIndex: number | null;
  legacyFeedContentHash: string | null;
  legacyManifestReference: string | null;
  legacyManifestUrl: string | null;
  /** Projects recovered (from user-provided slugs) */
  recoveredProjects: RecoveredProject[];
}

export interface RecoveredProject {
  slug: string;
  feedOwnerAddress: string;
  feedFound: boolean;
  feedIndex: number | null;
  contentHash: string | null;
  manifestReference: string | null;
  manifestUrl: string | null;
}

/**
 * Infer vault tier from stamp depth
 */
export function inferTierFromDepth(depth: number): VaultTier {
  for (const [tier, info] of Object.entries(VAULT_TIERS)) {
    if (info.depth === depth) return tier as VaultTier;
  }
  // Default to the closest tier
  if (depth <= 18) return 'starter';
  if (depth <= 19) return 'basic';
  if (depth <= 20) return 'standard';
  return 'pro';
}

/**
 * Check if a feed exists on Swarm and get its current state
 */
async function probeFeed(ownerAddress: string): Promise<{
  found: boolean;
  index: number | null;
  contentHash: string | null;
}> {
  try {
    let ownerHex = ownerAddress.replace(/^0x/, '');
    if (ownerHex.length === 64) ownerHex = ownerHex.slice(0, 40);
    const topicHex = '0'.repeat(64);
    const feedUrl = `${SWARM_GATEWAY_URL}/feeds/${ownerHex}/${topicHex}`;

    const response = await fetch(feedUrl);
    if (!response.ok) {
      return { found: false, index: null, contentHash: null };
    }

    const indexHeader = response.headers.get('swarm-feed-index');
    const index = indexHeader ? parseInt(indexHeader, 10) : null;

    // The response body is the content reference (32 bytes hex)
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const contentHash = bytes.length === 32
      ? Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
      : null;

    return { found: true, index, contentHash };
  } catch (err) {
    console.warn('[Recovery] Error probing feed for', ownerAddress, err);
    return { found: false, index: null, contentHash: null };
  }
}

/**
 * Try to create a feed manifest for a recovered feed and get its URL.
 * This is a read-only version — it computes what the manifest reference WOULD be
 * by querying the gateway for an existing manifest, or returns null.
 *
 * For a proper manifest URL we need the manifest reference, which requires
 * re-uploading the mantaray manifest. Instead, we construct the /bzz/ URL from
 * the raw feed endpoint which also works for browsing content.
 */
function buildFeedBrowseUrl(ownerAddress: string): string {
  let ownerHex = ownerAddress.replace(/^0x/, '');
  if (ownerHex.length === 64) ownerHex = ownerHex.slice(0, 40);
  const topicHex = '0'.repeat(64);
  return `${SWARM_GATEWAY_URL}/feeds/${ownerHex}/${topicHex}`;
}

/**
 * Recover data for a single vault.
 *
 * @param passkeyPrivateKey - The user's passkey-derived private key
 * @param vaultIndex - The vault index (deposit index from contract)
 * @param stampDepth - The stamp depth (from on-chain batchDepth)
 * @param projectSlugs - Optional array of project slugs to try recovering
 */
export async function recoverVault(
  passkeyPrivateKey: Hex,
  vaultIndex: number,
  stampDepth: number,
  projectSlugs: string[] = [],
): Promise<RecoveryResult> {
  // 1. Derive vault key
  const vaultKey = deriveVaultKey(passkeyPrivateKey, vaultIndex);
  const tier = inferTierFromDepth(stampDepth);

  // 2. Check for legacy feed (feed owner = vault key address)
  const legacyOwnerHex = vaultKey.address.replace(/^0x/, '');
  const legacyProbe = await probeFeed(legacyOwnerHex);

  let legacyManifestReference: string | null = null;
  let legacyManifestUrl: string | null = null;

  if (legacyProbe.found) {
    // We can't recover the exact manifest reference without re-uploading the mantaray,
    // but we can store the feed URL for browsing
    legacyManifestUrl = buildFeedBrowseUrl(legacyOwnerHex);
  }

  // 3. Try to recover projects from provided slugs
  const recoveredProjects: RecoveredProject[] = [];
  for (const slug of projectSlugs) {
    const projectKey = deriveProjectKey(vaultKey.privateKey, slug);
    const projectOwnerHex = projectKey.address.replace(/^0x/, '');
    const projectProbe = await probeFeed(projectOwnerHex);

    let manifestUrl: string | null = null;
    if (projectProbe.found) {
      manifestUrl = buildFeedBrowseUrl(projectOwnerHex);
    }

    recoveredProjects.push({
      slug,
      feedOwnerAddress: projectOwnerHex,
      feedFound: projectProbe.found,
      feedIndex: projectProbe.index,
      contentHash: projectProbe.contentHash,
      manifestReference: null, // Would need re-upload to get
      manifestUrl,
    });
  }

  return {
    vaultIndex,
    vaultKey,
    tier,
    legacyFeedFound: legacyProbe.found,
    legacyFeedIndex: legacyProbe.index,
    legacyFeedContentHash: legacyProbe.contentHash,
    legacyManifestReference,
    legacyManifestUrl,
    recoveredProjects,
  };
}

/**
 * Apply recovery results to localStorage, restoring vault and feed data.
 */
export function applyRecovery(result: RecoveryResult, stampId?: string): void {
  const now = Date.now();

  // Build project data
  const projects: ProjectData[] = result.recoveredProjects
    .filter(p => p.feedFound)
    .map(p => ({
      slug: p.slug,
      displayName: p.slug, // Best we can do without the original display name
      vaultIndex: result.vaultIndex,
      feedOwnerAddress: p.feedOwnerAddress,
      manifestUrl: p.manifestUrl || '',
      manifestReference: p.manifestReference || undefined,
      currentVersion: p.contentHash || undefined,
      currentIndex: p.feedIndex ?? 0,
      createdAt: now,
      updatedAt: now,
    }));

  // Save vault data
  const vault: VaultData = {
    vaultIndex: result.vaultIndex,
    tier: result.tier,
    depth: VAULT_TIERS[result.tier].depth,
    projects,
    createdAt: now,
    updatedAt: now,
  };
  setVaultData(result.vaultIndex, vault);

  // Save legacy feed data if it was found
  if (result.legacyFeedFound) {
    const ownerHex = result.vaultKey.address.replace(/^0x/, '');
    setFeedOwner(result.vaultIndex, ownerHex);
    if (result.legacyFeedIndex !== null) {
      setCurrentFeedIndex(result.vaultIndex, result.legacyFeedIndex);
    }
    if (result.legacyFeedContentHash) {
      setCurrentVersion(result.vaultIndex, result.legacyFeedContentHash);
    }
    if (result.legacyManifestUrl) {
      setFeedManifestUrl(
        result.vaultIndex,
        result.legacyManifestUrl,
        result.legacyManifestReference || undefined
      );
    }
  }
}

/**
 * Quick check: does a vault have any localStorage data?
 */
export function vaultHasLocalData(vaultIndex: number): boolean {
  return getVaultData(vaultIndex) !== null;
}
