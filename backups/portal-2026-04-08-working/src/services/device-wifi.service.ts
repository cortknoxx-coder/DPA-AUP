
import { Injectable, signal } from '@angular/core';
import { FirmwareStatus, Theme, DcnpEventType, DeviceTrack, StorageStatus, A2dpDevice, PlaybackMode, EqPreset } from '../types';

const DEFAULT_DEVICE_IP = '192.168.4.1';
const DEVICE_IP_KEY = 'dpa_device_ip';

// When running on localhost (ng serve), route through Angular dev-server proxy
// to bypass Chrome Private Network Access / CORS blocks to the device LAN IP.
const IS_DEV_PROXY = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const DEV_API_BASE = '/dpa-api';       // proxied → http://192.168.4.1/api
const DEV_UPLOAD_BASE = '/dpa-upload'; // proxied → http://192.168.4.1:81

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
  private baseUrl = IS_DEV_PROXY ? DEV_API_BASE : `http://${DEFAULT_DEVICE_IP}`;
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
      if (!IS_DEV_PROXY) this.baseUrl = `http://${savedIp}`;
    }
  }

  async probe(ip?: string): Promise<boolean> {
    if (ip) {
      this.deviceIp.set(ip);
      if (!IS_DEV_PROXY) this.baseUrl = `http://${ip}`;
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

  /**
   * Pull artist + album directly from the device's live state.
   * Returns empty strings (not null) if the device hasn't been configured yet.
   */
  async pullMetadata(): Promise<{ ok: boolean; artist: string; album: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { ok: false, artist: '', album: '' };
      const status: any = await response.json();
      return {
        ok: true,
        artist: typeof status.artist === 'string' ? status.artist : '',
        album: typeof status.album === 'string' ? status.album : '',
      };
    } catch {
      return { ok: false, artist: '', album: '' };
    }
  }

  /**
   * Verify that /art/cover.jpg actually landed on the device SD card.
   * Real firmware serves artwork via GET /api/art?path=/art/cover.jpg —
   * we do a lightweight range-0 GET (HEAD isn't routed) and check the
   * status code. 200 = file exists on SD.
   */
  async verifyCoverArt(path: string = '/art/cover.jpg'): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/art?path=${encodeURIComponent(path)}&t=${Date.now()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },  // pull 1 byte, not the whole file
        signal: AbortSignal.timeout(4000),
      });
      return response.ok || response.status === 206;
    } catch {
      return false;
    }
  }

  /** Public URL for device-hosted artwork (cache-busted). */
  coverArtUrl(path: string = '/art/cover.jpg'): string {
    return `${this.baseUrl}/api/art?path=${encodeURIComponent(path)}&t=${Date.now()}`;
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
      // Pass-through artist/album when present (firmware updates SSID via /api/theme)
      if ((theme as any).artist) payload.artist = (theme as any).artist;
      if ((theme as any).album)  payload.album  = (theme as any).album;

      return await this.postWithTimeout(`${this.baseUrl}/api/theme`, payload, 8000);
    } catch {
      return false;
    }
  }

  /**
   * Dedicated metadata push — updates artist/album on device (drives SSID + NVS).
   * Returns { ok, reason } so the UI can show the real failure cause.
   */
  async pushMetadata(artist: string, album: string, timeoutMs = 8000):
    Promise<{ ok: boolean; reason?: 'timeout' | 'network' | 'http' | 'firmware' | 'empty' }> {
    if (!artist && !album) return { ok: false, reason: 'empty' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/theme`, {
        method: 'POST',
        // text/plain avoids a CORS preflight (application/json triggers OPTIONS,
        // which the firmware's sync handler doesn't answer). Firmware parses the
        // body with a raw jsonVal() helper, so the content-type header is irrelevant.
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ artist, album }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return { ok: false, reason: 'http' };
      const result = await response.json().catch(() => null);
      if (!result) return { ok: false, reason: 'firmware' };
      return result.ok === true ? { ok: true } : { ok: false, reason: 'firmware' };
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'network' };
    }
  }

  private async postWithTimeout(url: string, payload: any, timeoutMs: number): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        // text/plain = simple request, no CORS preflight. Firmware parses body as raw text.
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return false;
      const result = await response.json().catch(() => null);
      return !!result && result.ok === true;
    } catch {
      clearTimeout(timer);
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
      const flat: Record<string, any> = {
        eventType,
        capsuleId,
        title: payload?.title || 'Capsule',
        description: payload?.description || '',
        date: payload?.metadata?.date || new Date().toISOString(),
        delivered: false,
      };
      if (typeof payload?.price === 'number') flat.price = payload.price;
      if (payload?.cta?.label) flat.ctaLabel = payload.cta.label;
      if (payload?.cta?.url)   flat.ctaUrl   = payload.cta.url;
      if (payload?.imageUrl)   flat.hasImage  = true;

      const response = await fetch(`${this.baseUrl}/api/capsule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flat),
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

  async getAnalytics(): Promise<
    {
      idx: number;
      path?: string;
      plays: number;
      skips: number;
      listenMs: number;
      lastPlayedAt?: number;
      rating: number;
    }[]
  > {
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

  // --- Delete File from SD ---

  async deleteFile(path: string): Promise<boolean> {
    try {
      await this.ensureAdminUnlocked();
      const response = await fetch(`${this.baseUrl}/api/sd/delete?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      return result.ok === true;
    } catch { return false; }
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
        xhr.addEventListener('error', () => {
          console.error('[Upload] XHR error event');
          resolve(false);
        });
        xhr.addEventListener('timeout', () => {
          console.error('[Upload] XHR timeout');
          resolve(false);
        });
        xhr.timeout = 0;  // No timeout — large files over ESP32 AP WiFi can take 30+ minutes
        const formData = new FormData();
        formData.append('file', file, file.name);
        // Real Phase-4 firmware runs a synchronous WebServer on port 81
        // specifically for reliable large-file uploads (matches the DPAC
        // uploader pattern). Port 80 AsyncWebServer can stall on big files.
        // In dev mode we route via the Angular proxy (/dpa-upload → :81).
        const uploadUrl = IS_DEV_PROXY
          ? DEV_UPLOAD_BASE
          : `http://${this.baseUrl.replace(/^https?:\/\//, '').replace(/[:/].*$/, '')}:81`;
        xhr.open('POST', `${uploadUrl}/api/sd/upload?path=${encodeURIComponent(path)}`);
        xhr.send(formData);
      });
    } catch (err) {
      console.error('[Upload] Transfer error:', err);
      return false;
    }
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
