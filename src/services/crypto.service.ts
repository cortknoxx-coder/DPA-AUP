
import { Injectable } from '@angular/core';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

@Injectable({ providedIn: 'root' })
export class CryptoService {
  
  /**
   * Decrypts a blob chunk from the DPA device using the session key.
   * This happens entirely in client memory. Keys are ephemeral.
   */
  async aesGcmDecrypt(blobB64: string, sessionKeyB64: string): Promise<ArrayBuffer> {
    try {
      const data = b64ToBytes(blobB64);
      
      // DPA Encrypted Blob Format:
      // [12 bytes IV/Nonce] [16 bytes Tag] [Ciphertext...]
      // Note: SubtleCrypto expects Tag appended to Ciphertext for 'decrypt',
      // but standard AES-GCM output often puts tag at end. 
      // DPA firmware output format: Nonce (12) + Tag (16) + Ciphertext (N)
      // WebCrypto decrypt expects: Ciphertext + Tag at the end.
      
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
