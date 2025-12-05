import { useState, useEffect } from 'react';
import type { NextPage } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Navigation from '../components/Navigation';
import DepositsList from '../components/DepositsList';
import CreateVaultModal from '../components/CreateVaultModal';
import { useFeedService } from '../hooks/useFeedService';
import styles from './vaults.module.css';
import { POSTAGE_STAMP_ADDRESS, GNOSIS_RPC_URL } from '../contracts/addresses';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

// Create public client for reading stamp depth
const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(GNOSIS_RPC_URL),
});

const VaultsPage: NextPage = () => {
  const { isConnected, address } = useAccount();
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Feed service for live URLs
  const feedService = useFeedService();
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [isInitializingFeed, setIsInitializingFeed] = useState(false);

  // Get amount from query string (e.g., /vaults?amount=100)
  const initialAmount = typeof router.query.amount === 'string' ? router.query.amount : undefined;
  // Get stampId from query string (e.g., /vaults?stampId=0x...)
  const initialStampId = typeof router.query.stampId === 'string' ? router.query.stampId : undefined;
  // Get contentHash from query string (e.g., /vaults?contentHash=abc123...)
  const initialContentHash = typeof router.query.contentHash === 'string' ? router.query.contentHash : undefined;

  // Auto-open modal if amount or stampId is in query string
  useEffect(() => {
    if ((initialAmount || initialStampId) && isConnected) {
      setShowCreateModal(true);
    }
  }, [initialAmount, initialStampId, isConnected]);

  const handleCreateSuccess = () => {
    setRefreshKey((prev) => prev + 1);
    // Clear the query string after successful creation
    if (initialAmount || initialStampId || initialContentHash) {
      router.replace('/vaults', undefined, { shallow: true });
    }
  };

  // Handle vault creation with feed initialization
  const handleCreateSuccessWithIndex = async (vaultIndex: number, stampId: string) => {
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
        await feedService.initializeFeed(vaultIndex, stampId, Number(depth), initialContentHash);
        const url = feedService.getFeedManifestUrl(vaultIndex);
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
      router.replace('/vaults', undefined, { shallow: true });
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    // Clear the query string if user closes without creating
    if (initialAmount || initialStampId || initialContentHash) {
      router.replace('/vaults', undefined, { shallow: true });
    }
  };

  return (
    <>
      <Head>
        <title>Vaults | Hostasis</title>
        <meta content="Manage your storage vaults on Hostasis." name="description" />
        <link href="/favicon.ico" rel="icon" />
      </Head>

      <Navigation />

      <div className={`container ${styles.vaultsContainer}`}>
        {!isConnected ? (
          <div className="info-box" style={{ textAlign: 'center', maxWidth: '500px', margin: '4rem auto' }}>
            <h3 style={{ marginTop: 0 }}>Connect Your Wallet</h3>
            <p className="description">You need to connect your wallet to view and manage your vaults.</p>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
              <ConnectButton />
            </div>
          </div>
        ) : (
          <>
            <div className={styles.vaultsHeader}>
              <h2>Vaults</h2>
              <button
                className={styles.createVaultButton}
                onClick={() => setShowCreateModal(true)}
              >
                + Create Vault
              </button>
            </div>
            <DepositsList
              key={refreshKey}
              onCreateClick={() => setShowCreateModal(true)}
              initialAmount={initialAmount}
            />
          </>
        )}

      </div>

      {showCreateModal && (
        <CreateVaultModal
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

export default VaultsPage;
