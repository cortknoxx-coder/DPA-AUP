
import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { DeviceBridgeService } from './device-bridge.service';
import { DeviceBleService } from './device-ble.service';
import { DeviceWifiService } from './device-wifi.service';
import { DeviceNfcService } from './device-nfc.service';
import { ApiService } from './api.service';
import { DpaDeviceInfo, LibraryIndex, Album, Track, FirmwareStatus, DeviceCapsuleRecord, DeviceRuntimeStatus } from '../types';
import { DataService } from './data.service';
import { normalizeDeviceAlbumMetaPayload, normalizeDeviceBookletPayload } from './device-content.utils';

export type ConnectionStatus = 'disconnected' | 'usb' | 'bluetooth' | 'wifi';
export type RegistrationStatus = 'unregistered' | 'analyzing' | 'registered' | 'lost';
export type ConnectionAction = ConnectionStatus | 'nfc' | 'detect';

export interface ConnectionDiagnosticEvent {
  kind: 'connect_attempt' | 'connect_success' | 'connect_failure' | 'disconnect' | 'reconnect_success';
  transport: ConnectionStatus | 'detect' | 'nfc' | 'unknown';
  detail: string;
  timestamp: string;
  duid?: string;
  uptimeSeconds?: number;
  bootState?: string;
  uploadState?: string;
  httpMode?: string;
  wifiMaintenance?: string;
  failureCount?: number;
}

@Injectable({
  providedIn: 'root'
})
export class DeviceConnectionService {
  private bridge = inject(DeviceBridgeService);
  private api = inject(ApiService);
  private dataService = inject(DataService);

  ble = inject(DeviceBleService);
  wifi = inject(DeviceWifiService);
  nfc = inject(DeviceNfcService);

  // --- Core State Signals ---
  connectionStatus = signal<ConnectionStatus>('disconnected');
  registrationStatus = signal<RegistrationStatus>('unregistered');
  connectionError = signal<string>('');
  connectionBusy = signal<ConnectionAction | null>(null);

  // --- Device-Sourced State ---
  deviceInfo = signal<DpaDeviceInfo | null>(null);
  deviceLibrary = signal<LibraryIndex | null>(null);
  deviceCapsules = signal<DeviceCapsuleRecord[]>([]);
  deviceRuntime = computed<DeviceRuntimeStatus | null>(() => {
    if (this.connectionStatus() !== 'wifi') return null;
    const status = this.wifi.lastStatus();
    if (!status) return null;
    return {
      bootState: status.bootState ?? 'ready',
      sdState: status.sdState ?? 'unknown',
      uploadState: status.uploadState ?? 'idle',
      degradedReason: status.degradedReason ?? '',
      httpReady: status.httpReady ?? true,
      httpMode: status.httpMode ?? 'full',
      audioVerified: status.audioVerified ?? status.player?.audioReady ?? false,
      wifiMaintenance: status.wifiMaintenance ?? 'normal',
      lastUploadPath: status.lastUploadPath ?? '',
      lastUploadBytes: status.lastUploadBytes ?? 0,
      mcu: status.mcu,
    };
  });
  deviceRuntimeMessage = computed(() => this.describeRuntime(this.deviceRuntime()));
  connectionDiagnostics = signal<ConnectionDiagnosticEvent[]>([]);
  wifiRecoveryActive = signal(false);
  lastDisconnectEvent = computed<ConnectionDiagnosticEvent | null>(() => {
    const events = this.connectionDiagnostics();
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].kind === 'disconnect') return events[i];
    }
    return null;
  });
  lastDisconnectSummary = computed(() => {
    const event = this.lastDisconnectEvent();
    if (!event) return '';
    const timestamp = new Date(event.timestamp).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = [`Lost at ${timestamp}`];
    if (event.failureCount) {
      parts.push(`${event.failureCount} failed poll${event.failureCount === 1 ? '' : 's'}`);
    }
    const runtime = [event.bootState, event.uploadState, event.httpMode].filter(Boolean).join(' / ');
    if (runtime) parts.push(runtime);
    if (event.wifiMaintenance) parts.push(event.wifiMaintenance);
    return parts.join(' • ');
  });
  deviceReadyForWrites = computed(() => {
    if (this.connectionStatus() !== 'wifi') return false;
    if (this.wifiRecoveryActive()) return false;
    const runtime = this.deviceRuntime();
    if (!runtime) return true;
    return runtime.bootState !== 'booting'
      && runtime.sdState !== 'error'
      && runtime.uploadState === 'idle';
  });

  // --- Derived State for UI ---
  isSnippetMode = computed(() => this.registrationStatus() !== 'registered');
  registeredDeviceId = computed(() => this.deviceInfo()?.serial ?? null);
  connectionTransportLabel = computed(() => {
    if (this.isSimulationMode()) return 'Simulator';
    if (this.connectionStatus() === 'wifi' && this.wifiRecoveryActive()) return 'WiFi Reconnecting';
    switch (this.connectionStatus()) {
      case 'wifi': return 'WiFi Direct';
      case 'usb': return 'USB-C Bridge';
      case 'bluetooth': return 'Bluetooth LE';
      default: return 'Disconnected';
    }
  });
  connectionSummary = computed(() => {
    if (this.isSimulationMode()) return 'Simulator active';
    if (this.connectionStatus() === 'wifi') {
      const status = this.wifi.lastStatus();
      const base = status?.duid || status?.album || this.deviceInfo()?.serial || 'DPA connected over WiFi';
      return this.wifiRecoveryActive() ? `${base} • reconnecting` : base;
    }
    if (this.connectionStatus() === 'usb') {
      return this.deviceInfo()?.serial || 'Bridge connected';
    }
    if (this.connectionStatus() === 'bluetooth') {
      return this.deviceInfo()?.serial || 'Bluetooth connected';
    }
    return 'No device detected';
  });

  // --- Internal State ---
  private isSimulated = signal(false);
  private wifiStatusPollTimer: ReturnType<typeof setInterval> | null = null;
  private wifiPollFailures = 0;
  private lastUploadBusy = false;
  private postUploadRecoveryInFlight = false;
  private detectConnectedDevicePromise: Promise<ConnectionStatus | null> | null = null;
  private wifiHydrationPromise: Promise<void> | null = null;
  private lastCoverSyncKey = '';
  private lastLedSyncKey = '';
  private wifiRecoveryTask: Promise<boolean> | null = null;
  private wifiRecoveryToken = 0;

  constructor() {
    // Simulator is opt-in only — user must explicitly click "Use Simulator"
    // on the fan auth page. No auto-activation to avoid mock fallback in live paths.

    // Auto-probe device WiFi on startup so ALL portal pages (creator + fan)
    // get real data synced into DataService regardless of entry point.
    this.autoProbeConnectedDevice();

    effect(() => {
      const revision = this.wifi.contentRevision();
      if (revision === 0 || this.connectionStatus() !== 'wifi') return;
      const status = this.wifi.lastStatus();
      if (status) {
        void this.scheduleWifiHydration(status);
      }
    }, { allowSignalWrites: true });
  }

  /**
   * Background WiFi probe — if user is already on the DPA network,
   * connect and sync device data into DataService immediately.
   * Runs silently; no UI spinners or error messages.
   */
  private autoProbeConnectedDevice() {
    void this.detectConnectedDevice({ silent: true, preferCurrent: false });
  }

  async detectConnectedDevice(options?: { silent?: boolean; preferCurrent?: boolean }): Promise<ConnectionStatus | null> {
    if (this.detectConnectedDevicePromise) return this.detectConnectedDevicePromise;

    this.detectConnectedDevicePromise = (async () => {
      this.connectionBusy.set('detect');
      const silent = options?.silent === true;
      const preferCurrent = options?.preferCurrent !== false;
      try {
        if (preferCurrent) {
          if (this.connectionStatus() === 'wifi' && await this.refreshWifiConnection(true)) {
            return 'wifi';
          }
          if (this.connectionStatus() === 'usb' && await this.refreshBridgeConnection(true)) {
            return 'usb';
          }
        }

        if (await this.connectViaWifi(undefined, { silent: true })) {
          return 'wifi';
        }

        if (await this.connectToBridge({ silent: true })) {
          return 'usb';
        }

        if (!silent) {
          this.connectionError.set('No connected DPA was detected yet. If the device is already attached, try Refresh Detection or choose a specific method below.');
        }
        return null;
      } finally {
        this.connectionBusy.set(null);
        this.detectConnectedDevicePromise = null;
      }
    })();

    return this.detectConnectedDevicePromise;
  }

  private async refreshWifiConnection(silent = false): Promise<boolean> {
    try {
      const ok = await this.wifi.getStatus().then(() => true).catch(() => false);
      if (!ok) return false;
      this.wifiRecoveryActive.set(false);
      this.connectionStatus.set('wifi');
      const status = this.wifi.lastStatus();
      if (status) {
        this.updateDeviceInfoFromStatus(status);
        this.registrationStatus.set('registered');
        this.lastUploadBusy = this.isUploadBusy(status);
        void this.scheduleWifiHydration(status);
      }
      this.startWifiStatusPolling();
      return true;
    } catch {
      if (!silent && this.connectionStatus() === 'wifi') {
        this.connectionError.set('Connected WiFi session could not be refreshed. Rejoin the DPA network and retry.');
      }
      return false;
    }
  }

  private async refreshBridgeConnection(silent = false): Promise<boolean> {
    try {
      if (!this.bridge.isConnected()) return false;
      this.cancelWifiRecovery();
      this.connectionError.set('');
      this.stopWifiStatusPolling();
      if (this.wifi.isConnected()) this.wifi.disconnect();
      if (this.ble.isConnected()) this.ble.disconnect();
      this.connectionStatus.set('usb');
      this.isSimulated.set(false);
      await this.checkDevice();
      return this.connectionStatus() === 'usb' && !!this.deviceInfo();
    } catch {
      if (!silent) {
        this.connectionError.set('The USB-C bridge is reachable, but the attached DPA did not answer cleanly.');
      }
      return false;
    }
  }

  private async attemptWifiConnection(ip?: string): Promise<boolean> {
    if (!ip && this.connectionStatus() === 'wifi' && await this.refreshWifiConnection(true)) {
      return true;
    }
    const success = ip ? await this.wifi.probe(ip) : await this.wifi.autoConnect();
    if (!success) return false;

    this.stopWifiStatusPolling();
    if (this.bridge.isConnected()) this.bridge.disconnect();
    if (this.ble.isConnected()) this.ble.disconnect();
    this.wifiRecoveryActive.set(false);
    this.connectionError.set('');
    this.connectionStatus.set('wifi');
    this.isSimulated.set(false);

    const status = this.wifi.lastStatus();
    if (status) {
      this.updateDeviceInfoFromStatus(status);
      this.registrationStatus.set('registered');
      this.lastUploadBusy = this.isUploadBusy(status);
      void this.scheduleWifiHydration(status);
    }
    this.startWifiStatusPolling();
    return true;
  }

  // --- USB Bridge Connection ---

  async connectToBridge(options?: { silent?: boolean }): Promise<boolean> {
    this.connectionError.set('');
    if (await this.refreshBridgeConnection(true)) {
      return true;
    }

    const connected = await this.bridge.connect();
    if (connected) {
      return this.refreshBridgeConnection(options?.silent === true);
    }
    if (!options?.silent) {
      this.connectionError.set('Failed to connect to DPA Desktop Bridge. Is the application running on your computer?');
    }
    return false;
  }

  // --- BLE Connection ---

  async connectViaBle(): Promise<boolean> {
    this.connectionError.set('');
    if (!this.ble.isSupported) {
      this.connectionError.set('Web Bluetooth is not supported in this browser. Use Chrome, Edge, or Opera.');
      return false;
    }

    const success = await this.ble.connect();
    if (success) {
      this.cancelWifiRecovery();
      this.connectionError.set('');
      this.connectionStatus.set('bluetooth');
      this.isSimulated.set(false);

      const info = this.ble.getDeviceInfo();
      if (info) {
        this.deviceInfo.set(info);
        this.registrationStatus.set('registered');
        await this.refreshWifiLibrary();
      }
      return true;
    }
    this.connectionError.set('Bluetooth connection failed. Keep the device nearby and try again.');
    return false;
  }

  // --- WiFi Connection ---

  async connectViaWifi(
    ip?: string,
    options?: { silent?: boolean; retryUntilConnected?: boolean; maxAttempts?: number; retryDelayMs?: number; reason?: string }
  ): Promise<boolean> {
    this.connectionError.set('');
    const retryUntilConnected = options?.retryUntilConnected ?? options?.silent !== true;
    const maxAttempts = retryUntilConnected ? (options?.maxAttempts ?? (options?.silent ? 3 : 20)) : 1;
    const retryDelayMs = options?.retryDelayMs ?? 1500;

    this.recordConnectionEvent('connect_attempt', 'Starting WiFi connection attempt.', 'wifi');

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const success = await this.attemptWifiConnection(ip);
      if (success) {
        this.recordConnectionEvent(
          attempt === 1 ? 'connect_success' : 'reconnect_success',
          attempt === 1
            ? 'WiFi connection established.'
            : `WiFi connection recovered after ${attempt} attempts.`,
          'wifi'
        );
        return true;
      }

      if (attempt >= maxAttempts || !retryUntilConnected) {
        break;
      }

      if (!options?.silent) {
        const maxLabel = Number.isFinite(maxAttempts) ? ` ${attempt + 1}/${maxAttempts}` : '';
        this.connectionError.set(
          `Still trying to reach the DPA over WiFi.${maxLabel ? ` Attempt${maxLabel}.` : ''} Stay on the DPA network until the device answers.`
        );
      }
      await this.sleep(retryDelayMs);
    }

    this.recordConnectionEvent(
      'connect_failure',
      `WiFi connection did not complete after ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'}.`,
      'wifi'
    );
    if (!options?.silent) {
      this.connectionError.set('Could not reach DPA over WiFi. Stay on the DPA network and retry, or wait while the portal keeps searching.');
    }
    return false;
  }

  // --- NFC Tap (reads DUID, then connects via WiFi or BLE) ---

  async connectViaNfc(): Promise<boolean> {
    this.connectionError.set('');
    const duid = await this.nfc.startScan();
    if (!duid) {
      if (this.nfc.lastError()) {
        this.connectionError.set(this.nfc.lastError()!);
      }
      return false;
    }

    // NFC tag read succeeded — try WiFi first (device AP), then BLE fallback
    const wifiOk = await this.connectViaWifi();
    if (wifiOk) return true;

    // WiFi failed, try BLE
    const bleOk = await this.connectViaBle();
    if (bleOk) return true;

    this.connectionError.set(`Found device ${duid} via NFC but could not connect. Join the DPA-Portal WiFi network and retry.`);
    return false;
  }

  // --- Simulator ---

  toggleSimulator() {
    if (this.isSimulated()) {
      this.disconnectDevice();
      return;
    }

    this.isSimulated.set(true);
    this.connectionStatus.set('usb');
    this.deviceInfo.set({ serial: 'DPA-SIM-1234', model: 'SIMULATOR', firmwareVersion: '1.0', capabilities: ['USB'], pubkeyB64: '' });
    this.registrationStatus.set('registered'); // Auto-register in sim mode
    this.populateMockLibrary();
    console.warn('DPA Bridge unavailable. Entering Simulator Mode.');
  }

  private async checkDevice() {
    if (this.isSimulationMode() || !this.bridge.isConnected()) return;
    try {
      const info = await this.bridge.getDeviceInfo();
      this.deviceInfo.set(info);

      const library = await this.bridge.listLibrary();
      this.deviceLibrary.set(library);

      if (info.serial) {
        this.registrationStatus.set('registered');
      }
    } catch (e) {
      console.error('Failed to get device info/library', e);
      this.disconnectDevice({ expected: false, reason: 'USB bridge lost the device during refresh.' });
    }
  }

  disconnectDevice(options?: { expected?: boolean; reason?: string }) {
    const expected = options?.expected !== false;
    const currentStatus = this.connectionStatus();
    if (!expected) {
      this.recordConnectionEvent('disconnect', options?.reason || 'Device transport disconnected unexpectedly.', currentStatus, this.wifiPollFailures || undefined);
    }

    // Disconnect all transports
    if (this.ble.isConnected()) this.ble.disconnect();
    if (this.wifi.isConnected()) this.wifi.disconnect();
    if (this.bridge.isConnected()) this.bridge.disconnect();
    if (this.nfc.isScanning()) this.nfc.stopScan();
    this.cancelWifiRecovery();
    this.stopWifiStatusPolling();

    this.connectionStatus.set('disconnected');
    if (expected) {
      this.connectionError.set('');
    }
    this.isSimulated.set(false);
    this.deviceInfo.set(null);
    this.deviceLibrary.set(null);
    this.deviceCapsules.set([]);
    this.registrationStatus.set('unregistered');
    this.wifiHydrationPromise = null;
  }

  private populateMockLibrary() {
    const mockAlbum = this.dataService.albums().find(a => a.id === '1');
    if (!mockAlbum) return;

    const libraryIndex: LibraryIndex = {
      albums: [
        {
          id: mockAlbum.albumId,
          title: mockAlbum.title,
          artworkUrl: `https://picsum.photos/seed/${mockAlbum.albumId}/400/400`
        }
      ],
      tracks: mockAlbum.tracks.map((track: Track) => ({
        id: track.trackId,
        albumId: track.albumId,
        title: track.title,
        durationSec: track.durationSec,
        trackNo: track.trackIndex + 1,
        codec: 'audio/wav'
      }))
    };
    this.deviceLibrary.set(libraryIndex);
  }

  private async refreshWifiLibrary() {
    const tracks = await this.wifi.getDeviceTracks();
    const duid = this.deviceInfo()?.serial ?? 'DPA';
    // Use device-reported metadata when available, fall back to DataService
    const status = this.wifi.lastStatus();
    const creatorAlbum = this.dataService.albums()?.[0];
    const albumTitle = status?.album || creatorAlbum?.title || 'DPA Album';
    const coverPath = await this.wifi.resolveAvailableCoverArtPath();
    const albumArt = coverPath ? this.wifi.coverArtUrl(coverPath) : '';
    this.deviceLibrary.set({
      albums: [
        {
          id: duid,
          title: albumTitle,
          artworkUrl: albumArt,
        },
      ],
      tracks: tracks.map(t => ({
        id: `${duid}:${t.index}`,
        albumId: duid,
        title: t.title,
        durationSec: Math.max(0, Math.round(t.durationMs / 1000)),
        trackNo: t.index + 1,
        codec: 'audio/wav',
      })),
    });
    await this.syncWifiStatusIntoLibrary();
  }

  async refreshDeviceCapsules() {
    if (this.connectionStatus() !== 'wifi') {
      this.deviceCapsules.set([]);
      return;
    }
    try {
      this.deviceCapsules.set(await this.wifi.getCapsules());
    } catch {
      this.deviceCapsules.set([]);
    }
  }

  async syncConnectedWifiState(): Promise<boolean> {
    if (this.connectionStatus() !== 'wifi') return false;
    try {
      const status = await this.wifi.getStatus({ forceRefresh: true, maxAgeMs: 0, timeoutMs: 4000 });
      this.updateDeviceInfoFromStatus(status);
      this.registrationStatus.set('registered');
      this.lastUploadBusy = this.isUploadBusy(status);
      await this.runPostUploadRecovery(status);
      return true;
    } catch {
      return false;
    }
  }

  private async syncWifiStatusIntoLibrary() {
    try {
      const status: FirmwareStatus = await this.wifi.getStatus();
      const current = this.deviceLibrary();
      if (!current || !status?.player?.trackId) return;

      const normalizedPath = status.player.trackId.trim();
      const normalizedTitle = status.player.trackTitle?.trim();

      this.deviceLibrary.set({
        ...current,
        tracks: current.tracks.map((t) => {
          const samePath = t.id === normalizedPath;
          const sameTitle = normalizedTitle && t.title === normalizedTitle;
          if (samePath || sameTitle) {
            return { ...t, id: normalizedPath || t.id };
          }
          return t;
        }),
      });
    } catch {
      // best effort only
    }
  }

  private async fetchDeviceCoverDataUrl(): Promise<string | undefined> {
    const coverPath = await this.wifi.resolveAvailableCoverArtPath();
    if (!coverPath) return undefined;
    try {
      const response = await fetch(this.wifi.coverArtUrl(coverPath));
      if (!response.ok) return undefined;
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Cover art did not decode into a data URL.'));
        };
        reader.onerror = () => reject(reader.error || new Error('Cover art read failed.'));
        reader.readAsDataURL(blob);
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Pull device metadata + tracks into DataService so all portal components
   * (fan-home, fan-album-detail, capsules, etc.) display real data instead of mock.
   */
  private async syncDeviceIntoDataService(status: FirmwareStatus) {
    try {
      const tracks = await this.wifi.getDeviceTracks();
      const bookletPayload = await this.wifi.getBookletData();
      const albumMetaPayload = await this.wifi.getAlbumMeta();
      let coverDataUrl: string | undefined;
      const coverKey = this.coverSyncKey(status);
      if (coverKey && coverKey !== this.lastCoverSyncKey) {
        coverDataUrl = await this.fetchDeviceCoverDataUrl();
        if (coverDataUrl) {
          this.lastCoverSyncKey = coverKey;
        }
      }
      const firstAlbum = this.dataService.albums()?.[0];
      if (!firstAlbum) return;

      const booklet = normalizeDeviceBookletPayload(bookletPayload);
      const albumMeta = normalizeDeviceAlbumMetaPayload(albumMetaPayload);

      this.dataService.syncAlbumFromDevice(firstAlbum.albumId, {
        artistName: status.artist || undefined,
        title: status.album || undefined,
        artworkUrl: coverDataUrl,
        tracks: tracks.map(t => ({
          title: t.title,
          durationSec: Math.max(1, Math.round(t.durationMs / 1000)),
          filename: t.filename,
        })),
        description: booklet?.description,
        lyrics: booklet?.lyrics,
        booklet: booklet?.booklet,
        genre: albumMeta?.genre,
        recordLabel: albumMeta?.recordLabel,
        copyright: albumMeta?.copyright,
        releaseDate: albumMeta?.releaseDate,
        upcCode: albumMeta?.upcCode,
        parentalAdvisory: albumMeta?.parentalAdvisory,
      });
    } catch {
      // best effort — DataService retains existing data on failure
    }
  }

  /**
   * Auto-sync LED playback colors from the device's cover art.
   * Fetches /art/cover.jpg from the device, extracts 2 dominant vibrant colors,
   * and pushes them as play_color + gradEnd so the VU patterns match the album.
   * Runs automatically on WiFi connect from any page.
   */
  private async syncLedColorsFromCover(status?: FirmwareStatus): Promise<void> {
    const syncKey = this.coverSyncKey(status ?? this.wifi.lastStatus());
    if (syncKey && syncKey === this.lastLedSyncKey) return;
    const coverPath = await this.wifi.resolveAvailableCoverArtPath();
    if (!coverPath) return;

    const url = this.wifi.coverArtUrl(coverPath);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) { reject('no ctx'); return; }
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = url;
    });

    // Extract dominant vibrant colors (same algo as album-metadata component)
    const [primary, secondary] = await this.extractCoverColors(dataUrl);
    await this.wifi.pushTheme({
      led: { playback: { color: primary, pattern: 'vu_classic' } },
    } as any, undefined, secondary);
    if (syncKey) this.lastLedSyncKey = syncKey;
    console.log(`[AUTO-LED] Synced album colors from device cover: ${primary} / ${secondary}`);
  }

  private scheduleWifiHydration(status: FirmwareStatus): Promise<void> {
    if (this.wifiHydrationPromise) return this.wifiHydrationPromise;

    this.wifiHydrationPromise = (async () => {
      // Let the initial connect settle before pulling heavier metadata/art assets.
      await new Promise((resolve) => setTimeout(resolve, 180));
      await this.refreshWifiLibrary();
      await this.refreshDeviceCapsules();
      await this.syncDeviceIntoDataService(status);
      await this.syncLedColorsFromCover(status);
    })().finally(() => {
      this.wifiHydrationPromise = null;
    });

    return this.wifiHydrationPromise;
  }

  private coverSyncKey(status: FirmwareStatus | null | undefined): string {
    if (!status) return '';
    const coverBytes = Number(status.coverBytes ?? 0);
    if (coverBytes <= 0) return '';
    return `${status.duid || 'DPA'}|${status.artist || ''}|${status.album || ''}|${coverBytes}`;
  }

  /** Extract 2 dominant vibrant colors from a data URL via canvas sampling. */
  private extractCoverColors(dataUrl: string): Promise<[string, string]> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const sz = 64;
        const c = document.createElement('canvas');
        c.width = sz; c.height = sz;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(['#0088ff', '#ff6600']); return; }
        ctx.drawImage(img, 0, 0, sz, sz);
        const px = ctx.getImageData(0, 0, sz, sz).data;

        const buckets: { r: number; g: number; b: number; count: number }[] = [];
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx === 0 || (mx - mn) / mx < 0.25 || mx / 255 < 0.15) continue;
          const qr = (r >> 4) << 4, qg = (g >> 4) << 4, qb = (b >> 4) << 4;
          let found = false;
          for (const bk of buckets) {
            if (Math.abs(bk.r - qr) < 32 && Math.abs(bk.g - qg) < 32 && Math.abs(bk.b - qb) < 32) {
              bk.r = (bk.r * bk.count + r) / (bk.count + 1);
              bk.g = (bk.g * bk.count + g) / (bk.count + 1);
              bk.b = (bk.b * bk.count + b) / (bk.count + 1);
              bk.count++;
              found = true;
              break;
            }
          }
          if (!found) buckets.push({ r, g, b, count: 1 });
        }
        buckets.sort((a, b) => b.count - a.count);
        const hex = (v: { r: number; g: number; b: number }) =>
          '#' + [v.r, v.g, v.b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
        const primary = buckets[0] || { r: 0, g: 136, b: 255 };
        let secondary = buckets[1] || primary;
        for (let j = 1; j < buckets.length; j++) {
          if (Math.abs(buckets[j].r - primary.r) + Math.abs(buckets[j].g - primary.g) + Math.abs(buckets[j].b - primary.b) > 100) {
            secondary = buckets[j]; break;
          }
        }
        resolve([hex(primary), hex(secondary)]);
      };
      img.onerror = () => resolve(['#0088ff', '#ff6600']);
      img.src = dataUrl;
    });
  }

  private recordConnectionEvent(
    kind: ConnectionDiagnosticEvent['kind'],
    detail: string,
    transport: ConnectionDiagnosticEvent['transport'] = 'unknown',
    failureCount?: number,
  ) {
    const status = this.wifi.lastStatus();
    const nextEvent: ConnectionDiagnosticEvent = {
      kind,
      transport,
      detail,
      timestamp: new Date().toISOString(),
      duid: status?.duid || this.deviceInfo()?.serial,
      uptimeSeconds: typeof status?.uptime_s === 'number' ? status.uptime_s : undefined,
      bootState: status?.bootState,
      uploadState: status?.uploadState,
      httpMode: status?.httpMode,
      wifiMaintenance: status?.wifiMaintenance,
      failureCount,
    };
    if (kind === 'disconnect' || kind === 'connect_failure') {
      console.warn('[DPA connection]', nextEvent);
    }
    this.connectionDiagnostics.update(events => [...events.slice(-24), nextEvent]);
  }

  private cancelWifiRecovery() {
    this.wifiRecoveryToken += 1;
    this.wifiRecoveryTask = null;
    this.wifiRecoveryActive.set(false);
  }

  private startBackgroundWifiRecovery(reason: string) {
    if (this.wifiRecoveryTask) return;

    const token = ++this.wifiRecoveryToken;
    this.connectionError.set(`DPA link dropped. ${reason} Retrying automatically until the device answers again.`);

    const task = (async () => {
      let attempts = 0;
      while (token === this.wifiRecoveryToken && this.connectionStatus() === 'disconnected') {
        attempts += 1;
        const recovered = await this.attemptWifiConnection();
        if (token !== this.wifiRecoveryToken) return false;
        if (recovered) {
          this.recordConnectionEvent('reconnect_success', `Recovered WiFi after ${attempts} background attempt(s).`, 'wifi');
          this.connectionError.set('');
          return true;
        }
        await this.sleep(2000);
      }
      return false;
    })().finally(() => {
      if (this.wifiRecoveryTask === task) {
        this.wifiRecoveryTask = null;
      }
    });

    this.wifiRecoveryTask = task;
  }

  private sleep(ms: number) {
    return new Promise<void>(resolve => window.setTimeout(resolve, ms));
  }

  async registerDevice(deviceId: string): Promise<boolean> {
    this.registrationStatus.set('analyzing');

    return new Promise((resolve) => {
      setTimeout(async () => {
        if (this.deviceInfo()?.serial !== deviceId) {
          this.registrationStatus.set('unregistered');
          resolve(false);
          return;
        }

        try {
          await this.api.claimDevice({
            serial: this.deviceInfo()?.serial,
            attestation: 'signed_nonce_goes_here'
          });

          this.registrationStatus.set('registered');
          resolve(true);
        } catch (e) {
          console.error("Failed to claim device with backend", e);
          this.registrationStatus.set('unregistered');
          resolve(false);
        }
      }, 2000);
    });
  }

  unregisterDevice() {
    this.registrationStatus.set('unregistered');
  }

  reportLost() {
    this.registrationStatus.set('lost');
  }

  // --- Mock methods for unregister flow ---
  verifyEmail(email: string): Promise<boolean> { return new Promise(r => setTimeout(() => r(email.includes('@')), 1000)); }
  sendDeviceIdReminder(email: string): Promise<void> { return new Promise(r => setTimeout(r, 1000)); }

  isSimulationMode() {
    return this.isSimulated();
  }

  private updateDeviceInfoFromStatus(status: FirmwareStatus) {
    this.deviceInfo.set({
      serial: status.duid,
      model: status.name,
      firmwareVersion: status.ver,
      capabilities: ['audio', 'portal', 'mesh'],
      pubkeyB64: '',
    });
  }

  private startWifiStatusPolling() {
    this.stopWifiStatusPolling();
    this.wifiRecoveryActive.set(false);
    this.wifiPollFailures = 0;
    this.wifiStatusPollTimer = setInterval(() => {
      void this.pollWifiStatus();
    }, 2500);
  }

  private stopWifiStatusPolling() {
    if (this.wifiStatusPollTimer) {
      clearInterval(this.wifiStatusPollTimer);
      this.wifiStatusPollTimer = null;
    }
    this.wifiPollFailures = 0;
  }

  private async pollWifiStatus() {
    if (this.connectionStatus() !== 'wifi') {
      this.stopWifiStatusPolling();
      return;
    }

    try {
      const status = await this.wifi.getStatus();
      this.wifiPollFailures = 0;
      this.wifiRecoveryActive.set(false);
      this.connectionError.set('');
      this.updateDeviceInfoFromStatus(status);

      const uploadBusy = this.isUploadBusy(status);
      if ((this.lastUploadBusy && !uploadBusy) || !this.deviceLibrary()) {
        await this.runPostUploadRecovery(status);
      }
      this.lastUploadBusy = uploadBusy;
    } catch {
      this.wifiPollFailures += 1;
      if (this.wifiPollFailures < 2) return;
      if (this.wifiPollFailures === 2) {
        this.wifiRecoveryActive.set(true);
        this.recordConnectionEvent(
          'disconnect',
          'Status polling stopped getting answers from the DPA and active recovery started.',
          'wifi',
          this.wifiPollFailures
        );
      }

      this.connectionError.set(
        'DPA WiFi stopped answering. Keeping the last known device UI on screen while reconnect attempts continue.'
      );

      const recovered = await this.wifi.autoConnect();
      if (recovered) {
        this.connectionStatus.set('wifi');
        const status = this.wifi.lastStatus();
        this.wifiPollFailures = 0;
        this.wifiRecoveryActive.set(false);
        this.connectionError.set('');
        this.recordConnectionEvent('reconnect_success', 'Recovered WiFi during active status polling.', 'wifi');
        if (status) {
          this.updateDeviceInfoFromStatus(status);
          await this.runPostUploadRecovery(status);
          this.lastUploadBusy = this.isUploadBusy(status);
        }
        return;
      }
    }
  }

  private async runPostUploadRecovery(status: FirmwareStatus) {
    if (this.postUploadRecoveryInFlight) return;
    this.postUploadRecoveryInFlight = true;
    try {
      await this.refreshWifiLibrary();
      await this.refreshDeviceCapsules();
      await this.syncDeviceIntoDataService(status);
    } finally {
      this.postUploadRecoveryInFlight = false;
    }
  }

  private isUploadBusy(status: FirmwareStatus | null | undefined): boolean {
    const uploadState = status?.uploadState ?? 'idle';
    return ['preparing', 'receiving', 'verifying', 'finalizing'].includes(uploadState);
  }

  private describeRuntime(runtime: DeviceRuntimeStatus | null): string {
    if (this.wifiRecoveryActive()) {
      return 'WiFi control is reconnecting. The portal is holding the last known device state on screen until status polling recovers.';
    }

    if (!runtime) return '';

    if (runtime.uploadState === 'error') {
      return 'The last upload failed verification on-device. Wait for idle, then retry the transfer.';
    }

    if (runtime.uploadState !== 'idle' && runtime.uploadState !== 'complete') {
      return runtime.httpMode === 'minimal'
        ? 'Large upload in progress. Minimal status stays online while playback controls stay blocked.'
        : 'Large upload in progress. The device will return to full control mode when the transfer settles.';
    }

    if (runtime.bootState === 'booting') {
      return 'Device is still booting and validating SD, audio, WiFi, and HTTP readiness.';
    }

    if (runtime.mcu?.stackTight) {
      return 'Playback task stack headroom is getting tight. Let the device settle before heavier transfers or repeated refreshes.';
    }

    if (runtime.mcu?.lowMemory) {
      return 'MCU free heap is running low. Live UI can fall behind until memory recovers or the HTTP server resets.';
    }

    if (runtime.bootState === 'degraded') {
      switch (runtime.degradedReason) {
        case 'sd_unavailable':
          return 'SD storage is not mounted. Tracks, cover art, and booklet data will stay unavailable until storage recovers.';
        case 'audio_unverified':
          return 'Audio hardware did not verify cleanly at boot. Playback should be treated as unavailable until the device recovers.';
        case 'upload_failed':
          return 'The last upload did not finalize cleanly. Check the runtime state before retrying.';
        default:
          return 'Device is online but running in a degraded state.';
      }
    }

    return '';
  }
}
