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
  }, [hasAttempted, feedService.exportFeedKey, reserveIndex]);

  return (
    <Modal title="Export Feed Key" onClose={onClose}>
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
              Use this key to update your site from CI/CD pipelines or the CLI.
              <strong> Keep it secret!</strong>
            </p>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Feed Address</label>
              <div className={styles.fieldValue}>
                <code className={styles.code}>{keyInfo.address}</code>
                <CopyButton text={keyInfo.address} label="Address" />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Private Key</label>
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
                Anyone with this key can update your site. Store it securely as an 
                environment variable or secret in your CI/CD system.
              </p>
            </div>

            <div className={styles.usage}>
              <label className={styles.fieldLabel}>Example Usage (CLI)</label>
              <pre className={styles.codeBlock}>
{`# Using bee-js CLI
export FEED_KEY="${keyInfo.privateKey}"
bee feed update --topic 0x0...0 --reference <new_hash>`}
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
