import { useState, useEffect } from 'react';
import { parseEther, type Hex } from 'viem';
import { useTokenConversion } from '../hooks/useTokenConversion';
import { useDepositWithPermit } from '../hooks/usePostageManager';
import TokenAmount from './TokenAmount';
import { formatTokenAmount } from '../utils/formatters';

export default function DepositForm({ onDepositSuccess }: { onDepositSuccess?: () => void }) {
  const [amount, setAmount] = useState('');
  const [stampId, setStampId] = useState('');
  const [error, setError] = useState('');

  const conversion = useTokenConversion();
  const { depositWithPermit, isPending: isDepositing, isSigning, isConfirming, isSuccess: isDeposited } = useDepositWithPermit();

  const [depositStep, setDepositStep] = useState('');

  // Determine strategy based on detected token
  const strategy = !conversion.currentToken ? 'NEED_TOKENS'
    : conversion.currentToken === 'SDAI' ? 'USE_SDAI'
    : conversion.currentToken === 'WRAPPED_DAI' ? 'CONVERT_DAI'
    : 'WRAP_XDAI';

  // Sync conversion error
  useEffect(() => {
    if (conversion.error) {
      setError(conversion.error);
    }
  }, [conversion.error]);

  // Handle successful deposit
  useEffect(() => {
    if (isDeposited) {
      if (onDepositSuccess) {
        onDepositSuccess();
      }
      setAmount('');
      setStampId('');
      setError('');
      setDepositStep('');
      conversion.resetConversion();
    }
  }, [isDeposited, onDepositSuccess, conversion]);

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
      const token = conversion.currentToken;

      if (!token) {
        setError('You need xDAI, wxDAI, or sDAI to create a deposit');
        return;
      }

      if (token === 'SDAI') {
        // Direct deposit
        setDepositStep('Depositing sDAI...');
        await depositWithPermit(amountBigInt, normalizedId as Hex);
      } else {
        // Convert then deposit
        await conversion.convertToSDAI(amountBigInt, token, async (sdaiAmount) => {
          setDepositStep('Depositing sDAI...');
          await depositWithPermit(sdaiAmount, normalizedId as Hex);
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to deposit');
      setDepositStep('');
    }
  };

  // Determine balances and token info based on strategy
  const getBalanceInfo = () => {
    if (strategy === 'USE_SDAI') {
      return {
        hasBalance: conversion.sdaiBalance && (conversion.sdaiBalance as bigint) > 0n,
        balance: conversion.sdaiBalance,
        tokenSymbol: 'sDAI',
        showConversionPreview: false,
      };
    } else if (strategy === 'CONVERT_DAI') {
      return {
        hasBalance: conversion.daiBalance && (conversion.daiBalance as bigint) > 0n,
        balance: conversion.daiBalance,
        tokenSymbol: 'wxDAI',
        showConversionPreview: true,
      };
    } else if (strategy === 'WRAP_XDAI') {
      return {
        hasBalance: conversion.nativeBalance && (conversion.nativeBalance as bigint) > 0n,
        balance: conversion.nativeBalance,
        tokenSymbol: 'xDAI',
        showConversionPreview: true,
      };
    }
    return {
      hasBalance: false,
      balance: 0n,
      tokenSymbol: 'xDAI/wxDAI/sDAI',
      showConversionPreview: false,
    };
  };

  const balanceInfo = getBalanceInfo();
  const isValidAmount = amount && parseFloat(amount) > 0;

  // Normalize stamp ID - accept with or without 0x prefix
  const normalizedStampId = stampId.startsWith('0x') ? stampId : `0x${stampId}`;
  const isValidStampId = stampId && normalizedStampId.match(/^0x[a-fA-F0-9]{64}$/);

  const currentStep = depositStep || conversion.currentStep;
  const isLoading = conversion.isLoading || isDepositing || isSigning || isConfirming;

  // Get button text based on strategy and state
  const getButtonText = () => {
    if (currentStep) return currentStep;
    if (isLoading) return 'Processing...';

    if (strategy === 'USE_SDAI') {
      return 'Deposit sDAI';
    } else if (strategy === 'CONVERT_DAI') {
      return 'Convert wxDAI → sDAI & Deposit';
    } else if (strategy === 'WRAP_XDAI') {
      return 'Wrap xDAI → wxDAI → sDAI & Deposit';
    } else {
      return 'Deposit';
    }
  };

  // Get conversion preview
  const getConversionPreview = () => {
    if (!balanceInfo.showConversionPreview || !isValidAmount || !conversion.currentToken) return null;

    try {
      const amountBigInt = parseEther(amount);
      const expectedSDAI = conversion.previewConversion(amountBigInt, conversion.currentToken);
      return formatTokenAmount(expectedSDAI);
    } catch {
      return null;
    }
  };

  const conversionPreview = getConversionPreview();

  return (
    <div className="info-box" style={{ marginTop: '2rem' }}>
      <h3 style={{ marginTop: 0 }}>Create Deposit</h3>

      {strategy === 'USE_SDAI' && balanceInfo.hasBalance ? (
        <div className="description" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
          <p style={{ margin: '0.25rem 0' }}>
            sDAI Balance: <TokenAmount value={balanceInfo.balance as bigint} />
          </p>
        </div>
      ) : null}
      {strategy === 'CONVERT_DAI' && balanceInfo.hasBalance ? (
        <div className="description" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
          <p style={{ margin: '0.25rem 0' }}>
            wxDAI Balance: <TokenAmount value={balanceInfo.balance as bigint} />
          </p>
          <p style={{ margin: '0.25rem 0', fontSize: '0.85rem', opacity: 0.8 }}>
            We&apos;ll convert your wxDAI to sDAI automatically
          </p>
        </div>
      ) : null}
      {strategy === 'WRAP_XDAI' && balanceInfo.hasBalance ? (
        <div className="description" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
          <p style={{ margin: '0.25rem 0' }}>
            xDAI Balance: <TokenAmount value={balanceInfo.balance as bigint} />
          </p>
          <p style={{ margin: '0.25rem 0', fontSize: '0.85rem', opacity: 0.8 }}>
            We&apos;ll wrap to wxDAI, convert to sDAI, then deposit
          </p>
        </div>
      ) : null}
      {strategy === 'NEED_TOKENS' ? (
        <div className="description" style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
          <p style={{ margin: '0.25rem 0', color: '#ff6b6b' }}>
            You need xDAI, wxDAI, or sDAI to create a deposit.{' '}
            <a
              href="https://bridge.gnosischain.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#7a7a7a', textDecoration: 'underline' }}
            >
              Get xDAI on Gnosis
            </a>
          </p>
        </div>
      ) : null}

      <div className="hash-input-container">
        <input
          type="text"
          className="hash-input"
          placeholder={`Amount (${balanceInfo.tokenSymbol})`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isLoading || !balanceInfo.hasBalance}
        />
      </div>

      <div className="hash-input-container" style={{ marginTop: '1rem' }}>
        <input
          type="text"
          className="hash-input"
          placeholder="Swarm Batch ID (00...)"
          value={stampId}
          onChange={(e) => setStampId(e.target.value)}
          disabled={isLoading || !balanceInfo.hasBalance}
        />
      </div>

      {error && (
        <p className="error-message">{error}</p>
      )}

      {isDeposited && (
        <p className="success-message">Deposit successful!</p>
      )}

      {currentStep && (
        <p className="description" style={{ fontSize: '0.9rem', marginTop: '1rem' }}>
          {currentStep}
        </p>
      )}

      <div className="button-group">
        <button
          className="view-button"
          onClick={handleDeposit}
          disabled={!isValidAmount || !isValidStampId || isLoading || !balanceInfo.hasBalance}
        >
          {getButtonText()}
        </button>
      </div>
    </div>
  );
}
