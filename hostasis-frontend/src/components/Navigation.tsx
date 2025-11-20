import { useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="nav-bar">
      <div className="nav-content">
        {/* Left: O8 Brand */}
        <div className="nav-left">
          <Link href="/" className="nav-brand">
            <span className="nav-o8">o8</span>
            <span className="nav-divider">/</span>
            <span className="nav-service">Hostasis</span>
          </Link>
        </div>

        {/* Right: Menu Items + Wallet */}
        <div className="nav-right">
          <div className="nav-menu">
            <Link href="/" className="nav-menu-item">
              Home
            </Link>
            <Link href="/upload" className="nav-menu-item">
              Upload
            </Link>
            <Link href="/reserves" className="nav-menu-item">
              Reserves
            </Link>
            <Link href="/stats" className="nav-menu-item">
              Stats
            </Link>
            <a
              href="https://github.com/o8-is/hostasis"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-menu-item nav-menu-item--external"
            >
              Docs
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginLeft: '0.25rem', opacity: 0.7 }}
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>

          {/* Mobile hamburger */}
          <button
            className="nav-mobile-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>

          <ConnectButton />
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="nav-mobile-menu">
          <Link href="/" className="nav-mobile-item" onClick={() => setMobileMenuOpen(false)}>
            Home
          </Link>
          <Link href="/upload" className="nav-mobile-item" onClick={() => setMobileMenuOpen(false)}>
            Upload
          </Link>
          <Link href="/reserves" className="nav-mobile-item" onClick={() => setMobileMenuOpen(false)}>
            Reserves
          </Link>
          <a
            href="https://github.com/octalmage/hostasis"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-mobile-item"
            onClick={() => setMobileMenuOpen(false)}
          >
            Docs
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ marginLeft: '0.25rem', opacity: 0.7 }}
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>
      )}
    </nav>
  );
}
