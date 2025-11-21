import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useStorageCalculator } from '../hooks/useStorageCalculator';
import { getPlanTierName } from '../utils/storagePlan';

const StorageCalculator: React.FC = () => {
  const [storageAmount, setStorageAmount] = useState<string>('50');
  const [storageUnit, setStorageUnit] = useState<'MB' | 'GB'>('MB');
  const [showBreakdown, setShowBreakdown] = useState(false);

  const {
    calculate,
    bufferFactors,
    apyPercentage,
    isAPYRealTime,
    pricePerGBPerYearDAI,
    isPricingRealTime
  } = useStorageCalculator();

  const calculations = useMemo(() => {
    const amount = parseFloat(storageAmount);
    // Convert to GB for calculation
    const storageGB = storageUnit === 'MB' ? amount / 1024 : amount;
    return calculate(storageGB);
  }, [storageAmount, storageUnit, calculate]);

  return (
    <div className="storage-calculator">
      <div className="calculator-header">
        <h2>Permanent Storage Calculator</h2>
        <p className="calculator-subtitle">
          See how much you need to reserve for permanent hosting
        </p>
      </div>

      <div className="calculator-content">
        <div className="calculator-input-section">
          <label htmlFor="storage-input" className="calculator-label">
            How much storage do you want?
          </label>
          <div className="calculator-input-group">
            <input
              id="storage-input"
              type="number"
              value={storageAmount}
              onChange={(e) => setStorageAmount(e.target.value)}
              className="calculator-input"
              min="0"
              step={storageUnit === 'MB' ? '100' : '1'}
              placeholder={storageUnit === 'MB' ? '500' : '10'}
            />
            <select
              value={storageUnit}
              onChange={(e) => setStorageUnit(e.target.value as 'MB' | 'GB')}
              className="calculator-unit-select"
            >
              <option value="MB">MB</option>
              <option value="GB">GB</option>
            </select>
          </div>
        </div>

        {calculations && (
          <div className="calculator-results">
            <div className="calculator-result-grid">
              <div className="calculator-result-card primary">
                <div className="result-label">Total Upfront Cost</div>
                <div className="result-value">{calculations.totalUpfrontCost.toFixed(2)} DAI</div>
                <div className="result-note">Initial stamp + reserve deposit</div>
              </div>

              <div className="calculator-result-card">
                <div className="result-label">Hosting Lifespan</div>
                <div className="result-value permanent">{calculations.hostingLifespan}</div>
                <div className="result-note">All hosting paid by yield</div>
              </div>
            </div>

            <div className="calculator-cost-breakdown">
              <div className="cost-breakdown-item">
                <span className="cost-label">Initial Stamp (7 days)</span>
                <span className="cost-dots"></span>
                <span className="cost-value">{calculations.initialStampCost.toFixed(2)} DAI</span>
              </div>
              <div className="cost-breakdown-item">
                <span className="cost-label">
                  Reserve Deposit
                  <span className="recoverable-badge">100% Recoverable</span>
                </span>
                <span className="cost-dots"></span>
                <span className="cost-value">{calculations.recommendedReserve.toFixed(2)} DAI</span>
              </div>
              {calculations.depth && getPlanTierName(calculations.depth) && (
                <div className="cost-breakdown-item">
                  <span className="cost-label">Storage Plan</span>
                  <span className="cost-dots"></span>
                  <span className="cost-value">{getPlanTierName(calculations.depth)} (Depth {calculations.depth})</span>
                </div>
              )}
            </div>

            <div className="reserve-info-callout">
              <div className="reserve-info-text">
                <strong>Your reserve is fully yours.</strong> Withdraw 100% anytime. The only cost is foregone yield while your storage is active.
              </div>
            </div>

            <Link
              href={`/reserves?amount=${calculations.totalUpfrontCost.toFixed(2)}`}
              className="calculator-cta-button"
            >
              Get Started with {calculations.totalUpfrontCost.toFixed(2)} DAI
            </Link>

            <button
              className="calculator-expand-button"
              onClick={() => setShowBreakdown(!showBreakdown)}
            >
              {showBreakdown ? '▼ Hide Breakdown' : '▶ Show Breakdown'}
            </button>

            {showBreakdown && (
              <div className="calculator-breakdown">
                <div className="breakdown-section">
                  <h4>Yield Breakdown</h4>
                  <div className="breakdown-row">
                    <span>Monthly yield</span>
                    <span className="breakdown-value">{calculations.monthlyYield.toFixed(2)} DAI</span>
                  </div>
                  <div className="breakdown-row">
                    <span>Yearly yield</span>
                    <span className="breakdown-value">{calculations.yearlyYield.toFixed(2)} DAI</span>
                  </div>
                </div>

                <div className="breakdown-divider" />

                <div className="breakdown-section">
                  <h4>Assumptions</h4>
                  <div className="breakdown-assumption">
                    <div className="assumption-label">Sky Savings Rate (APY)</div>
                    <div className="assumption-value">
                      {apyPercentage}%
                      <span className="assumption-badge">{isAPYRealTime ? 'Live' : 'Estimated'}</span>
                    </div>
                  </div>
                  <div className="breakdown-assumption">
                    <div className="assumption-label">Swarm Storage Cost</div>
                    <div className="assumption-value">
                      {pricePerGBPerYearDAI?.toFixed(2)} DAI/GB/year
                      <span className="assumption-badge">{isPricingRealTime ? 'Live' : 'Estimated'}</span>
                    </div>
                  </div>
                </div>

                <div className="breakdown-divider" />

                <div className="breakdown-section">
                  <h4>Safety Buffer</h4>
                  <div className="safety-buffer-highlight">
                    <div className="buffer-multiplier">{bufferFactors.combinedBuffer.toFixed(1)}x</div>
                  </div>
                  <div className="buffer-description">
                    <strong>Protects against:</strong>
                  </div>
                  <ul className="buffer-protections">
                    {/* <li>BZZ price increases up to 5x</li> */}
                    <li>Storage costs doubling (2x)</li>
                    <li>Yield rates dropping by 30%</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StorageCalculator;
