import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useReadContract } from 'wagmi'
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses'
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json'
import TokenAmount from './TokenAmount'
import { CopyButton } from './CopyButton'
import { FileList } from './FileList'
import { getUploadsByBatchId, type UploadRecord } from '../utils/uploadHistory'
import { useStampInfo, formatTimeRemaining } from '../hooks/useStampInfo'
import { useFeedService } from '../hooks/useFeedService'
import { hasFeed as checkHasFeed } from '../utils/feedStorage'

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
}: DepositCardProps) {
  const router = useRouter()
  const [uploads, setUploads] = useState<UploadRecord[]>([])
  const [isInitializing, setIsInitializing] = useState(false)
  const [feedUrl, setFeedUrl] = useState<string | null>(null)
  const [currentFeedIndex, setCurrentFeedIndex] = useState<number | null>(null)
  const feedService = useFeedService()
  const feedExists = checkHasFeed(depositIndex)

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

  if (!deposit || !depositData) return null

  // Filter out fully withdrawn reserves
  if (depositData.sDAIAmount === 0n) return null

  const depositDate = new Date(Number(depositData.depositTime) * 1000)
  const latestUpload = uploads.length > 0 ? uploads[uploads.length - 1] : null

  // Shorten batch ID for display
  const shortBatchId = depositData.stampId.length > 16
    ? `${depositData.stampId.slice(0, 8)}...${depositData.stampId.slice(-6)}`
    : depositData.stampId

  return (
    <div className={`info-box ${styles.depositCard}`}>
      {/* Header with reserve number and date */}
      <div className={styles.header}>
        <h4 className={styles.title}>Reserve #{depositIndex}</h4>
        <span className={styles.date}>
          {depositDate.toLocaleDateString()}
        </span>
      </div>

      {/* Live URL - Show prominently if feed exists */}
      {feedUrl && (
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
          <CopyButton text={feedUrl} label="URL" />
        </div>
      )}

      {/* Content Preview - Most Important Section */}
      <div className={styles.content}>
        <FileList upload={latestUpload} />
      </div>

      {/* Reserve Status - Secondary Info */}
      <div className={styles.status}>
        <div className={styles.statusItem}>
          <div>
            <div className={styles.statusLabel}>Reserved</div>
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
        {feedExists ? (
          <button
            className={`view-button view-button--primary ${styles.actionPrimary}`}
            onClick={() => router.push(`/upload?reserveId=${depositIndex}`)}
          >
            Update Site
          </button>
        ) : latestUpload ? (
          /* Has uploads but no feed - offer to initialize tracking */
          <button
            className={`view-button view-button--primary ${styles.actionPrimary}`}
            disabled={isInitializing}
            onClick={async () => {
              try {
                setIsInitializing(true)
                // Initialize feed with stamp depth from useStampInfo
                const manifestUrl = await feedService.initializeFeed(
                  depositIndex,
                  depositData.stampId,
                  stampInfo.depth,
                  latestUpload.reference
                )
                // Update the feed URL in state to trigger re-render
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
        ) : (
          <button
            className={`view-button view-button--primary ${styles.actionPrimary}`}
            onClick={onUpdateStamp}
          >
            Update Content
          </button>
        )}
        <div className={styles.actionsSecondary}>
          <button
            className="view-button view-button--tertiary"
            onClick={onTopUp}
          >
            Top Up
          </button>
          {feedExists && onExportKey && (
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
