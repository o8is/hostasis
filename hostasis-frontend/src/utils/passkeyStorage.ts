/**
 * Utility functions for managing passkey-derived wallet salt in localStorage
 *
 * The salt is used with WebAuthn PRF extension to derive a deterministic private key.
 * If the salt is lost (user clears browser data), a new passkey wallet will be created.
 * This is acceptable because the passkey wallet only holds temporary funds for uploads.
 */

const SALT_STORAGE_KEY = 'hostasis_passkey_salt';
const CREDENTIAL_ID_STORAGE_KEY = 'hostasis_passkey_credential_id';

/**
 * Store the PRF salt in localStorage
 */
export function storeSalt(salt: Uint8Array): void {
  try {
    const saltArray = Array.from(salt);
    localStorage.setItem(SALT_STORAGE_KEY, JSON.stringify(saltArray));
  } catch (error) {
    console.error('Failed to store passkey salt:', error);
    throw new Error('Failed to save passkey configuration');
  }
}

/**
 * Retrieve the PRF salt from localStorage
 */
export function retrieveSalt(): Uint8Array | null {
  try {
    const saltJson = localStorage.getItem(SALT_STORAGE_KEY);
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
  try {
    localStorage.setItem(CREDENTIAL_ID_STORAGE_KEY, credentialId);
  } catch (error) {
    console.error('Failed to store credential ID:', error);
  }
}

/**
 * Check if a passkey wallet has been configured
 */
export function hasPasskeyWallet(): boolean {
  return retrieveSalt() !== null;
}
