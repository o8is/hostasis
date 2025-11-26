import Modal from './Modal';
import DepositForm from './DepositForm';

interface CreateReserveModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  /** Called with the new reserve index and stamp ID after successful deposit */
  onSuccessWithIndex?: (reserveIndex: number, stampId: string) => void;
  initialAmount?: string;
  initialStampId?: string;
  /** Content hash (Swarm reference) to associate with the new reserve */
  initialContentHash?: string;
}

export default function CreateReserveModal({ 
  onClose, 
  onSuccess, 
  onSuccessWithIndex,
  initialAmount, 
  initialStampId,
  initialContentHash 
}: CreateReserveModalProps) {
  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    }
    // Auto-close modal after short delay to show success message
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  const handleSuccessWithIndex = (reserveIndex: number, stampId: string) => {
    if (onSuccessWithIndex) {
      onSuccessWithIndex(reserveIndex, stampId);
    }
    // Don't auto-close when using the index callback - let parent handle it
  };

  return (
    <Modal title="Create Reserve" onClose={onClose}>
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
