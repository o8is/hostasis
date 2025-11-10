import { useState, useEffect } from 'react';
import { type Hex } from 'viem';
import { useUpdateStampId } from '../hooks/usePostageManager';

export default function UpdateStampModal({
  depositIndex,
  onClose,
  onUpdateSuccess,
}: {
  depositIndex: number;
  onClose: () => void;
  onUpdateSuccess?: () => void;
}) {
  const [stampId, setStampId] = useState('');
  const [error, setError] = useState('');

  const { updateStampId, isPending, isConfirming, isSuccess } = useUpdateStampId();

  const handleUpdate = async () => {
    try {
      setError('');

      // Normalize and validate stamp ID (must be 32 bytes hex)
      const normalizedId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
      if (!normalizedId.match(/^0x[a-fA-F0-9]{64}$/)) {
        setError('Invalid stamp ID. Must be 64 hex characters (with or without 0x prefix)');
        return;
      }

      updateStampId(BigInt(depositIndex), normalizedId as Hex);
    } catch (err: any) {
      setError(err.message || 'Failed to update stamp ID');
    }
  };

  // Close modal on success and trigger refetch
  useEffect(() => {
    if (isSuccess) {
      if (onUpdateSuccess) {
        onUpdateSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 2000);
    }
  }, [isSuccess, onClose, onUpdateSuccess]);

  const normalizedStampId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
  const isValidStampId = stampId && normalizedStampId.match(/^0x[a-fA-F0-9]{64}$/);

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
        <h3 style={{ marginTop: 0 }}>Update Stamp ID for Deposit #{depositIndex}</h3>

        <p className="description">
          Enter the new Swarm batch ID to direct future yield distributions to.
        </p>

        <div className="hash-input-container" style={{ marginTop: '1rem' }}>
          <input
            type="text"
            className="hash-input"
            placeholder="New Batch ID (0x...)"
            value={stampId}
            onChange={(e) => setStampId(e.target.value)}
            disabled={isPending || isConfirming}
          />
        </div>

        <p className="description" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
          Must be 64 hex characters (with or without 0x prefix)
        </p>

        {error && (
          <p className="error-message">{error}</p>
        )}

        {isSuccess && (
          <p className="success-message">Stamp ID updated successfully!</p>
        )}

        <div className="button-group">
          <button
            className="view-button"
            onClick={handleUpdate}
            disabled={!isValidStampId || isPending || isConfirming}
            style={{ flex: 1 }}
          >
            {isConfirming ? 'Confirming...' : isPending ? 'Updating...' : 'Update Stamp'}
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
