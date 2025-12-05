import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
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

// Helper to encode salt for largeBlob storage
function encodeSaltForBlob(salt: Uint8Array): Uint8Array {
  // Prefix with a version byte for future compatibility
  const blob = new Uint8Array(1 + salt.length);
  blob[0] = 1; // version 1
  blob.set(salt, 1);
  return blob;
}

// Helper to decode salt from largeBlob
function decodeSaltFromBlob(blob: Uint8Array): Uint8Array | null {
  if (blob.length < 33 || blob[0] !== 1) return null;
  return blob.slice(1, 33);
}

export interface PasskeyWalletInfo {
  address: Hex;
  privateKey: Hex;
}

interface PasskeyContextValue {
  isConfigured: boolean;
  isAuthenticating: boolean;
  walletInfo: PasskeyWalletInfo | null;
  createPasskeyWallet: () => Promise<PasskeyWalletInfo>;
  authenticatePasskeyWallet: () => Promise<PasskeyWalletInfo>;
  clearWallet: () => void;
  error: Error | null;
}

const PasskeyContext = createContext<PasskeyContextValue | null>(null);

export function PasskeyProvider({ children }: { children: ReactNode }) {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [walletInfo, setWalletInfo] = useState<PasskeyWalletInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setIsConfigured(checkHasPasskeyWallet());
  }, []);

  const deriveWalletFromPRF = useCallback((prfOutput: Uint8Array, salt: Uint8Array): PasskeyWalletInfo => {
    // Derive private key using HKDF
    const privateKeyBytes = hkdf(sha256, prfOutput, salt, 'Hostasis Wallet', 32);

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
          name: 'Hostasis',
          displayName: 'Hostasis Wallet'
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },  // ES256
          { type: 'public-key', alg: -257 } // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        },
        challenge: challenge,
        timeout: 60000,
        extensions: {
          prf: {
            eval: {
              first: salt
            }
          },
          // Request largeBlob support for salt backup (survives localStorage clearing)
          largeBlob: {
            support: 'preferred'
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

      // Store salt and credential ID in localStorage
      storeSalt(salt);
      storeCredentialId(credential.id);

      // If largeBlob is supported, also store salt there as backup
      // This survives localStorage clearing
      if (extensionResults?.largeBlob?.supported) {
        try {
          // Write salt to largeBlob in a separate authentication
          const writeChallenge = crypto.getRandomValues(new Uint8Array(32));
          await navigator.credentials.get({
            publicKey: {
              challenge: writeChallenge,
              timeout: 60000,
              userVerification: 'required',
              allowCredentials: [{
                type: 'public-key',
                id: credential.rawId
              }],
              extensions: {
                largeBlob: {
                  write: encodeSaltForBlob(salt)
                }
              }
            } as any
          });
          console.log('Salt backed up to passkey largeBlob');
        } catch (blobErr) {
          // largeBlob write failed - not critical, localStorage still works
          console.warn('Failed to backup salt to largeBlob:', blobErr);
        }
      }

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
    // If already authenticated, return cached wallet
    if (walletInfo) {
      return walletInfo;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      // Retrieve stored salt from localStorage
      let salt = retrieveSalt();

      // If no salt in localStorage, try to recover from largeBlob
      if (!salt) {
        console.log('No salt in localStorage, attempting largeBlob recovery...');

        // First, authenticate to read largeBlob
        const recoveryChallenge = crypto.getRandomValues(new Uint8Array(32));
        const recoveryAssertion = await navigator.credentials.get({
          publicKey: {
            challenge: recoveryChallenge,
            timeout: 60000,
            userVerification: 'required',
            extensions: {
              largeBlob: {
                read: true
              }
            }
          } as any
        }) as PublicKeyCredential;

        if (recoveryAssertion) {
          const recoveryResults = recoveryAssertion.getClientExtensionResults() as any;
          if (recoveryResults?.largeBlob?.blob) {
            const blobData = new Uint8Array(recoveryResults.largeBlob.blob);
            const recoveredSalt = decodeSaltFromBlob(blobData);
            if (recoveredSalt) {
              console.log('Salt recovered from largeBlob! Restoring to localStorage...');
              salt = recoveredSalt;
              // Restore to localStorage for future use
              storeSalt(salt);
              storeCredentialId(recoveryAssertion.id);
              setIsConfigured(true);
            }
          }
        }
      }

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
  }, [deriveWalletFromPRF, walletInfo]);

  const clearWallet = useCallback(() => {
    setWalletInfo(null);
    setIsConfigured(false);
    setError(null);
  }, []);

  return (
    <PasskeyContext.Provider
      value={{
        isConfigured,
        isAuthenticating,
        walletInfo,
        createPasskeyWallet,
        authenticatePasskeyWallet,
        clearWallet,
        error,
      }}
    >
      {children}
    </PasskeyContext.Provider>
  );
}

/**
 * Hook to access the global passkey wallet state
 */
export function usePasskeyContext(): PasskeyContextValue {
  const context = useContext(PasskeyContext);
  if (!context) {
    throw new Error('usePasskeyContext must be used within a PasskeyProvider');
  }
  return context;
}
