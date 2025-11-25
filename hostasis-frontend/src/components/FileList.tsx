import React, { useState } from 'react'
import { buildSwarmUrl } from '../utils/swarmUrl'
import { formatFileSize } from '../utils/fileFormat'
import styles from './FileList.module.css'

interface UploadedFile {
  name: string
  size: number
  path?: string
}

interface UploadRecord {
  id: string
  batchId: string
  reference: string
  files: UploadedFile[]
  totalSize: number
  uploadedAt: number
  metadata?: {
    isWebsite?: boolean
    indexDocument?: string
    filename?: string
  }
}

interface FileListProps {
  upload: UploadRecord | null
}

export const FileList: React.FC<FileListProps> = ({ upload }) => {
  const [expanded, setExpanded] = useState(false)

  if (!upload) {
    return (
      <div className={styles.empty}>
        <p className={styles.textMuted}>No uploads yet</p>
        <p className={`${styles.textSmall} ${styles.textMuted}`}>
          Upload files to this reserve to start using decentralized storage
        </p>
      </div>
    )
  }

  const fileCount = upload.files.length
  const isWebsite = upload.metadata?.isWebsite ||
                    upload.files.some(f => /index\.html?$/i.test(f.name))

  // Website display
  if (isWebsite) {
    const websiteUrl = buildSwarmUrl(upload.reference, upload.metadata)
    return (
      <div className="file-list-website">
        <div className={styles.summary}>
          <div className={styles.summaryText}>
            <div className={styles.title}>Website</div>
            <div className={styles.meta}>
              {fileCount.toLocaleString()} {fileCount === 1 ? 'file' : 'files'} • {formatFileSize(upload.totalSize)}
            </div>
          </div>
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            View →
          </a>
        </div>
      </div>
    )
  }

  // Small file collection (≤5 files) - show all
  if (fileCount <= 5) {
    const baseUrl = buildSwarmUrl(upload.reference, upload.metadata)
    return (
      <div className="file-list-small">
        <div className={styles.summary}>
          <div className={styles.summaryText}>
            <div className={styles.title}>
              {fileCount} {fileCount === 1 ? 'File' : 'Files'}
            </div>
            <div className={styles.meta}>
              {formatFileSize(upload.totalSize)}
            </div>
          </div>
          <a
            href={baseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            View All →
          </a>
        </div>
        <ul className={styles.items}>
          {upload.files.map((file, index) => {
            const fileUrl = file.path
              ? `${baseUrl}/${file.path}`
              : fileCount === 1 && upload.metadata?.filename
                ? `${baseUrl}/${upload.metadata.filename}`
                : baseUrl
            return (
              <li key={index} className={styles.item}>
                <span className={styles.itemName}>{file.name}</span>
                <span className={styles.itemSize}>{formatFileSize(file.size)}</span>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.itemLink}
                >
                  View →
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  // Medium file collection (6-20 files) - show some with expand option
  if (fileCount <= 20) {
    const baseUrl = buildSwarmUrl(upload.reference, upload.metadata)
    const visibleFiles = expanded ? upload.files : upload.files.slice(0, 5)
    const remainingCount = fileCount - 5

    return (
      <div className="file-list-medium">
        <div className={styles.summary}>
          <div className={styles.summaryText}>
            <div className={styles.title}>
              {fileCount} Files
            </div>
            <div className={styles.meta}>
              {formatFileSize(upload.totalSize)}
            </div>
          </div>
          <a
            href={baseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
          >
            View All →
          </a>
        </div>
        <ul className={styles.items}>
          {visibleFiles.map((file, index) => {
            const fileUrl = file.path ? `${baseUrl}/${file.path}` : baseUrl
            return (
              <li key={index} className={styles.item}>
                <span className={styles.itemName}>{file.name}</span>
                <span className={styles.itemSize}>{formatFileSize(file.size)}</span>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.itemLink}
                >
                  View →
                </a>
              </li>
            )
          })}
        </ul>
        {!expanded && remainingCount > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className={styles.expand}
          >
            + View {remainingCount} more {remainingCount === 1 ? 'file' : 'files'}
          </button>
        )}
      </div>
    )
  }

  // Large file collection (>20 files) - just summary
  const baseUrl = buildSwarmUrl(upload.reference, upload.metadata)
  return (
    <div className="file-list-large">
      <div className={styles.summary}>
        <div className={styles.summaryText}>
          <div className={styles.title}>Large Collection</div>
          <div className={styles.meta}>
            {fileCount.toLocaleString()} files • {formatFileSize(upload.totalSize)}
          </div>
        </div>
        <a
          href={baseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
        >
          View Files →
        </a>
      </div>
    </div>
  )
}
