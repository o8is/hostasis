/**
 * Utility functions for managing passkey-derived wallet salt in localStorage
 *
 * The salt is used with WebAuthn PRF extension to derive a deterministic private key.
 * If the salt is lost (user clears browser data), the salt can be recovered from
 * the passkey's largeBlob extension (if the authenticator supported it at creation).
 */

const SALT_STORAGE_KEY = 'hostasis_passkey_salt';
const CREDENTIAL_ID_STORAGE_KEY = 'hostasis_passkey_credential_id';

/** Safe check for localStorage availability (SSR-safe) */
function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Store the PRF salt in localStorage
 */
export function storeSalt(salt: Uint8Array): void {
  const storage = getLocalStorage();
  if (!storage) throw new Error('localStorage not available');
  try {
    const saltArray = Array.from(salt);
    storage.setItem(SALT_STORAGE_KEY, JSON.stringify(saltArray));
  } catch (error) {
    console.error('Failed to store passkey salt:', error);
    throw new Error('Failed to save passkey configuration');
  }
}

/**
 * Retrieve the PRF salt from localStorage
 */
export function retrieveSalt(): Uint8Array | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const saltJson = storage.getItem(SALT_STORAGE_KEY);
    if (!saltJson) return null;

    const saltArray = JSON.parse(saltJson);
    return new Uint8Array(saltArray);
  } catch (error) {
    console.error('Failed to retrieve passkey salt:', error);
    return null;
  }
}

/**
 * Store the credential ID for the passkey
 */
export function storeCredentialId(credentialId: string): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(CREDENTIAL_ID_STORAGE_KEY, credentialId);
  } catch (error) {
    console.error('Failed to store credential ID:', error);
  }
}

/**
 * Retrieve the credential ID for the passkey
 */
export function retrieveCredentialId(): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return storage.getItem(CREDENTIAL_ID_STORAGE_KEY);
  } catch (error) {
    console.error('Failed to retrieve credential ID:', error);
    return null;
  }
}

/**
 * Check if a passkey wallet has been configured (salt exists in localStorage)
 */
export function hasPasskeyWallet(): boolean {
  return retrieveSalt() !== null;
}
