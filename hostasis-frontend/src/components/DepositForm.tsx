import { useState, useEffect, useMemo } from 'react';
import { parseEther, type Hex } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { useTokenConversion } from '../hooks/useTokenConversion';
import { useDepositWithPermit } from '../hooks/usePostageManager';
import { useUserDepositCount } from '../hooks/useDeposits';
import { useStorageCalculator } from '../hooks/useStorageCalculator';
import { EFFECTIVE_CAPACITY_BYTES } from '../hooks/useCreatePostageBatch';
import { POSTAGE_STAMP_ADDRESS } from '../contracts/addresses';
import PostageStampABI from '../contracts/abis/PostageStamp.json';
import TokenAmount from './TokenAmount';
import TokenSelector from './TokenSelector';
import { getMaxAmountInfo } from '../utils/maxAmount';
import { ensureBatchIdPrefix } from '../utils/batchId';

interface DepositFormProps {
  onDepositSuccess?: () => void;
  /** Called with the new vault index after successful deposit */
  onDepositSuccessWithIndex?: (vaultIndex: number, stampId: string) => void;
  initialAmount?: string;
  initialStampId?: string;
  /** Content hash (Swarm reference) to associate with the new vault */
  initialContentHash?: string;
  onCancel?: () => void;
  isModal?: boolean;
}

export default function DepositForm({ 
  onDepositSuccess, 
  onDepositSuccessWithIndex,
  initialAmount, 
  initialStampId, 
  initialContentHash,
  onCancel, 
  isModal = false 
}: DepositFormProps) {
  const [amount, setAmount] = useState(initialAmount || '');
  const [stampId, setStampId] = useState(initialStampId || '');
  const [error, setError] = useState('');

  const { address } = useAccount();
  const conversion = useTokenConversion();
  const { depositWithPermit, isPending: isDepositing, isSigning, isConfirming, isSuccess: isDeposited, hash: depositHash } = useDepositWithPermit();
  const { calculate } = useStorageCalculator();

  // Track deposit count to determine new reserve index
  const { data: depositCount, refetch: refetchDepositCount } = useUserDepositCount(address);

  // Fetch batch depth from chain when stampId is provided
  const normalizedInitialStampId = initialStampId ? ensureBatchIdPrefix(initialStampId) : undefined;
  const { data: batchDepth } = useReadContract({
    address: POSTAGE_STAMP_ADDRESS as `0x${string}`,
    abi: PostageStampABI,
    functionName: 'batchDepth',
    args: normalizedInitialStampId ? [normalizedInitialStampId] : undefined,
    query: {
      enabled: !!normalizedInitialStampId && normalizedInitialStampId.match(/^0x[a-fA-F0-9]{64}$/) !== null,
    },
  });

  // Calculate recommended amount from batch depth (when no initialAmount provided)
  const calculatedRecommendedDAI = useMemo(() => {
    if (initialAmount) return null; // Use provided amount instead
    if (!batchDepth) return null;

    const depth = Number(batchDepth);
    if (depth < 17 || depth > 24) return null;

    // Get storage capacity for this depth in GB
    const capacityBytes = EFFECTIVE_CAPACITY_BYTES[depth] || (Math.pow(2, depth) * 4096);
    const capacityGB = capacityBytes / (1024 * 1024 * 1024);

    // Calculate recommended reserve using the storage calculator
    const result = calculate(capacityGB, capacityBytes, depth);
    return result?.recommendedReserve ?? null;
  }, [batchDepth, initialAmount, calculate]);

  const [depositStep, setDepositStep] = useState('');

  // Sync conversion error
  useEffect(() => {
    if (conversion.error) {
      setError(conversion.error);
    }
  }, [conversion.error]);

  // Calculate and set recommended amount
  // Priority: initialAmount (from URL) > calculatedRecommendedDAI (from batch depth)
  // All amounts are in DAI and converted to user's selected token
  useEffect(() => {
    // Determine the DAI amount to use
    const daiAmount = initialAmount
      ? parseFloat(initialAmount)
      : calculatedRecommendedDAI;

    if (daiAmount && conversion.currentToken && conversion.exchangeRate) {
      const daiAmountBigInt = parseEther(daiAmount.toString());
      const tokenAmount = conversion.daiToTokenAmount(daiAmountBigInt, conversion.currentToken);
      // Format to 2 decimal places for display
      const tokenAmountFloat = Number(tokenAmount) / 1e18;
      setAmount(tokenAmountFloat.toFixed(2));
    } else if (daiAmount && !conversion.currentToken) {
      // Token not yet detected, use DAI amount as fallback
      setAmount(daiAmount.toFixed(2));
    }
  }, [initialAmount, calculatedRecommendedDAI, conversion.currentToken, conversion.exchangeRate]);

  // Sync initial stamp ID from props (e.g., from upload page)
  useEffect(() => {
    if (initialStampId) {
      setStampId(initialStampId);
    }
  }, [initialStampId]);

  // Handle successful deposit
  useEffect(() => {
    if (isDeposited) {
      // Capture stampId before clearing
      const currentStampId = stampId;

      // Refetch deposit count to get the new vault index
      refetchDepositCount().then((result) => {
        const newCount = result.data as bigint | undefined;
        if (newCount !== undefined && onDepositSuccessWithIndex && currentStampId) {
          // New vault index is count - 1 (0-indexed)
          const newVaultIndex = Number(newCount) - 1;
          const normalizedStampId = ensureBatchIdPrefix(currentStampId);
          onDepositSuccessWithIndex(newVaultIndex, normalizedStampId);
        }
      });

      if (onDepositSuccess) {
        onDepositSuccess();
      }
      setAmount('');
      setStampId('');
      setError('');
      setDepositStep('');
      conversion.resetConversion();
    }
  }, [isDeposited, onDepositSuccess, onDepositSuccessWithIndex, conversion, refetchDepositCount]);

  // Get balance info based on detected token
  const getBalance = () => {
    if (!conversion.currentToken) return 0n;
    if (conversion.currentToken === 'SDAI') return (conversion.sdaiBalance as bigint) || 0n;
    if (conversion.currentToken === 'WRAPPED_DAI') return (conversion.daiBalance as bigint) || 0n;
    if (conversion.currentToken === 'NATIVE_XDAI') return conversion.nativeBalance || 0n;
    return 0n;
  };

  const getTokenLabel = () => {
    if (!conversion.currentToken) return 'tokens';
    if (conversion.currentToken === 'SDAI') return 'sDAI';
    if (conversion.currentToken === 'WRAPPED_DAI') return 'wxDAI';
    if (conversion.currentToken === 'NATIVE_XDAI') return 'xDAI';
    return 'tokens';
  };

  const balance = getBalance();
  const tokenLabel = getTokenLabel();
  const maxAmountInfo = getMaxAmountInfo(
    conversion.currentToken,
    conversion.nativeBalance,
    conversion.daiBalance as bigint | undefined,
    conversion.sdaiBalance as bigint | undefined
  );
  const maxAmount = maxAmountInfo.maxAmountString;

  const handleDeposit = async () => {
    try {
      setError('');

      // Normalize and validate stamp ID (must be 32 bytes hex)
      const normalizedId = ensureBatchIdPrefix(stampId);
      if (!normalizedId.match(/^0x[a-fA-F0-9]{64}$/)) {
        setError('Invalid stamp ID. Must be 64 hex characters.');
        return;
      }

      const amountBigInt = parseEther(amount);
      const token = conversion.currentToken;

      if (!token) {
        setError('You need xDAI, wxDAI, or sDAI to create a vault');
        return;
      }

      if (balance && amountBigInt > balance) {
        setError('Amount exceeds balance');
        return;
      }

      if (token === 'SDAI') {
        setDepositStep('Creating vault...');
        await depositWithPermit(amountBigInt, normalizedId as Hex);
      } else {
        await conversion.convertToSDAI(amountBigInt, token, async (sdaiAmount) => {
          setDepositStep('Creating vault...');
          await depositWithPermit(sdaiAmount, normalizedId as Hex);
        });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create vault';
      setError(errorMessage);
      setDepositStep('');
    }
  };

  const setMaxAmountValue = () => {
    setAmount(maxAmount);
  };

  // Normalize stamp ID - accept with or without 0x prefix
  const normalizedStampId = ensureBatchIdPrefix(stampId);
  const isValidStampId = stampId && normalizedStampId.match(/^0x[a-fA-F0-9]{64}$/);

  const currentStep = depositStep || conversion.currentStep;
  const isLoading = conversion.isLoading || isDepositing || isSigning || isConfirming;
  const isValidAmount = amount && parseFloat(amount) > 0;

  const formContent = (
    <>
      {!isModal && <h3 style={{ marginTop: 0 }}>Create Vault</h3>}

      <p className="description">
        Available: <TokenAmount value={balance} symbol={tokenLabel} />
      </p>

      <TokenSelector
        availableTokens={conversion.availableTokens}
        currentToken={conversion.currentToken}
        onSelectToken={conversion.setTokenOverride}
        getBalance={conversion.getBalance}
        getTokenLabel={conversion.getTokenLabel}
        disabled={isLoading}
      />

      {conversion.currentToken && conversion.currentToken !== 'SDAI' && (
        <p className="description" style={{ fontSize: '0.85rem', color: '#b0b0b0' }}>
          {conversion.currentToken === 'NATIVE_XDAI' && "We'll convert xDAI → sDAI automatically"}
          {conversion.currentToken === 'WRAPPED_DAI' && "We'll convert wxDAI → sDAI automatically"}
        </p>
      )}

      {currentStep && (
        <p className="description" style={{ fontSize: '0.9rem', color: '#4a9eff' }}>
          {currentStep}
        </p>
      )}

      <div className="hash-input-container" style={{ marginTop: '1rem', marginBottom: '0.25rem' }}>
        <input
          type="text"
          className="hash-input"
          placeholder={`Amount (${tokenLabel})`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isLoading}
        />
      </div>

      <button
        onClick={setMaxAmountValue}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#b0b0b0',
          cursor: 'pointer',
          fontSize: '0.85rem',
          padding: '0',
          marginBottom: '1rem',
          textDecoration: 'underline',
        }}
      >
        Use max amount
      </button>

      <div className="hash-input-container" style={{ marginTop: '0' }}>
        <input
          type="text"
          className="hash-input"
          placeholder="Swarm Batch ID (00...)"
          value={stampId}
          onChange={(e) => setStampId(e.target.value)}
          disabled={isLoading}
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      {isDeposited && <p className="success-message">Vault created successfully!</p>}

      {!conversion.currentToken && (
        <p className="error-message">You need xDAI, wxDAI, or sDAI to create a vault</p>
      )}

      <div className="button-group">
        {onCancel && (
          <button className="view-button" onClick={onCancel} disabled={isLoading} style={{ flex: 1, opacity: 0.7 }}>
            Cancel
          </button>
        )}
        <button
          className="view-button view-button--tertiary"
          onClick={handleDeposit}
          disabled={!isValidAmount || !isValidStampId || isLoading || !conversion.currentToken}
          style={{ flex: 1 }}
        >
          {isLoading ? currentStep || 'Processing...' : (initialContentHash ? 'Create Vault & Deploy' : 'Create Vault')}
        </button>
      </div>
    </>
  );

  if (isModal) {
    return formContent;
  }

  return (
    <div className="info-box" style={{ marginTop: '2rem' }}>
      {formContent}
    </div>
  );
}
