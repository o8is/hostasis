import { useMemo } from 'react';
import { useWalletClient } from 'wagmi';
import { type Hex, keccak256, concat, toBytes } from 'viem';

/**
 * Client-side postage stamp signer
 *
 * Creates signatures for Swarm chunks so users can upload with their own batches
 * without needing the gateway to have access to their private key.
 */

export interface StampSignature {
  batchId: Hex;
  index: Hex;
  timestamp: Hex;
  signature: Hex;
}

export interface UseClientSideStamperReturn {
  signChunk: (chunkAddress: Uint8Array, batchId: Hex, index: bigint) => Promise<StampSignature>;
  isReady: boolean;
}

export function useClientSideStamper(): UseClientSideStamperReturn {
  const { data: walletClient } = useWalletClient();

  const signChunk = async (
    chunkAddress: Uint8Array,
    batchId: Hex,
    index: bigint
  ): Promise<StampSignature> => {
    if (!walletClient) {
      throw new Error('Wallet not connected');
    }

    // Timestamp in milliseconds (8 bytes)
    const timestamp = BigInt(Date.now());
    const timestampBytes = new Uint8Array(8);
    new DataView(timestampBytes.buffer).setBigUint64(0, timestamp, false); // big-endian

    // Index as 8 bytes
    const indexBytes = new Uint8Array(8);
    new DataView(indexBytes.buffer).setBigUint64(0, index, false); // big-endian

    // Construct the data to sign: chunkAddress + batchId + index + timestamp
    const batchIdBytes = toBytes(batchId);
    const dataToSign = concat([
      chunkAddress,
      batchIdBytes,
      indexBytes,
      timestampBytes
    ]);

    // Sign the data with the user's wallet
    const signature = await walletClient.signMessage({
      message: { raw: dataToSign }
    });

    return {
      batchId,
      index: `0x${index.toString(16).padStart(16, '0')}` as Hex,
      timestamp: `0x${timestamp.toString(16).padStart(16, '0')}` as Hex,
      signature
    };
  };

  const isReady = useMemo(() => !!walletClient, [walletClient]);

  return {
    signChunk,
    isReady
  };
}
