
import { Injectable, signal } from '@angular/core';
import { DPA_CONFIG } from './dpa-config';
import { DeviceRpcRequest, DeviceRpcResponse, DpaDeviceInfo, DecryptionKeyResponse } from '../types';

@Injectable({ providedIn: 'root' })
export class DeviceBridgeService {
  private ws?: WebSocket;
  private pending = new Map<string, { resolve: (v:any)=>void; reject:(e:any)=>void }>();
  
  // Reactive state for the UI
  isConnected = signal(false);
  lastError = signal<string | null>(null);

  async connect(): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return true;
    
    try {
      const bridgeUrl = DPA_CONFIG.bridgeWsUrl;
      if (!bridgeUrl) {
        this.lastError.set('Desktop bridge is disabled on hosted HTTPS until a secure WSS bridge URL is configured.');
        this.isConnected.set(false);
        return false;
      }
      this.ws = new WebSocket(bridgeUrl);
      
      await new Promise<void>((resolve, reject) => {
        const ws = this.ws!;
        const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
            ws.close();
        }, 2000); // Fast timeout for UI responsiveness

        ws.onopen = () => {
          clearTimeout(timeout);
          this.isConnected.set(true);
          this.lastError.set(null);
          console.log('[DPA Bridge] Connected');
          resolve();
        };
        
        ws.onerror = (e) => {
          clearTimeout(timeout);
          this.lastError.set('Bridge connection failed');
          reject(e);
        };
        
        ws.onclose = () => {
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
    } catch (e) {
      this.isConnected.set(false);
      return false;
    }
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
    this.isConnected.set(false);
  }

  private uuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async call(method: DeviceRpcRequest['method'], params?: any): Promise<any> {
    if (!this.isConnected()) throw new Error('Bridge not connected');
    
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

  async getDeviceInfo(): Promise<DpaDeviceInfo> { 
    return this.call('GET_DEVICE_INFO'); 
  }
  
  async listLibrary(): Promise<any> { 
    return this.call('LIST_LIBRARY'); 
  }
  
  async getManifest(albumId: string): Promise<any> { 
    return this.call('GET_MANIFEST', { albumId }); 
  }
  
  async readBlob(blobId: string, offset = 0, length?: number): Promise<any> { 
    return this.call('READ_BLOB', { blobId, offset, length }); 
  }
  
  async requestDecryptionKey(trackId: string): Promise<DecryptionKeyResponse> { 
    return this.call('REQUEST_DECRYPTION_KEY', { trackId }); 
  }
}
