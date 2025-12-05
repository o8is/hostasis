/**
 * Project and Vault Storage
 *
 * Manages localStorage storage for vaults and their projects.
 * Vaults are capacity tiers, projects are sites within them.
 */

import { normalizeProjectSlug, isValidProjectSlug } from '@hostasis/swarm-stamper';

// Re-export for convenience
export { normalizeProjectSlug, isValidProjectSlug };

/**
 * Vault tier definitions
 */
export const VAULT_TIERS = {
  starter: {
    name: 'Starter',
    depth: 18,
    capacityBytes: 7 * 1024 * 1024,        // ~7 MB
    capacityLabel: '~7 MB',
    description: 'Single small site',
  },
  basic: {
    name: 'Basic',
    depth: 19,
    capacityBytes: 112 * 1024 * 1024,      // ~112 MB
    capacityLabel: '~112 MB',
    description: 'A few small sites',
  },
  standard: {
    name: 'Standard',
    depth: 20,
    capacityBytes: 688 * 1024 * 1024,      // ~688 MB
    capacityLabel: '~688 MB',
    description: 'Multiple sites',
  },
  pro: {
    name: 'Pro',
    depth: 21,
    capacityBytes: 2.7 * 1024 * 1024 * 1024, // ~2.7 GB
    capacityLabel: '~2.7 GB',
    description: 'Many sites / large assets',
  },
} as const;

export type VaultTier = keyof typeof VAULT_TIERS;

/**
 * Get the recommended tier based on file size
 */
export function getRecommendedTier(fileSizeBytes: number): VaultTier {
  // Add 20% buffer for manifest overhead
  const requiredBytes = fileSizeBytes * 1.2;

  if (requiredBytes <= VAULT_TIERS.starter.capacityBytes) {
    return 'starter';
  }
  if (requiredBytes <= VAULT_TIERS.basic.capacityBytes) {
    return 'basic';
  }
  if (requiredBytes <= VAULT_TIERS.standard.capacityBytes) {
    return 'standard';
  }
  return 'pro';
}

/**
 * Project data stored per project
 */
export interface ProjectData {
  slug: string;               // Immutable, used for key derivation
  displayName: string;        // User-facing name (can change)
  vaultIndex: number;         // Parent vault index
  feedOwnerAddress: string;   // Derived from project key
  manifestUrl: string;        // Stable feed manifest URL
  manifestReference?: string; // Feed manifest reference hash
  currentVersion?: string;    // Latest content hash
  currentIndex: number;       // Feed index (increments with updates)
  createdAt: number;
  updatedAt: number;
}

/**
 * Vault data stored per vault
 */
export interface VaultData {
  vaultIndex: number;
  tier: VaultTier;
  depth: number;
  projects: ProjectData[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_PREFIX = 'hostasis_vault_';

/**
 * Get storage key for a vault
 */
function getStorageKey(vaultIndex: number): string {
  return `${STORAGE_PREFIX}${vaultIndex}`;
}

/**
 * Get vault data from localStorage
 */
export function getVaultData(vaultIndex: number): VaultData | null {
  if (typeof window === 'undefined') return null;

  const key = getStorageKey(vaultIndex);
  const data = localStorage.getItem(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as VaultData;
  } catch {
    return null;
  }
}

/**
 * Save vault data to localStorage
 */
export function setVaultData(vaultIndex: number, data: VaultData): void {
  if (typeof window === 'undefined') return;

  const key = getStorageKey(vaultIndex);
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Delete a vault from localStorage
 */
export function deleteVault(vaultIndex: number): void {
  if (typeof window === 'undefined') return;

  const key = getStorageKey(vaultIndex);
  localStorage.removeItem(key);
}

/**
 * Create a new vault
 */
export function createVault(vaultIndex: number, tier: VaultTier): VaultData {
  const now = Date.now();
  const vault: VaultData = {
    vaultIndex,
    tier,
    depth: VAULT_TIERS[tier].depth,
    projects: [],
    createdAt: now,
    updatedAt: now,
  };

  setVaultData(vaultIndex, vault);
  return vault;
}

/**
 * Get all vaults from localStorage
 */
export function getAllVaults(): VaultData[] {
  if (typeof window === 'undefined') return [];

  const vaults: VaultData[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          vaults.push(JSON.parse(data) as VaultData);
        } catch {
          // Skip invalid data
        }
      }
    }
  }

  return vaults.sort((a, b) => a.vaultIndex - b.vaultIndex);
}

/**
 * Get a project by slug from a vault
 */
export function getProject(vaultIndex: number, slug: string): ProjectData | null {
  const vault = getVaultData(vaultIndex);
  if (!vault) return null;

  return vault.projects.find(p => p.slug === slug) || null;
}

/**
 * Add a project to a vault
 */
export function addProject(vaultIndex: number, project: Omit<ProjectData, 'vaultIndex'>): ProjectData {
  let vault = getVaultData(vaultIndex);
  if (!vault) {
    throw new Error(`Vault ${vaultIndex} not found`);
  }

  // Check for duplicate slug
  if (vault.projects.some(p => p.slug === project.slug)) {
    throw new Error(`Project with slug "${project.slug}" already exists in vault ${vaultIndex}`);
  }

  const fullProject: ProjectData = {
    ...project,
    vaultIndex,
  };

  vault.projects.push(fullProject);
  vault.updatedAt = Date.now();
  setVaultData(vaultIndex, vault);

  return fullProject;
}

/**
 * Update a project in a vault
 */
export function updateProject(
  vaultIndex: number,
  slug: string,
  updates: Partial<Omit<ProjectData, 'slug' | 'vaultIndex'>>
): ProjectData | null {
  const vault = getVaultData(vaultIndex);
  if (!vault) return null;

  const projectIndex = vault.projects.findIndex(p => p.slug === slug);
  if (projectIndex === -1) return null;

  vault.projects[projectIndex] = {
    ...vault.projects[projectIndex],
    ...updates,
    updatedAt: Date.now(),
  };
  vault.updatedAt = Date.now();
  setVaultData(vaultIndex, vault);

  return vault.projects[projectIndex];
}

/**
 * Calculate total used capacity of a vault
 */
export function getVaultUsedCapacity(vault: VaultData): number {
  // This is a rough estimate - we'd need to track actual uploaded bytes per project
  // For now, return 0 as placeholder
  return 0;
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
