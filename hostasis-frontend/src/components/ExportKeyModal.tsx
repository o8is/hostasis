import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import Modal from "./Modal";
import { CopyButton } from "./CopyButton";
import { useFeedService } from "../hooks/useFeedService";
import { POSTAGE_MANAGER_ADDRESS } from "../contracts/addresses";
import PostageManagerABI from "../contracts/abis/PostageYieldManager.json";
import styles from "./ExportKeyModal.module.css";

interface ExportKeyModalProps {
  vaultIndex: number;
  /** If provided, exports project key instead of vault key */
  projectSlug?: string;
  projectName?: string;
  onClose: () => void;
}

export default function ExportKeyModal({
  vaultIndex,
  projectSlug,
  projectName,
  onClose,
}: ExportKeyModalProps) {
  const { address } = useAccount();
  const feedService = useFeedService();
  const [keyInfo, setKeyInfo] = useState<{
    privateKey: string;
    address: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [hasAttempted, setHasAttempted] = useState(false);

  // Fetch deposit data to get batchId
  const { data: deposit } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: "getUserDeposit",
    args: address ? [address, BigInt(vaultIndex)] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const batchId = (deposit as any)?.stampId as string | undefined;

  // Determine if we're exporting a project key or vault key
  const isProjectKey = Boolean(projectSlug);
  const keyType = isProjectKey ? "Project" : "Vault";

  useEffect(() => {
    // Only attempt once to prevent infinite loops
    if (hasAttempted) return;

    const exportKey = async () => {
      setHasAttempted(true);
      try {
        setIsLoading(true);
        setError(null);

        // Export project key or vault key based on props
        const info = isProjectKey
          ? await feedService.exportProjectKey(vaultIndex, projectSlug!)
          : await feedService.exportFeedKey(vaultIndex);

        setKeyInfo({
          privateKey: info.privateKey,
          address: info.address,
        });
      } catch (err) {
        console.error(`Failed to export ${keyType.toLowerCase()} key:`, err);
        setError(
          err instanceof Error
            ? err.message
            : `Failed to export ${keyType.toLowerCase()} key`
        );
      } finally {
        setIsLoading(false);
      }
    };

    exportKey();
  }, [
    hasAttempted,
    feedService,
    vaultIndex,
    projectSlug,
    isProjectKey,
    keyType,
  ]);

  // Generate modal title
  const modalTitle = isProjectKey
    ? `Export Key: ${projectName || projectSlug}`
    : "Export Vault Key";

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
          <div className={styles.field}>
              <label className={styles.fieldLabel}>Batch ID</label>
              <div className={styles.fieldValue}>
                <code className={styles.code}>{batchId || "Loading..."}</code>
                {batchId && <CopyButton text={batchId} label="Batch ID" />}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>{keyType} Private Key</label>
              <div className={styles.fieldValue}>
                {showPrivateKey ? (
                  <code className={styles.code}>{keyInfo.privateKey}</code>
                ) : (
                  <code className={styles.code}>
                    ••••••••••••••••••••••••••••••••
                  </code>
                )}
                <button
                  className={styles.toggleButton}
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                >
                  {showPrivateKey ? "Hide" : "Show"}
                </button>
                <CopyButton text={keyInfo.privateKey} label="Key" />
              </div>
            </div>

            <div className={styles.warning}>
              <strong>⚠️ Security Warning</strong>
              <p>
                This key can upload to your vault and update your feeds. Anyone
                with this key can modify your sites. Store it securely as a
                secret in your CI/CD system.
              </p>
            </div>

            <div className={styles.usage}>
              <label className={styles.fieldLabel}>Example Usage</label>
              <pre className={styles.codeBlock}>{`hostasis upload ./<directory> \\
  --project=<name> \\
  --batch-id ${batchId} \\
  --key ${keyInfo.privateKey} \\
  --feed

# Or with environment variables
export HOSTASIS_PROJECT="<name>"
export HOSTASIS_BATCH_ID="${batchId}"
export HOSTASIS_PRIVATE_KEY="${keyInfo.privateKey}"
hostasis upload ./<directory> --feed`}</pre>
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
