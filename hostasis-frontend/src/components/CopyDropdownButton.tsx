import React, { useState, useRef, useEffect } from 'react'
import styles from './CopyDropdownButton.module.css'

export interface CopyOption {
  label: string
  value: string
  description?: string
}

interface CopyDropdownButtonProps {
  options: CopyOption[]
  size?: 'default' | 'small'
}

export const CopyDropdownButton: React.FC<CopyDropdownButtonProps> = ({
  options,
  size = 'default'
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(index)
      setTimeout(() => {
        setCopiedIndex(null)
        setIsOpen(false)
      }, 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // If only one option, render a simple copy button
  if (options.length === 1) {
    return (
      <button
        onClick={() => handleCopy(options[0].value, 0)}
        className={`${styles.copyButton} ${size === 'small' ? styles.small : ''}`}
        title={copiedIndex === 0 ? 'Copied!' : `Copy ${options[0].label}`}
      >
        {copiedIndex === 0 ? '✓ Copied' : 'Copy'}
      </button>
    )
  }

  return (
    <div className={styles.container} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`${styles.copyButton} ${size === 'small' ? styles.small : ''}`}
        title="Copy options"
      >
        Copy ▾
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          {options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleCopy(option.value, index)}
              className={styles.dropdownItem}
              disabled={copiedIndex === index}
            >
              <span className={styles.optionLabel}>
                {copiedIndex === index ? '✓ ' : ''}{option.label}
              </span>
              {option.description && (
                <span className={styles.optionDescription}>{option.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Helper function to extract reference from URL
export const extractReferenceFromUrl = (url: string): string | null => {
  try {
    // Match various Swarm URL patterns:
    // 1. Subdomain format: https://REFERENCE.bzz.sh/
    // 2. Path format: https://gateway.com/bzz/REFERENCE
    // 3. Path format: https://gateway.com/bzz/REFERENCE/path

    // Try subdomain format first (e.g., bah5ac...qa.bzz.sh)
    // Swarm references can be hex (64 chars) or base32 CIDv1 (starting with 'ba')
    const subdomainMatch = url.match(/^https?:\/\/([a-z0-9]+)\.bzz\.sh/)
    if (subdomainMatch) {
      return subdomainMatch[1]
    }

    // Fall back to path format (typically hex)
    const pathMatch = url.match(/\/bzz\/([a-fA-F0-9]+)/)
    return pathMatch ? pathMatch[1] : null
  } catch {
    return null
  }
}

// Helper to shorten reference for display
export const shortenReference = (ref: string, prefixLen = 8, suffixLen = 6): string => {
  if (ref.length <= prefixLen + suffixLen + 3) return ref
  return `${ref.slice(0, prefixLen)}...${ref.slice(-suffixLen)}`
}
