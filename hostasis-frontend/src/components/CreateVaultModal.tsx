import Modal from './Modal';
import DepositForm from './DepositForm';

interface CreateVaultModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  /** Called with the new vault index and stamp ID after successful deposit */
  onSuccessWithIndex?: (vaultIndex: number, stampId: string) => void;
  initialAmount?: string;
  initialStampId?: string;
  /** Content hash (Swarm reference) to associate with the new vault */
  initialContentHash?: string;
}

export default function CreateVaultModal({
  onClose,
  onSuccess,
  onSuccessWithIndex,
  initialAmount,
  initialStampId,
  initialContentHash
}: CreateVaultModalProps) {
  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    }
    // Auto-close modal after short delay to show success message
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  const handleSuccessWithIndex = (vaultIndex: number, stampId: string) => {
    if (onSuccessWithIndex) {
      onSuccessWithIndex(vaultIndex, stampId);
    }
    // Don't auto-close when using the index callback - let parent handle it
  };

  return (
    <Modal title="Create Vault" onClose={onClose}>
      <DepositForm
        onDepositSuccess={handleSuccess}
        onDepositSuccessWithIndex={onSuccessWithIndex ? handleSuccessWithIndex : undefined}
        initialAmount={initialAmount}
        initialStampId={initialStampId}
        initialContentHash={initialContentHash}
        onCancel={onClose}
        isModal
      />
    </Modal>
  );
}
