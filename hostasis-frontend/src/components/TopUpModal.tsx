import { useState, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { useTokenConversion } from '../hooks/useTokenConversion';
import { useTopUpWithPermit } from '../hooks/usePostageManager';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';

type Deposit = {
  sDAIAmount: bigint;
  principalDAI: bigint;
  stampId: string;
  depositTime: bigint;
};

export default function TopUpModal({
  depositIndex,
  onClose,
  onTopUpSuccess,
}: {
  depositIndex: number;
  onClose: () => void;
  onTopUpSuccess?: () => void;
}) {
  const { address } = useAccount();
  const [amount, setAmount] = useState('');
  const [topUpStep, setTopUpStep] = useState('');

  const conversion = useTokenConversion();
  const { topUpWithPermit, isPending: isTopping, isSigning, isConfirming: isTopUpConfirming, isSuccess: isTopUpSuccess } = useTopUpWithPermit();

  // Get deposit details
  const { data: deposit } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: address ? [address, BigInt(depositIndex)] : undefined,
  });

  const depositData = deposit as unknown as Deposit | undefined;

  // Determine which balance to show based on detected token
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
  const maxAmount = formatEther(balance);

  const handleTopUp = async () => {
    try {
      const amountBigInt = parseEther(amount);
      const token = conversion.currentToken;

      if (balance && amountBigInt > balance) {
        return;
      }

      if (!token) {
        return;
      }

      if (token === 'SDAI') {
        // Direct top up
        setTopUpStep('Topping up with sDAI...');
        await topUpWithPermit(BigInt(depositIndex), amountBigInt);
      } else {
        // Convert then top up
        await conversion.convertToSDAI(amountBigInt, token, async (sdaiAmount) => {
          setTopUpStep('Topping up with sDAI...');
          await topUpWithPermit(BigInt(depositIndex), sdaiAmount);
        });
      }
    } catch (err: any) {
      setTopUpStep('');
      // Error is handled by conversion hook
    }
  };

  const setMaxAmount = () => {
    setAmount(maxAmount);
  };

  // Close modal on success and trigger refetch
  useEffect(() => {
    if (isTopUpSuccess) {
      if (onTopUpSuccess) {
        onTopUpSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 2000);
      conversion.resetConversion();
      setTopUpStep('');
    }
  }, [isTopUpSuccess, onClose, onTopUpSuccess, conversion]);

  const currentStep = topUpStep || conversion.currentStep;
  const error = conversion.error;
  const isLoading = conversion.isLoading || isTopping || isSigning || isTopUpConfirming;
  const isValidAmount = amount && parseFloat(amount) > 0;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        className="info-box"
        style={{ maxWidth: '500px', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Top Up Deposit #{depositIndex}</h3>

        {depositData && (
          <p className="description">
            Current: {formatEther(depositData.sDAIAmount)} sDAI
          </p>
        )}

        <p className="description">
          Available: {maxAmount} {tokenLabel}
        </p>

        {conversion.currentToken && conversion.currentToken !== 'SDAI' && (
          <p className="description" style={{ fontSize: '0.85rem', color: '#b0b0b0' }}>
            {conversion.currentToken === 'NATIVE_XDAI' && "We'll wrap to wxDAI, convert to sDAI, then top up"}
            {conversion.currentToken === 'WRAPPED_DAI' && "We'll convert to sDAI then top up"}
          </p>
        )}

        {currentStep && (
          <p className="description" style={{ fontSize: '0.9rem', color: '#4a9eff' }}>
            {currentStep}
          </p>
        )}

        <div className="hash-input-container" style={{ marginTop: '1rem' }}>
          <input
            type="text"
            className="hash-input"
            placeholder="Amount to add"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <button
          onClick={setMaxAmount}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#b0b0b0',
            cursor: 'pointer',
            fontSize: '0.85rem',
            marginTop: '0.5rem',
            textDecoration: 'underline',
          }}
        >
          Use max amount
        </button>

        {error && (
          <p className="error-message">{error}</p>
        )}

        {isTopUpSuccess && (
          <p className="success-message">Top up successful!</p>
        )}

        {!conversion.currentToken && (
          <p className="error-message">You need xDAI, wxDAI, or sDAI to top up</p>
        )}

        <div className="button-group">
          <button
            className="view-button"
            onClick={handleTopUp}
            disabled={!isValidAmount || isLoading || !conversion.currentToken}
            style={{ flex: 1 }}
          >
            {isLoading ? (currentStep || 'Processing...') : 'Top Up'}
          </button>
          <button
            className="view-button"
            onClick={onClose}
            disabled={isLoading}
            style={{ flex: 1, opacity: 0.7 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
