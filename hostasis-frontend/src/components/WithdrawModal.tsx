import { useState, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { parseEther } from 'viem';
import { useWithdraw } from '../hooks/usePostageManager';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import TokenAmount from './TokenAmount';
import { formatTokenAmountFull } from '../utils/formatters';

type Deposit = {
  sDAIAmount: bigint;
  principalDAI: bigint;
  stampId: string;
  depositTime: bigint;
};

export default function WithdrawModal({
  depositIndex,
  onClose,
  onWithdrawSuccess,
}: {
  depositIndex: number;
  onClose: () => void;
  onWithdrawSuccess?: () => void;
}) {
  const { address } = useAccount();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const { withdraw, isPending, isConfirming, isSuccess } = useWithdraw();

  // Get deposit details
  const { data: deposit } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: address ? [address, BigInt(depositIndex)] : undefined,
  });

  const depositData = deposit as unknown as Deposit | undefined;
  const maxAmount = depositData ? formatTokenAmountFull(depositData.sDAIAmount) : '0';

  const handleWithdraw = async () => {
    try {
      setError('');
      const amountBigInt = parseEther(amount);

      if (depositData && amountBigInt > depositData.sDAIAmount) {
        setError('Amount exceeds deposit balance');
        return;
      }

      withdraw(BigInt(depositIndex), amountBigInt);
    } catch (err: any) {
      setError(err.message || 'Failed to withdraw');
    }
  };

  const setMaxAmount = () => {
    setAmount(maxAmount);
  };

  // Close modal on success and trigger refetch
  useEffect(() => {
    if (isSuccess) {
      if (onWithdrawSuccess) {
        onWithdrawSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 2000);
    }
  }, [isSuccess, onClose, onWithdrawSuccess]);

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
        <h3 style={{ marginTop: 0 }}>Withdraw from Deposit #{depositIndex}</h3>

        <p className="description">
          Available: <TokenAmount value={depositData?.sDAIAmount} symbol="sDAI" />
        </p>

        <div className="hash-input-container" style={{ marginTop: '1rem' }}>
          <input
            type="text"
            className="hash-input"
            placeholder="Amount to withdraw"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isPending || isConfirming}
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
          <p className="success-message">Withdrawal successful!</p>
        )}

        <div className="button-group">
          <button
            className="view-button"
            onClick={handleWithdraw}
            disabled={!amount || isPending || isConfirming}
            style={{ flex: 1 }}
          >
            {isConfirming ? 'Confirming...' : isPending ? 'Withdrawing...' : 'Withdraw'}
          </button>
          <button
            className="view-button"
            onClick={onClose}
            disabled={isPending || isConfirming}
            style={{ flex: 1, opacity: 0.7 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
