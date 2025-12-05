import Link from 'next/link';

interface EmptyVaultsStateProps {
  onCreateClick: () => void;
  initialAmount?: string;
}

export default function EmptyVaultsState({ onCreateClick, initialAmount }: EmptyVaultsStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg
          width="80"
          height="80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      </div>

      <h2 className="empty-state-title">No vaults yet</h2>

      <p className="empty-state-description">
        Create your first vault to start hosting files permanently. Your vault earns yield that automatically pays for Swarm storage.
      </p>

      <button
        onClick={onCreateClick}
        className="empty-state-cta"
      >
        {initialAmount
          ? `Create Vault with ${initialAmount} DAI`
          : 'Create Your First Vault'}
      </button>

      <Link href="/#mechanism" className="empty-state-link">
        Learn how it works
      </Link>
    </div>
  );
}
