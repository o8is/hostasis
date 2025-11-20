import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import WithdrawModal from './WithdrawModal';
import UpdateStampModal from './UpdateStampModal';
import TopUpModal from './TopUpModal';
import DepositCard from './DepositCard';

export default function DepositsList() {
  const { address } = useAccount();
  const [selectedDeposit, setSelectedDeposit] = useState<number | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showUpdateStampModal, setShowUpdateStampModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Get user deposit count
  const { data: depositCount, refetch: refetchDepositCount } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDepositCount',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  const count = depositCount ? Number(depositCount) : 0;

  return (
    <>
      <div>
        {count === 0 ? (
          <p className="description" style={{ textAlign: 'center', marginTop: '1rem' }}>
            No reserves yet.
          </p>
        ) : (
          <div className="deposits-grid">
            {Array.from({ length: count }, (_, i) => count - 1 - i).map((depositIndex) => (
              <DepositCard
                key={depositIndex}
                depositIndex={depositIndex}
                userAddress={address!}
                refetchTrigger={refetchTrigger}
                onWithdraw={() => {
                  setSelectedDeposit(depositIndex);
                  setShowWithdrawModal(true);
                }}
                onUpdateStamp={() => {
                  setSelectedDeposit(depositIndex);
                  setShowUpdateStampModal(true);
                }}
                onTopUp={() => {
                  setSelectedDeposit(depositIndex);
                  setShowTopUpModal(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showWithdrawModal && selectedDeposit !== null && (
        <WithdrawModal
          depositIndex={selectedDeposit}
          onClose={() => {
            setShowWithdrawModal(false);
            setSelectedDeposit(null);
          }}
          onWithdrawSuccess={() => {
            refetchDepositCount();
            setRefetchTrigger(prev => prev + 1);
          }}
        />
      )}

      {showUpdateStampModal && selectedDeposit !== null && (
        <UpdateStampModal
          depositIndex={selectedDeposit}
          onClose={() => {
            setShowUpdateStampModal(false);
            setSelectedDeposit(null);
          }}
          onUpdateSuccess={() => {
            refetchDepositCount();
            setRefetchTrigger(prev => prev + 1);
          }}
        />
      )}

      {showTopUpModal && selectedDeposit !== null && (
        <TopUpModal
          depositIndex={selectedDeposit}
          onClose={() => {
            setShowTopUpModal(false);
            setSelectedDeposit(null);
          }}
          onTopUpSuccess={() => {
            refetchDepositCount();
            setRefetchTrigger(prev => prev + 1);
          }}
        />
      )}
    </>
  );
}
