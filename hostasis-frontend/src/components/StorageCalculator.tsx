import React, { useState, useMemo } from 'react';
import { formatUnits, parseUnits } from 'viem';
import Link from 'next/link';
import { useSparkAPYWithFallback } from '../hooks/useSparkAPY';
import { useSwarmPricingWithFallback } from '../hooks/useSwarmPricing';

interface CalculatorResult {
  storageGB: number;
  initialStampCost: string;
  recommendedReserve: string;
  totalUpfrontCost: string;
  dailyYield: string;
  monthlyYield: string;
  yearlyYield: string;
  hostingLifespan: string;
}

const StorageCalculator: React.FC = () => {
  const [storageAmount, setStorageAmount] = useState<string>('1');
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Fetch real-time Sky Savings Rate (via sDAI) with fallback
  const { apy: SKY_APY, apyPercentage, isRealTimeData: isAPYRealTime } = useSparkAPYWithFallback(0.05);

  // Fetch real-time Swarm pricing with fallback
  const {
    pricePerGBPerYearDAI,
    pricePerGBPerMonthBZZ,
    bzzPriceUSD,
    isRealTimeData: isPricingRealTime,
    isLoading: isPricingLoading
  } = useSwarmPricingWithFallback(0.1); // Fallback: 0.1 DAI/GB/year

  // Multi-factor buffer calculation for long-term protection
  const bufferFactors = useMemo(() => {
    // Factor 1: BZZ price volatility buffer (assume 5x potential increase)
    const bzzPriceBuffer = 5.0;

    // Factor 2: Network storage cost increase (assume 2x potential increase)
    const storagePriceBuffer = 2.0;

    // Factor 3: APY decline protection (assume APY could drop to 60% of current)
    const yieldDeclineBuffer = 1 / 0.6; // ~1.67x

    // Combined buffer: accounts for all risks happening together
    // We use geometric mean to avoid over-buffering while staying safe
    const combinedBuffer = Math.pow(
      bzzPriceBuffer * storagePriceBuffer * yieldDeclineBuffer,
      1/3 // Take cube root to get geometric mean
    ) * 1.2; // Add 20% safety margin on top

    return {
      bzzPriceBuffer,
      storagePriceBuffer,
      yieldDeclineBuffer,
      combinedBuffer: Math.round(combinedBuffer * 10) / 10, // Round to 1 decimal
    };
  }, []);

  const calculations = useMemo((): CalculatorResult | null => {
    const storage = parseFloat(storageAmount);
    if (isNaN(storage) || storage <= 0 || !pricePerGBPerYearDAI) return null;

    // Calculate yearly cost for storage using real-time pricing
    const yearlyStorageCost = storage * pricePerGBPerYearDAI;

    // Calculate initial stamp cost (7 days coverage to give reserve time to accrue yield)
    const initialDays = 7;
    const initialStampCost = yearlyStorageCost * (initialDays / 365);

    // Calculate required reserve to generate enough yield with multi-factor buffer
    const requiredReserve = (yearlyStorageCost / SKY_APY) * bufferFactors.combinedBuffer;

    // Total upfront cost = initial stamp + reserve deposit
    const totalUpfrontCost = initialStampCost + requiredReserve;

    // Calculate yields
    const yearlyYield = requiredReserve * SKY_APY;
    const monthlyYield = yearlyYield / 12;
    const dailyYield = yearlyYield / 365;

    return {
      storageGB: storage,
      initialStampCost: initialStampCost.toFixed(2),
      recommendedReserve: requiredReserve.toFixed(2),
      totalUpfrontCost: totalUpfrontCost.toFixed(2),
      dailyYield: dailyYield.toFixed(4),
      monthlyYield: monthlyYield.toFixed(2),
      yearlyYield: yearlyYield.toFixed(2),
      hostingLifespan: 'Permanent'
    };
  }, [storageAmount, pricePerGBPerYearDAI, SKY_APY, bufferFactors.combinedBuffer]);

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
              step="1"
              placeholder="10"
            />
            <span className="calculator-unit">GB</span>
          </div>
        </div>

        {calculations && (
          <div className="calculator-results">
            <div className="calculator-result-grid">
              <div className="calculator-result-card primary">
                <div className="result-label">Total Upfront Cost</div>
                <div className="result-value">{calculations.totalUpfrontCost} DAI</div>
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
                <span className="cost-value">{calculations.initialStampCost} DAI</span>
              </div>
              <div className="cost-breakdown-item">
                <span className="cost-label">Reserve Deposit</span>
                <span className="cost-dots"></span>
                <span className="cost-value">{calculations.recommendedReserve} DAI</span>
              </div>
            </div>

            <Link
              href={`/reserves?amount=${calculations.totalUpfrontCost}`}
              className="calculator-cta-button"
            >
              Get Started with {calculations.totalUpfrontCost} DAI
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
                    <span className="breakdown-value">{calculations.monthlyYield} DAI</span>
                  </div>
                  <div className="breakdown-row">
                    <span>Yearly yield</span>
                    <span className="breakdown-value">{calculations.yearlyYield} DAI</span>
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
                    <div className="buffer-description">
                      Your reserve includes protection against:
                    </div>
                  </div>
                  <ul className="buffer-protections">
                    <li>BZZ price increases up to 5x</li>
                    <li>Storage costs doubling (2x)</li>
                    <li>Yield rates dropping by 40%</li>
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
