import { useState, useEffect } from 'react'
import { useReadContract } from 'wagmi'
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses'
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json'
import TokenAmount from './TokenAmount'
import { CopyButton } from './CopyButton'
import { FileList } from './FileList'
import { getUploadsByBatchId, type UploadRecord } from '../utils/uploadHistory'
import { useStampInfo, formatTimeRemaining } from '../hooks/useStampInfo'

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
  refetchTrigger?: number
}

export default function DepositCard({
  depositIndex,
  userAddress,
  onWithdraw,
  onUpdateStamp,
  onTopUp,
  refetchTrigger,
}: DepositCardProps) {
  const [uploads, setUploads] = useState<UploadRecord[]>([])

  const { data: deposit, refetch } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: [userAddress, BigInt(depositIndex)],
  })

  // Refetch when trigger changes
  useEffect(() => {
    if (refetchTrigger !== undefined && refetchTrigger > 0) {
      refetch()
    }
  }, [refetchTrigger, refetch])

  // Fetch upload history for this batch/stamp
  useEffect(() => {
    if (deposit) {
      const depositData = deposit as unknown as Deposit
      const batchUploads = getUploadsByBatchId(depositData.stampId)
      setUploads(batchUploads)
    }
  }, [deposit])

  // Extract deposit data (or undefined if not loaded)
  const depositData = deposit ? (deposit as unknown as Deposit) : undefined

  // Fetch stamp information from blockchain and gateway
  const stampInfo = useStampInfo(depositData?.stampId)

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
    <div className="info-box deposit-card">
      {/* Header with reserve number and date */}
      <div className="deposit-card-header">
        <h4 className="deposit-card-title">Reserve #{depositIndex}</h4>
        <span className="deposit-card-date">
          {depositDate.toLocaleDateString()}
        </span>
      </div>

      {/* Content Preview - Most Important Section */}
      <div className="deposit-card-content">
        <FileList upload={latestUpload} />
      </div>

      {/* Reserve Status - Secondary Info */}
      <div className="deposit-card-status">
        <div className="deposit-card-status-item">
          <div>
            <div className="deposit-card-status-label">Reserved</div>
            <div className="deposit-card-status-value">
              <TokenAmount value={depositData.principalDAI} symbol="DAI" />
            </div>
          </div>
        </div>
        <div className="deposit-card-status-item">
          <div>
            <div className="deposit-card-status-label">Expires in</div>
            <div className="deposit-card-status-value" style={{
              color: stampInfo.timeRemainingSeconds && stampInfo.timeRemainingSeconds > 0 ? '#2d7a2d' : '#c93a3a'
            }}>
              {stampInfo.isLoading ? '...' : formatTimeRemaining(stampInfo.timeRemainingSeconds)}
            </div>
          </div>
        </div>
      </div>

      {/* Actions - Clear Hierarchy */}
      <div className="deposit-card-actions">
        <button
          className="view-button view-button--primary deposit-card-action-primary"
          onClick={onUpdateStamp}
        >
          Update Content
        </button>
        <div className="deposit-card-actions-secondary">
          <button
            className="view-button view-button--tertiary"
            onClick={onTopUp}
          >
            Top Up
          </button>
          <button
            className="view-button view-button--danger"
            onClick={onWithdraw}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Technical Details - Minimized */}
      <div className="deposit-card-technical">
        <span className="deposit-card-batch-id" title={depositData.stampId}>
          Batch ID: {shortBatchId}
        </span>
        <CopyButton text={depositData.stampId} label="Batch ID" />
      </div>
    </div>
  )
}
