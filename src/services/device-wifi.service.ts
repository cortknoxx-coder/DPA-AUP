
import { Injectable, signal } from '@angular/core';
import { FirmwareStatus, Theme, DcnpEventType, DeviceTrack, StorageStatus, A2dpDevice, PlaybackMode, EqPreset } from '../types';

const DEFAULT_DEVICE_IP = '192.168.4.1';
const DEVICE_IP_KEY = 'dpa_device_ip';

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  open: boolean;
}

export interface WifiStatus {
  ap: { ssid: string; ip: string; clients: number };
  sta: { connected: boolean; ssid: string; ip: string; rssi: number };
}

@Injectable({ providedIn: 'root' })
export class DeviceWifiService {
  private baseUrl = `http://${DEFAULT_DEVICE_IP}`;

  isConnected = signal(false);
  lastStatus = signal<FirmwareStatus | null>(null);
  deviceIp = signal(DEFAULT_DEVICE_IP);
  staConnected = signal(false);
  staIp = signal('');

  constructor() {
    // Restore last known device IP from localStorage
    const savedIp = localStorage.getItem(DEVICE_IP_KEY);
    if (savedIp) {
      this.deviceIp.set(savedIp);
      this.baseUrl = `http://${savedIp}`;
    }
  }

  async probe(ip?: string): Promise<boolean> {
    if (ip) {
      this.deviceIp.set(ip);
      this.baseUrl = `http://${ip}`;
      localStorage.setItem(DEVICE_IP_KEY, ip);
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/status`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;

      const status = (await response.json()) as FirmwareStatus;
      this.lastStatus.set(status);
      this.isConnected.set(true);

      // If device reports a STA IP, save it for future connections
      if (status.sta?.connected && status.sta.ip) {
        this.staConnected.set(true);
        this.staIp.set(status.sta.ip);
        localStorage.setItem(DEVICE_IP_KEY, status.sta.ip);
      }

      return true;
    } catch {
      this.isConnected.set(false);
      return false;
    }
  }

  /** Try to find the device: saved IP first, then AP fallback */
  async autoConnect(): Promise<boolean> {
    const savedIp = localStorage.getItem(DEVICE_IP_KEY);

    // Try saved IP first (could be STA IP on home network)
    if (savedIp && savedIp !== DEFAULT_DEVICE_IP) {
      const ok = await this.probe(savedIp);
      if (ok) return true;
    }

    // Fall back to AP IP
    return this.probe(DEFAULT_DEVICE_IP);
  }

  async getStatus(): Promise<FirmwareStatus> {
    const response = await fetch(`${this.baseUrl}/api/status`);
    const status = (await response.json()) as FirmwareStatus;
    this.lastStatus.set(status);
    return status;
  }

  async getFanData(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/fan.json`);
    return response.json();
  }

  async getCreatorData(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/creator.json`);
    return response.json();
  }

  async sendCommand(opCode: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/cmd?op=${opCode}`);
      const result = await response.json();
      return result.ok === true;
    } catch {
      return false;
    }
  }

  async selectTrack(index: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/track?i=${index}`);
      const result = await response.json();
      return result.ok === true;
    } catch {
      return false;
    }
  }

  async getMeshPeers(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/mesh`);
    return response.json();
  }

  // --- POST endpoints (new firmware additions) ---

  async pushTheme(theme: Theme, brightness?: number): Promise<boolean> {
    try {
      // Flatten nested Theme into the flat key format the firmware expects
      const payload: Record<string, any> = {};
      if (brightness !== undefined) payload.brightness = brightness;
      if (theme.led) {
        if (theme.led.idle)     { payload.idle_color = theme.led.idle.color;     payload.idle_pattern = theme.led.idle.pattern; }
        if (theme.led.playback) { payload.play_color = theme.led.playback.color; payload.play_pattern = theme.led.playback.pattern; }
        if (theme.led.charging) { payload.charge_color = theme.led.charging.color; payload.charge_pattern = theme.led.charging.pattern; }
      }
      if (theme.dcnp) {
        payload.dcnp_concert = theme.dcnp.concert;
        payload.dcnp_video   = theme.dcnp.video;
        payload.dcnp_merch   = theme.dcnp.merch;
        payload.dcnp_signing = theme.dcnp.signing;
        payload.dcnp_remix   = theme.dcnp.remix;
        payload.dcnp_other   = theme.dcnp.other;
      }
      const response = await fetch(`${this.baseUrl}/api/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      return result.ok === true;
    } catch {
      return false;
    }
  }

  async pushCapsule(eventType: DcnpEventType, capsuleId: string, payload: any): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/capsule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, capsuleId, payload }),
      });
      const result = await response.json();
      return result.ok === true;
    } catch {
      return false;
    }
  }

  async pushManifest(manifest: any): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      });
      const result = await response.json();
      return result.ok === true;
    } catch {
      return false;
    }
  }

  // --- Storage & Tracks ---

  async getStorageInfo(): Promise<StorageStatus | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/storage`);
      return (await response.json()) as StorageStatus;
    } catch { return null; }
  }

  async getDeviceTracks(): Promise<DeviceTrack[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tracks`);
      const data = await response.json();
      return data.tracks ?? [];
    } catch { return []; }
  }

  // --- .dpa File Upload ---

  async uploadDpaFile(file: File, onProgress?: (percent: number) => void): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);

      const xhr = new XMLHttpRequest();
      return new Promise((resolve) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener('load', () => resolve(xhr.status === 200));
        xhr.addEventListener('error', () => resolve(false));
        xhr.open('POST', `${this.baseUrl}/api/upload`);
        xhr.send(formData);
      });
    } catch { return false; }
  }

  // --- Volume & EQ ---

  async setVolume(volume: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/volume?level=${volume}`);
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
  }

  async setEqPreset(preset: EqPreset): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/eq?preset=${preset}`);
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
  }

  async setPlaybackMode(mode: PlaybackMode): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/mode?mode=${mode}`);
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
  }

  // --- Bluetooth A2DP Audio ---

  async scanA2dpDevices(): Promise<A2dpDevice[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/a2dp/scan`);
      const data = await response.json();
      return data.devices ?? [];
    } catch { return []; }
  }

  async connectA2dp(addr: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/a2dp/connect?addr=${encodeURIComponent(addr)}`);
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
  }

  async disconnectA2dp(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/a2dp/disconnect`);
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
  }

  async getA2dpDevices(): Promise<A2dpDevice[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/a2dp/devices`);
      const data = await response.json();
      return data.devices ?? [];
    } catch { return []; }
  }

  // --- WiFi Station Management ---

  async getWifiStatus(): Promise<WifiStatus | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/wifi/status`, {
        signal: AbortSignal.timeout(4000),
      });
      return (await response.json()) as WifiStatus;
    } catch { return null; }
  }

  async scanWifiNetworks(): Promise<WifiNetwork[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/wifi/scan`, {
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json();
      return (data.networks ?? []) as WifiNetwork[];
    } catch { return []; }
  }

  async connectToWifi(ssid: string, password: string): Promise<{ ok: boolean; ip: string }> {
    try {
      const url = `${this.baseUrl}/api/wifi/connect?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(password)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (data.ok && data.ip) {
        this.staConnected.set(true);
        this.staIp.set(data.ip);
        localStorage.setItem(DEVICE_IP_KEY, data.ip);
      }
      return { ok: data.ok ?? false, ip: data.ip ?? '' };
    } catch {
      return { ok: false, ip: '' };
    }
  }

  async disconnectWifi(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/wifi/disconnect`);
      const data = await response.json();
      this.staConnected.set(false);
      this.staIp.set('');
      localStorage.removeItem(DEVICE_IP_KEY);
      return data.ok ?? false;
    } catch { return false; }
  }

  disconnect(): void {
    this.isConnected.set(false);
    this.lastStatus.set(null);
    this.staConnected.set(false);
    this.staIp.set('');
  }
}
