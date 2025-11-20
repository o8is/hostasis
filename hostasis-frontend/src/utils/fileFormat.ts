/**
 * File formatting utilities
 * Shared formatters for file sizes and counts
 */

/**
 * Format bytes to human-readable file size (B, KB, MB, GB)
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format file count with proper pluralization
 */
export function formatFileCount(count: number): string {
  return `${count} file${count !== 1 ? 's' : ''}`;
}

/**
 * Format upload summary: "3 files, 2.4 MB"
 */
export function formatUploadSummary(fileCount: number, totalBytes: number): string {
  return `${formatFileCount(fileCount)}, ${formatFileSize(totalBytes)}`;
}
