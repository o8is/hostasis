/**
 * TierSelector - Vault tier selection component
 *
 * Allows users to select a vault capacity tier for their uploads.
 * Auto-selects recommended tier based on file size, but allows upgrading.
 */

import { VAULT_TIERS, type VaultTier } from '../utils/projectStorage';
import styles from './TierSelector.module.css';

interface TierSelectorProps {
  selectedTier: VaultTier;
  onTierChange: (tier: VaultTier) => void;
  recommendedTier?: VaultTier;
  disabled?: boolean;
}

export default function TierSelector({
  selectedTier,
  onTierChange,
  recommendedTier,
  disabled = false,
}: TierSelectorProps) {
  const tiers = Object.entries(VAULT_TIERS) as [VaultTier, typeof VAULT_TIERS[VaultTier]][];

  return (
    <div className={styles.container}>
      {tiers.map(([key, tier]) => {
        const isSelected = selectedTier === key;
        const isRecommended = recommendedTier === key;
        const isBelowRecommended = recommendedTier &&
          tiers.findIndex(([k]) => k === key) < tiers.findIndex(([k]) => k === recommendedTier);

        return (
          <button
            key={key}
            type="button"
            className={`${styles.tierOption} ${isSelected ? styles.selected : ''} ${isBelowRecommended ? styles.tooSmall : ''}`}
            onClick={(e) => {
              e.stopPropagation(); // Prevent VaultSelector parent from resetting tier
              if (!disabled && !isBelowRecommended) {
                onTierChange(key);
              }
            }}
            disabled={disabled || isBelowRecommended}
          >
            <div className={styles.tierHeader}>
              <span className={styles.tierName}>{tier.name}</span>
              {isRecommended && <span className={styles.recommendedBadge}>Recommended</span>}
            </div>
            <div className={styles.tierCapacity}>{tier.capacityLabel}</div>
            <div className={styles.tierDescription}>{tier.description}</div>
          </button>
        );
      })}
    </div>
  );
}
