import { useState, useCallback, useEffect } from 'react';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { type Hex } from 'viem';
import {
  storeSalt,
  retrieveSalt,
  storeCredentialId,
  hasPasskeyWallet as checkHasPasskeyWallet
} from '../utils/passkeyStorage';

export interface PasskeyWalletInfo {
  address: Hex;
  privateKey: Hex;
}

export interface UsePasskeyWalletReturn {
  isConfigured: boolean;
  isAuthenticating: boolean;
  walletInfo: PasskeyWalletInfo | null;
  createPasskeyWallet: () => Promise<PasskeyWalletInfo>;
  authenticatePasskeyWallet: () => Promise<PasskeyWalletInfo>;
  clearWallet: () => void;
  error: Error | null;
}

/**
 * Hook for managing a passkey-derived Ethereum wallet
 *
 * Uses WebAuthn PRF extension to derive a deterministic private key from a passkey.
 * The wallet is ephemeral and only used for stamp creation/signing.
 */
export function usePasskeyWallet(): UsePasskeyWalletReturn {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [walletInfo, setWalletInfo] = useState<PasskeyWalletInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setIsConfigured(checkHasPasskeyWallet());
  }, []);

  const deriveWalletFromPRF = useCallback((prfOutput: Uint8Array, salt: Uint8Array): PasskeyWalletInfo => {
    // Derive private key using HKDF
    const privateKeyBytes = hkdf(sha256, prfOutput, salt, 'Hostasis Swarm Stamp Wallet', 32);

    // Get public key
    const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false); // uncompressed

    // Derive Ethereum address from public key (last 20 bytes of keccak256 hash)
    const publicKeyHash = keccak_256(publicKeyBytes.slice(1)); // remove 0x04 prefix
    const addressBytes = publicKeyHash.slice(-20);
    const address = `0x${Buffer.from(addressBytes).toString('hex')}` as Hex;

    // Convert private key to hex
    const privateKey = `0x${Buffer.from(privateKeyBytes).toString('hex')}` as Hex;

    return { address, privateKey };
  }, []);

  const createPasskeyWallet = useCallback(async (): Promise<PasskeyWalletInfo> => {
    setIsAuthenticating(true);
    setError(null);

    try {
      // Generate a random salt
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const challenge = crypto.getRandomValues(new Uint8Array(32));

      // Create registration options using native WebAuthn API format
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        rp: {
          name: 'Hostasis',
          id: typeof window !== 'undefined' ? window.location.hostname : 'localhost'
        },
        user: {
          id: userId,
          name: 'swarm-uploader@hostasis.app',
          displayName: 'Hostasis Swarm Uploader'
        },
        challenge: challenge,
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256 (P-256)
          { type: 'public-key', alg: -257 } // RS256
        ],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required'
        },
        extensions: {
          prf: {
            eval: {
              first: salt
            }
          }
        } as any // PRF extension not in standard types yet
      };

      // Use native WebAuthn API
      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Failed to create passkey credential');
      }

      // Check if PRF extension was successful
      const extensionResults = credential.getClientExtensionResults() as any;
      if (!extensionResults?.prf?.enabled) {
        throw new Error('PRF extension not supported by this authenticator. Please use a different device or browser.');
      }

      // Get PRF output from the extension results
      const prfResults = extensionResults.prf.results;
      if (!prfResults?.first) {
        throw new Error('Failed to get PRF output from authenticator');
      }

      // Convert ArrayBuffer to Uint8Array
      const prfOutput = new Uint8Array(prfResults.first);

      // Derive wallet
      const wallet = deriveWalletFromPRF(prfOutput, salt);

      // Store salt and credential ID
      storeSalt(salt);
      storeCredentialId(credential.id);

      setIsConfigured(true);
      setWalletInfo(wallet);

      return wallet;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create passkey wallet');
      setError(error);
      throw error;
    } finally {
      setIsAuthenticating(false);
    }
  }, [deriveWalletFromPRF]);

  const authenticatePasskeyWallet = useCallback(async (): Promise<PasskeyWalletInfo> => {
    setIsAuthenticating(true);
    setError(null);

    try {
      // Retrieve stored salt
      const salt = retrieveSalt();
      if (!salt) {
        throw new Error('No passkey wallet configured. Please create one first.');
      }

      // Create authentication options using native WebAuthn API
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: challenge,
        timeout: 60000,
        userVerification: 'required',
        extensions: {
          prf: {
            eval: {
              first: salt
            }
          }
        } as any // PRF extension not in standard types yet
      };

      // Use native WebAuthn API
      const assertion = await navigator.credentials.get({
        publicKey: publicKeyOptions
      }) as PublicKeyCredential;

      if (!assertion) {
        throw new Error('Failed to authenticate with passkey');
      }

      // Check if PRF extension was successful
      const extensionResults = assertion.getClientExtensionResults() as any;
      if (!extensionResults?.prf?.results?.first) {
        throw new Error('Failed to get PRF output from authenticator');
      }

      // Convert ArrayBuffer to Uint8Array
      const prfOutput = new Uint8Array(extensionResults.prf.results.first);

      // Derive wallet (should be same as creation)
      const wallet = deriveWalletFromPRF(prfOutput, salt);

      setWalletInfo(wallet);

      return wallet;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to authenticate passkey wallet');
      setError(error);
      throw error;
    } finally {
      setIsAuthenticating(false);
    }
  }, [deriveWalletFromPRF]);

  const clearWallet = useCallback(() => {
    setWalletInfo(null);
    setIsConfigured(false);
    setError(null);
  }, []);

  return {
    isConfigured,
    isAuthenticating,
    walletInfo,
    createPasskeyWallet,
    authenticatePasskeyWallet,
    clearWallet,
    error
  };
}
