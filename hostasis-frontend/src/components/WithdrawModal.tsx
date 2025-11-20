import { useState, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { parseEther } from 'viem';
import { useWithdraw } from '../hooks/usePostageManager';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import TokenAmount from './TokenAmount';
import { getMaxAmountString } from '../utils/maxAmount';
import Modal from './Modal';

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
  const maxAmount = depositData ? getMaxAmountString(depositData.sDAIAmount) : '0';

  const handleWithdraw = async () => {
    try {
      setError('');
      const amountBigInt = parseEther(amount);

      if (depositData && amountBigInt > depositData.sDAIAmount) {
        setError('Amount exceeds deposit balance');
        return;
      }

      withdraw(BigInt(depositIndex), amountBigInt);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to withdraw';
      setError(errorMessage);
    }
  };

  const setMaxAmountValue = () => {
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

  const isLoading = isPending || isConfirming;

  return (
    <Modal title={`Cancel Reserve #${depositIndex}`} onClose={onClose}>
      <div className="modal-warning">
        <p>Warning: Withdrawing will remove funds from this reserve.</p>
      </div>

      <p className="description">
        Available: <TokenAmount value={depositData?.sDAIAmount} symbol="sDAI" />
      </p>

      <div className="hash-input-container" style={{ marginTop: '1rem', marginBottom: '0.25rem' }}>
        <input
          type="text"
          className="hash-input"
          placeholder="Amount to withdraw"
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

      {error && <p className="error-message">{error}</p>}

      {isSuccess && <p className="success-message">Withdrawal successful!</p>}

      <div className="button-group">
        <button className="view-button" onClick={onClose} disabled={isLoading} style={{ flex: 1, opacity: 0.7 }}>
          Keep Reserve
        </button>
        <button
          className="view-button view-button--danger"
          onClick={handleWithdraw}
          disabled={!amount || isLoading}
          style={{ flex: 1 }}
        >
          {isConfirming ? 'Confirming...' : isPending ? 'Withdrawing...' : 'Withdraw'}
        </button>
      </div>
    </Modal>
  );
}
