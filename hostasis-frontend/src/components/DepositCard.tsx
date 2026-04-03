import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useReadContract } from 'wagmi'
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses'
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json'
import TokenAmount from './TokenAmount'
import { CopyButton } from './CopyButton'
import { CopyDropdownButton, type CopyOption } from './CopyDropdownButton'
import { FileList } from './FileList'
import { getUploadsByBatchId, type UploadRecord } from '../utils/uploadHistory'
import { useStampInfo, formatTimeRemaining } from '../hooks/useStampInfo'
import { useFeedService } from '../hooks/useFeedService'
import { hasFeed as checkHasFeed, getCurrentVersion, getFeedManifestReference } from '../utils/feedStorage'
import { getVaultData, type ProjectData, type VaultTier, VAULT_TIERS } from '../utils/projectStorage'
import { vaultHasLocalData } from '../utils/vaultRecovery'
import VaultRecovery from './VaultRecovery'

type Deposit = {
  sDAIAmount: bigint
  principalDAI: bigint
  stampId: string
  depositTime: bigint
}

interface DepositCardProps {
  depositIndex: number
  userAddress: string
  onWithdraw: () => void
  onUpdateStamp: () => void
  onTopUp: () => void
  onExportKey?: () => void
  refetchTrigger?: number
  /** Called when deposit active status is determined (active = sDAIAmount > 0) */
  onActiveChange?: (depositIndex: number, isActive: boolean) => void
}

import styles from './DepositCard.module.css'

export default function DepositCard({
  depositIndex,
  userAddress,
  onWithdraw,
  onUpdateStamp,
  onTopUp,
  onExportKey,
  refetchTrigger,
  onActiveChange,
}: DepositCardProps) {
  const router = useRouter()
  const [uploads, setUploads] = useState<UploadRecord[]>([])
  const [isInitializing, setIsInitializing] = useState(false)
  const [feedUrl, setFeedUrl] = useState<string | null>(null)
  const [currentFeedIndex, setCurrentFeedIndex] = useState<number | null>(null)
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [projectFeedIndices, setProjectFeedIndices] = useState<Record<string, number | null>>({})
  const [needsRecovery, setNeedsRecovery] = useState(false)
  const feedService = useFeedService()
  const feedExists = checkHasFeed(depositIndex)

  // Fetch projects for this vault, and check if recovery is needed
  useEffect(() => {
    const vault = getVaultData(depositIndex)
    if (vault) {
      // Only update if projects actually changed (deep comparison of slugs)
      setProjects(prev => {
        const newSlugs = vault.projects.map(p => p.slug).sort().join(',')
        const prevSlugs = prev.map(p => p.slug).sort().join(',')
        return newSlugs !== prevSlugs ? vault.projects : prev
      })
      setNeedsRecovery(false)
    } else {
      setNeedsRecovery(true)
    }
  }, [depositIndex, refetchTrigger])

  // Get vault tier info
  const vault = getVaultData(depositIndex)
  const tierInfo = vault ? VAULT_TIERS[vault.tier as VaultTier] : null

  const { data: deposit, refetch } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: [userAddress, BigInt(depositIndex)],
  })

  // Extract deposit data (or undefined if not loaded)
  const depositData = deposit ? (deposit as unknown as Deposit) : undefined

  // Fetch stamp information (includes depth)
  const stampInfo = useStampInfo(depositData?.stampId)

  // Get the manifest URL if feed exists
  useEffect(() => {
    if (feedExists) {
      const manifestUrl = feedService.getFeedManifestUrl(depositIndex)
      setFeedUrl(manifestUrl)
    }
  }, [feedExists, depositIndex, feedService])

  // Fetch current feed index from Swarm gateway
  useEffect(() => {
    if (feedExists) {
      feedService.fetchCurrentFeedIndex(depositIndex).then(index => {
        if (index !== null) {
          setCurrentFeedIndex(index)
        }
      })
    }
  }, [feedExists, depositIndex, feedService, refetchTrigger])

  // Fetch feed indices for all projects
  useEffect(() => {
    if (projects.length > 0) {
      Promise.all(
        projects.map(async (project) => {
          if (project.feedOwnerAddress) {
            const index = await feedService.fetchProjectFeedIndex(project.feedOwnerAddress)
            return { slug: project.slug, index }
          }
          return { slug: project.slug, index: null }
        })
      ).then(results => {
        const indices = results.reduce((acc, { slug, index }) => {
          acc[slug] = index
          return acc
        }, {} as Record<string, number | null>)

        // Only update if indices actually changed
        setProjectFeedIndices(prev => {
          const changed = Object.keys(indices).some(slug => prev[slug] !== indices[slug]) ||
                         Object.keys(prev).length !== Object.keys(indices).length
          return changed ? indices : prev
        })
      })
    }
  }, [projects, feedService, refetchTrigger])

  // Refetch when trigger changes
  useEffect(() => {
    if (refetchTrigger !== undefined && refetchTrigger > 0) {
      refetch()
    }
  }, [refetchTrigger, refetch])

  // Fetch upload history for this batch/stamp
  useEffect(() => {
    if (depositData) {
      const batchUploads = getUploadsByBatchId(depositData.stampId)
      setUploads(batchUploads)
    }
  }, [depositData])

  // Report active status to parent
  useEffect(() => {
    if (depositData && onActiveChange) {
      const isActive = depositData.sDAIAmount > 0n
      onActiveChange(depositIndex, isActive)
    }
  }, [depositData, depositIndex, onActiveChange])

  if (!deposit || !depositData) return null

  // Filter out fully withdrawn vaults
  if (depositData.sDAIAmount === 0n) return null

  const depositDate = new Date(Number(depositData.depositTime) * 1000)
  const latestUpload = uploads.length > 0 ? uploads[uploads.length - 1] : null

  // Shorten batch ID for display
  const shortBatchId = depositData.stampId.length > 16
    ? `${depositData.stampId.slice(0, 8)}...${depositData.stampId.slice(-6)}`
    : depositData.stampId

  return (
    <div className={`info-box ${styles.depositCard}`}>
      {/* Header with vault number, tier, and date */}
      <div className={styles.header}>
        <h4 className={styles.title}>
          Vault #{depositIndex}
          {tierInfo && (
            <span className={styles.tierBadge}>{tierInfo.name}</span>
          )}
        </h4>
        <span className={styles.date}>
          {depositDate.toLocaleDateString()}
        </span>
      </div>

      {/* Recovery Banner — shown when on-chain vault exists but localStorage data is missing */}
      {needsRecovery && stampInfo.depth > 0 && (
        <VaultRecovery
          vaultIndex={depositIndex}
          stampDepth={stampInfo.depth}
          stampId={depositData.stampId}
          onRecovered={() => {
            setNeedsRecovery(false)
            // Re-read vault data after recovery
            const vault = getVaultData(depositIndex)
            if (vault) {
              setProjects(vault.projects)
            }
          }}
        />
      )}

      {/* Projects List */}
      {projects.length > 0 ? (
        <div className={styles.projectsList}>
          {projects.map((project) => {
            // Only show slug if different from display name
            const showSlug = project.slug !== project.displayName.toLowerCase().replace(/\s+/g, '-');
            // Extract readable URL parts
            const urlDisplay = project.manifestUrl
              ? project.manifestUrl.replace(/^https?:\/\//, '').replace(/\/bzz\//, '/…/')
              : null;

            // Get the live feed index from Swarm, fallback to local
            const liveIndex = projectFeedIndices[project.slug] ?? project.currentIndex;

            return (
              <div key={project.slug} className={styles.projectItem}>
                <div className={styles.projectHeader}>
                  <div className={styles.projectTitle}>
                    <span className={styles.projectName}>{project.displayName}</span>
                    {showSlug && <span className={styles.projectSlug}>({project.slug})</span>}
                    <span className={styles.projectVersion}>v{liveIndex}</span>
                  </div>
                  {project.manifestUrl && (
                    <a
                      href={project.manifestUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.projectLink}
                      title={project.manifestUrl}
                    >
                      View Site ↗
                    </a>
                  )}
                </div>
                <div className={styles.projectActions}>
                  {project.manifestUrl && (() => {
                    const copyOptions: CopyOption[] = [
                      {
                        label: 'Live URL',
                        value: project.manifestUrl,
                        description: 'Full URL with gateway'
                      }
                    ]

                    // Add feed hash (for DNSLink/ENS setup)
                    if (project.manifestReference) {
                      copyOptions.push({
                        label: 'Feed Hash',
                        value: project.manifestReference,
                        description: 'For DNSLink/ENS'
                      })
                    }

                    return <CopyDropdownButton options={copyOptions} size="small" />
                  })()}
                  <button
                    className={`view-button view-button--small ${styles.updateBtn}`}
                    onClick={() => router.push(`/upload?vaultId=${depositIndex}&project=${project.slug}`)}
                    title="Push new version"
                  >
                    Update
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : feedUrl ? (
        /* Legacy: single feed URL for vaults without projects */
        <div className={styles.stableUrl}>
          <div className={styles.stableUrlLabel}>
            Live URL
            {feedExists && currentFeedIndex !== null && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', opacity: 0.7 }}>
                (v{currentFeedIndex})
              </span>
            )}
          </div>
          <a
            href={feedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.stableUrlLink}
          >
            {feedUrl}
          </a>
          {(() => {
            const feedReference = getFeedManifestReference(depositIndex)
            const currentVersion = getCurrentVersion(depositIndex)
            const copyOptions: CopyOption[] = [
              {
                label: 'Live URL',
                value: feedUrl,
                description: 'Full URL with gateway'
              }
            ]

            // Add feed hash (for DNSLink/ENS setup)
            if (feedReference) {
              copyOptions.push({
                label: 'Feed Hash',
                value: feedReference,
                description: 'For DNSLink/ENS'
              })
            }

            return <CopyDropdownButton options={copyOptions} size="small" />
          })()}
        </div>
      ) : (
        /* No projects and no legacy feed */
        <div className={styles.emptyProjects}>
          <span>No projects yet</span>
        </div>
      )}

      {/* Content Preview - Show for legacy uploads */}
      {!projects.length && latestUpload && (
        <div className={styles.content}>
          <FileList upload={latestUpload} />
        </div>
      )}

      {/* Vault Status - Secondary Info */}
      <div className={styles.status}>
        <div className={styles.statusItem}>
          <div>
            <div className={styles.statusLabel}>Deposited</div>
            <div className={styles.statusValue}>
              <TokenAmount value={depositData.principalDAI} symbol="DAI" />
            </div>
          </div>
        </div>
        <div className={styles.statusItem}>
          <div>
            <div className={styles.statusLabel}>Expires in</div>
            <div className={styles.statusValue} style={{
              color: stampInfo.timeRemainingSeconds && stampInfo.timeRemainingSeconds > 0 ? '#2d7a2d' : '#c93a3a'
            }}>
              {stampInfo.isLoading ? '...' : formatTimeRemaining(stampInfo.timeRemainingSeconds)}
            </div>
          </div>
        </div>
      </div>

      {/* Actions - Clear Hierarchy */}
      <div className={styles.actions}>
        {/* Primary action: Add new project to vault */}
        <button
          className={`view-button view-button--primary ${styles.actionPrimary}`}
          onClick={() => router.push(`/upload?vaultId=${depositIndex}`)}
        >
          {projects.length > 0 ? 'Add Project' : 'Deploy Site'}
        </button>

        {/* Legacy: Enable updates for old vaults without projects */}
        {!projects.length && latestUpload && !feedExists && (
          <button
            className={`view-button ${styles.actionSecondary}`}
            disabled={isInitializing}
            onClick={async () => {
              try {
                setIsInitializing(true)
                const manifestUrl = await feedService.initializeFeed(
                  depositIndex,
                  depositData.stampId,
                  stampInfo.depth,
                  latestUpload.reference
                )
                setFeedUrl(manifestUrl)
              } catch (err) {
                console.error('Failed to initialize feed:', err)
                alert('Failed to initialize feed. Please try again.')
              } finally {
                setIsInitializing(false)
              }
            }}
          >
            {isInitializing ? 'Initializing...' : 'Enable Updates'}
          </button>
        )}

        <div className={styles.actionsSecondary}>
          <button
            className="view-button view-button--tertiary"
            onClick={onTopUp}
          >
            Top Up
          </button>
          {(feedExists || projects.length > 0) && onExportKey && (
            <button
              className="view-button"
              onClick={onExportKey}
            >
              Export Key
            </button>
          )}
          <button
            className="view-button view-button--danger"
            onClick={onWithdraw}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Technical Details - Minimized */}
      <div className={styles.technical}>
        <span className={styles.batchId} title={depositData.stampId}>
          Batch ID: {shortBatchId}
        </span>
        <CopyButton text={depositData.stampId} label="Batch ID" />
      </div>
    </div>
  )
}
