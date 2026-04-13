
import { Injectable, signal } from '@angular/core';
import { DPA_CONFIG } from './dpa-config';
import { DeviceRpcRequest, DeviceRpcResponse, DpaDeviceInfo, DecryptionKeyResponse, LibraryIndex, Manifest } from '../types';

@Injectable({ providedIn: 'root' })
export class DeviceBridgeService {
  private ws?: WebSocket;
  private pending = new Map<string, { resolve: (v:any)=>void; reject:(e:any)=>void }>();
  private transport: 'ws' | 'http' | null = null;
  
  // Reactive state for the UI
  isConnected = signal(false);
  lastError = signal<string | null>(null);

  usesHttpBridge(): boolean {
    return this.transport === 'http' && this.isConnected();
  }

  usesLocalHelperHttp(): boolean {
    return this.usesHttpBridge();
  }

  async connect(): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return true;
    if (this.transport === 'http' && this.isConnected()) return true;

    try {
      const response = await fetch(`${DPA_CONFIG.bridgeHttpUrl}/health`, {
        signal: AbortSignal.timeout(2000),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Bridge control plane returned ${response.status}`);
      }
      this.transport = 'http';
      this.lastError.set(null);
      this.isConnected.set(true);
      return true;
    } catch (e) {
      console.warn('[DPA Bridge] HTTP bridge unavailable, trying WebSocket bridge.', e);
    }

    try {
      const bridgeUrl = DPA_CONFIG.bridgeWsUrl;
      if (bridgeUrl) {
        this.ws = new WebSocket(bridgeUrl);

        await new Promise<void>((resolve, reject) => {
          const ws = this.ws!;
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
            ws.close();
          }, 2000);

          ws.onopen = () => {
            clearTimeout(timeout);
            this.transport = 'ws';
            this.isConnected.set(true);
            this.lastError.set(null);
            console.log('[DPA Bridge] Connected');
            resolve();
          };

          ws.onerror = (err) => {
            clearTimeout(timeout);
            reject(err);
          };

          ws.onclose = () => {
            this.transport = null;
            this.isConnected.set(false);
            console.log('[DPA Bridge] Disconnected');
          };

          ws.onmessage = (evt) => {
            try {
              const msg = JSON.parse(evt.data) as DeviceRpcResponse;
              const p = this.pending.get(msg.id);
              if (!p) return;
              this.pending.delete(msg.id);
              if (msg.ok) p.resolve(msg.result);
              else p.reject(new Error(msg.error?.message || 'RPC error'));
            } catch (err) {
              console.error('[DPA Bridge] Parse error', err);
            }
          };
        });
        return true;
      }
    } catch (e) {
      console.warn('[DPA Bridge] WebSocket connect failed.', e);
    }
    this.transport = null;
    this.lastError.set('Bridge connection failed');
    this.isConnected.set(false);
    return false;
  }

  disconnect(): void {
    for (const [, pending] of this.pending) {
      pending.reject(new Error('Bridge disconnected'));
    }
    this.pending.clear();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // best effort
      }
      this.ws = undefined;
    }
    this.transport = null;
    this.isConnected.set(false);
  }

  private uuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async call(method: DeviceRpcRequest['method'], params?: any): Promise<any> {
    if (!this.isConnected() || this.transport !== 'ws') throw new Error('Bridge RPC is unavailable');
    
    const id = this.uuidv4();
    const req: DeviceRpcRequest = { id, method, params };
    
    this.ws!.send(JSON.stringify(req));
    
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Bridge RPC timeout'));
        }
      }, 5000);
    });
  }

  // --- API Wrappers ---

  private async fetchBridgeJson<T>(path: string): Promise<T> {
    const response = await fetch(`${DPA_CONFIG.bridgeHttpUrl}${path}`, {
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Bridge helper request failed (${response.status})`);
    }
    const payload = await response.json();
    return (payload.manifest || payload.library || payload.device || payload) as T;
  }

  async getDeviceInfo(): Promise<DpaDeviceInfo> { 
    if (this.transport === 'http') {
      return this.fetchBridgeJson<DpaDeviceInfo>('/device-info');
    }
    return this.call('GET_DEVICE_INFO'); 
  }
  
  async listLibrary(): Promise<LibraryIndex> { 
    if (this.transport === 'http') {
      return this.fetchBridgeJson<LibraryIndex>('/library');
    }
    return this.call('LIST_LIBRARY'); 
  }
  
  async getManifest(albumId: string): Promise<Manifest> { 
    if (this.transport === 'http') {
      return this.fetchBridgeJson<Manifest>(`/manifest?albumId=${encodeURIComponent(albumId)}`);
    }
    return this.call('GET_MANIFEST', { albumId }); 
  }
  
  async readBlob(blobId: string, offset = 0, length?: number): Promise<any> { 
    if (this.transport === 'http') {
      throw new Error('The cloud-control snapshot path does not expose encrypted blob reads yet. Use a live local-device path for playback.');
    }
    return this.call('READ_BLOB', { blobId, offset, length }); 
  }
  
  async requestDecryptionKey(trackId: string): Promise<DecryptionKeyResponse> { 
    if (this.transport === 'http') {
      throw new Error('The cloud-control snapshot path does not expose decryption keys yet. Use a live local-device path for playback.');
    }
    return this.call('REQUEST_DECRYPTION_KEY', { trackId }); 
  }
}
