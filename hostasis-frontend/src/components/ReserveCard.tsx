/**
 * ReserveCard - Simple display card for showing reserve info
 * Used in update mode to show which reserve is being used
 */

import { RESERVE_TIERS, type ReserveTier } from '../utils/projectStorage';
import { CopyButton } from './CopyButton';
import styles from './ReserveCard.module.css';

interface ReserveCardProps {
  reserveIndex: number;
  tier: ReserveTier;
  createdAt?: number;
  batchId: string;
}

export default function ReserveCard({
  reserveIndex,
  tier,
  createdAt,
  batchId,
}: ReserveCardProps) {
  const tierInfo = RESERVE_TIERS[tier];

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
            Reserve #{reserveIndex}
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
