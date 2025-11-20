import Modal from './Modal';
import DepositForm from './DepositForm';

interface CreateReserveModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialAmount?: string;
  initialStampId?: string;
}

export default function CreateReserveModal({ onClose, onSuccess, initialAmount, initialStampId }: CreateReserveModalProps) {
  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    }
    // Auto-close modal after short delay to show success message
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  return (
    <Modal title="Create Reserve" onClose={onClose}>
      <DepositForm onDepositSuccess={handleSuccess} initialAmount={initialAmount} initialStampId={initialStampId} onCancel={onClose} isModal />
    </Modal>
  );
}
