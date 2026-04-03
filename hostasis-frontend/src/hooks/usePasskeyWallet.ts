/**
 * Hook for managing a passkey-derived Ethereum wallet
 *
 * This is a thin wrapper around the PasskeyContext for backwards compatibility.
 * The actual state is stored in the context to be shared across all components.
 */
import { usePasskeyContext, type PasskeyWalletInfo } from '../contexts/PasskeyContext';

export type { PasskeyWalletInfo };

export interface UsePasskeyWalletReturn {
  isConfigured: boolean;
  isAuthenticating: boolean;
  walletInfo: PasskeyWalletInfo | null;
  createPasskeyWallet: () => Promise<PasskeyWalletInfo>;
  authenticatePasskeyWallet: () => Promise<PasskeyWalletInfo>;
  /** Try to recover a lost salt from largeBlob. Returns wallet if recovery succeeds, null if not. */
  recoverPasskeyWallet: () => Promise<PasskeyWalletInfo | null>;
  clearWallet: () => void;
  error: Error | null;
}

/**
 * Hook for managing a passkey-derived Ethereum wallet
 *
 * Uses WebAuthn PRF extension to derive a deterministic private key from a passkey.
 * The wallet state is shared globally via PasskeyContext.
 */
export function usePasskeyWallet(): UsePasskeyWalletReturn {
  return usePasskeyContext();
}
