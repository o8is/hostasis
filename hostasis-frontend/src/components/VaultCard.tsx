/**
 * VaultCard - Simple display card for showing vault info
 * Used in update mode to show which vault is being used
 */

import { VAULT_TIERS, type VaultTier } from '../utils/projectStorage';
import { CopyButton } from './CopyButton';
import styles from './VaultCard.module.css';

interface VaultCardProps {
  vaultIndex: number;
  tier: VaultTier;
  createdAt?: number;
  batchId: string;
}

export default function VaultCard({
  vaultIndex,
  tier,
  createdAt,
  batchId,
}: VaultCardProps) {
  const tierInfo = VAULT_TIERS[tier];

  // Format date if provided
  const dateStr = createdAt
    ? new Date(createdAt).toLocaleDateString()
    : null;

  // Shorten batch ID
  const shortBatchId = batchId.length > 16
    ? `${batchId.slice(0, 8)}...${batchId.slice(-6)}`
    : batchId;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.title}>
            Vault #{vaultIndex}
            <span className={styles.tierBadge}>{tierInfo.name}</span>
          </span>
          {dateStr && <span className={styles.date}>{dateStr}</span>}
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.batchId} title={batchId}>
          Batch ID: {shortBatchId}
        </span>
        <CopyButton text={batchId} label="" />
      </div>
    </div>
  );
}
