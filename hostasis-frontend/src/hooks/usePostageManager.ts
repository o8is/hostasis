import { useWriteContract, useWaitForTransactionReceipt, useSignTypedData, useAccount } from 'wagmi';
import { type Hex, hexToSignature } from 'viem';
import { POSTAGE_MANAGER_ADDRESS, SDAI_ADDRESS, GNOSIS_CHAIN_ID } from '../contracts/addresses';
import PostageManagerABI from '../contracts/abis/PostageYieldManager.json';
import { useSDAINonce } from './useSDAI';
import { useState, useEffect } from 'react';

export function useDeposit() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deposit = (sDAIAmount: bigint, stampId: Hex) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'deposit',
      args: [sDAIAmount, stampId],
    });
  };

  return {
    deposit,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const withdraw = (depositIndex: bigint, sDAIAmount: bigint) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'withdraw',
      args: [depositIndex, sDAIAmount],
    });
  };

  return {
    withdraw,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useUpdateStampId() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const updateStampId = (depositIndex: bigint, newStampId: Hex) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'updateStampId',
      args: [depositIndex, newStampId],
    });
  };

  return {
    updateStampId,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useTopUp() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const topUp = (depositIndex: bigint, sDAIAmount: bigint) => {
    writeContract({
      address: POSTAGE_MANAGER_ADDRESS,
      abi: PostageManagerABI,
      functionName: 'topUp',
      args: [depositIndex, sDAIAmount],
    });
  };

  return {
    topUp,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useDepositWithPermit() {
  const { address } = useAccount();
  const { data: nonce } = useSDAINonce(address);
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [isSigning, setIsSigning] = useState(false);

  const depositWithPermit = async (sDAIAmount: bigint, stampId: Hex) => {
    if (!address || nonce === undefined) {
      throw new Error('Wallet not connected or nonce not loaded');
    }

    try {
      setIsSigning(true);

      // Set deadline to 20 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Sign the permit message
      const signature = await signTypedDataAsync({
        domain: {
          name: 'Savings xDAI',
          version: '1',
          chainId: GNOSIS_CHAIN_ID,
          verifyingContract: SDAI_ADDRESS,
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: address,
          spender: POSTAGE_MANAGER_ADDRESS,
          value: sDAIAmount,
          nonce: nonce as bigint,
          deadline,
        },
      });

      setIsSigning(false);

      // Split signature into v, r, s
      const { v, r, s } = hexToSignature(signature);

      // Execute depositWithPermit
      writeContract({
        address: POSTAGE_MANAGER_ADDRESS,
        abi: PostageManagerABI,
        functionName: 'depositWithPermit',
        args: [sDAIAmount, stampId, deadline, v, r, s],
      });
    } catch (err) {
      setIsSigning(false);
      throw err;
    }
  };

  return {
    depositWithPermit,
    hash,
    isPending,
    isSigning,
    isConfirming,
    isSuccess,
    error,
  };
}

export function useTopUpWithPermit() {
  const { address } = useAccount();
  const { data: nonce } = useSDAINonce(address);
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [isSigning, setIsSigning] = useState(false);

  const topUpWithPermit = async (depositIndex: bigint, sDAIAmount: bigint) => {
    if (!address || nonce === undefined) {
      throw new Error('Wallet not connected or nonce not loaded');
    }

    try {
      setIsSigning(true);

      // Set deadline to 20 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Sign the permit message
      const signature = await signTypedDataAsync({
        domain: {
          name: 'Savings xDAI',
          version: '1',
          chainId: GNOSIS_CHAIN_ID,
          verifyingContract: SDAI_ADDRESS,
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: address,
          spender: POSTAGE_MANAGER_ADDRESS,
          value: sDAIAmount,
          nonce: nonce as bigint,
          deadline,
        },
      });

      setIsSigning(false);

      // Split signature into v, r, s
      const { v, r, s } = hexToSignature(signature);

      // Execute topUpWithPermit
      writeContract({
        address: POSTAGE_MANAGER_ADDRESS,
        abi: PostageManagerABI,
        functionName: 'topUpWithPermit',
        args: [depositIndex, sDAIAmount, deadline, v, r, s],
      });
    } catch (err) {
      setIsSigning(false);
      throw err;
    }
  };

  return {
    topUpWithPermit,
    hash,
    isPending,
    isSigning,
    isConfirming,
    isSuccess,
    error,
  };
}
