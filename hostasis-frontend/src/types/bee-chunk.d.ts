declare module '@ethersphere/bee-js/dist/mjs/chunk/cac.js' {
  export interface Chunk {
    readonly data: Uint8Array;
    address: {
      toUint8Array(): Uint8Array;
      toString(): string;
    };
  }

  export function makeContentAddressedChunk(payloadBytes: Uint8Array | string): Chunk;
}
