
import { Injectable, signal } from '@angular/core';

const DPA_URL_PREFIX = 'https://dpa.audio/d/';

@Injectable({ providedIn: 'root' })
export class DeviceNfcService {
  isSupported = signal(typeof window !== 'undefined' && 'NDEFReader' in window);
  isScanning = signal(false);
  lastDuid = signal<string | null>(null);
  lastError = signal<string | null>(null);

  private reader: any = null; // NDEFReader (typed as any since Web NFC typings are not standard)
  private abortController: AbortController | null = null;

  /**
   * Start scanning for NFC tags containing DPA device URLs.
   * Returns the DUID when a valid DPA tag is found.
   * Web NFC is only available on Android Chrome.
   */
  async startScan(): Promise<string | null> {
    if (!this.isSupported()) {
      this.lastError.set('Web NFC is not supported in this browser. Use Chrome on Android.');
      return null;
    }

    try {
      this.abortController = new AbortController();
      this.reader = new (window as any).NDEFReader();
      this.isScanning.set(true);
      this.lastError.set(null);

      await this.reader.scan({ signal: this.abortController.signal });

      return new Promise<string | null>((resolve) => {
        this.reader.addEventListener('reading', ({ message }: any) => {
          for (const record of message.records) {
            if (record.recordType === 'url') {
              const url = new TextDecoder().decode(record.data);
              if (url.startsWith(DPA_URL_PREFIX)) {
                const duid = url.slice(DPA_URL_PREFIX.length);
                this.lastDuid.set(duid);
                this.stopScan();
                resolve(duid);
                return;
              }
            }
            // Also check text records for DUID
            if (record.recordType === 'text') {
              const text = new TextDecoder().decode(record.data);
              if (text.startsWith('DPA-')) {
                this.lastDuid.set(text);
                this.stopScan();
                resolve(text);
                return;
              }
            }
          }
        });

        this.reader.addEventListener('readingerror', () => {
          this.lastError.set('Failed to read NFC tag. Try again.');
        });

        // Timeout after 30 seconds
        setTimeout(() => {
          if (this.isScanning()) {
            this.stopScan();
            this.lastError.set('NFC scan timed out. Hold your DPA closer to the phone.');
            resolve(null);
          }
        }, 30000);
      });
    } catch (e: any) {
      this.isScanning.set(false);
      if (e.name === 'AbortError') return null;
      this.lastError.set(e.message || 'NFC scan failed');
      return null;
    }
  }

  stopScan(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isScanning.set(false);
  }
}
