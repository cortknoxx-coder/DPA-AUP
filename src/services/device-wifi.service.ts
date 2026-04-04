
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

export type LedPreviewMode = 'idle' | 'playback' | 'charging';

export interface LedPreviewParams {
  color?: string;
  pattern?: string;
  brightness?: number;
  gradEnd?: string;
}

@Injectable({ providedIn: 'root' })
export class DeviceWifiService {
  private baseUrl = `http://${DEFAULT_DEVICE_IP}`;
  private isAdminUnlocked = false;

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
        signal: AbortSignal.timeout(5000),
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
      // Firmware parses "op" as hexadecimal string (base 16).
      const opHex = opCode.toString(16).padStart(2, '0');
      const response = await fetch(`${this.baseUrl}/api/cmd?op=${opHex}`);
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

  async playFile(path: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/audio/play?file=${encodeURIComponent(path)}`);
      const result = await response.json();
      return result.ok === true;
    } catch {
      return false;
    }
  }

  async getMeshPeers(): Promise<any> {
    // Mesh endpoint not implemented in current firmware build.
    return { active: false, peers: 0, peerList: [] };
  }

  // --- POST endpoints (new firmware additions) ---

  async pushTheme(theme: Theme, brightness?: number, gradEnd?: string): Promise<boolean> {
    try {
      // Flatten nested Theme into the flat key format the firmware expects
      const payload: Record<string, any> = {};
      if (brightness !== undefined) payload.brightness = brightness;
      if (gradEnd) payload.grad_end = gradEnd;
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

  async previewLed(mode: LedPreviewMode, params: LedPreviewParams): Promise<boolean> {
    try {
      const query = new URLSearchParams();
      query.set('mode', mode);
      if (params.color) query.set('color', params.color);
      if (params.pattern) query.set('pattern', params.pattern);
      if (params.gradEnd) query.set('gradEnd', params.gradEnd);
      if (typeof params.brightness === 'number') {
        query.set('brightness', String(Math.max(0, Math.min(100, Math.round(params.brightness)))));
      }
      const response = await fetch(`${this.baseUrl}/api/led/preview?${query.toString()}`);
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
    // Manifest ingest endpoint is not implemented in current firmware.
    // Keep method for API compatibility while returning false explicitly.
    return false;
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
      // Prefer neutral track endpoint for DPA/WAV mixed libraries.
      const response = await fetch(`${this.baseUrl}/api/audio/tracks`);
      if (response.ok) {
        const data = await response.json();
        const tracks = data.tracks ?? [];
        return tracks.map((t: any, i: number) => this.mapTrackResponse(t, i));
      }
    } catch { return []; }
    try {
      // Legacy firmware fallback: WAV-only endpoint.
      const response = await fetch(`${this.baseUrl}/api/audio/wavs`);
      const data = await response.json();
      const wavs = data.wavs ?? [];
      return wavs.map((w: any, i: number) => this.mapTrackResponse({ ...w, format: 'wav', codec: 'wav' }, i));
    } catch { return []; }
  }

  private mapTrackResponse(track: any, i: number): DeviceTrack {
    const path: string = track.path || track.file || track.filename || '';
    const title =
      track.title ||
      path
        .split('/')
        .pop()
        ?.replace(/\.(wav|dpa)$/i, '')
        .replace(/_/g, ' ') ||
      `Track ${i + 1}`;
    const sizeBytes = Number(track.size || 0);
    return {
      index: Number(track.idx ?? track.index ?? i),
      filename: path,
      title,
      sizeMB: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
      plays: Number(track.plays || 0),
      durationMs: Number(track.durationMs || 0),
      format: track.format === 'dpa' ? 'dpa' : 'wav',
      codec: track.codec || (track.format === 'dpa' ? 'wav' : 'wav'),
      sampleRate: track.sampleRate ? Number(track.sampleRate) : undefined,
      channels: track.channels ? Number(track.channels) : undefined,
      bitsPerSample: track.bitsPerSample ? Number(track.bitsPerSample) : undefined,
    } as DeviceTrack;
  }

  async getCapsules(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/capsules`);
      const data = await response.json();
      return data.capsules ?? [];
    } catch {
      return [];
    }
  }

  async getAnalytics(): Promise<{ idx: number; plays: number; skips: number; listenMs: number; rating: number }[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/analytics`);
      const data = await response.json();
      return data.tracks ?? [];
    } catch {
      return [];
    }
  }

  async getFavorites(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/favorites`);
      const data = await response.json();
      return data.favorites ?? [];
    } catch {
      return [];
    }
  }

  async setFavorite(path: string, state: boolean): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/favorites/set?file=${encodeURIComponent(path)}&state=${state ? 'true' : 'false'}`
      );
      const data = await response.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }

  // --- .dpa File Upload ---

  async uploadDpaFile(file: File, onProgress?: (percent: number) => void): Promise<boolean> {
    return this.uploadFileToPath(file, `/tracks/${file.name}`, onProgress);
  }

  async uploadFileToPath(file: File, path: string, onProgress?: (percent: number) => void): Promise<boolean> {
    try {
      await this.ensureAdminUnlocked();
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
        // Firmware supports SD multipart uploads at /api/sd/upload.
        xhr.open('POST', `${this.baseUrl}/api/sd/upload?path=${encodeURIComponent(path)}`);
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
      // Portal UI alias -> firmware canonical preset
      const mapped = preset === 'bass' ? 'bass_boost' : preset;
      const response = await fetch(`${this.baseUrl}/api/eq?preset=${mapped}`);
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
  }

  async setPlaybackMode(mode: PlaybackMode): Promise<boolean> {
    try {
      // Firmware currently supports only normal/repeat_one.
      if (mode !== 'normal' && mode !== 'repeat_one') return false;
      const response = await fetch(`${this.baseUrl}/api/mode?mode=${mode}`);
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
  }

  // --- Bluetooth A2DP Audio ---

  async scanA2dpDevices(): Promise<A2dpDevice[]> {
    // A2DP scan endpoint is not implemented in current firmware.
    return [];
  }

  async connectA2dp(addr: string): Promise<boolean> {
    // A2DP connect endpoint is not implemented in current firmware.
    return false;
  }

  async disconnectA2dp(): Promise<boolean> {
    // A2DP disconnect endpoint is not implemented in current firmware.
    return false;
  }

  async getA2dpDevices(): Promise<A2dpDevice[]> {
    // A2DP devices endpoint is not implemented in current firmware.
    return [];
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
      await this.ensureAdminUnlocked();
      const response = await fetch(`${this.baseUrl}/api/wifi/scan`, {
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json();
      return (data.networks ?? []) as WifiNetwork[];
    } catch { return []; }
  }

  async connectToWifi(ssid: string, password: string): Promise<{ ok: boolean; ip: string }> {
    try {
      await this.ensureAdminUnlocked();
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
      await this.ensureAdminUnlocked();
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
    this.isAdminUnlocked = false;
  }

  private async ensureAdminUnlocked(): Promise<void> {
    if (this.isAdminUnlocked) return;
    const status = this.lastStatus();
    const duid = status?.duid;
    if (!duid) return;
    try {
      const res = await fetch(`${this.baseUrl}/api/admin/unlock?key=${encodeURIComponent(duid)}`);
      if (res.ok) this.isAdminUnlocked = true;
    } catch {
      // best effort; endpoint callers will fail naturally if still locked
    }
  }
}
