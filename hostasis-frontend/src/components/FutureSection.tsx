import React from 'react';

const FutureSection: React.FC = () => {
  return (
    <div className="future-section">
      <h2 className="future-title">Built for every chain. Built for the long term.</h2>
      <p className="future-intro">
        Hostasis is chain-agnostic. Today it runs on Gnosis Chain with Sky Savings (sDAI) and Swarm.
      </p>

      <div className="future-roadmap">
        <h3 className="future-roadmap-title">Soon:</h3>
        <ul className="future-roadmap-list">
          <li>Cross-chain stablecoins</li>
          <li>Automatic on-ramps</li>
          <li>Alternative backends</li>
          <li>Generalized &ldquo;yield → resource&rdquo; infrastructure</li>
        </ul>
      </div>

      <p className="future-vision">
        Long term, Hostasis becomes a universal decentralized hosting platform.
      </p>
    </div>
  );
};

export default FutureSection;
