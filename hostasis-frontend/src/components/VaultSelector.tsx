/**
 * VaultSelector - Choose where to deploy a project
 *
 * Allows users to either:
 * - Create a new vault (with tier selection)
 * - Use an existing vault (shows capacity)
 */

import TierSelector from './TierSelector';
import {
  type VaultTier,
  type VaultData,
  VAULT_TIERS,
} from '../utils/projectStorage';
import styles from './VaultSelector.module.css';

export type VaultSelection =
  | { type: 'new'; tier: VaultTier }
  | { type: 'existing'; vaultIndex: number };

interface VaultSelectorProps {
  vaults: VaultData[];
  selection: VaultSelection;
  onSelectionChange: (selection: VaultSelection) => void;
  recommendedTier?: VaultTier;
  disabled?: boolean;
  hideNewVaultOption?: boolean;
}

export default function VaultSelector({
  vaults,
  selection,
  onSelectionChange,
  recommendedTier = 'standard',
  disabled = false,
  hideNewVaultOption = false,
}: VaultSelectorProps) {
  const hasExistingVaults = vaults.length > 0;

  return (
    <div className={styles.container}>
      {/* New Vault Option */}
      {!hideNewVaultOption && (
        <div
          className={`${styles.option} ${selection.type === 'new' ? styles.selected : ''} ${disabled ? styles.disabled : ''}`}
          onClick={() => !disabled && onSelectionChange({ type: 'new', tier: recommendedTier })}
        >
          <div className={styles.optionHeader}>
            <input
              type="radio"
              checked={selection.type === 'new'}
              onChange={() => onSelectionChange({ type: 'new', tier: recommendedTier })}
              disabled={disabled}
              className={styles.radio}
            />
            <span className={styles.optionTitle}>New Vault</span>
          </div>

          {selection.type === 'new' && (
            <div className={styles.tierSelectorWrapper}>
              <TierSelector
                selectedTier={selection.tier}
                onTierChange={(tier) => onSelectionChange({ type: 'new', tier })}
                recommendedTier={recommendedTier}
                disabled={disabled}
              />
            </div>
          )}
        </div>
      )}

      {/* Existing Vaults */}
      {hasExistingVaults && (
        <div className={styles.existingSection}>
          {!hideNewVaultOption && <div className={styles.existingLabel}>Or add to existing vault</div>}

          {vaults.map((vault) => {
            const tierInfo = VAULT_TIERS[vault.tier];
            const isSelected = selection.type === 'existing' && selection.vaultIndex === vault.vaultIndex;

            return (
              <div
                key={vault.vaultIndex}
                className={`${styles.vaultOption} ${isSelected ? styles.selected : ''} ${disabled ? styles.disabled : ''}`}
                onClick={() => !disabled && onSelectionChange({ type: 'existing', vaultIndex: vault.vaultIndex })}
              >
                <div className={styles.optionHeader}>
                  {!disabled && (
                    <input
                      type="radio"
                      checked={isSelected}
                      onChange={() => onSelectionChange({ type: 'existing', vaultIndex: vault.vaultIndex })}
                      disabled={disabled}
                      className={styles.radio}
                    />
                  )}
                  <span className={styles.optionTitle}>
                    Vault #{vault.vaultIndex}
                    <span className={styles.tierBadge}>{tierInfo.name}</span>
                  </span>
                </div>

                <div className={styles.vaultDetails}>
                  <div className={styles.capacityText}>
                    {tierInfo.capacityLabel} capacity
                  </div>
                  <div className={styles.projectCount}>
                    {vault.projects.length} project{vault.projects.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
