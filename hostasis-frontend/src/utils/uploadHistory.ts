/**
 * Upload History Tracking Utility
 *
 * Tracks file uploads to Swarm, linking them to postage batch IDs.
 * This allows users to see which files are associated with each reserve.
 */

export interface UploadedFile {
  name: string;
  size: number;
  type: string;
}

export interface UploadMetadata {
  isWebsite?: boolean;
  indexDocument?: string;
  filename?: string; // For single file uploads
}

export interface UploadRecord {
  id: string;
  batchId: string;
  reference: string; // Swarm content hash
  files: UploadedFile[];
  totalSize: number;
  uploadedAt: number; // Unix timestamp
  metadata?: UploadMetadata;
}

const STORAGE_KEY = 'hostasis_upload_history';

/**
 * Get all upload records from localStorage
 */
function getAllRecords(): UploadRecord[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to read upload history:', error);
    return [];
  }
}

/**
 * Save all upload records to localStorage
 */
function saveAllRecords(records: UploadRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.error('Failed to save upload history:', error);
  }
}

/**
 * Save a new upload record
 */
export function saveUpload(record: Omit<UploadRecord, 'id' | 'uploadedAt'>): UploadRecord {
  const newRecord: UploadRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    uploadedAt: Date.now(),
  };

  const records = getAllRecords();
  records.push(newRecord);
  saveAllRecords(records);

  return newRecord;
}

/**
 * Get all uploads associated with a specific batch ID
 */
export function getUploadsByBatchId(batchId: string): UploadRecord[] {
  const records = getAllRecords();
  return records.filter(record => record.batchId.toLowerCase() === batchId.toLowerCase());
}

/**
 * Get all upload records
 */
export function getAllUploads(): UploadRecord[] {
  return getAllRecords();
}

/**
 * Delete an upload record by ID
 */
export function deleteUpload(id: string): void {
  const records = getAllRecords();
  const filtered = records.filter(record => record.id !== id);
  saveAllRecords(filtered);
}

/**
 * Clear all upload history
 */
export function clearAllUploads(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear upload history:', error);
  }
}

/**
 * Get total storage used by a batch ID (sum of all upload sizes)
 */
export function getTotalSizeByBatchId(batchId: string): number {
  const uploads = getUploadsByBatchId(batchId);
  return uploads.reduce((total, upload) => total + upload.totalSize, 0);
}

/**
 * Get total number of files uploaded with a batch ID
 */
export function getTotalFilesByBatchId(batchId: string): number {
  const uploads = getUploadsByBatchId(batchId);
  return uploads.reduce((total, upload) => total + upload.files.length, 0);
}
