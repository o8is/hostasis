import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatEther, parseEther, erc20Abi } from 'viem';
import Navigation from '../components/Navigation';
import { BZZ_ADDRESS } from '../contracts/addresses';
import FileDropZone from '../components/FileDropZone';
import { useStorageCalculator } from '../hooks/useStorageCalculator';
import { useSwapDAIForBZZ } from '../hooks/useSwapDAIForBZZ';
import { usePasskeyWallet } from '../hooks/usePasskeyWallet';
import { usePasskeyBatchCreation } from '../hooks/usePasskeyBatchCreation';
import { useStampedUpload } from '../hooks/useStampedUpload';
import { formatBZZ } from '../utils/bzzFormat';
import { saveUpload } from '../utils/uploadHistory';
import { getPlanTierName } from '../utils/storagePlan';
import styles from './upload.module.css';

type UploadStep = 'drop' | 'review' | 'passkey' | 'swap' | 'gas-transfer' | 'create-batch' | 'upload' | 'complete';

interface UploadState {
  files: File[];
  totalSize: number;
  step: UploadStep;
  batchId?: string;
  swarmUrl?: string;
  isSPA?: boolean; // Single Page App mode
}

const Upload: NextPage = () => {
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const [state, setState] = useState<UploadState>({
    files: [],
    totalSize: 0,
    step: 'drop',
    isSPA: false
  });

  const [currentAction, setCurrentAction] = useState('');

  // Debug mode: allow reusing existing stamp via ?debugBatchId=xxx&debugDepth=20
  const debugBatchId = typeof router.query.debugBatchId === 'string' ? router.query.debugBatchId : undefined;
  const debugDepth = typeof router.query.debugDepth === 'string' ? parseInt(router.query.debugDepth) : 20;
  const isDebugMode = !!debugBatchId;

  const { calculate, bzzPriceUSD } = useStorageCalculator();
  const { getQuote, approveDAI, executeSwap, isApproving: isSwapApproving, isSwapping } = useSwapDAIForBZZ();

  // Passkey wallet hooks
  const {
    isConfigured: hasPasskey,
    isAuthenticating,
    walletInfo: passkeyWallet,
    createPasskeyWallet,
    authenticatePasskeyWallet,
    error: passkeyError
  } = usePasskeyWallet();

  const { createBatchWithPasskey, isCreating: isBatchCreating } = usePasskeyBatchCreation();
  const { uploadWithStamper, progress: uploadProgress, error: uploadError, reset: resetUpload } = useStampedUpload();

  // Viem clients for gas transfer
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  // Convert bytes to GB
  const storageSizeGB = useMemo(() => {
    return state.totalSize / (1024 * 1024 * 1024);
  }, [state.totalSize]);

  // Calculate costs based on file size - this gives us everything we need!
  const calculations = useMemo(() => {
    if (storageSizeGB <= 0) return null;
    return calculate(storageSizeGB, state.totalSize);
  }, [storageSizeGB, state.totalSize, calculate]);

  const handleFilesDropped = (files: File[], totalSize: number) => {
    setState({
      files,
      totalSize,
      step: 'review'
    });
  };

  const handleStartDeployment = async () => {
    if (!isConnected || !address) return;

    try {
      // Step 1: Authenticate with passkey (or create if first time)
      setState(prev => ({ ...prev, step: 'passkey' }));
      setCurrentAction('Authenticating with passkey...');

      let passkeyInfo = passkeyWallet;
      if (!passkeyInfo) {
        if (hasPasskey) {
          passkeyInfo = await authenticatePasskeyWallet();
        } else {
          setCurrentAction('Creating passkey wallet...');
          passkeyInfo = await createPasskeyWallet();
        }
      }

      if (!passkeyInfo) {
        throw new Error('Failed to authenticate passkey wallet');
      }

      console.log('Passkey wallet ready:', passkeyInfo.address);

      // DEBUG MODE: Skip swap and stamp creation, go straight to upload with existing stamp
      if (isDebugMode && debugBatchId) {
        console.log('🐛 DEBUG MODE: Skipping swap/stamp, using existing stamp', { debugBatchId, debugDepth });
        setState(prev => ({ ...prev, step: 'upload', batchId: debugBatchId }));
        setCurrentAction('Uploading with debug stamp...');

        const result = await uploadWithStamper(
          state.files,
          debugBatchId,
          passkeyInfo.privateKey,
          debugDepth,
          undefined, // gatewayUrl - use default
          { isSPA: state.isSPA }
        );

        setState(prev => ({
          ...prev,
          step: 'complete',
          swarmUrl: result.url
        }));

        // Detect if this is a website upload
        const isWebsite = state.files.some(f =>
          f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
        );
        const indexDocument = state.files.find(f =>
          f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
        )?.name;
        const filename = state.files.length === 1 ? state.files[0].name : undefined;

        saveUpload({
          batchId: debugBatchId,
          reference: result.reference,
          files: state.files.map(f => ({
            name: f.name,
            size: f.size,
            type: f.type
          })),
          totalSize: state.totalSize,
          metadata: {
            isWebsite,
            indexDocument,
            filename,
            isSPA: state.isSPA
          }
        });

        return;
      }

      if (!publicClient) {
        throw new Error('Public client not available');
      }

      if (!calculations || !calculations.bzzAmount) {
        throw new Error('Calculation data not available. Please try again.');
      }

      // Check passkey wallet balances
      const [passkeyBzzBalance, passkeyXdaiBalance] = await Promise.all([
        publicClient.readContract({
          address: BZZ_ADDRESS,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [passkeyInfo.address]
        }) as Promise<bigint>,
        publicClient.getBalance({ address: passkeyInfo.address })
      ]);

      console.log('Passkey wallet balances:', {
        bzz: formatBZZ(passkeyBzzBalance),
        xdai: formatEther(passkeyXdaiBalance)
      });

      // Step 2: Swap for BZZ if needed
      const bzzNeeded = calculations.bzzAmount;
      const needsSwap = passkeyBzzBalance < bzzNeeded;
      if (needsSwap) {
        setState(prev => ({ ...prev, step: 'swap' }));
        setCurrentAction('Getting swap quote...');
        // Use the initialStampCost in DAI from calculations
        const daiAmountStr = calculations.initialStampCost.toFixed(6);
        const quote = await getQuote(daiAmountStr, true, passkeyInfo.address); // Send BZZ to passkey

        // If using wrapped DAI, check/approve. Native xDAI needs no approval.
        if (!quote.isNative) {
          setCurrentAction('Checking DAI allowance...');
          const approveHash = await approveDAI(quote.amountIn, quote.tx.to);
          if (approveHash) {
            setCurrentAction('Waiting for DAI approval confirmation...');
            await new Promise(resolve => setTimeout(resolve, 10000));
          } else {
            setCurrentAction('DAI already approved');
          }
        }

        // Execute swap (BZZ sent directly to passkey wallet)
        setCurrentAction('Swapping xDAI for BZZ (to passkey wallet)...');
        const swapHash = await executeSwap(quote);
        setCurrentAction('Waiting for swap confirmation...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        console.log('Passkey wallet has enough BZZ, skipping swap');
      }

      // Step 3: Send gas money if needed
      const gasAmount = parseEther('0.001');
      const needsGas = passkeyXdaiBalance < gasAmount;

      if (needsGas) {
        setState(prev => ({ ...prev, step: 'gas-transfer' }));
        setCurrentAction('Sending gas to passkey wallet...');

        if (!walletClient) {
          throw new Error('Wallet client not available');
        }

        const gasHash = await walletClient.sendTransaction({
          to: passkeyInfo.address,
          value: gasAmount,
        });

        setCurrentAction('Waiting for gas transfer confirmation...');
        await publicClient.waitForTransactionReceipt({ hash: gasHash });
      } else {
        console.log('Passkey wallet has enough xDAI for gas, skipping gas transfer');
      }

      // Step 6: Create batch with passkey wallet
      setState(prev => ({ ...prev, step: 'create-batch' }));

      if (!calculations.depth || !calculations.balancePerChunk) {
        throw new Error('Batch parameters not calculated. Please try again.');
      }

      setCurrentAction('Creating postage stamp with passkey wallet...');

      const { hash: createHash, batchId } = await createBatchWithPasskey({
        passkeyPrivateKey: passkeyInfo.privateKey,
        initialBalancePerChunk: calculations.balancePerChunk,
        depth: calculations.depth,
        immutable: true
      });

      console.log('Batch created:', { batchId, hash: createHash });
      setState(prev => ({ ...prev, batchId }));

      // Step 7: Upload to Swarm with client-side stamping
      setState(prev => ({ ...prev, step: 'upload' }));
      setCurrentAction('Uploading with client-side stamping...');

      // Remove 0x prefix for batch ID
      const normalizedBatchId = batchId.replace(/^0x/, '');
      const uploadResult = await uploadWithStamper(
        state.files,
        normalizedBatchId,
        passkeyInfo.privateKey,
        calculations.depth,
        undefined, // gatewayUrl - use default
        { isSPA: state.isSPA }
      );

      // Save upload record for history tracking
      const isWebsite = state.files.some(f =>
        f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
      );
      const indexDocument = state.files.find(f =>
        f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
      )?.name;

      // For single file uploads, save the filename for proper URL construction
      const isSingleFile = state.files.length === 1;
      const filename = isSingleFile ? state.files[0].name : undefined;

      saveUpload({
        batchId,
        reference: uploadResult.reference,
        files: state.files.map(f => ({
          name: f.name,
          size: f.size,
          type: f.type
        })),
        totalSize: state.totalSize,
        metadata: {
          isWebsite,
          indexDocument,
          filename,
          isSPA: state.isSPA
        }
      });

      setState(prev => ({
        ...prev,
        step: 'complete',
        swarmUrl: uploadResult.url
      }));

      // Don't auto-redirect - let user test the content first
      // They can manually navigate to reserves page if needed
    } catch (err) {
      console.error('Deployment failed:', err);
      setCurrentAction('');
    }
  };

  const handleReset = () => {
    setState({
      files: [],
      totalSize: 0,
      step: 'drop',
      isSPA: false
    });
    resetUpload();
    setCurrentAction('');
  };

  const handleRetryUpload = async () => {
    if (!state.batchId || state.files.length === 0 || !passkeyWallet || !calculations?.depth) return;

    try {
      resetUpload();
      setCurrentAction('Retrying upload to Swarm...');

      const normalizedBatchId = state.batchId.replace(/^0x/, '');

      const uploadResult = await uploadWithStamper(
        state.files,
        normalizedBatchId,
        passkeyWallet.privateKey,
        calculations.depth,
        undefined, // gatewayUrl - use default
        { isSPA: state.isSPA }
      );

      // Save upload record for history tracking
      const isWebsite = state.files.some(f =>
        f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
      );
      const indexDocument = state.files.find(f =>
        f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
      )?.name;

      // For single file uploads, save the filename for proper URL construction
      const isSingleFile = state.files.length === 1;
      const filename = isSingleFile ? state.files[0].name : undefined;

      saveUpload({
        batchId: state.batchId,
        reference: uploadResult.reference,
        files: state.files.map(f => ({
          name: f.name,
          size: f.size,
          type: f.type
        })),
        totalSize: state.totalSize,
        metadata: {
          isWebsite,
          indexDocument,
          filename,
          isSPA: state.isSPA
        }
      });

      setState(prev => ({
        ...prev,
        step: 'complete',
        swarmUrl: uploadResult.url
      }));

      // Don't auto-redirect - let user test the content first
    } catch (err) {
      console.error('Retry upload failed:', err);
      setCurrentAction('');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Smart number formatting - increases precision for smaller values
  const formatSmartNumber = (value: number, minDecimals: number = 2): string => {
    if (value === 0) return '0';
    if (value >= 1) return value.toFixed(minDecimals);
    if (value >= 0.01) return value.toFixed(4);
    if (value >= 0.0001) return value.toFixed(6);
    if (value >= 0.000001) return value.toFixed(8);
    return value.toExponential(2);
  };

  const isProcessing = isAuthenticating || isSwapApproving || isSwapping || isBatchCreating ||
    uploadProgress.phase === 'chunking' || uploadProgress.phase === 'stamping' || uploadProgress.phase === 'uploading';

  return (
    <>
      <Head>
        <title>Upload | Hostasis</title>
        <meta
          content="Drop your files and deploy to permanent Swarm storage."
          name="description"
        />
      </Head>

      <Navigation />

      <div className={styles.page}>
        {isDebugMode && (
          <div className={styles.debugBanner}>
            🐛 DEBUG MODE: Using existing stamp {debugBatchId?.substring(0, 10)}... (depth {debugDepth})
          </div>
        )}
        
        <div className={styles.hero}>
          <h1 className={styles.headline}>
            Drag &amp; drop. It&apos;s permanent.
          </h1>
          <p className={styles.subheadline}>
            Drop a folder with your project&apos;s HTML, CSS, and JS files.
            <br />
            We&apos;ll give you permanent decentralized hosting.
          </p>
        </div>

        <div className={styles.container}>
          {state.step === 'drop' && (
            <FileDropZone onFilesDropped={handleFilesDropped} />
          )}

          {state.step === 'review' && calculations && (
            <div className={styles.review}>
              <div className={styles.reviewHeader}>
                <h2>Ready to Deploy</h2>
                <p>Review your upload and costs</p>
              </div>

              <div className={styles.reviewSummary}>
                <div className={styles.reviewStat}>
                  <span className={styles.statLabel}>Files</span>
                  <span className={styles.statValue}>{state.files.length}</span>
                </div>
                <div className={styles.reviewStat}>
                  <span className={styles.statLabel}>Total Size</span>
                  <span className={styles.statValue}>{formatFileSize(state.totalSize)}</span>
                </div>
                <div className={styles.reviewStat}>
                  <span className={styles.statLabel}>Storage</span>
                  <span className={styles.statValue}>{formatSmartNumber(storageSizeGB)} GB</span>
                </div>
              </div>

              <div className={styles.reviewCosts}>
                <h3>Cost Breakdown</h3>

                {calculations.bzzAmount && (
                  <div className={styles.costLine}>
                    <span>BZZ for Stamp (7 days)</span>
                    <span>{formatSmartNumber(parseFloat(formatBZZ(calculations.bzzAmount)))} BZZ</span>
                  </div>
                )}

                <div className={styles.costLine}>
                  <span>Est. xDAI for BZZ Swap</span>
                  <span>{formatSmartNumber(calculations.initialStampCost)} xDAI</span>
                </div>

                <div className={styles.costLine}>
                  <span>Recommended Reserve</span>
                  <span>{formatSmartNumber(calculations.recommendedReserve)} xDAI</span>
                </div>

                {calculations.depth && getPlanTierName(calculations.depth) && (
                  <div className={styles.costLine}>
                    <span>Storage Plan</span>
                    <span>{getPlanTierName(calculations.depth)} (Depth {calculations.depth})</span>
                  </div>
                )}

                <div className={`${styles.costLine} ${styles.costLineTotal}`}>
                  <span>Total xDAI Needed</span>
                  <span>{formatSmartNumber(calculations.totalUpfrontCost)} xDAI</span>
                </div>

                <div className={styles.costNote}>
                  Your reserve generates yield to pay for permanent hosting.
                  No monthly fees, ever.
                </div>
              </div>

              {/* SPA Option - only show if uploading a website with index.html */}
              {state.files.some(f => 
                f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
              ) && (
                <div className={styles.spaOption}>
                  <label className={styles.spaCheckboxLabel}>
                    <input
                      type="checkbox"
                      checked={state.isSPA || false}
                      onChange={(e) => setState(prev => ({ ...prev, isSPA: e.target.checked }))}
                      className={styles.spaCheckbox}
                    />
                    <span className={styles.spaCheckboxText}>
                      Configure as a single-page app (rewrite all urls to /index.html)
                    </span>
                  </label>
                </div>
              )}

              {!isConnected ? (
                <div className={styles.connectPrompt}>
                  <p>Connect your wallet to deploy</p>
                  <ConnectButton />
                </div>
              ) : (
                <div className={styles.reviewActions}>
                  <button
                    onClick={handleStartDeployment}
                    className={styles.ctaButton}
                    disabled={isProcessing}
                  >
                    {isProcessing ? 'Processing...' : 'Deploy to Swarm'}
                  </button>
                  <button
                    onClick={handleReset}
                    className={styles.secondaryButton}
                    disabled={isProcessing}
                  >
                    Start Over
                  </button>
                </div>
              )}
            </div>
          )}

          {(state.step === 'passkey' || state.step === 'swap' || state.step === 'gas-transfer' || state.step === 'create-batch' || state.step === 'upload') && (
            <div className={styles.progress}>
              <div className={styles.progressHeader}>
                <h2>Deploying...</h2>
                <p>{currentAction || uploadProgress.message}</p>
              </div>

              <div className={styles.progressSteps}>
                <div className={`${styles.progressStep} ${state.step === 'passkey' ? styles.progressStepActive : (state.step === 'swap' || state.step === 'gas-transfer' || state.step === 'create-batch' || state.step === 'upload') ? styles.progressStepComplete : ''}`}>
                  <div className={styles.stepNumber}>1</div>
                  <div className={styles.stepLabel}>Passkey Auth</div>
                </div>
                <div className={`${styles.progressStep} ${state.step === 'swap' ? styles.progressStepActive : (state.step === 'gas-transfer' || state.step === 'create-batch' || state.step === 'upload') ? styles.progressStepComplete : ''}`}>
                  <div className={styles.stepNumber}>2</div>
                  <div className={styles.stepLabel}>Swap → Passkey</div>
                </div>
                <div className={`${styles.progressStep} ${state.step === 'gas-transfer' ? styles.progressStepActive : (state.step === 'create-batch' || state.step === 'upload') ? styles.progressStepComplete : ''}`}>
                  <div className={styles.stepNumber}>3</div>
                  <div className={styles.stepLabel}>Send Gas</div>
                </div>
                <div className={`${styles.progressStep} ${state.step === 'create-batch' ? styles.progressStepActive : state.step === 'upload' ? styles.progressStepComplete : ''}`}>
                  <div className={styles.stepNumber}>4</div>
                  <div className={styles.stepLabel}>Create Stamp</div>
                </div>
                <div className={`${styles.progressStep} ${state.step === 'upload' ? styles.progressStepActive : ''}`}>
                  <div className={styles.stepNumber}>5</div>
                  <div className={styles.stepLabel}>Upload Files</div>
                </div>
              </div>

              {uploadError && (
                <div className={styles.error}>
                  <p>Error: {uploadError.message}</p>
                  <div className={styles.errorActions}>
                    {state.step === 'upload' && state.batchId && (
                      <button onClick={handleRetryUpload} className={styles.ctaButton}>
                        Retry Upload
                      </button>
                    )}
                    <button onClick={handleReset} className={styles.secondaryButton}>
                      Start Over
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {state.step === 'complete' && (
            <div className={styles.complete}>
              <div className={styles.completeIcon}>✓</div>
              <h2>Deployed Successfully!</h2>
              <p>
                Your files are now on the Swarm network.
              </p>
              {state.swarmUrl && (
                <div className={styles.completeActions}>
                  <a href={state.swarmUrl} target="_blank" rel="noopener noreferrer" className={styles.swarmLink}>
                    View on Swarm
                  </a>

                  <div className={styles.reservePrompt}>
                    <p className={styles.reserveMessage}>
                      <strong>Almost done!</strong> Create a reserve to make your upload permanent.
                    </p>
                    <button
                      onClick={() => {
                        // Use the recommended reserve amount that was already calculated and shown to user
                        const recommendedReserve = calculations?.recommendedReserve.toFixed(2) || '0';

                        router.push(
                          `/reserves?stampId=${state.batchId}&amount=${recommendedReserve}`
                        );
                      }}
                      className={styles.createReserveButton}
                    >
                      Create Reserve
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.features}>
          <div className={styles.featureItem}>
            <h3>Put your project online</h3>
            <p>
              Drag and drop your project folder, and your project will be
              deployed to decentralized Swarm storage. Truly permanent.
            </p>
          </div>

          <div className={styles.featureItem}>
            <h3>Fund with yield</h3>
            <p>
              Your reserve deposit earns yield that automatically pays for
              storage. No subscriptions, no renewals, no monthly bills.
            </p>
          </div>

          <div className={styles.featureItem}>
            <h3>Own your hosting</h3>
            <p>
              Censorship-resistant, decentralized storage means your site
              stays online as long as the Swarm network exists.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default Upload;
