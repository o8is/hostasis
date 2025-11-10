import { useState, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { useTopUp } from '../hooks/usePostageManager';
import { useSDAIBalance, useSDAIAllowance, useApproveSDAI } from '../hooks/useSDAI';
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
  const [error, setError] = useState('');

  const { topUp, isPending, isConfirming, isSuccess } = useTopUp();
  const { approve, isPending: isApproving, isConfirming: isApprovingConfirming, isSuccess: isApproved } = useApproveSDAI();
  const { data: balance } = useSDAIBalance(address);
  const { data: allowance, refetch: refetchAllowance } = useSDAIAllowance(address);

  // Get deposit details
  const { data: deposit } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: address ? [address, BigInt(depositIndex)] : undefined,
  });

  const depositData = deposit as unknown as Deposit | undefined;
  const maxAmount = balance ? formatEther(balance as bigint) : '0';

  // Check if user needs to approve
  const needsApproval = () => {
    if (!amount || allowance === undefined) return false;
    try {
      const amountBigInt = parseEther(amount);
      return (allowance as bigint) < amountBigInt;
    } catch {
      return false;
    }
  };

  const handleApprove = async () => {
    try {
      setError('');
      const amountBigInt = parseEther(amount);
      approve(amountBigInt);
    } catch (err: any) {
      setError(err.message || 'Failed to approve');
    }
  };

  const handleTopUp = async () => {
    try {
      setError('');
      const amountBigInt = parseEther(amount);

      if (balance && amountBigInt > (balance as bigint)) {
        setError('Amount exceeds balance');
        return;
      }

      topUp(BigInt(depositIndex), amountBigInt);
    } catch (err: any) {
      setError(err.message || 'Failed to top up');
    }
  };

  const setMaxAmount = () => {
    setAmount(maxAmount);
  };

  // Refetch allowance after approval
  useEffect(() => {
    if (isApproved) {
      refetchAllowance();
    }
  }, [isApproved, refetchAllowance]);

  // Close modal on success and trigger refetch
  useEffect(() => {
    if (isSuccess) {
      if (onTopUpSuccess) {
        onTopUpSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 2000);
    }
  }, [isSuccess, onClose, onTopUpSuccess]);

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
          Available: {maxAmount} sDAI
        </p>

        <div className="hash-input-container" style={{ marginTop: '1rem' }}>
          <input
            type="text"
            className="hash-input"
            placeholder="Amount to add"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isPending || isConfirming || isApproving || isApprovingConfirming}
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

        {isSuccess && (
          <p className="success-message">Top up successful!</p>
        )}

        <div className="button-group">
          {needsApproval() ? (
            <button
              className="view-button"
              onClick={handleApprove}
              disabled={!isValidAmount || isApproving || isApprovingConfirming}
              style={{ flex: 1 }}
            >
              {isApprovingConfirming ? 'Confirming...' : isApproving ? 'Approving...' : 'Approve sDAI'}
            </button>
          ) : (
            <button
              className="view-button"
              onClick={handleTopUp}
              disabled={!isValidAmount || isPending || isConfirming}
              style={{ flex: 1 }}
            >
              {isConfirming ? 'Confirming...' : isPending ? 'Topping Up...' : 'Top Up'}
            </button>
          )}
          <button
            className="view-button"
            onClick={onClose}
            disabled={isPending || isConfirming || isApproving || isApprovingConfirming}
            style={{ flex: 1, opacity: 0.7 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
