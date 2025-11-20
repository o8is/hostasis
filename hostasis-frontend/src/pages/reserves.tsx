import { useState, useEffect } from 'react';
import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useAccount, useReadContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Navigation from '../components/Navigation';
import DepositsList from '../components/DepositsList';
import EmptyReservesState from '../components/EmptyReservesState';
import CreateReserveModal from '../components/CreateReserveModal';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';

const ReservesPage: NextPage = () => {
  const { isConnected, address } = useAccount();
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Get amount from query string (e.g., /reserves?amount=100)
  const initialAmount = typeof router.query.amount === 'string' ? router.query.amount : undefined;
  // Get stampId from query string (e.g., /reserves?stampId=0x...)
  const initialStampId = typeof router.query.stampId === 'string' ? router.query.stampId : undefined;

  // Get deposit count to determine empty state
  const { data: depositCount, refetch: refetchDepositCount } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDepositCount',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const count = depositCount ? Number(depositCount) : 0;

  // Auto-open modal if amount or stampId is in query string
  useEffect(() => {
    if ((initialAmount || initialStampId) && isConnected) {
      setShowCreateModal(true);
    }
  }, [initialAmount, initialStampId, isConnected]);

  const handleCreateSuccess = () => {
    refetchDepositCount();
    setRefreshKey((prev) => prev + 1);
    // Clear the query string after successful creation
    if (initialAmount || initialStampId) {
      router.replace('/reserves', undefined, { shallow: true });
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    // Clear the query string if user closes without creating
    if (initialAmount || initialStampId) {
      router.replace('/reserves', undefined, { shallow: true });
    }
  };

  return (
    <>
      <Head>
        <title>Reserves | Hostasis</title>
        <meta content="Manage your storage reserves on Hostasis." name="description" />
        <link href="/favicon.ico" rel="icon" />
      </Head>

      <Navigation />

      <div className="container" style={{ marginTop: '3rem' }}>
        {!isConnected ? (
          <div className="info-box" style={{ textAlign: 'center', maxWidth: '500px', margin: '4rem auto' }}>
            <h3 style={{ marginTop: 0 }}>Connect Your Wallet</h3>
            <p className="description">You need to connect your wallet to view and manage your reserves.</p>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
              <ConnectButton />
            </div>
          </div>
        ) : count === 0 ? (
          <EmptyReservesState onCreateClick={() => setShowCreateModal(true)} initialAmount={initialAmount} />
        ) : (
          <>
            <div className="reserves-header">
              <h1>Your Reserves</h1>
              <button className="create-reserve-button" onClick={() => setShowCreateModal(true)}>
                + Create Reserve
              </button>
            </div>
            <DepositsList key={refreshKey} />
          </>
        )}
      </div>

      {showCreateModal && (
        <CreateReserveModal onClose={handleCloseModal} onSuccess={handleCreateSuccess} initialAmount={initialAmount} initialStampId={initialStampId} />
      )}
    </>
  );
};

export default ReservesPage;
