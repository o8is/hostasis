/**
 * @hostasis/swarm-stamper
 *
 * Client-side stamping and upload for Swarm with derived reserve keys
 */

export { StampedUploader } from './uploader.js';
export * from './types.js';
export {
  getContentType,
  normalizeBatchId,
  swarmHashToCid,
  cidToSwarmHash,
  buildMantarayManifest,
  saveMantarayNodeRecursively,
  uploadWithMerkleTree,
  resolveFilePaths,
  detectDocuments,
  buildUploadResult,
  computeReference
} from './utils.js';
export {
  writeFeedUpdate,
  makeFeedIdentifier,
  calculateBmtRootHash,
  calculateChunkAddress,
  makeSOCAddress,
  getAddressFromPrivateKey,
  type WriteFeedUpdateOptions
} from './feed.js';
export {
  normalizeProjectSlug,
  isValidProjectSlug,
  deriveProjectKey,
  type ProjectKeyInfo
} from './keys.js';
