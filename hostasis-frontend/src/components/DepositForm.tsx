import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { parseEther, formatEther, type Hex } from 'viem';
import { useSDAIBalance, useSDAIAllowance, useApproveSDAI } from '../hooks/useSDAI';
import { useDeposit, useDepositWithPermit } from '../hooks/usePostageManager';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';

export default function DepositForm({ onDepositSuccess }: { onDepositSuccess?: () => void }) {
  const { address } = useAccount();
  const [amount, setAmount] = useState('');
  const [stampId, setStampId] = useState('');
  const [error, setError] = useState('');

  // Fetch user's sDAI balance
  const { data: balance, refetch: refetchBalance } = useSDAIBalance(address);
  const { data: allowance, refetch: refetchAllowance } = useSDAIAllowance(address);

  // Hooks for approval and deposit
  const { approve, isPending: isApproving, isConfirming: isApprovingConfirming, isSuccess: isApproved } = useApproveSDAI();
  const { deposit, isPending: isDepositing, isConfirming: isDepositingConfirming, isSuccess: isDeposited } = useDeposit();
  const { depositWithPermit, isPending: isPermitDepositing, isSigning, isConfirming: isPermitDepositingConfirming, isSuccess: isPermitDeposited } = useDepositWithPermit();

  // Prefer permit-based deposit (single transaction)
  const [usePermit, setUsePermit] = useState(true);

  const handleApprove = async () => {
    try {
      setError('');
      const amountBigInt = parseEther(amount);
      approve(amountBigInt);
    } catch (err: any) {
      setError(err.message || 'Failed to approve');
    }
  };

  const handleDeposit = async () => {
    try {
      setError('');

      // Normalize and validate stamp ID (must be 32 bytes hex)
      const normalizedId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
      if (!normalizedId.match(/^0x[a-fA-F0-9]{64}$/)) {
        setError('Invalid stamp ID. Must be 64 hex characters (with or without 0x prefix)');
        return;
      }

      const amountBigInt = parseEther(amount);

      if (usePermit) {
        // Use permit-based deposit (single transaction!)
        await depositWithPermit(amountBigInt, normalizedId as Hex);
      } else {
        // Use traditional deposit (requires prior approval)
        deposit(amountBigInt, normalizedId as Hex);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to deposit');
    }
  };

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

  // Refetch allowance after approval
  useEffect(() => {
    if (isApproved) {
      refetchAllowance();
    }
  }, [isApproved, refetchAllowance]);

  // Refetch data and notify parent after successful deposit
  useEffect(() => {
    if (isDeposited || isPermitDeposited) {
      refetchBalance();
      refetchAllowance();
      if (onDepositSuccess) {
        onDepositSuccess();
      }
      // Reset form
      setAmount('');
      setStampId('');
    }
  }, [isDeposited, isPermitDeposited, refetchBalance, refetchAllowance, onDepositSuccess]);

  const hasBalance = balance && (balance as bigint) > BigInt(0);
  const isValidAmount = amount && parseFloat(amount) > 0;

  // Normalize stamp ID - accept with or without 0x prefix
  const normalizedStampId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
  const isValidStampId = stampId && normalizedStampId.match(/^0x[a-fA-F0-9]{64}$/);

  return (
    <div className="info-box" style={{ marginTop: '2rem' }}>
      <h3 style={{ marginTop: 0 }}>Deposit sDAI</h3>

      {hasBalance ? (
        <p className="description" style={{ fontSize: '0.9rem' }}>
          Balance: {balance ? formatEther(balance as bigint) : '0'} sDAI
        </p>
      ) : null}

      <div className="hash-input-container">
        <input
          type="text"
          className="hash-input"
          placeholder="Amount (sDAI)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isApproving || isDepositing}
        />
      </div>

      <div className="hash-input-container" style={{ marginTop: '1rem' }}>
        <input
          type="text"
          className="hash-input"
          placeholder="Swarm Batch ID (0x...)"
          value={stampId}
          onChange={(e) => setStampId(e.target.value)}
          disabled={isApproving || isDepositing}
        />
      </div>

      {error && (
        <p className="error-message">{error}</p>
      )}

      {(isDeposited || isPermitDeposited) && (
        <p className="success-message">Deposit successful!</p>
      )}

      <div className="button-group">
        {usePermit ? (
          <button
            className="view-button"
            onClick={handleDeposit}
            disabled={!isValidAmount || !isValidStampId || isSigning || isPermitDepositing || isPermitDepositingConfirming}
          >
            {isSigning ? 'Sign message...' : isPermitDepositingConfirming ? 'Confirming...' : isPermitDepositing ? 'Depositing...' : 'Deposit'}
          </button>
        ) : needsApproval() ? (
          <button
            className="view-button"
            onClick={handleApprove}
            disabled={!isValidAmount || isApproving || isApprovingConfirming}
          >
            {isApprovingConfirming ? 'Confirming...' : isApproving ? 'Approving...' : 'Approve sDAI'}
          </button>
        ) : (
          <button
            className="view-button"
            onClick={handleDeposit}
            disabled={!isValidAmount || !isValidStampId || isDepositing || isDepositingConfirming}
          >
            {isDepositingConfirming ? 'Confirming...' : isDepositing ? 'Depositing...' : 'Deposit'}
          </button>
        )}
      </div>

      <div className="checkbox-container" onClick={() => setUsePermit(!usePermit)}>
        <div className="checkbox-wrapper">
          <input
            type="checkbox"
            checked={usePermit}
            onChange={(e) => setUsePermit(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className="checkbox-label">
          <span className="checkbox-label-main">Use gasless approval</span>
          <span className="checkbox-label-description">Sign once instead of 2 transactions (recommended)</span>
        </div>
      </div>

      {!hasBalance && (
        <p className="description" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
          You need sDAI to deposit. Get sDAI on Gnosis Chain first.
        </p>
      )}
    </div>
  );
}
