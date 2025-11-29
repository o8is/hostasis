import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount, useWalletClient, usePublicClient, useReadContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Navigation from '../components/Navigation';
import FileDropZone from '../components/FileDropZone';
import ReserveSelector, { type ReserveSelection } from '../components/ReserveSelector';
import ReserveCard from '../components/ReserveCard';
import { POSTAGE_MANAGER_ADDRESS, POSTAGE_STAMP_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import { useStorageCalculator } from '../hooks/useStorageCalculator';
import { usePasskeyWallet } from '../hooks/usePasskeyWallet';
import { useReserveWalletBatchCreation } from '../hooks/useReserveWalletBatchCreation';
import { useStampedUpload } from '../hooks/useStampedUpload';
import { useFeedService } from '../hooks/useFeedService';
import { formatBZZ } from '../utils/bzzFormat';
import { saveUpload } from '../utils/uploadHistory';
import { deriveReserveKey } from '../utils/reserveKeys';
import {
  normalizeProjectSlug,
  isValidProjectSlug,
  getRecommendedTier,
  getAllReserves,
  getReserveData,
  createReserve,
  deleteReserve,
  addProject,
  updateProject,
  RESERVE_TIERS,
  type ReserveTier,
  type ReserveData,
} from '../utils/projectStorage';
import { deriveProjectKey } from '@hostasis/swarm-stamper';
import styles from './upload.module.css';

type UploadStep = 'drop' | 'config' | 'deploying' | 'complete';

interface UploadState {
  files: File[];
  totalSize: number;
  step: UploadStep;
  // Config
  projectName: string;
  projectSlug: string;
  reserveSelection: ReserveSelection;
  isSPA: boolean;
  // Results
  batchId?: string;
  swarmUrl?: string;
  swarmReference?: string;
  manifestUrl?: string;
  reserveIndex?: number;
}

const Upload: NextPage = () => {
  const router = useRouter();
  const { isConnected, address } = useAccount();

  // Load existing reserves
  const [reserves, setReserves] = useState<ReserveData[]>([]);
  useEffect(() => {
    setReserves(getAllReserves());
  }, []);

  // For updating existing projects (via query param)
  const existingReserveId = typeof router.query.reserveId === 'string' ? parseInt(router.query.reserveId) : undefined;
  const existingProjectSlug = typeof router.query.project === 'string' ? router.query.project : undefined;

  // Get existing project data if updating
  const existingReserve = existingReserveId !== undefined ? getReserveData(existingReserveId) : undefined;
  const existingProject = existingReserve && existingProjectSlug
    ? existingReserve.projects.find(p => p.slug === existingProjectSlug)
    : undefined;
  const isUpdateMode = !!existingProject;

  // Initialize state - pre-fill if updating existing project
  const [state, setState] = useState<UploadState>({
    files: [],
    totalSize: 0,
    step: 'drop',
    projectName: '',
    projectSlug: '',
    reserveSelection: { type: 'new', tier: 'standard' },
    isSPA: false,
  });

  // Update state when we have existing project info
  useEffect(() => {
    if (isUpdateMode && existingProject && existingReserveId !== undefined) {
      // Only update if values have changed
      setState(prev => {
        const needsUpdate =
          prev.projectName !== existingProject.displayName ||
          prev.projectSlug !== existingProject.slug ||
          prev.reserveSelection.type !== 'existing' ||
          (prev.reserveSelection.type === 'existing' && prev.reserveSelection.reserveIndex !== existingReserveId);

        if (!needsUpdate) return prev;

        return {
          ...prev,
          projectName: existingProject.displayName,
          projectSlug: existingProject.slug,
          reserveSelection: { type: 'existing', reserveIndex: existingReserveId },
        };
      });
    }
  }, [isUpdateMode, existingProject?.displayName, existingProject?.slug, existingReserveId]);

  const [currentAction, setCurrentAction] = useState('');
  const [deployError, setDeployError] = useState<string | null>(null);

  // Fetch existing reserve info if updating
  const { data: existingDeposit } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: address && existingReserveId !== undefined ? [address, BigInt(existingReserveId)] : undefined,
    query: {
      enabled: !!address && existingReserveId !== undefined,
    },
  });

  const existingStampId = existingDeposit ? (existingDeposit as any).stampId : undefined;

  const { data: existingStampDepth } = useReadContract({
    address: POSTAGE_STAMP_ADDRESS,
    abi: PostageStampABI,
    functionName: 'batchDepth',
    args: existingStampId ? [existingStampId.startsWith('0x') ? existingStampId : `0x${existingStampId}`] : undefined,
    query: {
      enabled: !!existingStampId,
    },
  });

  const { calculate } = useStorageCalculator();
  const feedService = useFeedService();

  // Passkey wallet hooks
  const {
    isConfigured: hasPasskey,
    isAuthenticating,
    walletInfo: passkeyWallet,
    createPasskeyWallet,
    authenticatePasskeyWallet,
  } = usePasskeyWallet();

  const { createBatchWithReserveWallet, isCreating: isBatchCreating, currentStep } = useReserveWalletBatchCreation();
  const { uploadWithStamper, progress: uploadProgress, error: uploadError, reset: resetUpload } = useStampedUpload();

  // Get user's deposit count to derive next reserve index
  const { data: depositCount } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDepositCount',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  // Calculate recommended tier based on file size
  const recommendedTier = useMemo(() => {
    if (state.totalSize <= 0) return 'standard';
    return getRecommendedTier(state.totalSize);
  }, [state.totalSize]);

  // Update recommended tier when files change
  useEffect(() => {
    if (state.step === 'config' && state.reserveSelection.type === 'new') {
      setState(prev => ({
        ...prev,
        reserveSelection: { type: 'new', tier: recommendedTier },
      }));
    }
  }, [recommendedTier]);

  // Calculate costs based on selected tier
  const storageSizeGB = state.totalSize / (1024 * 1024 * 1024);
  const selectedTierDepth = state.reserveSelection.type === 'new'
    ? RESERVE_TIERS[state.reserveSelection.tier].depth
    : undefined;
  const calculations = useMemo(() => {
    if (storageSizeGB <= 0) return null;
    return calculate(storageSizeGB, state.totalSize, selectedTierDepth);
  }, [storageSizeGB, state.totalSize, calculate, selectedTierDepth]);

  // Validate project name
  const projectNameError = useMemo(() => {
    if (!state.projectName) return null;
    const slug = normalizeProjectSlug(state.projectName);
    if (!slug) return 'Please enter a valid project name';
    if (!isValidProjectSlug(slug)) return 'Project name must contain at least one letter or number';

    // Check for duplicate in selected reserve (skip check if updating existing project)
    if (state.reserveSelection.type === 'existing' && !isUpdateMode) {
      const reserve = getReserveData(state.reserveSelection.reserveIndex);
      if (reserve?.projects.some(p => p.slug === slug)) {
        return 'A project with this name already exists in this reserve';
      }
    }
    return null;
  }, [state.projectName, state.reserveSelection, isUpdateMode]);

  const canDeploy = state.projectName.length > 0 && !projectNameError && isConnected;

  const handleFilesDropped = (files: File[], totalSize: number) => {
    setState(prev => ({
      ...prev,
      files,
      totalSize,
      step: 'config',
      // Don't reset reserve selection if in update mode
      reserveSelection: isUpdateMode
        ? prev.reserveSelection
        : { type: 'new', tier: getRecommendedTier(totalSize) },
    }));
  };

  const handleProjectNameChange = (name: string) => {
    setState(prev => ({
      ...prev,
      projectName: name,
      projectSlug: normalizeProjectSlug(name),
    }));
  };

  const handleDeploy = async () => {
    if (!isConnected || !address || !canDeploy) return;

    setDeployError(null);
    setState(prev => ({ ...prev, step: 'deploying' }));

    try {
      // Step 1: Authenticate with passkey
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

      let reserveIndex: number;
      let stampId: string;
      let depth: number;
      let reserveKey: { privateKey: string; address: string };

      if (state.reserveSelection.type === 'new') {
        // Creating new reserve
        reserveIndex = depositCount ? Number(depositCount) : 0;
        const tier = state.reserveSelection.tier;
        depth = RESERVE_TIERS[tier].depth;

        // Calculate costs using selected tier's depth
        const tierCalc = calculate(storageSizeGB, state.totalSize, depth);
        if (!tierCalc) throw new Error('Failed to calculate costs');

        const balancePerChunk = tierCalc.balancePerChunk;

        reserveKey = deriveReserveKey(passkeyInfo.privateKey, reserveIndex);

        // Calculate total xDAI needed
        const totalXDAI = (tierCalc.initialStampCost + 0.01).toFixed(6);

        setCurrentAction('Creating postage stamp...');

        const { batchId } = await createBatchWithReserveWallet({
          reservePrivateKey: reserveKey.privateKey as `0x${string}`,
          totalXDAI,
          initialBalancePerChunk: balancePerChunk || BigInt(0),
          depth,
          immutable: false,
        });

        stampId = batchId;

        // Create reserve in local storage
        createReserve(reserveIndex, tier);

      } else {
        // Using existing reserve
        reserveIndex = state.reserveSelection.reserveIndex;
        const reserve = getReserveData(reserveIndex);
        if (!reserve) throw new Error('Reserve not found');

        // Get stamp from contract
        const deposit = await publicClient?.readContract({
          address: POSTAGE_MANAGER_ADDRESS,
          abi: PostageManagerABI,
          functionName: 'getUserDeposit',
          args: [address, BigInt(reserveIndex)],
        }) as any;

        if (!deposit?.stampId) throw new Error('No stamp found for reserve');

        stampId = deposit.stampId;
        depth = reserve.depth;
        reserveKey = deriveReserveKey(passkeyInfo.privateKey, reserveIndex);
      }

      // Step 2: Upload files
      setCurrentAction('Uploading files...');
      setState(prev => ({ ...prev, batchId: stampId, reserveIndex }));

      const normalizedStampId = stampId.replace(/^0x/, '');
      const uploadResult = await uploadWithStamper(
        state.files,
        normalizedStampId,
        reserveKey.privateKey as `0x${string}`,
        depth,
        undefined,
        { isSPA: state.isSPA }
      );

      // Step 3: Create or update project feed
      let manifestUrl: string;

      if (isUpdateMode) {
        // Update existing project
        setCurrentAction('Updating project feed...');

        await feedService.deployToProject(
          reserveIndex,
          state.projectSlug,
          stampId,
          depth,
          uploadResult.reference
        );

        // Get the existing manifest URL
        manifestUrl = existingProject!.manifestUrl;
      } else {
        // Create new project
        setCurrentAction('Creating project feed...');

        const projectKey = deriveProjectKey(reserveKey.privateKey, state.projectSlug);

        // Add project to reserve first (manifestUrl will be updated by initializeProjectFeed)
        const now = Date.now();
        const projectData = {
          slug: state.projectSlug,
          displayName: state.projectName,
          feedOwnerAddress: projectKey.address,
          manifestUrl: '', // Will be set by initializeProjectFeed
          currentVersion: uploadResult.reference,
          currentIndex: 0,
          createdAt: now,
          updatedAt: now,
        };
        addProject(reserveIndex, projectData);

        // Initialize the feed - this creates the SOC, manifest, and updates the project's manifestUrl
        manifestUrl = await feedService.initializeProjectFeed(
          reserveIndex,
          state.projectSlug,
          stampId,
          depth,
          uploadResult.reference
        );
      }

      // Save upload record
      const isWebsite = state.files.some(f =>
        f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
      );
      const indexDocument = state.files.find(f =>
        f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
      )?.name;

      saveUpload({
        batchId: stampId,
        reference: uploadResult.reference,
        files: state.files.map(f => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })),
        totalSize: state.totalSize,
        metadata: {
          isWebsite,
          indexDocument,
          isSPA: state.isSPA,
        },
      });

      setState(prev => ({
        ...prev,
        step: 'complete',
        swarmUrl: manifestUrl, // Use the feed URL (stable, updatable) instead of static upload URL
        swarmReference: uploadResult.reference,
        reserveIndex,
      }));

      // Refresh reserves list
      setReserves(getAllReserves());

    } catch (err) {
      console.error('Deployment failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Deployment failed';

      // Check if this is a stale reserve error (reserve exists in localStorage but not on-chain)
      if (errorMessage.includes('InvalidDepositIndex') && state.reserveSelection.type === 'existing') {
        const staleIndex = state.reserveSelection.reserveIndex;
        console.log(`Cleaning up stale reserve #${staleIndex}`);
        deleteReserve(staleIndex);
        setReserves(getAllReserves());
        setDeployError(`Reserve #${staleIndex} no longer exists on-chain and has been removed. Please select a different option.`);
        setState(prev => ({
          ...prev,
          step: 'config',
          reserveSelection: { type: 'new', tier: recommendedTier },
        }));
      } else {
        setDeployError(errorMessage);
        setState(prev => ({ ...prev, step: 'config' }));
      }
    }
  };

  const handleReset = () => {
    setState({
      files: [],
      totalSize: 0,
      step: 'drop',
      projectName: '',
      projectSlug: '',
      reserveSelection: { type: 'new', tier: 'standard' },
      isSPA: false,
    });
    resetUpload();
    setCurrentAction('');
    setDeployError(null);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSmartNumber = (value: number, minDecimals: number = 2): string => {
    if (value === 0) return '0';
    if (value >= 1) return value.toFixed(minDecimals);
    if (value >= 0.01) return value.toFixed(4);
    if (value >= 0.0001) return value.toFixed(6);
    return value.toExponential(2);
  };

  const isProcessing = isAuthenticating || isBatchCreating ||
    uploadProgress.phase === 'chunking' || uploadProgress.phase === 'stamping' || uploadProgress.phase === 'uploading';

  // Get tier info for display
  const selectedTierInfo = state.reserveSelection.type === 'new'
    ? RESERVE_TIERS[state.reserveSelection.tier]
    : null;

  return (
    <>
      <Head>
        <title>Upload | Hostasis</title>
        <meta content="Drop your files and deploy to permanent Swarm storage." name="description" />
      </Head>

      <Navigation />

      <div className={styles.page}>
        <div className={styles.hero}>
          <h1 className={styles.headline}>
            {isUpdateMode ? `Update ${existingProject?.displayName}` : "Drag & drop. It's online."}
          </h1>
          <p className={styles.subheadline}>
            {isUpdateMode ? (
              <>
                Drop your updated files to push a new version.
                <br />
                Your live URL will update automatically.
              </>
            ) : (
              <>
                Drop a folder with your project&apos;s HTML, CSS, and JS files.
                <br />
                We&apos;ll give you a link to share it.
              </>
            )}
          </p>
        </div>

        <div className={styles.container}>
          {state.step === 'drop' && (
            <FileDropZone onFilesDropped={handleFilesDropped} />
          )}

          {state.step === 'config' && (
            <div className={styles.review}>
              <div className={styles.reviewHeader}>
                <h2>Almost there!</h2>
                <p>{state.files.length} files · {formatFileSize(state.totalSize)}</p>
              </div>

              {/* Project Name Input */}
              <div className={styles.configSection}>
                <label className={styles.configLabel}>Project name</label>
                <input
                  type="text"
                  value={state.projectName}
                  onChange={(e) => handleProjectNameChange(e.target.value)}
                  placeholder="my-portfolio"
                  className={styles.configInput}
                  autoFocus
                  disabled={isUpdateMode}
                  readOnly={isUpdateMode}
                />
                {state.projectSlug && !projectNameError && (
                  <div className={styles.slugPreview}>
                    Slug: <code>{state.projectSlug}</code>
                  </div>
                )}
                {projectNameError && (
                  <div className={styles.inputError}>{projectNameError}</div>
                )}
              </div>

              {/* Reserve Selection */}
              <div className={styles.configSection}>
                <label className={styles.configLabel}>
                  {isUpdateMode ? 'Updating in reserve' : 'Where should this project live?'}
                </label>
                {isUpdateMode && existingReserve && existingReserveId !== undefined ? (
                  <ReserveCard
                    reserveIndex={existingReserveId}
                    tier={existingReserve.tier}
                    createdAt={existingDeposit ? Number((existingDeposit as any).depositTime) * 1000 : undefined}
                    batchId={existingStampId || ''}
                  />
                ) : (
                  <ReserveSelector
                    reserves={reserves}
                    selection={state.reserveSelection}
                    onSelectionChange={(selection) => setState(prev => ({ ...prev, reserveSelection: selection }))}
                    recommendedTier={recommendedTier}
                    disabled={isProcessing}
                  />
                )}
              </div>

              {/* Cost Summary (only for new reserves) */}
              {state.reserveSelection.type === 'new' && calculations && (
                <div className={styles.reviewCosts}>
                  <h3>Cost Estimate</h3>
                  <div className={styles.costLine}>
                    <span>Postage stamp ({selectedTierInfo?.name})</span>
                    <span>~{formatSmartNumber(calculations.initialStampCost)} xDAI</span>
                  </div>
                  <div className={styles.costLine}>
                    <span>Reserve funding (optional)</span>
                    <span>~{formatSmartNumber(calculations.recommendedReserve)} DAI</span>
                  </div>
                  <div className={styles.costNote}>
                    Stamp gets you online for ~7 days. Fund a reserve to stay online permanently via yield.
                  </div>
                </div>
              )}

              {/* SPA Option */}
              {state.files.some(f =>
                f.name.toLowerCase() === 'index.html' || f.name.toLowerCase() === 'index.htm'
              ) && (
                <div className={styles.spaOption}>
                  <label className={styles.spaCheckboxLabel}>
                    <input
                      type="checkbox"
                      checked={state.isSPA}
                      onChange={(e) => setState(prev => ({ ...prev, isSPA: e.target.checked }))}
                      className={styles.spaCheckbox}
                    />
                    <span className={styles.spaCheckboxText}>
                      Single-page app (rewrite all URLs to /index.html)
                    </span>
                  </label>
                </div>
              )}

              {deployError && (
                <div className={styles.error}>
                  <p>{deployError}</p>
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
                    onClick={handleDeploy}
                    className={styles.ctaButton}
                    disabled={!canDeploy || isProcessing}
                  >
                    {isProcessing ? (isUpdateMode ? 'Updating...' : 'Deploying...') : (isUpdateMode ? 'Update Project' : 'Deploy to Swarm')}
                  </button>
                  <button
                    onClick={handleReset}
                    className={styles.secondaryButton}
                    disabled={isProcessing}
                  >
                    {isUpdateMode ? 'Cancel' : 'Start Over'}
                  </button>
                </div>
              )}
            </div>
          )}

          {state.step === 'deploying' && (
            <div className={styles.progress}>
              <div className={styles.progressHeader}>
                <h2>{isUpdateMode ? `Updating ${state.projectName}...` : `Deploying ${state.projectName}...`}</h2>
                <p>{currentAction || uploadProgress.message}</p>
              </div>

              <div className={styles.progressSteps}>
                <div className={`${styles.progressStep} ${
                  currentAction.includes('passkey') || currentAction.includes('Creating passkey')
                    ? styles.progressStepActive
                    : currentAction ? styles.progressStepComplete : ''
                }`}>
                  <div className={styles.stepNumber}>1</div>
                  <div className={styles.stepLabel}>Auth</div>
                </div>
                <div className={`${styles.progressStep} ${
                  currentAction.includes('stamp') || currentAction.includes('Fund')
                    ? styles.progressStepActive
                    : currentAction.includes('Upload') || currentAction.includes('feed')
                      ? styles.progressStepComplete : ''
                }`}>
                  <div className={styles.stepNumber}>2</div>
                  <div className={styles.stepLabel}>Stamp</div>
                </div>
                <div className={`${styles.progressStep} ${
                  currentAction.includes('Upload') || uploadProgress.phase !== 'idle'
                    ? styles.progressStepActive
                    : currentAction.includes('feed') ? styles.progressStepComplete : ''
                }`}>
                  <div className={styles.stepNumber}>3</div>
                  <div className={styles.stepLabel}>Upload</div>
                </div>
                <div className={`${styles.progressStep} ${
                  currentAction.includes('feed') ? styles.progressStepActive : ''
                }`}>
                  <div className={styles.stepNumber}>4</div>
                  <div className={styles.stepLabel}>Feed</div>
                </div>
              </div>

              {uploadError && (
                <div className={styles.error}>
                  <p>Error: {uploadError.message}</p>
                  <button onClick={handleReset} className={styles.secondaryButton}>
                    Start Over
                  </button>
                </div>
              )}
            </div>
          )}

          {state.step === 'complete' && (
            <div className={styles.complete}>
              <div className={styles.completeIcon}>✓</div>
              <h2>{isUpdateMode ? 'Update published!' : 'Your site is live!'}</h2>

              {state.swarmUrl && (
                <div className={styles.completeActions}>
                  <a
                    href={state.swarmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.swarmLink}
                  >
                    {state.swarmUrl}
                  </a>

                  <div className={styles.actionButtons}>
                    <a
                      href={state.swarmUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.ctaButton}
                      style={{ textDecoration: 'none', display: 'inline-block' }}
                    >
                      Open Site
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(state.swarmUrl || '')}
                      className={styles.secondaryButton}
                    >
                      Copy Link
                    </button>
                  </div>

                  {/* Fund Reserve CTA */}
                  {state.reserveSelection.type === 'new' && calculations && (
                    <div className={styles.reservePrompt}>
                      <p className={styles.reserveMessage}>
                        <strong>Keep it online permanently</strong>
                        Fund your reserve to earn yield that pays for hosting forever. No monthly fees.
                      </p>
                      <button
                        onClick={() => {
                          router.push(
                            `/reserves?stampId=${state.batchId}&contentHash=${state.swarmReference}`
                          );
                        }}
                        className={styles.ctaButton}
                        style={{ width: '100%' }}
                      >
                        Fund Reserve (~{formatSmartNumber(calculations.recommendedReserve)} DAI)
                      </button>
                      <p className={styles.skipNote}>
                        Skip for now - your site stays live for ~7 days
                      </p>
                    </div>
                  )}
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
