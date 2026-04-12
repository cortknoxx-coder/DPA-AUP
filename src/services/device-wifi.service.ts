
import { Injectable, signal } from '@angular/core';
import {
  FirmwareStatus,
  Theme,
  DcnpEventType,
  DeviceTrack,
  StorageStatus,
  A2dpDevice,
  PlaybackMode,
  EqPreset,
  DeviceCapsuleRecord,
  DeviceBookletPayload,
  DeviceAlbumMetaPayload,
} from '../types';
import {
  normalizeDeviceAlbumMetaPayload,
  normalizeDeviceBookletPayload,
  normalizeDeviceCapsuleRecord,
} from './device-content.utils';
import {
  isHostedHttps,
  readDeviceTunnelOverride,
  readDeviceUploadTunnelOverride,
} from '../dpa-device-http';

const DEFAULT_DEVICE_IP = '192.168.4.1';
const DEVICE_IP_KEY = 'dpa_device_ip';

// When running on localhost (ng serve), route through Angular dev-server proxy
// to bypass Chrome Private Network Access / CORS blocks to the device LAN IP.
const IS_DEV_PROXY = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const DEV_API_BASE = '/dpa-api';       // proxied → http://192.168.4.1/api
const DEV_UPLOAD_BASE = '/dpa-upload'; // proxied → http://192.168.4.1:81
const STATUS_CACHE_WINDOW_MS = 1000;
const STATUS_UPLOAD_FALLBACK_MS = 15000;

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  open: boolean;
}

export interface WifiStatus {
  ap: { ssid: string; ip: string; clients: number };
  sta: { connected: boolean; ssid: string; ip: string; rssi: number; joinPending?: boolean };
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
  private uploadQueue: Promise<unknown> = Promise.resolve();
  private statusRequest: Promise<FirmwareStatus | null> | null = null;
  private lastStatusAt = 0;
  private preferredStatusPlane: 'main' | 'upload' = 'main';
  private uploadStatusFallbackUntil = 0;

  isConnected = signal(false);
  lastStatus = signal<FirmwareStatus | null>(null);
  deviceIp = signal(DEFAULT_DEVICE_IP);
  staConnected = signal(false);
  staIp = signal('');
  contentRevision = signal(0);
  private artRevision = signal(0);

  constructor() {
    const savedIp = localStorage.getItem(DEVICE_IP_KEY);
    if (savedIp) {
      this.deviceIp.set(savedIp);
    }
    this.baseUrl = this.computeDeviceHttpRoot(savedIp || undefined);
  }

  private computeDeviceHttpRoot(ipOverride?: string): string {
    if (IS_DEV_PROXY) return DEV_API_BASE;
    if (isHostedHttps()) return '/dpa-api';
    const tunnel = readDeviceTunnelOverride();
    if (tunnel) return tunnel.replace(/\/$/, '');
    const ip = ipOverride ?? this.deviceIp();
    return `http://${ip}`;
  }

  private sanitizeDevicePath(path: string): string {
    let out = path.startsWith('/') ? path : `/${path}`;
    out = out.replace(/ /g, '_');
    out = out.replace(/[()']/g, '');
    out = out.replace(/[&#]/g, '_');
    return out;
  }

  async probe(ip?: string): Promise<boolean> {
    if (ip) {
      this.deviceIp.set(ip);
      localStorage.setItem(DEVICE_IP_KEY, ip);
      this.baseUrl = this.computeDeviceHttpRoot(ip);
    }

    const status = await this.fetchStatusJson(3500, { forceRefresh: true, maxAgeMs: 0 });
    if (status) {
      this.syncStatusSignals(status);
      return true;
    }

    this.isConnected.set(false);
    if (!ip) {
      const recovered = await this.reprobeAfterTransientFailure();
      if (recovered) {
        this.isConnected.set(true);
        return true;
      }
    }

    this.isConnected.set(false);
    return false;
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

  async getStatus(options?: { timeoutMs?: number; maxAgeMs?: number; forceRefresh?: boolean }): Promise<FirmwareStatus> {
    const status = await this.fetchStatusJson(options?.timeoutMs ?? 5000, {
      maxAgeMs: options?.maxAgeMs ?? STATUS_CACHE_WINDOW_MS,
      forceRefresh: options?.forceRefresh,
    });
    if (!status) {
      this.isConnected.set(false);
      throw new Error('Device status unavailable');
    }
    return status;
  }

  /**
   * Pull artist + album directly from the device's live state.
   * Returns empty strings (not null) if the device hasn't been configured yet.
   */
  async pullMetadata(): Promise<{ ok: boolean; artist: string; album: string }> {
    const status = await this.fetchStatusJson(4000, { maxAgeMs: 2000 });
    if (!status) {
      return { ok: false, artist: '', album: '' };
    }
    return {
      ok: true,
      artist: typeof status.artist === 'string' ? status.artist : '',
      album: typeof status.album === 'string' ? status.album : '',
    };
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
    return `${this.baseUrl}/api/art?path=${encodeURIComponent(path)}&rev=${this.assetCacheKey(path)}`;
  }

  coverArtCandidateUrls(paths: string[] = ['/art/cover.jpg', '/art/cover.png']): string[] {
    return paths.map((path) => this.coverArtUrl(path));
  }

  async resolveAvailableCoverArtPath(paths: string[] = ['/art/cover.jpg', '/art/cover.png']): Promise<string | null> {
    for (const path of paths) {
      if (await this.verifyCoverArt(path)) return path;
    }
    return null;
  }

  /** Per-track artwork URL from device SD: /art/{stem}.jpg */
  trackArtUrl(trackFilename: string): string {
    const base = trackFilename.split('/').pop() || trackFilename;
    const stem = base.replace(/\.(wav|dpa|WAV|DPA)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'track';
    const path = `/art/${stem}.jpg`;
    return `${this.baseUrl}/api/art?path=${encodeURIComponent(path)}&rev=${this.assetCacheKey(path)}`;
  }

  trackArtCandidateUrls(trackFilename: string): string[] {
    const base = trackFilename.split('/').pop() || trackFilename;
    const stem = base.replace(/\.(wav|dpa|WAV|DPA)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'track';
    return ['jpg', 'png', 'webp'].map((ext) =>
      `${this.baseUrl}/api/art?path=${encodeURIComponent(`/art/${stem}.${ext}`)}&rev=${this.assetCacheKey(`/art/${stem}.${ext}`)}`
    );
  }

  async getFanData(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/fan.json`);
    return response.json();
  }

  async getCreatorData(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/creator.json`);
    return response.json();
  }

  async getBookletData(): Promise<DeviceBookletPayload | null> {
    return this.fetchJsonFile('/api/booklet', normalizeDeviceBookletPayload);
  }

  async pushBookletData(payload: DeviceBookletPayload): Promise<boolean> {
    return this.persistJsonFile('/data/booklet.json', 'booklet.json', payload);
  }

  async getAlbumMeta(): Promise<DeviceAlbumMetaPayload | null> {
    return this.fetchJsonFile('/api/album/meta', normalizeDeviceAlbumMetaPayload);
  }

  async pushAlbumMeta(payload: DeviceAlbumMetaPayload): Promise<boolean> {
    return this.persistJsonFile('/data/album_meta.json', 'album-meta.json', payload);
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

      const ok = await this.postWithTimeout(`${this.baseUrl}/api/theme`, payload, 8000);
      if (ok) {
        this.invalidateAfterMutation('/api/theme', { content: false, artwork: false });
      }
      return ok;
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
      if (result.ok === true) {
        this.invalidateAfterMutation('/api/theme', { content: true, artwork: false });
        return { ok: true };
      }
      return { ok: false, reason: 'firmware' };
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
        delivered: true,
      };
      if (typeof payload?.price === 'number') flat.price = payload.price;
      if (payload?.cta?.label) flat.ctaLabel = payload.cta.label;
      if (payload?.cta?.url)   flat.ctaUrl   = payload.cta.url;
      if (payload?.imageUrl)   flat.hasImage  = true;

      const response = await fetch(`${this.baseUrl}/api/capsule`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(flat),
      });
      const result = await response.json();
      if (result.ok === true) {
        this.invalidateAfterMutation(`/capsules/${capsuleId}`, { content: true, artwork: false });
        return true;
      }
      return false;
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
      const response = await fetch(`${this.baseUrl}/api/storage`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      return (await response.json()) as StorageStatus;
    } catch { return null; }
  }

  async getDeviceTracks(): Promise<DeviceTrack[]> {
    try {
      // Prefer neutral track endpoint for DPA/WAV mixed libraries.
      const response = await fetch(`${this.baseUrl}/api/audio/tracks`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (response.ok) {
        const data = await response.json();
        const tracks = data.tracks ?? [];
        return tracks.map((t: any, i: number) => this.mapTrackResponse(t, i));
      }
    } catch { return []; }
    try {
      // Legacy firmware fallback: WAV-only endpoint.
      const response = await fetch(`${this.baseUrl}/api/audio/wavs`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
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

  async getCapsules(): Promise<DeviceCapsuleRecord[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/capsules`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      const data = await response.json();
      return (data.capsules ?? []).map((capsule: any) => normalizeDeviceCapsuleRecord(capsule));
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
      const response = await fetch(`${this.baseUrl}/api/analytics`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      const data = await response.json();
      return data.tracks ?? [];
    } catch {
      return [];
    }
  }

  async getFavorites(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/favorites`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
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
      if (data.ok === true) {
        this.clearTransientCaches({ content: false, artwork: false });
        return true;
      }
      return false;
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
      if (result.ok === true) {
        this.invalidateAfterMutation(path, { content: true, artwork: path.startsWith('/art/') });
        return true;
      }
      return false;
    } catch { return false; }
  }

  // --- .dpa File Upload ---

  async uploadDpaFile(file: File, onProgress?: (percent: number) => void): Promise<boolean> {
    return this.uploadFileToPath(file, `/tracks/${file.name}`, onProgress);
  }

  async uploadFileToPath(file: File, path: string, onProgress?: (percent: number) => void): Promise<boolean> {
    return this.enqueueUpload(async () => {
      await this.ensureAdminUnlocked();
      const writable = await this.waitForWritableWindow();
      if (!writable) {
        return false;
      }
      const devicePath = this.sanitizeDevicePath(path);
      const deviceFilename = devicePath.split('/').pop() || file.name;
      const maxAttempts = file.size > 8 * 1024 * 1024 ? 3 : 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const transferred = await this.runUploadAttempt(file, devicePath, onProgress);
        if (transferred) {
          await this.waitForUploadStateToSettle();
          const verified = await this.verifyUploadPath(devicePath, deviceFilename);
          if (verified) {
            this.invalidateAfterMutation(devicePath, {
              bytes: file.size,
              content: true,
              artwork: devicePath.startsWith('/art/'),
            });
            onProgress?.(100);
            return true;
          }
          console.warn(`[Upload] Verification failed for ${devicePath} on attempt ${attempt}`);
        } else {
          console.warn(`[Upload] Transfer failed for ${devicePath} on attempt ${attempt}`);
        }

        if (attempt < maxAttempts) {
          await this.reprobeAfterTransientFailure();
          await this.sleep(350 * attempt);
        }
      }

      return false;
    }).catch((err) => {
      console.error('[Upload] Transfer error:', err);
      return false;
    });
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
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (data.pending) {
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 500));
          const st = await this.getWifiStatus();
          if (!st?.sta) continue;
          if (st.sta.joinPending) continue;
          if (st.sta.connected && st.sta.ip) {
            this.staConnected.set(true);
            this.staIp.set(st.sta.ip);
            localStorage.setItem(DEVICE_IP_KEY, st.sta.ip);
            return { ok: true, ip: st.sta.ip };
          }
          return { ok: false, ip: '' };
        }
        return { ok: false, ip: '' };
      }
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

  async configurePrivateIngest(baseUrl: string, deviceToken: string): Promise<boolean> {
    try {
      await this.ensureAdminUnlocked();
      const url = `${this.baseUrl}/api/ingest/config?base=${encodeURIComponent(baseUrl)}&token=${encodeURIComponent(deviceToken)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json();
      return payload.ok === true;
    } catch {
      return false;
    }
  }

  async clearPrivateIngestConfiguration(): Promise<boolean> {
    try {
      await this.ensureAdminUnlocked();
      const response = await fetch(`${this.baseUrl}/api/ingest/clear`, {
        signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json();
      return payload.ok === true;
    } catch {
      return false;
    }
  }

  async pushFileToPrivateIngest(
    path: string,
    albumId: string,
    kind = 'support'
  ): Promise<{ ok: boolean; state?: string; lastError?: string; lastSessionId?: string }> {
    try {
      await this.ensureAdminUnlocked();
      const url = `${this.baseUrl}/api/ingest/push?path=${encodeURIComponent(path)}&albumId=${encodeURIComponent(albumId)}&kind=${encodeURIComponent(kind)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(120000),
      });
      const payload = await response.json();
      return {
        ok: payload.ok === true,
        state: payload.state,
        lastError: payload.lastError,
        lastSessionId: payload.lastSessionId,
      };
    } catch {
      return { ok: false, lastError: 'request_failed' };
    }
  }

  disconnect(): void {
    this.isConnected.set(false);
    this.lastStatus.set(null);
    this.staConnected.set(false);
    this.staIp.set('');
    this.isAdminUnlocked = false;
    this.lastStatusAt = 0;
    this.statusRequest = null;
    this.preferredStatusPlane = 'main';
    this.uploadStatusFallbackUntil = 0;
  }

  clearTransientCaches(options?: { content?: boolean; artwork?: boolean }) {
    this.lastStatusAt = 0;
    this.statusRequest = null;
    this.uploadStatusFallbackUntil = 0;
    if (options?.content) {
      this.contentRevision.update((value) => value + 1);
    }
    if (options?.artwork || options?.content) {
      this.artRevision.update((value) => value + 1);
    }
  }

  private syncStatusSignals(status: FirmwareStatus) {
    this.lastStatus.set(status);
    this.isConnected.set(true);
    this.lastStatusAt = Date.now();

    if (status.sta?.connected && status.sta.ip) {
      this.staConnected.set(true);
      this.staIp.set(status.sta.ip);
      localStorage.setItem(DEVICE_IP_KEY, status.sta.ip);
    } else {
      this.staConnected.set(false);
      this.staIp.set('');
    }
  }

  private assetCacheKey(path: string): string {
    const revision = this.artRevision();
    const status = this.lastStatus();
    const coverBytes = status?.coverBytes ?? 0;
    const lastUploadPath = status?.lastUploadPath ?? '';
    const lastUploadBytes = status?.lastUploadBytes ?? 0;
    const uploadToken = lastUploadPath === path ? lastUploadBytes : 0;
    return `${revision}-${coverBytes}-${uploadToken}`;
  }

  private noteOptimisticMutation(path: string, bytes?: number) {
    const current = this.lastStatus();
    if (!current) return;
    this.lastStatus.set({
      ...current,
      lastUploadPath: path,
      lastUploadBytes: typeof bytes === 'number' ? bytes : current.lastUploadBytes,
    });
  }

  private invalidateAfterMutation(
    path: string,
    options?: { bytes?: number; content?: boolean; artwork?: boolean; refreshStatus?: boolean }
  ) {
    this.noteOptimisticMutation(path, options?.bytes);
    this.clearTransientCaches({
      content: options?.content ?? true,
      artwork: options?.artwork ?? path.startsWith('/art/'),
    });
    if (options?.refreshStatus === false) return;
    void this.fetchStatusJson(4000, { forceRefresh: true, maxAgeMs: 0 }).catch(() => null);
  }

  private uploadBaseUrl(): string {
    if (IS_DEV_PROXY) return DEV_UPLOAD_BASE;
    const uploadTunnel = readDeviceUploadTunnelOverride();
    // Hosted HTTPS can use a direct HTTPS upload tunnel to bypass
    // Vercel request-body limits for large device transfers.
    if (uploadTunnel) return uploadTunnel.replace(/\/$/, '');
    if (isHostedHttps()) return '/dpa-upload';
    const mainTunnel = readDeviceTunnelOverride();
    if (mainTunnel && isHostedHttps()) {
      try {
        const u = new URL(mainTunnel);
        u.port = '81';
        return u.origin;
      } catch {
        /* fall through */
      }
    }
    const host = this.baseUrl.replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
    return `http://${host}:81`;
  }

  private isCrossOriginRequest(url: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      return new URL(url, window.location.href).origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  private async fetchStatusJson(
    timeoutMs: number,
    options?: { forceRefresh?: boolean; maxAgeMs?: number; preferUploadPlane?: boolean }
  ): Promise<FirmwareStatus | null> {
    const maxAgeMs = options?.maxAgeMs ?? 0;
    const cached = this.lastStatus();
    if (!options?.forceRefresh && cached && (Date.now() - this.lastStatusAt) <= maxAgeMs) {
      return cached;
    }
    if (!options?.forceRefresh && this.statusRequest) {
      return this.statusRequest;
    }

    const request = this.fetchStatusJsonUncached(timeoutMs, options?.preferUploadPlane).finally(() => {
      if (this.statusRequest === request) {
        this.statusRequest = null;
      }
    });
    this.statusRequest = request;
    return request;
  }

  private async fetchStatusJsonUncached(timeoutMs: number, preferUploadPlane = false): Promise<FirmwareStatus | null> {
    for (const { plane, url } of this.statusUrlsInPriorityOrder(preferUploadPlane)) {
      try {
        const init: RequestInit = {
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        };
        if (!this.isCrossOriginRequest(url)) {
          init.headers = {
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          };
        }
        const response = await fetch(url, init);
        if (!response.ok) continue;
        const status = (await response.json()) as FirmwareStatus;
        this.preferredStatusPlane = plane;
        if (plane === 'upload' || this.shouldPreferUploadStatus(status)) {
          this.uploadStatusFallbackUntil = Date.now() + STATUS_UPLOAD_FALLBACK_MS;
        } else {
          this.uploadStatusFallbackUntil = 0;
        }
        this.syncStatusSignals(status);
        return status;
      } catch {
        // Try the next status plane.
      }
    }
    return null;
  }

  private statusUrlsInPriorityOrder(preferUploadPlane = false): Array<{ plane: 'main' | 'upload'; url: string }> {
    const uploadPreferred =
      preferUploadPlane ||
      this.preferredStatusPlane === 'upload' ||
      Date.now() < this.uploadStatusFallbackUntil ||
      this.shouldPreferUploadStatus(this.lastStatus());

    const main = { plane: 'main' as const, url: `${this.baseUrl}/api/status` };
    const upload = { plane: 'upload' as const, url: `${this.uploadBaseUrl()}/api/status` };
    return uploadPreferred ? [upload, main] : [main, upload];
  }

  private shouldPreferUploadStatus(status: FirmwareStatus | null): boolean {
    const uploadState = status?.uploadState ?? 'idle';
    return ['preparing', 'receiving', 'verifying', 'finalizing'].includes(uploadState)
      || status?.httpMode === 'minimal';
  }

  private async reprobeAfterTransientFailure(): Promise<boolean> {
    const candidates = [
      this.deviceIp(),
      localStorage.getItem(DEVICE_IP_KEY) || '',
      DEFAULT_DEVICE_IP,
    ].filter((value, index, arr) => !!value && arr.indexOf(value) === index);

    for (const candidate of candidates) {
      if (await this.probe(candidate)) {
        return true;
      }
      await this.sleep(200);
    }
    return false;
  }

  private async runUploadAttempt(file: File, path: string, onProgress?: (percent: number) => void): Promise<boolean> {
    const uploadUrl = `${this.uploadBaseUrl()}/api/sd/upload?path=${encodeURIComponent(path)}`;
    if (this.isCrossOriginRequest(uploadUrl)) {
      let stopProgressMonitor: (() => void) | null = null;
      try {
        // Cross-origin upload responses can be blocked by the browser even when
        // the device accepted the payload. Send the transfer as no-cors and
        // rely on the existing post-upload verification path to confirm success.
        this.preferredStatusPlane = 'upload';
        this.uploadStatusFallbackUntil = Date.now() + STATUS_UPLOAD_FALLBACK_MS;
        const formData = new FormData();
        formData.append('file', file, file.name);
        stopProgressMonitor = onProgress
          ? this.startCrossOriginUploadProgressMonitor(path, file.size, onProgress)
          : null;
        await fetch(uploadUrl, {
          method: 'POST',
          mode: 'no-cors',
          cache: 'no-store',
          body: formData,
        });
        return true;
      } catch (error) {
        console.error('[Upload] no-cors upload failed', error);
        return false;
      } finally {
        stopProgressMonitor?.();
      }
    }

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }
      xhr.addEventListener('load', () => resolve(xhr.status >= 200 && xhr.status < 300));
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
      xhr.open('POST', uploadUrl);
      xhr.send(formData);
    });
  }

  private async waitForUploadStateToSettle(maxWaitMs = 12000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const status = await this.fetchStatusJson(3000, { forceRefresh: true, maxAgeMs: 0, preferUploadPlane: true });
      if (!status) {
        await this.sleep(300);
        continue;
      }

      const uploadState = status.uploadState ?? 'idle';
      if (!['preparing', 'receiving', 'verifying', 'finalizing'].includes(uploadState)) {
        return;
      }
      await this.sleep(400);
    }
  }

  private startCrossOriginUploadProgressMonitor(
    path: string,
    totalBytes: number,
    onProgress: (percent: number) => void
  ): () => void {
    let stopped = false;
    let lastPercent = 1;
    onProgress(lastPercent);

    void (async () => {
      while (!stopped) {
        try {
          const status = await this.fetchStatusJson(2500, { forceRefresh: true, maxAgeMs: 0, preferUploadPlane: true });
          const percent = this.estimateCrossOriginUploadProgress(path, totalBytes, status);
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress(percent);
          }
        } catch {
          // Best-effort progress only.
        }
        if (!stopped) {
          await this.sleep(900);
        }
      }
    })();

    return () => {
      stopped = true;
    };
  }

  private estimateCrossOriginUploadProgress(path: string, totalBytes: number, status: FirmwareStatus | null): number {
    const uploadState = status?.uploadState ?? 'idle';
    const lastUploadPath = status?.lastUploadPath ?? '';
    const lastUploadBytes = Number(status?.lastUploadBytes ?? 0);
    if (lastUploadPath === path && totalBytes > 0 && lastUploadBytes > 0) {
      return Math.max(1, Math.min(95, Math.round((lastUploadBytes / totalBytes) * 100)));
    }
    if (uploadState === 'preparing') return 3;
    if (uploadState === 'receiving') return 10;
    if (uploadState === 'verifying') return 95;
    if (uploadState === 'finalizing') return 97;
    return 1;
  }

  private async waitForWritableWindow(maxWaitMs = 10000): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const status = await this.fetchStatusJson(3000);
      if (!status) {
        await this.sleep(300);
        continue;
      }

      const uploadState = status.uploadState ?? 'idle';
      const bootState = status.bootState ?? 'ready';
      const sdState = status.sdState ?? 'unknown';
      const writable = bootState !== 'booting'
        && sdState !== 'error'
        && !['preparing', 'receiving', 'verifying', 'finalizing'].includes(uploadState);
      if (writable) return true;

      await this.sleep(400);
    }
    return false;
  }

  private async verifyUploadPath(path: string, filename: string): Promise<boolean> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const lower = normalizedPath.toLowerCase();

    if (lower === '/art/cover.jpg' || lower === '/art/cover.png' || lower.startsWith('/art/')) {
      return this.verifyCoverArt(normalizedPath);
    }

    if (lower === '/data/booklet.json') {
      return (await this.getBookletData()) !== null;
    }

    if (lower === '/data/album_meta.json') {
      return (await this.getAlbumMeta()) !== null;
    }

    if (lower.startsWith('/tracks/')) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const tracks = await this.getDeviceTracks();
        const trackIndexed = tracks.some((track) => {
          const trackName = track.filename.split('/').pop() || track.filename;
          return track.filename === normalizedPath || trackName === filename;
        });
        if (trackIndexed) return true;
        if (await this.fileExistsOnDevice(normalizedPath)) return true;
        await this.sleep(700 * (attempt + 1));
      }
      return false;
    }

    return this.fileExistsOnDevice(normalizedPath);
  }

  private async fileExistsOnDevice(path: string): Promise<boolean> {
    try {
      await this.ensureAdminUnlocked();
      const slash = path.lastIndexOf('/');
      const dir = slash > 0 ? path.slice(0, slash) : '/';
      const name = slash >= 0 ? path.slice(slash + 1) : path;
      const response = await fetch(`${this.baseUrl}/api/sd/files?dir=${encodeURIComponent(dir)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return false;
      const payload = await response.json();
      const files = Array.isArray(payload?.files) ? payload.files : [];
      return files.some((entry: any) => {
        const entryPath = String(entry?.path || entry?.name || '');
        const entryName = entryPath.split('/').pop() || entryPath;
        return entryPath === path || entryName === name;
      });
    } catch {
      return false;
    }
  }

  private enqueueUpload<T>(task: () => Promise<T>): Promise<T> {
    const next = this.uploadQueue.then(task, task);
    this.uploadQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  private async fetchJsonFile<T>(path: string, normalize: (raw: any) => T | null): Promise<T | null> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (!response.ok) return null;
      return normalize(await response.json());
    } catch {
      return null;
    }
  }

  private async persistJsonFile(path: string, filename: string, payload: unknown): Promise<boolean> {
    try {
      const file = new File(
        [new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })],
        filename,
        { type: 'application/json' }
      );
      return this.uploadFileToPath(file, path);
    } catch {
      return false;
    }
  }
}
