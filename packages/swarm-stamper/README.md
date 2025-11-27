# @hostasis/swarm-stamper

Client-side stamping and upload for Swarm with derived reserve keys.

## Features

- **Client-side stamping**: Sign chunks with your reserve key (no gateway key needed)
- **Parallel uploads**: Upload multiple chunks concurrently for maximum speed
- **Merkle tree support**: Efficient chunking for large files
- **Manifest creation**: Automatic Mantaray manifest generation for collections
- **SPA support**: Single Page App mode with proper routing
- **Progress tracking**: Real-time upload progress callbacks
- **TypeScript**: Full type definitions included

## Installation

```bash
npm install @hostasis/swarm-stamper
```

## Usage

### Basic Upload

```typescript
import { StampedUploader } from '@hostasis/swarm-stamper';

const uploader = new StampedUploader({
  gatewayUrl: 'https://gateway.ethswarm.org',
  batchId: '0x...', // Your postage batch ID
  privateKey: '0x...', // Your private key for signing
  depth: 20
});

// Upload files
const result = await uploader.uploadFiles(files, {
  isSPA: false,
  onProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.message} (${progress.percentage}%)`);
  }
});

console.log('Reference:', result.reference);
console.log('URL:', result.url);
console.log('CID:', result.cid);
```

### Single File Upload

```typescript
const file = new File(['Hello, Swarm!'], 'hello.txt');
const result = await uploader.uploadFiles([file]);

console.log('File available at:', result.url);
```

### Website Upload (SPA Mode)

```typescript
// Upload a React/Vue/etc. SPA
const result = await uploader.uploadFiles(files, {
  isSPA: true, // Routes all 404s to index.html
  indexDocument: 'index.html'
});

console.log('Website live at:', result.url);
```

### Progress Tracking

```typescript
await uploader.uploadFiles(files, {
  onProgress: (progress) => {
    console.log(progress.phase); // 'chunking' | 'stamping' | 'uploading' | 'complete'
    console.log(progress.message); // Human-readable status
    console.log(progress.percentage); // 0-100
    console.log(progress.chunksProcessed, '/', progress.totalChunks);
  }
});
```

### Upload Raw Data

```typescript
const data = new Uint8Array([1, 2, 3, 4, 5]);
const result = await uploader.uploadData(data);

console.log('Data reference:', result.reference);
```

## API Reference

### `StampedUploader`

#### Constructor

```typescript
new StampedUploader(config: StampedUploaderConfig)
```

**Config:**
- `gatewayUrl`: Swarm gateway URL
- `batchId`: Postage batch ID (hex string)
- `reservePrivateKey`: Private key of batch owner (reserve key)
- `depth`: Batch depth

#### Methods

##### `uploadFiles(files: File[], options?: UploadOptions): Promise<UploadResult>`

Upload files to Swarm with client-side stamping.

**Options:**
- `isSPA`: Enable SPA mode (routes 404s to index.html)
- `indexDocument`: Custom index document path
- `errorDocument`: Custom error document path
- `onProgress`: Progress callback function

**Returns:**
- `reference`: Swarm hash (hex)
- `url`: Full URL with CID subdomain routing
- `cid`: CIDv1 representation

##### `uploadData(data: Uint8Array): Promise<{ reference: string }>`

Upload raw data as chunks.

## License

MIT
