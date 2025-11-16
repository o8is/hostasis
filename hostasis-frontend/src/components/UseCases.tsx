import React from 'react';

interface UseCase {
  title: string;
  icon: string;
}

const useCases: UseCase[] = [
  { title: 'Permanent website hosting', icon: '🌐' },
  { title: 'Permanent NFT storage', icon: '🎨' },
  { title: 'Archival backups', icon: '📦' },
  { title: 'DAO documents', icon: '📜' },
  { title: 'Public datasets', icon: '🗂️' },
  { title: 'Dapp frontends', icon: '⚡' },
  { title: 'Provenance records', icon: '✔️' },
  { title: 'Much much more', icon: '🌍' }
];

const UseCases: React.FC = () => {
  return (
    <div className="use-cases-section">
      <h2 className="use-cases-title">Use Cases</h2>
      <p className="use-cases-subtitle">
        From personal projects to enterprise infrastructure
      </p>

      <div className="use-cases-grid">
        {useCases.map((useCase, index) => (
          <div key={index} className="use-case-card">
            <div className="use-case-icon">{useCase.icon}</div>
            <div className="use-case-title">{useCase.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UseCases;
