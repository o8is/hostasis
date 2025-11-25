import React, { useState } from 'react'
import styles from './CopyButton.module.css'

interface CopyButtonProps {
  text: string
  label?: string
}

export const CopyButton: React.FC<CopyButtonProps> = ({ text, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={styles.copyButton}
      title={copied ? 'Copied!' : `Copy ${label}`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
