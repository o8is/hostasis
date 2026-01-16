import { useState, useCallback } from 'react';
import { type Hex } from 'viem';
import { StampedUploader } from '@hostasis/swarm-stamper';
import type { UploadProgress, UploadResult, UploadOptions } from '@hostasis/swarm-stamper';
import { SWARM_GATEWAY_URL } from '../contracts/addresses';

// Re-export types for backward compatibility
export type { UploadProgress, UploadResult, UploadOptions };

export interface UseStampedUploadReturn {
  uploadWithStamper: (
    files: File[],
    batchId: string,
    batchOwnerPrivateKey: Hex, // Vault key (batch owner) - NOT the passkey!
    depth: number,
    gatewayUrl?: string,
    options?: UploadOptions
  ) => Promise<UploadResult>;
  progress: UploadProgress;
  error: Error | null;
  reset: () => void;
}

/**
 * Hook for uploading files with client-side stamping
 * Now uses @hostasis/swarm-stamper package
 */
export function useStampedUpload(): UseStampedUploadReturn {
  const [progress, setProgress] = useState<UploadProgress>({
    phase: 'idle',
    message: 'Ready to upload'
  });
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => {
    setProgress({ phase: 'idle', message: 'Ready to upload' });
    setError(null);
  }, []);

  const uploadWithStamper = useCallback(async (
    files: File[],
    batchId: string,
    batchOwnerPrivateKey: Hex, // This should be the vault key (batch owner), not the passkey!
    depth: number,
    gatewayUrl: string = SWARM_GATEWAY_URL,
    options: UploadOptions = {}
  ): Promise<UploadResult> => {
    setError(null);

    try {
      if (!batchOwnerPrivateKey) {
        throw new Error('Batch owner private key is required for client-side stamping');
      }

      if (files.length === 0) {
        throw new Error('No files provided for upload');
      }

      // Create uploader instance
      // Limit concurrency to get predictable progress tracking
      // (Infinity can cause browser to queue requests internally which skews progress)
      const uploader = new StampedUploader({
        gatewayUrl: gatewayUrl || SWARM_GATEWAY_URL,
        batchId,
        privateKey: batchOwnerPrivateKey, // Vault key owns the batch
        depth,
        concurrency: 50,
      });

      // Upload with progress tracking
      const result = await uploader.uploadFiles(files, {
        ...options,
        onProgress: (progressUpdate) => {
          setProgress(progressUpdate);
        }
      });

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';

      setProgress({
        phase: 'error',
        message: errorMessage
      });
      setError(err instanceof Error ? err : new Error(errorMessage));
      throw err;
    }
  }, []);

  return {
    uploadWithStamper,
    progress,
    error,
    reset
  };
}
