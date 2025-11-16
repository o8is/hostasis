import type { NextPage } from 'next';
import Head from 'next/head';
import { useAccount } from 'wagmi';
import { useState } from 'react';
import Navigation from '../components/Navigation';
import DepositForm from '../components/DepositForm';
import DepositsList from '../components/DepositsList';
import InfoCards from '../components/InfoCards';
import StorageCalculator from '../components/StorageCalculator';
import FutureSection from '../components/FutureSection';
import UseCases from '../components/UseCases';
import TrustSection from '../components/TrustSection';
import CTAFooter from '../components/CTAFooter';

const Home: NextPage = () => {
  const { isConnected } = useAccount();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDepositSuccess = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <>
      <Head>
        <title>o8 | Hostasis</title>
        <meta
          content="Permanent decentralized web hosting powered by yield."
          name="description"
        />
        <link href="/favicon.ico" rel="icon" />
      </Head>

      <Navigation />

      <div className="container" style={{ marginTop: '3rem' }}>
        {/* Hero Section */}
        <div className="hero-section">
          <h1 className="hero-headline">
            Upload once. Host forever.
          </h1>
          <p className="hero-subheadline">
            Your storage is paid for by yield — permanently.
          </p>
          <p className="hero-description">
            Reserve your storage with any supported asset. Your reserve earns yield. Hostasis converts that yield into Swarm storage so your files stay online forever — no subscriptions, no monthly bills.
          </p>
          {!isConnected && (
            <div className="hero-cta">
              <p className="cta-hint">Connect your wallet to get started</p>
            </div>
          )}
        </div>

        {/* Storage Calculator - Prominent placement */}
        <StorageCalculator />

        {/* The 3-Step Mechanism */}
        <div className="mechanism-section">
          <h2 className="section-title">How It Works</h2>
          <InfoCards />
        </div>

        {/* Reserve Management (for connected users) */}
        {isConnected && (
          <div className="deposit-section">
            <h2 className="section-title">Reserves</h2>
            <DepositForm onDepositSuccess={handleDepositSuccess} />
            <DepositsList key={refreshKey} />
          </div>
        )}

        {/* Use Cases Section */}
        <UseCases />

        {/* Multi-chain & Future-Proofing Section */}
        <FutureSection />

        {/* Trust & Tech Section */}
        <TrustSection />

        {/* Strong CTA Footer */}
        <CTAFooter />
      </div>
    </>
  );
};

export default Home;
