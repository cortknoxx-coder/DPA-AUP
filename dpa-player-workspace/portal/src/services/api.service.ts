
import { Injectable } from '@angular/core';
import { DPA_CONFIG } from './dpa-config';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private headers(): HeadersInit {
    // In a real app, this would use a JWT. For the demo, we use a static email header.
    return { 'x-user-email': 'demo@dpa.local', 'content-type': 'application/json' };
  }

  async getMe() {
    const r = await fetch(`${DPA_CONFIG.apiBaseUrl}/me`, { headers: this.headers() });
    return await r.json();
  }

  async getLibrary() {
    // Note: This would fetch metadata about purchased albums from the backend.
    // The actual content (tracks) is loaded from the device itself.
    const r = await fetch(`${DPA_CONFIG.apiBaseUrl}/library`, { headers: this.headers() });
    return await r.json();
  }

  async getCapsules(albumId?: string) {
    const url = new URL(`${DPA_CONFIG.apiBaseUrl}/capsules`);
    if (albumId) url.searchParams.set('albumId', albumId);
    const r = await fetch(url.toString(), { headers: this.headers() });
    return await r.json();
  }

  async claimDevice(payload: any) {
    const r = await fetch(`${DPA_CONFIG.apiBaseUrl}/devices/claim`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    });
    return await r.json();
  }

  async claimCapsule(capsuleId: string) {
    const r = await fetch(`${DPA_CONFIG.apiBaseUrl}/capsules/${capsuleId}/claim`, {
      method: 'POST',
      headers: this.headers()
    });
    return await r.json();
  }

  async getAupCurrent() {
    const r = await fetch(`${DPA_CONFIG.apiBaseUrl}/aup/current`, { headers: this.headers() });
    return await r.json();
  }
}
