/**
 * ReserveSelector - Choose where to deploy a project
 *
 * Allows users to either:
 * - Create a new reserve (with tier selection)
 * - Use an existing reserve (shows capacity)
 */

import TierSelector from './TierSelector';
import {
  type ReserveTier,
  type ReserveData,
  RESERVE_TIERS,
} from '../utils/projectStorage';
import styles from './ReserveSelector.module.css';

export type ReserveSelection =
  | { type: 'new'; tier: ReserveTier }
  | { type: 'existing'; reserveIndex: number };

interface ReserveSelectorProps {
  reserves: ReserveData[];
  selection: ReserveSelection;
  onSelectionChange: (selection: ReserveSelection) => void;
  recommendedTier?: ReserveTier;
  disabled?: boolean;
  hideNewReserveOption?: boolean;
}

export default function ReserveSelector({
  reserves,
  selection,
  onSelectionChange,
  recommendedTier = 'standard',
  disabled = false,
  hideNewReserveOption = false,
}: ReserveSelectorProps) {
  const hasExistingReserves = reserves.length > 0;

  return (
    <div className={styles.container}>
      {/* New Reserve Option */}
      {!hideNewReserveOption && (
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
            <span className={styles.optionTitle}>New Reserve</span>
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

      {/* Existing Reserves */}
      {hasExistingReserves && (
        <div className={styles.existingSection}>
          {!hideNewReserveOption && <div className={styles.existingLabel}>Or add to existing reserve</div>}

          {reserves.map((reserve) => {
            const tierInfo = RESERVE_TIERS[reserve.tier];
            const isSelected = selection.type === 'existing' && selection.reserveIndex === reserve.reserveIndex;

            return (
              <div
                key={reserve.reserveIndex}
                className={`${styles.reserveOption} ${isSelected ? styles.selected : ''} ${disabled ? styles.disabled : ''}`}
                onClick={() => !disabled && onSelectionChange({ type: 'existing', reserveIndex: reserve.reserveIndex })}
              >
                <div className={styles.optionHeader}>
                  {!disabled && (
                    <input
                      type="radio"
                      checked={isSelected}
                      onChange={() => onSelectionChange({ type: 'existing', reserveIndex: reserve.reserveIndex })}
                      disabled={disabled}
                      className={styles.radio}
                    />
                  )}
                  <span className={styles.optionTitle}>
                    Reserve #{reserve.reserveIndex}
                    <span className={styles.tierBadge}>{tierInfo.name}</span>
                  </span>
                </div>

                <div className={styles.reserveDetails}>
                  <div className={styles.capacityText}>
                    {tierInfo.capacityLabel} capacity
                  </div>
                  <div className={styles.projectCount}>
                    {reserve.projects.length} project{reserve.projects.length !== 1 ? 's' : ''}
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
