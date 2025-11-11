'use client';

import { useBlockNumber } from 'wagmi';
import { useEffect, useState } from 'react';

export function NetworkStatus() {
  const { data: blockNumber, isError, isLoading } = useBlockNumber({
    watch: true,
  });
  const [lastUpdate, setLastUpdate] = useState(Date.now());

  useEffect(() => {
    if (blockNumber) {
      setLastUpdate(Date.now());
    }
  }, [blockNumber]);

  // Check if we haven't received an update in 30 seconds
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSinceUpdate = Date.now() - lastUpdate;
      setIsStale(timeSinceUpdate > 30000);
    }, 1000);

    return () => clearInterval(interval);
  }, [lastUpdate]);

  const getStatusColor = () => {
    if (isError) return '#ef4444'; // red
    if (isLoading) return '#eab308'; // yellow
    if (isStale) return '#f59e0b'; // orange
    return '#10b981'; // green
  };

  const getStatusText = () => {
    if (isError) return 'Disconnected';
    if (isLoading) return 'Connecting...';
    if (isStale) return 'Syncing...';
    return 'Connected';
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 500,
        color: '#fff',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: getStatusColor(),
          boxShadow: `0 0 8px ${getStatusColor()}`,
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ opacity: 0.7, fontSize: '11px' }}>{getStatusText()}</span>
        {blockNumber && (
          <span style={{ fontFamily: 'monospace' }}>
            Block {blockNumber.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
