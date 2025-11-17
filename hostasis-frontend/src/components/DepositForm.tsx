import { useState, useEffect } from 'react';
import { parseEther, formatUnits, type Hex } from 'viem';
import { useChainId } from 'wagmi';
import { gnosis } from 'wagmi/chains';
import { useTokenConversion } from '../hooks/useTokenConversion';
import { useDepositWithPermit } from '../hooks/usePostageManager';
import { useEnsoRoute, SUPPORTED_SOURCE_CHAINS } from '../hooks/useEnsoRoute';
import TokenAmount from './TokenAmount';
import TokenSelector from './TokenSelector';
import { getMaxAmountString } from '../utils/maxAmount';

interface DepositFormProps {
  onDepositSuccess?: () => void;
  initialAmount?: string;
  onCancel?: () => void;
  isModal?: boolean;
}

export default function DepositForm({ onDepositSuccess, initialAmount, onCancel, isModal = false }: DepositFormProps) {
  const [amount, setAmount] = useState(initialAmount || '');
  const [stampId, setStampId] = useState('');
  const [error, setError] = useState('');

  const chainId = useChainId();
  const isOnGnosis = chainId === gnosis.id;
  const currentChain = SUPPORTED_SOURCE_CHAINS.find(c => c.id === chainId);

  const conversion = useTokenConversion();
  const { depositWithPermit, isPending: isDepositing, isSigning, isConfirming, isSuccess: isDeposited } = useDepositWithPermit();
  const ensoRoute = useEnsoRoute();

  const [depositStep, setDepositStep] = useState('');

  // Sync conversion error
  useEffect(() => {
    if (conversion.error) {
      setError(conversion.error);
    }
  }, [conversion.error]);

  // Sync initial amount from props (e.g., from query string)
  useEffect(() => {
    if (initialAmount) {
      setAmount(initialAmount);
    }
  }, [initialAmount]);

  // Handle successful deposit
  useEffect(() => {
    if (isDeposited) {
      if (onDepositSuccess) {
        onDepositSuccess();
      }
      setAmount('');
      setStampId('');
      setError('');
      setDepositStep('');
      conversion.resetConversion();
    }
  }, [isDeposited, onDepositSuccess, conversion]);

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
  const maxAmount = getMaxAmountString(balance);

  const handleDeposit = async () => {
    try {
      setError('');

      // Normalize and validate stamp ID (must be 32 bytes hex)
      const normalizedId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
      if (!normalizedId.match(/^0x[a-fA-F0-9]{64}$/)) {
        setError('Invalid stamp ID. Must be 64 hex characters.');
        return;
      }

      const amountBigInt = parseEther(amount);
      const token = conversion.currentToken;

      if (!token) {
        setError('You need xDAI, wxDAI, or sDAI to create a reserve');
        return;
      }

      if (balance && amountBigInt > balance) {
        setError('Amount exceeds balance');
        return;
      }

      if (token === 'SDAI') {
        setDepositStep('Creating reserve...');
        await depositWithPermit(amountBigInt, normalizedId as Hex);
      } else {
        await conversion.convertToSDAI(amountBigInt, token, async (sdaiAmount) => {
          setDepositStep('Creating reserve...');
          await depositWithPermit(sdaiAmount, normalizedId as Hex);
        });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create reserve';
      setError(errorMessage);
      setDepositStep('');
    }
  };

  const setMaxAmountValue = () => {
    setAmount(maxAmount);
  };

  // Normalize stamp ID - accept with or without 0x prefix
  const normalizedStampId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
  const isValidStampId = stampId && normalizedStampId.match(/^0x[a-fA-F0-9]{64}$/);

  const currentStep = depositStep || conversion.currentStep;
  const isLoading = conversion.isLoading || isDepositing || isSigning || isConfirming || ensoRoute.isLoading || ensoRoute.isPending || ensoRoute.isConfirming;
  const isValidAmount = amount && parseFloat(amount) > 0;

  // Cross-chain deposit flow
  const renderCrossChainForm = () => (
    <>
      {!isModal && <h3 style={{ marginTop: 0 }}>Create Reserve</h3>}

      <div className="cross-chain-notice">
        <span className="chain-badge">{currentChain?.name || 'Unknown Chain'}</span>
        <p>
          You&apos;re on {currentChain?.name}. We&apos;ll bridge and convert your tokens to sDAI on Gnosis automatically.
        </p>
      </div>

      {ensoRoute.sourceTokenBalance && (
        <p className="description">
          Available: {formatUnits(ensoRoute.sourceTokenBalance, ensoRoute.sourceToken === 'USDC' || ensoRoute.sourceToken === 'USDT' ? 6 : 18)} {ensoRoute.sourceToken}
        </p>
      )}

      <div className="hash-input-container" style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
        <input
          type="text"
          className="hash-input"
          placeholder="Reserve amount (DAI)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isLoading}
        />
      </div>
      <p className="description" style={{ fontSize: '0.8rem', color: '#7a7a7a', marginBottom: '1rem' }}>
        Enter how much DAI you want in your reserve
      </p>

      {isValidAmount && !ensoRoute.routeData && !ensoRoute.isLoading && (
        <button
          className="view-button"
          onClick={() => ensoRoute.getRoute(amount)}
          style={{ marginBottom: '1rem' }}
        >
          Get Quote
        </button>
      )}

      {ensoRoute.isLoading && (
        <p className="description" style={{ fontSize: '0.9rem', color: '#4a9eff' }}>
          Finding best route...
        </p>
      )}

      {ensoRoute.routeData && ensoRoute.estimatedSourceAmount && (
        <div className="route-estimate">
          <div className="estimate-row">
            <span>You pay</span>
            <span className="estimate-value">{ensoRoute.estimatedSourceAmount} {ensoRoute.sourceToken}</span>
          </div>
          <div className="estimate-row">
            <span>Bridge + swap fees</span>
            <span className="estimate-value">~{ensoRoute.estimatedFees} {ensoRoute.sourceToken}</span>
          </div>
          <div className="estimate-row highlight">
            <span>Reserve on Gnosis</span>
            <span className="estimate-value">~{amount} sDAI</span>
          </div>
        </div>
      )}

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

      {(error || ensoRoute.error) && <p className="error-message">{error || ensoRoute.error}</p>}

      {ensoRoute.isSuccess && <p className="success-message">Cross-chain deposit initiated! Funds will arrive on Gnosis shortly.</p>}

      <div className="button-group">
        {onCancel && (
          <button className="view-button" onClick={onCancel} disabled={isLoading} style={{ flex: 1, opacity: 0.7 }}>
            Cancel
          </button>
        )}
        <button
          className="view-button view-button--tertiary"
          onClick={() => ensoRoute.executeRoute()}
          disabled={!isValidAmount || !isValidStampId || isLoading || !ensoRoute.routeData}
          style={{ flex: 1 }}
        >
          {ensoRoute.isPending ? 'Confirm in wallet...' : ensoRoute.isConfirming ? 'Processing...' : `Deposit ${ensoRoute.estimatedSourceAmount || ''} ${ensoRoute.sourceToken}`}
        </button>
      </div>

      <p className="description" style={{ fontSize: '0.75rem', color: '#7a7a7a', marginTop: '0.5rem', textAlign: 'center' }}>
        Powered by Enso
      </p>
    </>
  );

  // Standard Gnosis deposit flow
  const renderGnosisForm = () => (
    <>
      {!isModal && <h3 style={{ marginTop: 0 }}>Create Reserve</h3>}

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

      {isDeposited && <p className="success-message">Reserve created successfully!</p>}

      {!conversion.currentToken && (
        <p className="error-message">You need xDAI, wxDAI, or sDAI to create a reserve</p>
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
          {isLoading ? currentStep || 'Processing...' : 'Create Reserve'}
        </button>
      </div>
    </>
  );

  const formContent = isOnGnosis ? renderGnosisForm() : renderCrossChainForm();

  if (isModal) {
    return formContent;
  }

  return (
    <div className="info-box" style={{ marginTop: '2rem' }}>
      {formContent}
    </div>
  );
}
