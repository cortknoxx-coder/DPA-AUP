
import { Injectable } from '@angular/core';

// DPA Master Key — must match firmware constant
const DPA_MASTER_KEY = 'DPA-MASTER-2026';

// .dpa file magic bytes
const DPA_MAGIC = new Uint8Array([0x44, 0x50, 0x41, 0x01]); // "DPA\x01"
const DPA_VERSION = 1;

// Content type flags
const FLAG_FLAC = 0x01;
const FLAG_VIDEO = 0x02;
const FLAG_CAPSULE = 0x04;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class CryptoService {

  /**
   * Derive AES-256 key from device DUID + master key
   * Must match firmware key derivation: SHA-256(DUID + masterKey)
   */
  async deriveDeviceKey(duid: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(duid + DPA_MASTER_KEY);
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial);

    return crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Compute DUID hash for .dpa file header
   * SHA-256(DUID + masterKey) as hex string
   */
  async computeDuidHash(duid: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(duid + DPA_MASTER_KEY);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(hash));
  }

  /**
   * Encrypt a file into .dpa format for a specific device
   * Returns the complete .dpa file as ArrayBuffer
   *
   * .dpa File Format:
   * [4 bytes] Magic: "DPA\x01"
   * [1 byte]  Version: 0x01
   * [1 byte]  Flags: bit0=FLAC, bit1=video, bit2=capsule
   * [32 bytes] DUID Hash (SHA-256 of DUID + master key)
   * [12 bytes] IV/Nonce (random)
   * [N bytes]  Encrypted payload (AES-256-GCM ciphertext + 16-byte auth tag)
   */
  async encryptToDpa(
    plainData: ArrayBuffer,
    duid: string,
    contentType: 'audio' | 'video' | 'capsule'
  ): Promise<ArrayBuffer> {
    // Derive key
    const key = await this.deriveDeviceKey(duid);

    // Compute DUID hash
    const duidHashHex = await this.computeDuidHash(duid);
    const duidHashBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      duidHashBytes[i] = parseInt(duidHashHex.substring(i * 2, i * 2 + 2), 16);
    }

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Set content flag
    let flags = 0;
    if (contentType === 'audio') flags = FLAG_FLAC;
    else if (contentType === 'video') flags = FLAG_VIDEO;
    else if (contentType === 'capsule') flags = FLAG_CAPSULE;

    // Encrypt with AES-256-GCM
    // WebCrypto returns ciphertext + tag appended
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plainData
    );

    // Build .dpa file
    // Header: 4 (magic) + 1 (version) + 1 (flags) + 32 (duid hash) + 12 (iv) = 50 bytes
    const headerSize = 50;
    const dpaFile = new ArrayBuffer(headerSize + encrypted.byteLength);
    const view = new DataView(dpaFile);
    const bytes = new Uint8Array(dpaFile);

    // Magic
    bytes.set(DPA_MAGIC, 0);

    // Version
    view.setUint8(4, DPA_VERSION);

    // Flags
    view.setUint8(5, flags);

    // DUID Hash
    bytes.set(duidHashBytes, 6);

    // IV
    bytes.set(iv, 38);

    // Encrypted payload (ciphertext + GCM tag)
    bytes.set(new Uint8Array(encrypted), headerSize);

    return dpaFile;
  }

  /**
   * Decrypt a .dpa file — validates DUID ownership first
   */
  async decryptDpa(dpaData: ArrayBuffer, duid: string): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(dpaData);

    // Validate magic
    if (bytes[0] !== 0x44 || bytes[1] !== 0x50 || bytes[2] !== 0x41 || bytes[3] !== 0x01) {
      throw new Error('DPA_INVALID_MAGIC');
    }

    // Validate DUID hash
    const storedHash = bytes.slice(6, 38);
    const expectedHashHex = await this.computeDuidHash(duid);
    const storedHashHex = bytesToHex(storedHash);

    if (storedHashHex !== expectedHashHex) {
      throw new Error('DPA_WRONG_DEVICE');
    }

    // Extract IV and ciphertext
    const iv = bytes.slice(38, 50);
    const encryptedPayload = bytes.slice(50);

    // Derive key and decrypt
    const key = await this.deriveDeviceKey(duid);

    try {
      return await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedPayload
      );
    } catch (err) {
      console.error('DPA decryption failed', err);
      throw new Error('DPA_DECRYPT_FAIL');
    }
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
