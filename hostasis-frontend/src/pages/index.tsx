import type { NextPage } from 'next';
import Head from 'next/head';
import { useAccount } from 'wagmi';
import { useState } from 'react';
import Navigation from '../components/Navigation';
import DepositForm from '../components/DepositForm';
import DepositsList from '../components/DepositsList';
import InfoCards from '../components/InfoCards';

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
        <h1>
          Permanent hosting powered by Swarm and Spark.
        </h1>
        <InfoCards />
        {isConnected ? (
          <>

            <DepositForm onDepositSuccess={handleDepositSuccess} />
            <DepositsList key={refreshKey} />
          </>
        ) : (
          <div className="info-box" style={{ marginTop: '2rem', textAlign: 'center' }}>
            <h3>Welcome to Hostasis</h3>
            <p className="description">
              Connect your wallet to get started with permanent decentralized storage powered by yield.
            </p>
          </div>
        )}
      </div>
    </>
  );
};

export default Home;
