import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount, useWalletClient, usePublicClient, useReadContract } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import Navigation from '../components/Navigation';
import FileDropZone from '../components/FileDropZone';
import VaultSelector, { type VaultSelection } from '../components/VaultSelector';
import VaultCard from '../components/VaultCard';
import { CopyDropdownButton, type CopyOption } from '../components/CopyDropdownButton';
import { POSTAGE_MANAGER_ADDRESS, POSTAGE_STAMP_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import { useStorageCalculator } from '../hooks/useStorageCalculator';
import { usePasskeyWallet } from '../hooks/usePasskeyWallet';
import { useVaultBatchCreation } from '../hooks/useVaultBatchCreation';
import { useStampedUpload } from '../hooks/useStampedUpload';
import { useFeedService } from '../hooks/useFeedService';
import { formatBZZ } from '../utils/bzzFormat';
import { saveUpload } from '../utils/uploadHistory';
import { deriveVaultKey } from '../utils/vaultKeys';
import {
  normalizeProjectSlug,
  isValidProjectSlug,
  getRecommendedTier,
  getAllVaults,
  getVaultData,
  createVault,
  deleteVault,
  addProject,
  updateProject,
  VAULT_TIERS,
  type VaultTier,
  type VaultData,
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
  vaultSelection: VaultSelection;
  isSPA: boolean;
  // Results
  batchId?: string;
  swarmUrl?: string;
  swarmReference?: string;
  manifestUrl?: string;
  vaultIndex?: number;
}

const Upload: NextPage = () => {
  const router = useRouter();
  const { isConnected, address } = useAccount();

  // Load existing vaults
  const [vaults, setVaults] = useState<VaultData[]>([]);
  useEffect(() => {
    setVaults(getAllVaults());
  }, []);

  // For updating existing projects (via query param)
  const existingVaultId = typeof router.query.vaultId === 'string' ? parseInt(router.query.vaultId) : undefined;
  const existingProjectSlug = typeof router.query.project === 'string' ? router.query.project : undefined;

  // Get existing project data if updating
  const existingVault = existingVaultId !== undefined ? getVaultData(existingVaultId) : undefined;
  const existingProject = existingVault && existingProjectSlug
    ? existingVault.projects.find(p => p.slug === existingProjectSlug)
    : undefined;
  const isUpdateMode = !!existingProject;

  // Initialize state - pre-fill if updating existing project
  const [state, setState] = useState<UploadState>({
    files: [],
    totalSize: 0,
    step: 'drop',
    projectName: '',
    projectSlug: '',
    vaultSelection: { type: 'new', tier: 'standard' },
    isSPA: false,
  });

  // Update state when we have existing project info
  useEffect(() => {
    if (isUpdateMode && existingProject && existingVaultId !== undefined) {
      // Only update if values have changed
      setState(prev => {
        const needsUpdate =
          prev.projectName !== existingProject.displayName ||
          prev.projectSlug !== existingProject.slug ||
          prev.vaultSelection.type !== 'existing' ||
          (prev.vaultSelection.type === 'existing' && prev.vaultSelection.vaultIndex !== existingVaultId);

        if (!needsUpdate) return prev;

        return {
          ...prev,
          projectName: existingProject.displayName,
          projectSlug: existingProject.slug,
          vaultSelection: { type: 'existing', vaultIndex: existingVaultId },
        };
      });
    }
  }, [isUpdateMode, existingProject?.displayName, existingProject?.slug, existingVaultId]);

  const [currentAction, setCurrentAction] = useState('');
  const [deployError, setDeployError] = useState<string | null>(null);

  // Fetch existing vault info if updating
  const { data: existingDeposit } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: address && existingVaultId !== undefined ? [address, BigInt(existingVaultId)] : undefined,
    query: {
      enabled: !!address && existingVaultId !== undefined,
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

  const { createBatchWithVaultWallet, isCreating: isBatchCreating, currentStep } = useVaultBatchCreation();
  const { uploadWithStamper, progress: uploadProgress, error: uploadError, reset: resetUpload } = useStampedUpload();

  // Get user's deposit count to derive next vault index
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
    if (state.step === 'config' && state.vaultSelection.type === 'new') {
      setState(prev => ({
        ...prev,
        vaultSelection: { type: 'new', tier: recommendedTier },
      }));
    }
  }, [recommendedTier]);

  // Calculate costs based on selected tier
  const storageSizeGB = state.totalSize / (1024 * 1024 * 1024);
  const selectedTierDepth = state.vaultSelection.type === 'new'
    ? VAULT_TIERS[state.vaultSelection.tier].depth
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

    // Check for duplicate in selected vault (skip check if updating existing project)
    if (state.vaultSelection.type === 'existing' && !isUpdateMode) {
      const vault = getVaultData(state.vaultSelection.vaultIndex);
      if (vault?.projects.some(p => p.slug === slug)) {
        return 'A project with this name already exists in this vault';
      }
    }
    return null;
  }, [state.projectName, state.vaultSelection, isUpdateMode]);

  const canDeploy = state.projectName.length > 0 && !projectNameError && isConnected;

  const handleFilesDropped = (files: File[], totalSize: number) => {
    setState(prev => ({
      ...prev,
      files,
      totalSize,
      step: 'config',
      // Don't reset vault selection if in update mode
      vaultSelection: isUpdateMode
        ? prev.vaultSelection
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

      let vaultIndex: number;
      let stampId: string;
      let depth: number;
      let vaultKey: { privateKey: string; address: string };

      if (state.vaultSelection.type === 'new') {
        // Creating new vault
        vaultIndex = depositCount ? Number(depositCount) : 0;
        const tier = state.vaultSelection.tier;
        depth = VAULT_TIERS[tier].depth;

        // Calculate costs using selected tier's depth
        const tierCalc = calculate(storageSizeGB, state.totalSize, depth);
        if (!tierCalc) throw new Error('Failed to calculate costs');

        const balancePerChunk = tierCalc.balancePerChunk;

        vaultKey = deriveVaultKey(passkeyInfo.privateKey, vaultIndex);

        // Calculate total xDAI needed (stamp cost + gas reserve for swap/approve/createBatch)
        const totalXDAI = (tierCalc.initialStampCost + 0.02).toFixed(6);

        setCurrentAction('Creating postage stamp...');

        const { batchId } = await createBatchWithVaultWallet({
          vaultPrivateKey: vaultKey.privateKey as `0x${string}`,
          totalXDAI,
          initialBalancePerChunk: balancePerChunk || BigInt(0),
          depth,
          immutable: false,
        });

        stampId = batchId;

        // Create vault in local storage
        createVault(vaultIndex, tier);

      } else {
        // Using existing vault
        vaultIndex = state.vaultSelection.vaultIndex;
        const vault = getVaultData(vaultIndex);
        if (!vault) throw new Error('Vault not found');

        // Get stamp from contract
        const deposit = await publicClient?.readContract({
          address: POSTAGE_MANAGER_ADDRESS,
          abi: PostageManagerABI,
          functionName: 'getUserDeposit',
          args: [address, BigInt(vaultIndex)],
        }) as any;

        if (!deposit?.stampId) throw new Error('No stamp found for vault');

        stampId = deposit.stampId;
        depth = vault.depth;
        vaultKey = deriveVaultKey(passkeyInfo.privateKey, vaultIndex);
      }

      // Step 2: Upload files
      setCurrentAction('Uploading files...');
      setState(prev => ({ ...prev, batchId: stampId, vaultIndex }));

      const normalizedStampId = stampId.replace(/^0x/, '');
      const uploadResult = await uploadWithStamper(
        state.files,
        normalizedStampId,
        vaultKey.privateKey as `0x${string}`,
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
          vaultIndex,
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

        const projectKey = deriveProjectKey(vaultKey.privateKey, state.projectSlug);

        // Add project to vault first (manifestUrl will be updated by initializeProjectFeed)
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
        addProject(vaultIndex, projectData);

        // Initialize the feed - this creates the SOC, manifest, and updates the project's manifestUrl
        manifestUrl = await feedService.initializeProjectFeed(
          vaultIndex,
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
        vaultIndex,
      }));

      // Refresh vaults list
      setVaults(getAllVaults());

    } catch (err) {
      console.error('Deployment failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Deployment failed';

      // Check if this is a stale vault error (vault exists in localStorage but not on-chain)
      if (errorMessage.includes('InvalidDepositIndex') && state.vaultSelection.type === 'existing') {
        const staleIndex = state.vaultSelection.vaultIndex;
        console.log(`Cleaning up stale vault #${staleIndex}`);
        deleteVault(staleIndex);
        setVaults(getAllVaults());
        setDeployError(`Vault #${staleIndex} no longer exists on-chain and has been removed. Please select a different option.`);
        setState(prev => ({
          ...prev,
          step: 'config',
          vaultSelection: { type: 'new', tier: recommendedTier },
        }));
      } else {
        setDeployError(errorMessage);
        setState(prev => ({ ...prev, step: 'config' }));
      }
    }
  };

  const handleReset = (preserveContext = false) => {
    setState(prev => {
      // Determine vault selection for next deploy
      let nextVaultSelection: VaultSelection = { type: 'new', tier: 'standard' };

      if (preserveContext && prev.vaultIndex !== undefined) {
        // Use the vault from the just-completed deploy (works for both new and existing vaults)
        nextVaultSelection = { type: 'existing', vaultIndex: prev.vaultIndex };
      }

      return {
        files: [],
        totalSize: 0,
        step: 'drop',
        // Keep project name/slug if preserving context (for repeated updates)
        projectName: preserveContext ? prev.projectName : '',
        projectSlug: preserveContext ? prev.projectSlug : '',
        vaultSelection: nextVaultSelection,
        isSPA: false,
      };
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
  const selectedTierInfo = state.vaultSelection.type === 'new'
    ? VAULT_TIERS[state.vaultSelection.tier]
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

              {/* Vault Selection */}
              <div className={styles.configSection}>
                <label className={styles.configLabel}>
                  {isUpdateMode ? 'Updating in vault' : 'Where should this project live?'}
                </label>
                {isUpdateMode && existingVault && existingVaultId !== undefined ? (
                  <VaultCard
                    vaultIndex={existingVaultId}
                    tier={existingVault.tier}
                    createdAt={existingDeposit ? Number((existingDeposit as any).depositTime) * 1000 : undefined}
                    batchId={existingStampId || ''}
                  />
                ) : (
                  <VaultSelector
                    vaults={vaults}
                    selection={state.vaultSelection}
                    onSelectionChange={(selection) => setState(prev => ({ ...prev, vaultSelection: selection }))}
                    recommendedTier={recommendedTier}
                    disabled={isProcessing}
                  />
                )}
              </div>

              {/* Cost Summary (only for new vaults) */}
              {state.vaultSelection.type === 'new' && calculations && (
                <div className={styles.reviewCosts}>
                  <h3>Cost Estimate</h3>
                  <div className={styles.costLine}>
                    <span>Postage stamp ({selectedTierInfo?.name})</span>
                    <span>~{formatSmartNumber(calculations.initialStampCost)} xDAI</span>
                  </div>
                  <div className={styles.costLine}>
                    <span>Vault funding (optional)</span>
                    <span>~{formatSmartNumber(calculations.recommendedReserve)} DAI</span>
                  </div>
                  <div className={styles.costNote}>
                    Stamp gets you online for ~7 days. Fund a vault to stay online permanently via yield.
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
                  <button onClick={() => handleReset()} className={styles.secondaryButton}>
                    Start Over
                  </button>
                </div>
              )}
            </div>
          )}

          {state.step === 'complete' && (
            <div className={styles.complete}>
              <div className={styles.completeIcon}>✓</div>
              <h2>{isUpdateMode ? 'Update published!' : 'Deploy successful!'}</h2>

              {state.swarmUrl && (() => {
                const copyOptions: CopyOption[] = [
                  {
                    label: 'Live URL',
                    value: state.swarmUrl,
                    description: 'Full URL with gateway'
                  }
                ];

                if (state.swarmReference) {
                  copyOptions.push({
                    label: 'Swarm Reference',
                    value: state.swarmReference,
                    description: 'Content hash'
                  });
                }

                return (
                  <div className={styles.completeCard}>
                    {/* Project Header */}
                    <div className={styles.projectHeader}>
                      <div className={styles.projectTitle}>
                        <span className={styles.projectName}>{state.projectName}</span>
                        {state.vaultIndex !== undefined && (
                          <span className={styles.vaultLink}>
                            Vault #{state.vaultIndex}
                          </span>
                        )}
                      </div>
                      <a
                        href={state.swarmUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.viewSiteLink}
                      >
                        View Site ↗
                      </a>
                    </div>

                    {/* URL Display */}
                    <div className={styles.urlDisplay}>
                      <a
                        href={state.swarmUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.urlLink}
                      >
                        {state.swarmUrl}
                      </a>
                      <CopyDropdownButton options={copyOptions} size="small" />
                    </div>

                    {/* Main Actions */}
                    <div className={styles.completeActions}>
                      {state.vaultSelection.type === 'existing' && state.vaultIndex !== undefined ? (
                        <>
                          <button
                            onClick={() => router.push('/vaults')}
                            className={styles.ctaButton}
                          >
                            Back to Vaults
                          </button>
                          <button
                            onClick={() => handleReset(true)}
                            className={styles.secondaryButton}
                          >
                            Deploy Another
                          </button>
                        </>
                      ) : (
                        /* Fund Vault CTA for new batch */
                        calculations && (
                          <>
                            <button
                              onClick={() => {
                                router.push(
                                  `/vaults?stampId=${state.batchId}&contentHash=${state.swarmReference}`
                                );
                              }}
                              className={styles.ctaButton}
                            >
                              Fund Vault (~{formatSmartNumber(calculations.recommendedReserve)} DAI)
                            </button>
                            <p className={styles.fundNote}>
                              Keep it online permanently with yield-generating vaults
                            </p>
                            <button
                              onClick={() => handleReset(true)}
                              className={styles.secondaryButton}
                            >
                              Deploy Another
                            </button>
                          </>
                        )
                      )}
                    </div>
                  </div>
                );
              })()}
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
              Your vault deposit earns yield that automatically pays for
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
