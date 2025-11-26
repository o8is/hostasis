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
import { useFeedService } from '../hooks/useFeedService';
import styles from './reserves.module.css';
import { POSTAGE_MANAGER_ADDRESS, POSTAGE_STAMP_ADDRESS, GNOSIS_RPC_URL } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

// Create public client for reading stamp depth
const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(GNOSIS_RPC_URL),
});

const ReservesPage: NextPage = () => {
  const { isConnected, address } = useAccount();
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Feed service for live URLs
  const feedService = useFeedService();
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [isInitializingFeed, setIsInitializingFeed] = useState(false);

  // Get amount from query string (e.g., /reserves?amount=100)
  const initialAmount = typeof router.query.amount === 'string' ? router.query.amount : undefined;
  // Get stampId from query string (e.g., /reserves?stampId=0x...)
  const initialStampId = typeof router.query.stampId === 'string' ? router.query.stampId : undefined;
  // Get contentHash from query string (e.g., /reserves?contentHash=abc123...)
  const initialContentHash = typeof router.query.contentHash === 'string' ? router.query.contentHash : undefined;

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
    if (initialAmount || initialStampId || initialContentHash) {
      router.replace('/reserves', undefined, { shallow: true });
    }
  };

  // Handle reserve creation with feed initialization
  const handleCreateSuccessWithIndex = async (reserveIndex: number, stampId: string) => {
    refetchDepositCount();
    setRefreshKey((prev) => prev + 1);

    // If we have a content hash, initialize the feed
    if (initialContentHash) {
      setIsInitializingFeed(true);
      setFeedError(null);

      try {
        // Fetch stamp depth from blockchain
        const prefixedStampId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
        const depth = await publicClient.readContract({
          address: POSTAGE_STAMP_ADDRESS as `0x${string}`,
          abi: PostageStampABI,
          functionName: 'batchDepth',
          args: [prefixedStampId],
        });

        // Initialize feed and deploy first version
        await feedService.initializeFeed(reserveIndex, stampId, Number(depth), initialContentHash);
        const url = feedService.getFeedManifestUrl(reserveIndex);
        setLiveUrl(url);

        // Close modal after success
        setShowCreateModal(false);
      } catch (err) {
        console.error('Failed to initialize feed:', err);
        setFeedError(err instanceof Error ? err.message : 'Failed to initialize feed');
      } finally {
        setIsInitializingFeed(false);
      }
    }
    
    // Clear the query string after successful creation
    if (initialAmount || initialStampId || initialContentHash) {
      router.replace('/reserves', undefined, { shallow: true });
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    // Clear the query string if user closes without creating
    if (initialAmount || initialStampId || initialContentHash) {
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

      <div className={`container ${styles.reservesContainer}`}>
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
          <div>
            <div className={styles.reservesHeader}>
              <h1>Reserves</h1>
              <button className={styles.createReserveButton} onClick={() => setShowCreateModal(true)}>
                + Create Reserve
              </button>
            </div>
            <DepositsList key={refreshKey} />
          </div>
        )}
        
        {/* Show URL after successful feed initialization */}
        {liveUrl && (
          <div className="info-box" style={{ marginTop: '2rem', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, color: '#4ade80' }}>✓ Content Tracking Enabled!</h3>
            <p className="description">
              Live URL — update your content anytime from the &quot;Update Site&quot; button:
            </p>
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                background: 'rgba(74, 158, 255, 0.1)',
                borderRadius: '8px',
                color: '#4a9eff',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
                fontSize: '0.9rem'
              }}
            >
              {liveUrl}
            </a>
            <button
              onClick={() => setLiveUrl(null)}
              style={{ marginTop: '1rem' }}
              className="view-button"
            >
              Dismiss
            </button>
          </div>
        )}
        
        {feedError && (
          <div className="info-box" style={{ marginTop: '2rem', textAlign: 'center', borderColor: '#ef4444' }}>
            <p style={{ color: '#ef4444', margin: 0 }}>Feed Error: {feedError}</p>
            <button 
              onClick={() => setFeedError(null)}
              style={{ marginTop: '1rem' }}
              className="view-button"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateReserveModal 
          onClose={handleCloseModal} 
          onSuccess={initialContentHash ? undefined : handleCreateSuccess}
          onSuccessWithIndex={initialContentHash ? handleCreateSuccessWithIndex : undefined}
          initialAmount={initialAmount} 
          initialStampId={initialStampId}
          initialContentHash={initialContentHash}
        />
      )}
    </>
  );
};

export default ReservesPage;
