import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import WithdrawModal from './WithdrawModal';
import UpdateStampModal from './UpdateStampModal';
import TopUpModal from './TopUpModal';
import ExportKeyModal from './ExportKeyModal';
import DepositCard from './DepositCard';
import EmptyVaultsState from './EmptyVaultsState';

import styles from './DepositsList.module.css';

interface DepositsListProps {
  onCreateClick?: () => void;
  initialAmount?: string;
}

export default function DepositsList({ onCreateClick, initialAmount }: DepositsListProps) {
  const { address } = useAccount();
  const [selectedDeposit, setSelectedDeposit] = useState<number | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showUpdateStampModal, setShowUpdateStampModal] = useState(false);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showExportKeyModal, setShowExportKeyModal] = useState(false);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  // Track active deposit status: Map<depositIndex, isActive>
  const [activeStatus, setActiveStatus] = useState<Map<number, boolean>>(new Map());

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

  // Handler for when a DepositCard reports its active status
  const handleActiveChange = useCallback((depositIndex: number, isActive: boolean) => {
    setActiveStatus(prev => {
      const next = new Map(prev);
      next.set(depositIndex, isActive);
      return next;
    });
  }, []);

  // Reset active status when count changes (e.g., after withdrawal refetch)
  useEffect(() => {
    setActiveStatus(new Map());
  }, [count, refetchTrigger]);

  // Check if all deposits have reported and none are active
  const allDepositsReported = activeStatus.size === count;
  const hasActiveDeposits = Array.from(activeStatus.values()).some(isActive => isActive);
  const showEmptyState = count === 0 || (allDepositsReported && !hasActiveDeposits);

  return (
    <>
      <div>
        {showEmptyState ? (
          onCreateClick ? (
            <EmptyVaultsState onCreateClick={onCreateClick} initialAmount={initialAmount} />
          ) : (
            <p className="description" style={{ textAlign: 'center', marginTop: '1rem' }}>
              No active vaults.
            </p>
          )
        ) : (
          <div className={styles.depositsGrid}>
            {Array.from({ length: count }, (_, i) => count - 1 - i).map((depositIndex) => (
              <DepositCard
                key={depositIndex}
                depositIndex={depositIndex}
                userAddress={address!}
                refetchTrigger={refetchTrigger}
                onActiveChange={handleActiveChange}
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
                onExportKey={() => {
                  setSelectedDeposit(depositIndex);
                  setShowExportKeyModal(true);
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

      {showExportKeyModal && selectedDeposit !== null && (
        <ExportKeyModal
          vaultIndex={selectedDeposit}
          onClose={() => {
            setShowExportKeyModal(false);
            setSelectedDeposit(null);
          }}
        />
      )}
    </>
  );
}
