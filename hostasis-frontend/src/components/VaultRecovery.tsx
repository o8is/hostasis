import { useState } from 'react';
import { usePasskeyWallet } from '../hooks/usePasskeyWallet';
import { recoverVault, applyRecovery, type RecoveryResult } from '../utils/vaultRecovery';
import { type Hex } from 'viem';

interface VaultRecoveryProps {
  vaultIndex: number;
  stampDepth: number;
  stampId?: string;
  onRecovered: () => void;
}

export default function VaultRecovery({ vaultIndex, stampDepth, stampId, onRecovered }: VaultRecoveryProps) {
  const { walletInfo, authenticatePasskeyWallet, recoverPasskeyWallet } = usePasskeyWallet();
  const [isRecovering, setIsRecovering] = useState(false);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectSlugs, setProjectSlugs] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleRecover = async () => {
    setIsRecovering(true);
    setError(null);
    setResult(null);

    try {
      // Ensure passkey is authenticated
      let passkey = walletInfo;
      if (!passkey) {
        passkey = await authenticatePasskeyWallet().catch(async () => {
          // Try recovery if auth fails
          const recovered = await recoverPasskeyWallet();
          if (!recovered) throw new Error('Passkey authentication required');
          return recovered;
        });
      }

      // Parse project slugs if provided
      const slugs = projectSlugs
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);

      const recoveryResult = await recoverVault(
        passkey.privateKey as Hex,
        vaultIndex,
        stampDepth,
        slugs,
      );

      setResult(recoveryResult);

      // Auto-apply if we found something
      if (recoveryResult.legacyFeedFound || recoveryResult.recoveredProjects.some(p => p.feedFound)) {
        applyRecovery(recoveryResult, stampId);
        onRecovered();
      } else {
        // Still save the vault shell so the tier info shows
        applyRecovery(recoveryResult, stampId);
        onRecovered();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed');
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div style={{
      padding: '0.75rem',
      background: 'rgba(255, 200, 50, 0.08)',
      borderRadius: '8px',
      border: '1px solid rgba(255, 200, 50, 0.2)',
      fontSize: '0.85rem',
    }}>
      <div style={{ marginBottom: '0.5rem', color: 'rgba(255, 200, 50, 0.9)', fontWeight: 500 }}>
        ⚠ Missing local data
      </div>
      <p style={{ margin: '0 0 0.5rem', opacity: 0.8, lineHeight: 1.4 }}>
        Project data for this vault was lost (localStorage cleared).
        Recovery can restore feed connections from Swarm.
      </p>

      {!result && (
        <>
          <button
            className="view-button view-button--small"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ marginBottom: showAdvanced ? '0.5rem' : 0, marginRight: '0.5rem' }}
          >
            {showAdvanced ? 'Hide' : 'Have project names?'}
          </button>

          {showAdvanced && (
            <div style={{ marginBottom: '0.5rem' }}>
              <input
                type="text"
                value={projectSlugs}
                onChange={(e) => setProjectSlugs(e.target.value)}
                placeholder="e.g. my-blog, portfolio"
                style={{
                  width: '100%',
                  padding: '0.4rem 0.6rem',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '4px',
                  color: 'inherit',
                  fontSize: '0.85rem',
                }}
              />
              <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>
                Enter project slugs (comma-separated) to recover multi-project feeds
              </div>
            </div>
          )}

          <button
            className="view-button view-button--primary view-button--small"
            onClick={handleRecover}
            disabled={isRecovering}
          >
            {isRecovering ? 'Recovering...' : 'Recover Vault Data'}
          </button>
        </>
      )}

      {result && (
        <div style={{ marginTop: '0.5rem' }}>
          {result.legacyFeedFound && (
            <div style={{ color: '#2d7a2d' }}>
              ✓ Legacy feed recovered (v{result.legacyFeedIndex})
            </div>
          )}
          {result.recoveredProjects.map(p => (
            <div key={p.slug} style={{ color: p.feedFound ? '#2d7a2d' : '#c93a3a' }}>
              {p.feedFound ? '✓' : '✗'} Project &ldquo;{p.slug}&rdquo; {p.feedFound ? `recovered (v${p.feedIndex})` : 'not found on Swarm'}
            </div>
          ))}
          {!result.legacyFeedFound && result.recoveredProjects.every(p => !p.feedFound) && (
            <div style={{ opacity: 0.7 }}>
              No feeds found — vault tier restored. You can deploy new projects.
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: '#c93a3a', marginTop: '0.5rem' }}>
          {error}
        </div>
      )}
    </div>
  );
}
