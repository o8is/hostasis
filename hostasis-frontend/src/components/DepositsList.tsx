import { useState, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { POSTAGE_MANAGER_ADDRESS } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import WithdrawModal from './WithdrawModal';
import UpdateStampModal from './UpdateStampModal';
import TopUpModal from './TopUpModal';
import TokenAmount from './TokenAmount';

type Deposit = {
  sDAIAmount: bigint;
  principalDAI: bigint;
  stampId: string;
  depositTime: bigint;
};

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
      <div style={{ marginTop: '2rem' }}>
        <div className="separator" />
        <h3 style={{ textAlign: 'center', marginTop: '2rem' }}>Your Reserves</h3>

        {count === 0 ? (
          <p className="description" style={{ textAlign: 'center', marginTop: '1rem' }}>
            No reserves yet. Create your first reserve above!
          </p>
        ) : (
          <div className="deposits-grid">
            {Array.from({ length: count }, (_, i) => (
              <DepositCard
                key={i}
                depositIndex={i}
                userAddress={address!}
                refetchTrigger={refetchTrigger}
                onWithdraw={() => {
                  setSelectedDeposit(i);
                  setShowWithdrawModal(true);
                }}
                onUpdateStamp={() => {
                  setSelectedDeposit(i);
                  setShowUpdateStampModal(true);
                }}
                onTopUp={() => {
                  setSelectedDeposit(i);
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

function DepositCard({
  depositIndex,
  userAddress,
  onWithdraw,
  onUpdateStamp,
  onTopUp,
  refetchTrigger,
}: {
  depositIndex: number;
  userAddress: string;
  onWithdraw: () => void;
  onUpdateStamp: () => void;
  onTopUp: () => void;
  refetchTrigger?: number;
}) {
  const { data: deposit, refetch } = useReadContract({
    address: POSTAGE_MANAGER_ADDRESS,
    abi: PostageManagerABI,
    functionName: 'getUserDeposit',
    args: [userAddress, BigInt(depositIndex)],
  });

  // Refetch when trigger changes
  useEffect(() => {
    if (refetchTrigger !== undefined && refetchTrigger > 0) {
      refetch();
    }
  }, [refetchTrigger, refetch]);

  if (!deposit) return null;

  const depositData = deposit as unknown as Deposit;
  const depositDate = new Date(Number(depositData.depositTime) * 1000);

  return (
    <div className="info-box deposit-card">
      <h4 style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Reserve #{depositIndex}</span>
        <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: '#7a7a7a' }}>
          {depositDate.toLocaleDateString()}
        </span>
      </h4>

      <div style={{ fontSize: '0.9rem', lineHeight: '1.8' }}>
        <p>
          <strong>Reserved:</strong> <TokenAmount value={depositData.principalDAI} symbol="DAI" />
        </p>
        <p style={{ wordBreak: 'break-all' }}>
          <strong>Batch ID:</strong> {depositData.stampId}
        </p>
      </div>

      <div className="button-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <button className="view-button" onClick={onTopUp}>
          Top Up
        </button>
        <button className="view-button" onClick={onWithdraw}>
          Withdraw
        </button>
        <button className="view-button" onClick={onUpdateStamp} style={{ opacity: 0.8, gridColumn: '1 / -1' }}>
          Update Stamp
        </button>
      </div>
    </div>
  );
}
