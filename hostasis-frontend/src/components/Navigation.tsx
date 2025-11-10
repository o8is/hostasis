import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';

export default function Navigation() {
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

        {/* Center: Navigation Links (optional - for future features) */}
        <div className="nav-center">
          {/* Future: Add links like Deposits, Stats, etc. */}
        </div>

        {/* Right: Connect Button */}
        <div className="nav-right">
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
