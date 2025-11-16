import React from 'react';
import { useAccount } from 'wagmi';

const CTAFooter: React.FC = () => {
  const { isConnected } = useAccount();

  return (
    <div className="cta-footer">
      <div className="cta-footer-content">
        <h2 className="cta-footer-headline">
          Host your files forever — powered by yield.
        </h2>
        <p className="cta-footer-description">
          No subscriptions. No monthly bills. Just permanent storage.
        </p>
        {!isConnected && (
          <div className="cta-footer-action">
            <p className="cta-footer-hint">Connect your wallet to get started</p>
          </div>
        )}
        {isConnected && (
          <div className="cta-footer-action">
            <p className="cta-footer-success">
              You're connected! Scroll up to make your first deposit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CTAFooter;
