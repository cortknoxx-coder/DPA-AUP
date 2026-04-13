
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
const STATUS_CACHE_WINDOW_MS = 2500;
const STATUS_RATE_LIMIT_BACKOFF_MS = 5000;
const STATUS_STALE_FALLBACK_MS = 12000;
const STATUS_UPLOAD_FALLBACK_MS = 15000;
const MAIN_CONTROL_PLANE_BACKOFF_MS = 15000;

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
  private statusRateLimitedUntil = 0;
  private mainControlPlaneUnavailableUntil = 0;
  private hostedHelperAvailability: { ok: boolean; checkedAt: number } | null = null;
  private coverPathCache: { key: string; path: string | null; checkedAt: number } | null = null;

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

  requiresHostedLocalHelper(): boolean {
    return false;
  }

  hostedHelperUnavailableMessage(): string {
    return 'Hosted mode now uses the Vercel control plane for cloud access. Use WiFi only for a real local-direct DPA connection on the same network.';
  }

  private computeDeviceHttpRoot(ipOverride?: string): string {
    if (IS_DEV_PROXY) return DEV_API_BASE;
    const tunnel = readDeviceTunnelOverride();
    if (tunnel) return tunnel.replace(/\/$/, '');
    const ip = ipOverride ?? this.deviceIp();
    return `http://${ip}`;
  }

  async hostedHelperReady(timeoutMs = 1200): Promise<boolean> {
    void timeoutMs;
    this.hostedHelperAvailability = { ok: false, checkedAt: Date.now() };
    return false;
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
    }
    const resolvedIp = ip ?? this.deviceIp();
    this.baseUrl = this.computeDeviceHttpRoot(resolvedIp);

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
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (
      (this.mainControlPlaneDown() || this.isBrowserHostileReadUrl(`${this.baseUrl}/api/art-exists`)) &&
      (normalizedPath === '/art/cover.jpg' || normalizedPath === '/art/cover.png')
    ) {
      return (this.lastStatus()?.coverBytes ?? 0) > 0;
    }
    try {
      const existsUrl = `${this.baseUrl}/api/art-exists?path=${encodeURIComponent(normalizedPath)}`;
      const existsResponse = await fetch(existsUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      });
      if (existsResponse.ok) {
        const payload = await existsResponse.json().catch(() => null);
        if (payload && typeof payload.exists === 'boolean') {
          return payload.exists;
        }
      }

      // Older firmware fallback: a tiny range GET still answers existence,
      // but the dedicated exists endpoint is preferred to avoid streaming work.
      const artUrl = `${this.baseUrl}/api/art?path=${encodeURIComponent(normalizedPath)}&t=${Date.now()}`;
      const response = await fetch(artUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(4000),
      });
      return response.ok || response.status === 206;
    } catch {
      this.noteMainControlPlaneUnavailable();
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
    const cacheKey = this.coverPathCacheKey();
    const status = this.lastStatus();
    const ttlMs = status?.player?.playing ? 60000 : 10000;
    if (this.coverPathCache && this.coverPathCache.key === cacheKey && (Date.now() - this.coverPathCache.checkedAt) < ttlMs) {
      return this.coverPathCache.path;
    }

    if ((status?.coverBytes ?? 0) <= 0 && paths.every((path) => path === '/art/cover.jpg' || path === '/art/cover.png')) {
      this.coverPathCache = { key: cacheKey, path: null, checkedAt: Date.now() };
      return null;
    }

    for (const path of paths) {
      if (await this.verifyCoverArt(path)) {
        this.coverPathCache = { key: cacheKey, path, checkedAt: Date.now() };
        return path;
      }
    }
    this.coverPathCache = { key: cacheKey, path: null, checkedAt: Date.now() };
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
    if (!this.canBrowserReadDevicePath('/api/booklet')) return null;
    return this.fetchJsonFile('/api/booklet', normalizeDeviceBookletPayload);
  }

  async pushBookletData(payload: DeviceBookletPayload): Promise<boolean> {
    return this.persistJsonFile('/data/booklet.json', 'booklet.json', payload);
  }

  async getAlbumMeta(): Promise<DeviceAlbumMetaPayload | null> {
    if (!this.canBrowserReadDevicePath('/api/album/meta')) return null;
    return this.fetchJsonFile('/api/album/meta', normalizeDeviceAlbumMetaPayload);
  }

  async pushAlbumMeta(payload: DeviceAlbumMetaPayload): Promise<boolean> {
    return this.persistJsonFile('/data/album_meta.json', 'album-meta.json', payload);
  }

  async sendCommand(opCode: number): Promise<boolean> {
    // Firmware parses "op" as hexadecimal string (base 16).
    const opHex = opCode.toString(16).padStart(2, '0');
    for (const root of this.commandRootsInPriorityOrder()) {
      try {
        const response = await fetch(`${root}/api/cmd?op=${opHex}`);
        const result = await response.json();
        if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
        if (result.ok === true) return true;
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
      }
    }
    return false;
  }

  async selectTrack(index: number): Promise<boolean> {
    for (const root of this.commandRootsInPriorityOrder()) {
      try {
        const response = await fetch(`${root}/api/track?i=${index}`);
        const result = await response.json();
        if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
        if (result.ok === true) return true;
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
      }
    }
    return false;
  }

  async playFile(path: string): Promise<boolean> {
    for (const root of this.commandRootsInPriorityOrder()) {
      try {
        const response = await fetch(`${root}/api/audio/play?file=${encodeURIComponent(path)}`);
        const result = await response.json();
        if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
        if (result.ok === true) return true;
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
      }
    }
    return false;
  }

  async stopPlayback(): Promise<boolean> {
    for (const root of this.commandRootsInPriorityOrder()) {
      try {
        const response = await fetch(`${root}/api/audio/stop`);
        const result = await response.json();
        if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
        if (result.ok === true) return true;
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
      }
    }
    return false;
  }

  async getMeshPeers(): Promise<any> {
    // Mesh endpoint not implemented in current firmware build.
    return { active: false, peers: 0, peerList: [] };
  }

  // --- Playlist order ---

  async getPlaylistOrder(): Promise<string[]> {
    for (const root of this.commandRootsInPriorityOrder()) {
      try {
        const url = `${root}/api/playlist/order`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const data = await response.json();
        if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
        return Array.isArray(data?.order) ? data.order : [];
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
      }
    }
    return [];
  }

  async setPlaylistOrder(filenames: string[]): Promise<boolean> {
    await this.ensureAdminUnlocked();
    const payload = JSON.stringify({ order: filenames });
    for (const root of this.commandRootsInPriorityOrder()) {
      const url = `${root}/api/playlist/order`;
      const crossOrigin = this.isCrossOriginRequest(url);
      try {
        const init: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: payload,
          ...(crossOrigin ? { mode: 'no-cors' as RequestMode, cache: 'no-store' as RequestCache } : {}),
        };
        const response = await fetch(url, init);
        if (crossOrigin) {
          return true;
        }
        if (!response.ok) { if (root === this.baseUrl) this.noteMainControlPlaneUnavailable(); continue; }
        const result = await response.json().catch(() => null);
        if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
        return !!result?.ok;
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
      }
    }
    return false;
  }

  // --- POST endpoints (new firmware additions) ---

  private lastPushedThemeJson = '';

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
      if ((theme as any).artist) payload.artist = (theme as any).artist;
      if ((theme as any).album)  payload.album  = (theme as any).album;

      const json = JSON.stringify(payload);
      if (json === this.lastPushedThemeJson) {
        return true;
      }

      const status = this.lastStatus();
      if (status?.player?.playing) {
        console.warn('[Wifi] pushTheme deferred — audio is playing');
        return true;
      }

      const ok = await this.postWithTimeout(`${this.baseUrl}/api/theme`, payload, 8000);
      if (ok) {
        this.lastPushedThemeJson = json;
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
    const payload = JSON.stringify({ artist, album });

    for (const root of this.commandRootsInPriorityOrder()) {
      const url = `${root}/api/theme`;
      const crossOrigin = this.isCrossOriginRequest(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const init: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: payload,
          signal: ctrl.signal,
          ...(crossOrigin ? { mode: 'no-cors' as RequestMode, cache: 'no-store' as RequestCache } : {}),
        };
        const response = await fetch(url, init);
        clearTimeout(timer);

        if (crossOrigin) {
          await this.sleep(800);
          const status = await this.fetchStatusJson(3000, { forceRefresh: true, maxAgeMs: 0 });
          const deviceArtist = (status as any)?.artist ?? '';
          const deviceAlbum = (status as any)?.album ?? '';
          if ((artist && deviceArtist === artist) || (album && deviceAlbum === album)) {
            this.invalidateAfterMutation('/api/theme', { content: false, artwork: false });
            return { ok: true };
          }
          continue;
        }

        if (!response.ok) { if (root === this.baseUrl) this.noteMainControlPlaneUnavailable(); continue; }
        const result = await response.json().catch(() => null);
        if (result?.ok === true) {
          if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
          this.invalidateAfterMutation('/api/theme', { content: false, artwork: false });
          return { ok: true };
        }
        continue;
      } catch (e: any) {
        clearTimeout(timer);
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
        continue;
      }
    }
    return { ok: false, reason: 'network' };
  }

  private async postWithTimeout(url: string, payload: any, timeoutMs: number): Promise<boolean> {
    const jsonBody = JSON.stringify(payload);
    const crossOrigin = this.isCrossOriginRequest(url);
    if (crossOrigin) {
      for (const root of this.commandRootsInPriorityOrder()) {
        const targetUrl = `${root}/api/theme`;
        try {
          await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: jsonBody,
            mode: 'no-cors',
            cache: 'no-store',
          });
          await this.sleep(600);
          return true;
        } catch {
          if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
        }
      }
      return false;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: jsonBody,
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
    const expectedTrackCount = Math.max(0, Number(this.lastStatus()?.storage?.trackCount || 0));
    const uploadRoot = this.uploadBaseUrl();
    const roots = Array.from(new Set(
      this.mainControlPlaneDown()
        ? [uploadRoot, this.baseUrl]
        : [this.baseUrl, uploadRoot]
    ));
    for (const root of roots) {
      try {
        const tracksUrl = `${root}/api/audio/tracks`;
        const init: RequestInit = {
          cache: 'no-store',
        };
        if (!this.isCrossOriginRequest(tracksUrl)) {
          init.headers = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
        }
        const response = await fetch(tracksUrl, init);
        if (response.ok) {
          if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
          const data = await response.json();
          const tracks = data.tracks ?? [];
          if (tracks.length > 0 && (expectedTrackCount <= 1 || tracks.length >= expectedTrackCount)) {
            return tracks.map((t: any, i: number) => this.mapTrackResponse(t, i));
          }
        }
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
        // Try the next authoritative track source.
      }
      try {
        const wavsUrl = `${root}/api/audio/wavs`;
        const init: RequestInit = {
          cache: 'no-store',
        };
        if (!this.isCrossOriginRequest(wavsUrl)) {
          init.headers = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
        }
        const response = await fetch(wavsUrl, init);
        if (response.ok) {
          if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
          const data = await response.json();
          const wavs = data.wavs ?? [];
          if (wavs.length > 0 && (expectedTrackCount <= 1 || wavs.length >= expectedTrackCount)) {
            return wavs.map((w: any, i: number) => this.mapTrackResponse({ ...w, format: 'wav', codec: 'wav' }, i));
          }
        }
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
        // Keep walking the candidate roots.
      }
    }
    return [];
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
    if (!this.canBrowserReadDevicePath('/api/capsules')) return [];
    try {
      const url = `${this.baseUrl}/api/capsules`;
      const response = await fetch(url, this.jsonReadRequestInit(url, 4000));
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
    if (this.mainControlPlaneDown()) return [];
    try {
      const url = `${this.baseUrl}/api/analytics`;
      const response = await fetch(url, this.jsonReadRequestInit(url, 4000));
      if (response.ok) {
        this.mainControlPlaneUnavailableUntil = 0;
      }
      const data = await response.json();
      return data.tracks ?? [];
    } catch {
      this.noteMainControlPlaneUnavailable();
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
    await this.ensureAdminUnlocked();
    for (const root of this.commandRootsInPriorityOrder()) {
      try {
        const url = `${root}/api/sd/delete?path=${encodeURIComponent(path)}`;
        const response = await fetch(url);
        const result = await response.json();
        if (root === this.baseUrl) this.mainControlPlaneUnavailableUntil = 0;
        if (result.ok === true) {
          this.invalidateAfterMutation(path, { content: true, artwork: path.startsWith('/art/') });
          return true;
        }
      } catch {
        if (root === this.baseUrl) this.noteMainControlPlaneUnavailable();
      }
    }
    return false;
  }

  // --- .dpa File Upload ---

  async uploadDpaFile(file: File, onProgress?: (percent: number) => void): Promise<boolean> {
    return this.uploadFileToPath(file, `/tracks/${file.name}`, onProgress);
  }

  async uploadFileToPath(file: Blob | File, path: string, onProgress?: (percent: number) => void): Promise<boolean> {
    return this.enqueueUpload(async () => {
      await this.ensureAdminUnlocked();
      const writable = await this.waitForWritableWindow();
      if (!writable) {
        return false;
      }
      const devicePath = this.sanitizeDevicePath(path);
      const fallbackName = (file instanceof File) ? file.name : devicePath.split('/').pop() || 'upload.bin';
      const deviceFilename = devicePath.split('/').pop() || fallbackName;
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
    if (options?.artwork) {
      this.artRevision.update((value) => value + 1);
      this.coverPathCache = null;
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

  private coverPathCacheKey(): string {
    const revision = this.artRevision();
    const status = this.lastStatus();
    const coverBytes = status?.coverBytes ?? 0;
    const lastUploadPath = status?.lastUploadPath ?? '';
    const lastUploadBytes = status?.lastUploadBytes ?? 0;
    const uploadToken = (lastUploadPath === '/art/cover.jpg' || lastUploadPath === '/art/cover.png') ? lastUploadBytes : 0;
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
    const mainTunnel = readDeviceTunnelOverride();
    if (mainTunnel) {
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
    const cacheAgeMs = cached ? (Date.now() - this.lastStatusAt) : Number.POSITIVE_INFINITY;
    if (!options?.forceRefresh && cached && (Date.now() - this.lastStatusAt) <= maxAgeMs) {
      return cached;
    }
    if (!options?.forceRefresh && cached && Date.now() < this.statusRateLimitedUntil && cacheAgeMs <= STATUS_STALE_FALLBACK_MS) {
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
        if (response.status === 429) {
          this.statusRateLimitedUntil = Date.now() + STATUS_RATE_LIMIT_BACKOFF_MS;
          const cached = this.lastStatus();
          const cacheAgeMs = cached ? (Date.now() - this.lastStatusAt) : Number.POSITIVE_INFINITY;
          if (cached && cacheAgeMs <= STATUS_STALE_FALLBACK_MS) {
            return cached;
          }
          continue;
        }
        if (!response.ok) continue;
        const status = (await response.json()) as FirmwareStatus;
        this.statusRateLimitedUntil = 0;
        if (plane === 'main') this.mainControlPlaneUnavailableUntil = 0;
        this.preferredStatusPlane = plane;
        if (plane === 'upload' || this.shouldPreferUploadStatus(status)) {
          this.uploadStatusFallbackUntil = Date.now() + STATUS_UPLOAD_FALLBACK_MS;
        } else {
          this.uploadStatusFallbackUntil = 0;
        }
        this.syncStatusSignals(status);
        return status;
      } catch {
        if (plane === 'main') this.noteMainControlPlaneUnavailable();
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

  private async runUploadAttempt(file: Blob | File, path: string, onProgress?: (percent: number) => void): Promise<boolean> {
    const uploadUrl = `${this.uploadBaseUrl()}/api/sd/upload?path=${encodeURIComponent(path)}`;
    const formFilename = path.split('/').pop() || ((file instanceof File) ? file.name : 'upload.bin');
    if (this.isCrossOriginRequest(uploadUrl)) {
      let stopProgressMonitor: (() => void) | null = null;
      try {
        this.preferredStatusPlane = 'upload';
        this.uploadStatusFallbackUntil = Date.now() + STATUS_UPLOAD_FALLBACK_MS;
        const formData = new FormData();
        formData.append('file', file, formFilename);
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
      xhr.timeout = 0;

      const formData = new FormData();
      formData.append('file', file, formFilename);
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
      await this.sleep(1200);
      while (!stopped) {
        try {
          const status = await this.fetchStatusJson(2500, {
            forceRefresh: true,
            maxAgeMs: 0,
            preferUploadPlane: false,
          });
          const percent = this.estimateCrossOriginUploadProgress(path, totalBytes, status);
          if (percent > lastPercent) {
            lastPercent = percent;
            onProgress(percent);
          }
        } catch {
          // Best-effort progress only.
        }
        if (!stopped) {
          await this.sleep(1500);
        }
      }
    })();

    return () => {
      stopped = true;
    };
  }

  private estimateCrossOriginUploadProgress(path: string, totalBytes: number, status: FirmwareStatus | null): number {
    const uploadState = status?.uploadState ?? 'idle';

    const bytesWritten = Number(status?.uploadBytesWritten ?? 0);
    const bytesExpected = Number(status?.uploadBytesExpected ?? 0);
    if (bytesWritten > 0 && (uploadState === 'receiving' || uploadState === 'verifying')) {
      const denominator = bytesExpected > 0 ? bytesExpected : totalBytes;
      if (denominator > 0) {
        return Math.max(2, Math.min(95, Math.round((bytesWritten / denominator) * 100)));
      }
    }

    const lastUploadPath = status?.lastUploadPath ?? '';
    const lastUploadBytes = Number(status?.lastUploadBytes ?? 0);
    if (lastUploadPath === path && totalBytes > 0 && lastUploadBytes > 0) {
      return Math.max(1, Math.min(95, Math.round((lastUploadBytes / totalBytes) * 100)));
    }
    if (uploadState === 'preparing') return 3;
    if (uploadState === 'receiving') return 5;
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
      return this.verifyJsonUpload(normalizedPath, '/api/booklet', () => this.getBookletData());
    }

    if (lower === '/data/album_meta.json') {
      return this.verifyJsonUpload(normalizedPath, '/api/album/meta', () => this.getAlbumMeta());
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
    for (const root of this.commandRootsInPriorityOrder()) {
      try {
        const res = await fetch(`${root}/api/admin/unlock?key=${encodeURIComponent(duid)}`);
        if (res.ok) {
          this.isAdminUnlocked = true;
          return;
        }
      } catch {
        // try next root
      }
    }
  }

  private async fetchJsonFile<T>(path: string, normalize: (raw: any) => T | null): Promise<T | null> {
    try {
      const url = `${this.baseUrl}${path}`;
      const response = await fetch(url, this.jsonReadRequestInit(url, 4000));
      if (!response.ok) return null;
      return normalize(await response.json());
    } catch {
      return null;
    }
  }

  canBrowserReadDevicePath(path: string): boolean {
    return !this.isBrowserHostileReadUrl(`${this.baseUrl}${path}`);
  }

  private jsonReadRequestInit(url: string, timeoutMs: number): RequestInit {
    const init: RequestInit = {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    };
    if (!this.isCrossOriginRequest(url)) {
      init.headers = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
    }
    return init;
  }

  private isBrowserHostileReadUrl(url: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const target = new URL(url, window.location.href);
      return window.location.protocol === 'https:'
        && target.protocol === 'http:'
        && target.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  private noteMainControlPlaneUnavailable() {
    this.mainControlPlaneUnavailableUntil = Date.now() + MAIN_CONTROL_PLANE_BACKOFF_MS;
  }

  private mainControlPlaneDown(): boolean {
    return Date.now() < this.mainControlPlaneUnavailableUntil;
  }

  private commandRootsInPriorityOrder(): string[] {
    const uploadRoot = this.uploadBaseUrl();
    return Array.from(new Set(
      this.mainControlPlaneDown()
        ? [uploadRoot, this.baseUrl]
        : [this.baseUrl, uploadRoot]
    ));
  }

  private recentUploadLooksSettled(path: string): boolean {
    const status = this.lastStatus();
    const uploadState = status?.uploadState ?? 'idle';
    return (status?.lastUploadPath ?? '') === path
      && Number(status?.lastUploadBytes ?? 0) > 0
      && !['preparing', 'receiving', 'verifying', 'finalizing'].includes(uploadState);
  }

  private async verifyJsonUpload<T>(
    uploadPath: string,
    readPath: string,
    readback: () => Promise<T | null>
  ): Promise<boolean> {
    if (await this.fileExistsOnDevice(uploadPath)) return true;
    if (!this.canBrowserReadDevicePath(readPath)) {
      return this.recentUploadLooksSettled(uploadPath);
    }
    return (await readback()) !== null;
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
