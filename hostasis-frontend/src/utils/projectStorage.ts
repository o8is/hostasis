/**
 * Project and Reserve Storage
 *
 * Manages localStorage storage for reserves and their projects.
 * Reserves are capacity tiers, projects are sites within them.
 */

import { normalizeProjectSlug, isValidProjectSlug } from '@hostasis/swarm-stamper';

// Re-export for convenience
export { normalizeProjectSlug, isValidProjectSlug };

/**
 * Reserve tier definitions
 */
export const RESERVE_TIERS = {
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

export type ReserveTier = keyof typeof RESERVE_TIERS;

/**
 * Get the recommended tier based on file size
 */
export function getRecommendedTier(fileSizeBytes: number): ReserveTier {
  // Add 20% buffer for manifest overhead
  const requiredBytes = fileSizeBytes * 1.2;

  if (requiredBytes <= RESERVE_TIERS.starter.capacityBytes) {
    return 'starter';
  }
  if (requiredBytes <= RESERVE_TIERS.basic.capacityBytes) {
    return 'basic';
  }
  if (requiredBytes <= RESERVE_TIERS.standard.capacityBytes) {
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
  reserveIndex: number;       // Parent reserve index
  feedOwnerAddress: string;   // Derived from project key
  manifestUrl: string;        // Stable feed manifest URL
  manifestReference?: string; // Feed manifest reference hash
  currentVersion?: string;    // Latest content hash
  currentIndex: number;       // Feed index (increments with updates)
  createdAt: number;
  updatedAt: number;
}

/**
 * Reserve data stored per reserve
 */
export interface ReserveData {
  reserveIndex: number;
  tier: ReserveTier;
  depth: number;
  projects: ProjectData[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_PREFIX = 'hostasis_reserve_';

/**
 * Get storage key for a reserve
 */
function getStorageKey(reserveIndex: number): string {
  return `${STORAGE_PREFIX}${reserveIndex}`;
}

/**
 * Get reserve data from localStorage
 */
export function getReserveData(reserveIndex: number): ReserveData | null {
  if (typeof window === 'undefined') return null;

  const key = getStorageKey(reserveIndex);
  const data = localStorage.getItem(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as ReserveData;
  } catch {
    return null;
  }
}

/**
 * Save reserve data to localStorage
 */
export function setReserveData(reserveIndex: number, data: ReserveData): void {
  if (typeof window === 'undefined') return;

  const key = getStorageKey(reserveIndex);
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Delete a reserve from localStorage
 */
export function deleteReserve(reserveIndex: number): void {
  if (typeof window === 'undefined') return;

  const key = getStorageKey(reserveIndex);
  localStorage.removeItem(key);
}

/**
 * Create a new reserve
 */
export function createReserve(reserveIndex: number, tier: ReserveTier): ReserveData {
  const now = Date.now();
  const reserve: ReserveData = {
    reserveIndex,
    tier,
    depth: RESERVE_TIERS[tier].depth,
    projects: [],
    createdAt: now,
    updatedAt: now,
  };

  setReserveData(reserveIndex, reserve);
  return reserve;
}

/**
 * Get all reserves from localStorage
 */
export function getAllReserves(): ReserveData[] {
  if (typeof window === 'undefined') return [];

  const reserves: ReserveData[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          reserves.push(JSON.parse(data) as ReserveData);
        } catch {
          // Skip invalid data
        }
      }
    }
  }

  return reserves.sort((a, b) => a.reserveIndex - b.reserveIndex);
}

/**
 * Get a project by slug from a reserve
 */
export function getProject(reserveIndex: number, slug: string): ProjectData | null {
  const reserve = getReserveData(reserveIndex);
  if (!reserve) return null;

  return reserve.projects.find(p => p.slug === slug) || null;
}

/**
 * Add a project to a reserve
 */
export function addProject(reserveIndex: number, project: Omit<ProjectData, 'reserveIndex'>): ProjectData {
  let reserve = getReserveData(reserveIndex);
  if (!reserve) {
    throw new Error(`Reserve ${reserveIndex} not found`);
  }

  // Check for duplicate slug
  if (reserve.projects.some(p => p.slug === project.slug)) {
    throw new Error(`Project with slug "${project.slug}" already exists in reserve ${reserveIndex}`);
  }

  const fullProject: ProjectData = {
    ...project,
    reserveIndex,
  };

  reserve.projects.push(fullProject);
  reserve.updatedAt = Date.now();
  setReserveData(reserveIndex, reserve);

  return fullProject;
}

/**
 * Update a project in a reserve
 */
export function updateProject(
  reserveIndex: number,
  slug: string,
  updates: Partial<Omit<ProjectData, 'slug' | 'reserveIndex'>>
): ProjectData | null {
  const reserve = getReserveData(reserveIndex);
  if (!reserve) return null;

  const projectIndex = reserve.projects.findIndex(p => p.slug === slug);
  if (projectIndex === -1) return null;

  reserve.projects[projectIndex] = {
    ...reserve.projects[projectIndex],
    ...updates,
    updatedAt: Date.now(),
  };
  reserve.updatedAt = Date.now();
  setReserveData(reserveIndex, reserve);

  return reserve.projects[projectIndex];
}

/**
 * Calculate total used capacity of a reserve
 */
export function getReserveUsedCapacity(reserve: ReserveData): number {
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
