import { useState, useEffect } from 'react';
import { type Hex } from 'viem';
import { useUpdateStampId } from '../hooks/usePostageManager';
import Modal from './Modal';

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
        setError('Invalid stamp ID. Must be 64 hex characters.');
        return;
      }

      updateStampId(BigInt(depositIndex), normalizedId as Hex);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update stamp ID';
      setError(errorMessage);
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
  const isLoading = isPending || isConfirming;

  return (
    <Modal title={`Update Content for Vault #${depositIndex}`} onClose={onClose}>
      <p className="description">Update this vault to point to new content by entering a new batch ID.</p>

      <div className="hash-input-container" style={{ marginTop: '1rem' }}>
        <input
          type="text"
          className="hash-input"
          placeholder="New Batch ID (00...)"
          value={stampId}
          onChange={(e) => setStampId(e.target.value)}
          disabled={isLoading}
        />
      </div>

      <p className="description" style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: '#7a7a7a' }}>
        Must be 64 hex characters (with or without 0x prefix)
      </p>

      {error && <p className="error-message">{error}</p>}

      {isSuccess && <p className="success-message">Batch ID updated successfully!</p>}

      <div className="button-group">
        <button className="view-button" onClick={onClose} disabled={isLoading} style={{ flex: 1, opacity: 0.7 }}>
          Cancel
        </button>
        <button
          className="view-button view-button--primary"
          onClick={handleUpdate}
          disabled={!isValidStampId || isLoading}
          style={{ flex: 1 }}
        >
          {isConfirming ? 'Confirming...' : isPending ? 'Updating...' : 'Update'}
        </button>
      </div>
    </Modal>
  );
}
