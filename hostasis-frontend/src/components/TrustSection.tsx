import React from 'react';

interface TrustBadge {
  title: string;
  description: string;
  icon: string;
}

const trustBadges: TrustBadge[] = [
  {
    title: 'Built on Sky',
    description: 'Powered by Sky\'s Savings Rate (sDAI)',
    icon: '☁️'
  },
  {
    title: 'Powered by Swarm',
    description: 'Decentralized storage network',
    icon: '🐝'
  },
  {
    title: '100% On-chain',
    description: 'All operations verified on Gnosis Chain',
    icon: '⛓️'
  },
  {
    title: 'Open-source',
    description: 'Fully transparent and auditable',
    icon: '📖'
  },
  {
    title: 'Non-custodial',
    description: 'You always control your funds',
    icon: '🔐'
  },
  {
    title: 'Battle-tested',
    description: 'Built on proven DeFi infrastructure',
    icon: '🛡️'
  }
];

const TrustSection: React.FC = () => {
  return (
    <div className="trust-section">
      <h2 className="trust-title">Built on proven infrastructure</h2>
      <p className="trust-subtitle">
        Hostasis combines the best of DeFi and decentralized storage
      </p>

      <div className="trust-grid">
        {trustBadges.map((badge, index) => (
          <div key={index} className="trust-badge">
            <div className="trust-badge-icon">{badge.icon}</div>
            <h4 className="trust-badge-title">{badge.title}</h4>
            <p className="trust-badge-description">{badge.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TrustSection;
