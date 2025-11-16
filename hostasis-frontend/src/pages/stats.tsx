import type { NextPage } from 'next';
import Head from 'next/head';
import { useAccount } from 'wagmi';
import { useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import Navigation from '../components/Navigation';
import { useStats, useHarvest, useProcessBatch, useGetBatchIncentive } from '../hooks/useStats';

const Stats: NextPage = () => {
  const { isConnected } = useAccount();
  const {
    previewYield,
    distributionState,
    activeUserCount,
    totalSDAI,
    totalPrincipalDAI,
    keeperFeePool,
    lastHarvestTime,
    minYieldThreshold,
    harvesterFeeBps,
    keeperFeeBps,
    refetchAll,
  } = useStats();

  const { harvest, isPending: isHarvesting, isConfirming: isHarvestConfirming, isSuccess: harvestSuccess } = useHarvest();
  const { processBatch, isPending: isProcessing, isConfirming: isProcessConfirming, isSuccess: processSuccess } = useProcessBatch();

  const [batchSize, setBatchSize] = useState<bigint>(10n);
  const { data: batchIncentive, refetch: refetchBatchIncentive } = useGetBatchIncentive(batchSize);

  // Auto-refresh stats every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetchAll();
      refetchBatchIncentive();
    }, 10000);
    return () => clearInterval(interval);
  }, [refetchAll, refetchBatchIncentive]);

  // Refetch after successful transactions
  useEffect(() => {
    if (harvestSuccess || processSuccess) {
      refetchAll();
      refetchBatchIncentive();
    }
  }, [harvestSuccess, processSuccess, refetchAll, refetchBatchIncentive]);

  const formatDAI = (value: bigint | undefined) => {
    if (value === undefined) return '...';
    return parseFloat(formatUnits(value, 18)).toFixed(4);
  };

  const formatSDAI = (value: bigint | undefined) => {
    if (value === undefined) return '...';
    return parseFloat(formatUnits(value, 18)).toFixed(4);
  };

  const formatBZZ = (value: bigint | undefined) => {
    if (value === undefined) return '...';
    return parseFloat(formatUnits(value, 16)).toFixed(4);
  };

  const formatTimestamp = (timestamp: bigint | undefined) => {
    if (timestamp === undefined) return '...';
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleString();
  };

  const formatBps = (bps: bigint | undefined) => {
    if (bps === undefined) return '...';
    return `${Number(bps) / 100}%`;
  };

  const handleHarvest = () => {
    harvest();
  };

  const handleProcessBatch = () => {
    processBatch(batchSize);
  };

  // Parse distribution state
  const distState = distributionState ? {
    totalBZZ: distributionState[0],
    cursor: distributionState[1],
    harvestYieldPerShare: distributionState[2],
    totalYieldDAI: distributionState[3],
    snapshotRate: distributionState[4],
    active: distributionState[5],
  } : undefined;

  const canProcess = batchIncentive ? batchIncentive[0] : false;
  const estimatedReward = batchIncentive ? batchIncentive[1] : 0n;
  const remainingUsers = batchIncentive ? batchIncentive[2] : 0n;

  return (
    <>
      <Head>
        <title>Stats | Hostasis</title>
        <meta
          content="System statistics and admin controls"
          name="description"
        />
        <link href="/favicon.ico" rel="icon" />
      </Head>

      <Navigation />

      <div className="container" style={{ marginTop: '3rem' }}>
        <div className="stats-page">
          <h1 className="stats-title">System Statistics</h1>

          {!isConnected && (
            <div className="stats-warning">
              <p>Connect your wallet to view stats and perform actions</p>
            </div>
          )}

          {/* Global Stats */}
          <div className="stats-section">
            <h2 className="stats-section-title">Global State</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Total sDAI Deposited</div>
                <div className="stat-value">{formatSDAI(totalSDAI)} sDAI</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Principal (DAI)</div>
                <div className="stat-value">{formatDAI(totalPrincipalDAI)} DAI</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Active Users</div>
                <div className="stat-value">{activeUserCount?.toString() || '...'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Keeper Fee Pool</div>
                <div className="stat-value">{formatDAI(keeperFeePool)} DAI</div>
              </div>
            </div>
          </div>

          {/* Yield Stats */}
          <div className="stats-section">
            <h2 className="stats-section-title">Yield Information</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Preview Yield (Available)</div>
                <div className="stat-value highlight">{formatDAI(previewYield)} DAI</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Min Yield Threshold</div>
                <div className="stat-value">{formatDAI(minYieldThreshold)} DAI</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Last Harvest</div>
                <div className="stat-value small">{formatTimestamp(lastHarvestTime)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Harvester Fee</div>
                <div className="stat-value">{formatBps(harvesterFeeBps)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Keeper Fee</div>
                <div className="stat-value">{formatBps(keeperFeeBps)}</div>
              </div>
            </div>
          </div>

          {/* Distribution State */}
          <div className="stats-section">
            <h2 className="stats-section-title">Distribution State</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Distribution Active</div>
                <div className="stat-value">
                  {distState?.active ? (
                    <span className="status-active">Yes</span>
                  ) : (
                    <span className="status-inactive">No</span>
                  )}
                </div>
              </div>
              {distState?.active && (
                <>
                  <div className="stat-card">
                    <div className="stat-label">Total BZZ to Distribute</div>
                    <div className="stat-value">{formatBZZ(distState.totalBZZ)} BZZ</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Current Cursor Position</div>
                    <div className="stat-value">{distState.cursor.toString()}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Total Yield (DAI)</div>
                    <div className="stat-value">{formatDAI(distState.totalYieldDAI)} DAI</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Harvest Yield Per Share</div>
                    <div className="stat-value">{formatDAI(distState.harvestYieldPerShare)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Snapshot Rate</div>
                    <div className="stat-value">{formatDAI(distState.snapshotRate)}</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          {isConnected && (
            <div className="stats-section">
              <h2 className="stats-section-title">Actions</h2>

              {/* Harvest Section */}
              <div className="action-card">
                <h3 className="action-title">Harvest Yield</h3>
                <p className="action-description">
                  Collect accumulated yield and convert to BZZ for distribution.
                  {previewYield && minYieldThreshold && previewYield < minYieldThreshold && (
                    <span className="action-warning"> (Below minimum threshold)</span>
                  )}
                </p>
                <button
                  className="action-button"
                  onClick={handleHarvest}
                  disabled={isHarvesting || isHarvestConfirming || !previewYield || previewYield === 0n || (minYieldThreshold !== undefined && previewYield < minYieldThreshold)}
                >
                  {isHarvesting || isHarvestConfirming ? 'Harvesting...' : 'Harvest'}
                </button>
                {harvestSuccess && <div className="action-success">Harvest successful!</div>}
              </div>

              {/* Process Batch Section */}
              <div className="action-card">
                <h3 className="action-title">Process Distribution Batch</h3>
                <p className="action-description">
                  Process a batch of users to distribute BZZ to their postage stamps.
                </p>

                <div className="batch-controls">
                  <div className="batch-input-group">
                    <label htmlFor="batchSize" className="batch-label">Batch Size:</label>
                    <input
                      id="batchSize"
                      type="number"
                      className="batch-input"
                      value={batchSize.toString()}
                      onChange={(e) => setBatchSize(BigInt(e.target.value || '10'))}
                      min="1"
                      max="100"
                    />
                  </div>

                  {distState?.active && (
                    <div className="batch-info">
                      <div className="batch-info-item">
                        <span className="batch-info-label">Remaining Users:</span>
                        <span className="batch-info-value">{remainingUsers.toString()}</span>
                      </div>
                      <div className="batch-info-item">
                        <span className="batch-info-label">Estimated Reward:</span>
                        <span className="batch-info-value">{formatDAI(estimatedReward)} DAI</span>
                      </div>
                      <div className="batch-info-item">
                        <span className="batch-info-label">Can Process:</span>
                        <span className="batch-info-value">{canProcess ? 'Yes' : 'No'}</span>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  className="action-button"
                  onClick={handleProcessBatch}
                  disabled={isProcessing || isProcessConfirming || !canProcess}
                >
                  {isProcessing || isProcessConfirming ? 'Processing...' : 'Process Batch'}
                </button>
                {processSuccess && <div className="action-success">Batch processed successfully!</div>}
              </div>
            </div>
          )}

          {/* Auto-refresh indicator */}
          <div className="stats-footer">
            <p className="auto-refresh">Auto-refreshing every 10 seconds</p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Stats;
