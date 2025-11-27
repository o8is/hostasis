import { useState, useEffect } from 'react';
import Modal from './Modal';
import { CopyButton } from './CopyButton';
import { useFeedService } from '../hooks/useFeedService';
import styles from './ExportKeyModal.module.css';

interface ExportKeyModalProps {
  reserveIndex: number;
  onClose: () => void;
}

export default function ExportKeyModal({ reserveIndex, onClose }: ExportKeyModalProps) {
  const feedService = useFeedService();
  const [keyInfo, setKeyInfo] = useState<{ privateKey: string; address: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);

  useEffect(() => {
    // Only attempt once to prevent infinite loops
    if (hasAttempted) return;
    
    const exportKey = async () => {
      setHasAttempted(true);
      try {
        setIsLoading(true);
        setError(null);
        const info = await feedService.exportFeedKey(reserveIndex);
        setKeyInfo({
          privateKey: info.privateKey,
          address: info.address,
        });
      } catch (err) {
        console.error('Failed to export feed key:', err);
        setError(err instanceof Error ? err.message : 'Failed to export feed key');
      } finally {
        setIsLoading(false);
      }
    };

    exportKey();
  }, [hasAttempted, feedService, reserveIndex]);

  return (
    <Modal title="Export Reserve Key" onClose={onClose}>
      <div className={styles.content}>
        {isLoading && (
          <p className={styles.loading}>Authenticating with passkey...</p>
        )}

        {error && (
          <div className={styles.errorContainer}>
            <p className={styles.error}>{error}</p>
            <button
              className="view-button"
              onClick={() => {
                setHasAttempted(false);
                setError(null);
              }}
            >
              Retry
            </button>
          </div>
        )}

        {keyInfo && (
          <>
            <p className={styles.description}>
              This key owns your reserve&apos;s batch and can upload files and update your feed.
              <br />
              Use it in CI/CD pipelines or with the Hostasis CLI.
              <strong> Keep it secret!</strong>
            </p>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Reserve Address</label>
              <div className={styles.fieldValue}>
                <code className={styles.code}>{keyInfo.address}</code>
                <CopyButton text={keyInfo.address} label="Address" />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Reserve Private Key</label>
              <div className={styles.fieldValue}>
                {showPrivateKey ? (
                  <code className={styles.code}>{keyInfo.privateKey}</code>
                ) : (
                  <code className={styles.code}>••••••••••••••••••••••••••••••••</code>
                )}
                <button
                  className={styles.toggleButton}
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                >
                  {showPrivateKey ? 'Hide' : 'Show'}
                </button>
                <CopyButton text={keyInfo.privateKey} label="Key" />
              </div>
            </div>

            <div className={styles.warning}>
              <strong>⚠️ Security Warning</strong>
              <p>
                This key can upload to your batch and update your feed. Anyone with this
                key can modify your site. Store it securely as a secret in your CI/CD system.
              </p>
            </div>

            <div className={styles.usage}>
              <label className={styles.fieldLabel}>Example Usage (Coming Soon)</label>
              <pre className={styles.codeBlock}>
{`# Upload and update feed with Hostasis CLI
export HOSTASIS_RESERVE_KEY="${keyInfo.privateKey}"

# Upload files
hostasis upload ./dist --batch-id <your-batch-id>

# Update feed
hostasis feed update --reference <swarm-hash>`}
              </pre>
            </div>
          </>
        )}

        <div className={styles.actions}>
          <button className="view-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
