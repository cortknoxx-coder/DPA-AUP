
import { Injectable } from '@angular/core';
import { DpaAudioFormat, DpaFileHeader, DpaPackagingMetadata } from '../types';

// DPA1 container magic bytes
const DPA1_MAGIC = new Uint8Array([0x44, 0x50, 0x41, 0x31]); // "DPA1"
const DPA1_VERSION = 1;

// DPA1 content flags — reserve bits for future encryption / ownership / signing.
const DPA_FLAG_AUDIO = 0x01;
const DPA_FLAG_VIDEO = 0x02;
const DPA_FLAG_CAPSULE = 0x04;
const DPA_FLAG_ENCRYPTED = 0x08;

const DPA_TITLE_BYTES = 96;
const DPA_FILENAME_BYTES = 96;
const DPA_HEADER_BYTES =
  4 + // magic
  1 + // version
  1 + // flags
  2 + // header size
  4 + // payload format
  4 + // sample rate
  2 + // channels
  2 + // bits per sample
  4 + // duration ms
  4 + // payload size
  DPA_TITLE_BYTES +
  DPA_FILENAME_BYTES;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function writeFixedUtf8(bytes: Uint8Array, offset: number, maxBytes: number, value: string | undefined) {
  const src = new TextEncoder().encode(value || '');
  const slice = src.slice(0, maxBytes - 1);
  bytes.set(slice, offset);
  bytes[offset + slice.length] = 0;
}

function readFixedUtf8(bytes: Uint8Array, offset: number, maxBytes: number): string {
  const end = bytes.slice(offset, offset + maxBytes).indexOf(0);
  const view = end >= 0 ? bytes.slice(offset, offset + end) : bytes.slice(offset, offset + maxBytes);
  return new TextDecoder().decode(view);
}

@Injectable({ providedIn: 'root' })
export class CryptoService {
  /**
   * Legacy encrypted .dpa helper retained for capsules and future secure content flows.
   * This is distinct from the DPA1 media container used for uploaded audio masters.
   */
  async encryptForDevice(
    plainData: ArrayBuffer,
    duid: string,
    contentType: 'audio' | 'video' | 'capsule'
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(duid + 'DPA-MASTER-2026');
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial);
    const key = await crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const duidHashBytes = new Uint8Array(hashBuffer);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainData);

    const headerSize = 50;
    const dpaFile = new ArrayBuffer(headerSize + encrypted.byteLength);
    const view = new DataView(dpaFile);
    const bytes = new Uint8Array(dpaFile);

    bytes.set(new Uint8Array([0x44, 0x50, 0x41, 0x01]), 0); // legacy "DPA\x01"
    view.setUint8(4, 1);
    view.setUint8(5, this.contentFlags(contentType, true));
    bytes.set(duidHashBytes, 6);
    bytes.set(iv, 38);
    bytes.set(new Uint8Array(encrypted), headerSize);
    return dpaFile;
  }


  private contentFlags(contentType: 'audio' | 'video' | 'capsule', encrypted = false): number {
    let flags = 0;
    if (contentType === 'audio') flags |= DPA_FLAG_AUDIO;
    else if (contentType === 'video') flags |= DPA_FLAG_VIDEO;
    else if (contentType === 'capsule') flags |= DPA_FLAG_CAPSULE;
    if (encrypted) flags |= DPA_FLAG_ENCRYPTED;
    return flags;
  }

  packageDpaAudio(
    payload: ArrayBuffer,
    metadata: DpaPackagingMetadata
  ): ArrayBuffer {
    const out = new ArrayBuffer(DPA_HEADER_BYTES + payload.byteLength);
    const view = new DataView(out);
    const bytes = new Uint8Array(out);

    bytes.set(DPA1_MAGIC, 0);
    view.setUint8(4, DPA1_VERSION);
    view.setUint8(5, this.contentFlags('audio', false));
    view.setUint16(6, DPA_HEADER_BYTES, true);
    view.setUint32(8, metadata.format, true);
    view.setUint32(12, metadata.sampleRate, true);
    view.setUint16(16, metadata.channels, true);
    view.setUint16(18, metadata.bitsPerSample, true);
    view.setUint32(20, metadata.durationMs, true);
    view.setUint32(24, payload.byteLength, true);
    writeFixedUtf8(bytes, 28, DPA_TITLE_BYTES, metadata.title);
    writeFixedUtf8(bytes, 28 + DPA_TITLE_BYTES, DPA_FILENAME_BYTES, metadata.originalFilename || '');
    bytes.set(new Uint8Array(payload), DPA_HEADER_BYTES);
    return out;
  }

  parseDpaAudioHeader(data: ArrayBuffer): DpaFileHeader {
    const view = new DataView(data);
    const bytes = new Uint8Array(data);
    if (
      bytes[0] !== DPA1_MAGIC[0] ||
      bytes[1] !== DPA1_MAGIC[1] ||
      bytes[2] !== DPA1_MAGIC[2] ||
      bytes[3] !== DPA1_MAGIC[3]
    ) {
      throw new Error('DPA_INVALID_MAGIC');
    }
    const version = view.getUint8(4);
    if (version !== DPA1_VERSION) {
      throw new Error('DPA_UNSUPPORTED_VERSION');
    }
    const flags = view.getUint8(5);
    const headerSize = view.getUint16(6, true);
    const payloadSize = view.getUint32(24, true);
    const title = readFixedUtf8(bytes, 28, DPA_TITLE_BYTES);
    const originalFilename = readFixedUtf8(bytes, 28 + DPA_TITLE_BYTES, DPA_FILENAME_BYTES);
    return {
      magic: 'DPA1',
      sampleRate: view.getUint32(12, true),
      channels: view.getUint16(16, true),
      bitsPerSample: view.getUint16(18, true),
      durationMs: view.getUint32(20, true),
      payloadCodec: view.getUint32(8, true) as DpaAudioFormat,
      contentType: (flags & DPA_FLAG_AUDIO) ? 'audio' : (flags & DPA_FLAG_VIDEO) ? 'video' : 'capsule',
      version,
      flags,
      headerSize,
      payloadSize,
      title,
      originalFilename,
    };
  }

  extractDpaAudioPayload(data: ArrayBuffer): ArrayBuffer {
    const header = this.parseDpaAudioHeader(data);
    return data.slice(header.headerSize, header.headerSize + header.payloadSize);
  }

  async packageWavAsDpa(
    wavData: ArrayBuffer,
    metadata: Partial<DpaPackagingMetadata> = {}
  ): Promise<ArrayBuffer> {
    const info = this.inspectWav(wavData);
    return this.packageDpaAudio(wavData, {
      format: metadata.format || 1,
      sampleRate: metadata.sampleRate || info.sampleRate,
      channels: metadata.channels || info.channels,
      bitsPerSample: metadata.bitsPerSample || info.bitsPerSample,
      durationMs: metadata.durationMs || info.durationMs,
      title: metadata.title || '',
      originalFilename: metadata.originalFilename || '',
    });
  }

  private inspectWav(wavData: ArrayBuffer) {
    const view = new DataView(wavData);
    const bytes = new Uint8Array(wavData);
    const readAscii = (offset: number, length: number) =>
      new TextDecoder().decode(bytes.slice(offset, offset + length));

    if (readAscii(0, 4) !== 'RIFF' || readAscii(8, 4) !== 'WAVE') {
      throw new Error('WAV_INVALID_HEADER');
    }

    let offset = 12;
    let sampleRate = 44100;
    let channels = 2;
    let bitsPerSample = 16;
    let dataSize = 0;
    while (offset + 8 <= bytes.length) {
      const id = readAscii(offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      if (id === 'fmt ') {
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (id === 'data') {
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    const bytesPerFrame = Math.max(1, (bitsPerSample / 8) * channels);
    const totalFrames = dataSize > 0 ? Math.floor(dataSize / bytesPerFrame) : 0;
    const durationMs = sampleRate > 0 ? Math.round((totalFrames * 1000) / sampleRate) : 0;
    return { sampleRate, channels, bitsPerSample, durationMs };
  }

  /**
   * Legacy: Decrypts a blob chunk using session key (USB bridge mode)
   */
  async aesGcmDecrypt(blobB64: string, sessionKeyB64: string): Promise<ArrayBuffer> {
    try {
      const data = b64ToBytes(blobB64);

      // DPA Encrypted Blob Format:
      // [12 bytes IV/Nonce] [16 bytes Tag] [Ciphertext...]
      const nonce = data.slice(0, 12);
      const tag = data.slice(12, 28);
      const ciphertext = data.slice(28);

      const keyBytes = b64ToBytes(sessionKeyB64);
      const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      // Reconstruct for WebCrypto: Ciphertext + Tag
      const combined = new Uint8Array(ciphertext.length + tag.length);
      combined.set(ciphertext, 0);
      combined.set(tag, ciphertext.length);

      return await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        combined
      );
    } catch (err) {
      console.error('Decryption failed', err);
      throw new Error('DPA_DECRYPT_FAIL');
    }
  }
}
