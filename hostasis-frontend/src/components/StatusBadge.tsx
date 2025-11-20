import React from 'react'

interface StatusBadgeProps {
  timeRemainingSeconds: number | null
  loading?: boolean
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ timeRemainingSeconds, loading }) => {
  if (loading || timeRemainingSeconds === null) {
    return (
      <span className="status-badge status-badge--loading">
        Loading...
      </span>
    )
  }

  const isExpired = timeRemainingSeconds <= 0
  const isExpiringSoon = timeRemainingSeconds > 0 && timeRemainingSeconds < 3 * 24 * 60 * 60 // 3 days

  if (isExpired) {
    return (
      <span className="status-badge status-badge--expired">
        Expired
      </span>
    )
  }

  if (isExpiringSoon) {
    return (
      <span className="status-badge status-badge--expiring">
        Expiring Soon
      </span>
    )
  }

  return (
    <span className="status-badge status-badge--active">
      Active
    </span>
  )
}
