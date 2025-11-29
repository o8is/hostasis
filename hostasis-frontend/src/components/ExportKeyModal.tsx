import { useState, useEffect } from 'react';
import Modal from './Modal';
import { CopyButton } from './CopyButton';
import { useFeedService } from '../hooks/useFeedService';
import styles from './ExportKeyModal.module.css';

interface ExportKeyModalProps {
  reserveIndex: number;
  /** If provided, exports project key instead of reserve key */
  projectSlug?: string;
  projectName?: string;
  onClose: () => void;
}

export default function ExportKeyModal({
  reserveIndex,
  projectSlug,
  projectName,
  onClose,
}: ExportKeyModalProps) {
  const feedService = useFeedService();
  const [keyInfo, setKeyInfo] = useState<{ privateKey: string; address: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);

  // Determine if we're exporting a project key or reserve key
  const isProjectKey = Boolean(projectSlug);
  const keyType = isProjectKey ? 'Project' : 'Reserve';

  useEffect(() => {
    // Only attempt once to prevent infinite loops
    if (hasAttempted) return;

    const exportKey = async () => {
      setHasAttempted(true);
      try {
        setIsLoading(true);
        setError(null);

        // Export project key or reserve key based on props
        const info = isProjectKey
          ? await feedService.exportProjectKey(reserveIndex, projectSlug!)
          : await feedService.exportFeedKey(reserveIndex);

        setKeyInfo({
          privateKey: info.privateKey,
          address: info.address,
        });
      } catch (err) {
        console.error(`Failed to export ${keyType.toLowerCase()} key:`, err);
        setError(err instanceof Error ? err.message : `Failed to export ${keyType.toLowerCase()} key`);
      } finally {
        setIsLoading(false);
      }
    };

    exportKey();
  }, [hasAttempted, feedService, reserveIndex, projectSlug, isProjectKey, keyType]);

  // Generate modal title
  const modalTitle = isProjectKey
    ? `Export Key: ${projectName || projectSlug}`
    : 'Export Reserve Key';

  return (
    <Modal title={modalTitle} onClose={onClose}>
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
              {isProjectKey ? (
                <>
                  This key can update the feed for <strong>{projectName || projectSlug}</strong>.
                  <br />
                  Use it in CI/CD pipelines with the Hostasis CLI to deploy updates.
                </>
              ) : (
                <>
                  This key owns your reserve&apos;s batch and can upload files and update feeds.
                  <br />
                  Use it in CI/CD pipelines or with the Hostasis CLI.
                </>
              )}
              <strong> Keep it secret!</strong>
            </p>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>{keyType} Address</label>
              <div className={styles.fieldValue}>
                <code className={styles.code}>{keyInfo.address}</code>
                <CopyButton text={keyInfo.address} label="Address" />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>{keyType} Private Key</label>
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
                {isProjectKey
                  ? `This key can update the ${projectName || projectSlug} feed. Anyone with this key can modify your site.`
                  : 'This key can upload to your batch and update your feeds. Anyone with this key can modify your sites.'}
                {' '}Store it securely as a secret in your CI/CD system.
              </p>
            </div>

            <div className={styles.usage}>
              <label className={styles.fieldLabel}>Example Usage</label>
              <pre className={styles.codeBlock}>
{isProjectKey
  ? `# Deploy to project with Hostasis CLI
hostasis deploy ./dist \\
  --reserve-key=<your-reserve-key> \\
  --project=${projectSlug}

# Or export as environment variable
export HOSTASIS_PROJECT_KEY="${keyInfo.privateKey}"
hostasis deploy ./dist --project=${projectSlug}`
  : `# Upload and update feed with Hostasis CLI
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
