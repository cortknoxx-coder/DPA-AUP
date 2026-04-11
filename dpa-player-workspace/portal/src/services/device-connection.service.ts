
import { Injectable, signal, computed, inject } from '@angular/core';
import { DeviceBridgeService } from './device-bridge.service';
import { DeviceBleService } from './device-ble.service';
import { DeviceWifiService } from './device-wifi.service';
import { DeviceNfcService } from './device-nfc.service';
import { ApiService } from './api.service';
import { DpaDeviceInfo, LibraryIndex, Album, Track, FirmwareStatus } from '../types';
import { DataService } from './data.service';

export type ConnectionStatus = 'disconnected' | 'usb' | 'bluetooth' | 'wifi';
export type RegistrationStatus = 'unregistered' | 'analyzing' | 'registered' | 'lost';

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

  // --- Device-Sourced State ---
  deviceInfo = signal<DpaDeviceInfo | null>(null);
  deviceLibrary = signal<LibraryIndex | null>(null);

  // --- Derived State for UI ---
  isSnippetMode = computed(() => this.registrationStatus() !== 'registered');
  registeredDeviceId = computed(() => this.deviceInfo()?.serial ?? null);

  // --- Internal State ---
  private isSimulated = signal(false);

  constructor() {
    // Simulator is opt-in only — user must explicitly click "Use Simulator"
    // on the fan auth page. No auto-activation to avoid mock fallback in live paths.
  }

  // --- USB Bridge Connection ---

  async connectToBridge() {
    this.connectionError.set('');
    const connected = await this.bridge.connect();
    if (connected) {
      this.connectionStatus.set('usb');
      this.isSimulated.set(false);
      await this.checkDevice();
    } else {
      this.connectionError.set('Failed to connect to DPA Desktop Bridge. Is the application running on your computer?');
      this.disconnectDevice();
    }
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

  async connectViaWifi(ip?: string): Promise<boolean> {
    this.connectionError.set('');
    const success = ip ? await this.wifi.probe(ip) : await this.wifi.autoConnect();
    if (success) {
      this.connectionError.set('');
      this.connectionStatus.set('wifi');
      this.isSimulated.set(false);

      const status = this.wifi.lastStatus();
      if (status) {
        this.deviceInfo.set({
          serial: status.duid,
          model: status.name,
          firmwareVersion: status.ver,
          capabilities: ['audio', 'portal', 'mesh'],
          pubkeyB64: '',
        });
        this.registrationStatus.set('registered');
        await this.refreshWifiLibrary();
      }

      // Auto-sync LED colors from cover art on device (if present).
      // Runs on any page — lights always match the album when connected.
      this.syncLedColorsFromCover().catch(() => {});

      return true;
    }
    this.connectionError.set('Could not reach DPA over WiFi. Confirm you are on the DPA-Portal network and retry.');
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
      this.disconnectDevice();
    }
  }

  disconnectDevice() {
    // Disconnect all transports
    if (this.ble.isConnected()) this.ble.disconnect();
    if (this.wifi.isConnected()) this.wifi.disconnect();
    if (this.nfc.isScanning()) this.nfc.stopScan();

    this.connectionStatus.set('disconnected');
    this.connectionError.set('');
    this.isSimulated.set(false);
    this.deviceInfo.set(null);
    this.deviceLibrary.set(null);
    this.registrationStatus.set('unregistered');
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
    const creatorAlbum = this.dataService.albums()?.[0];
    const albumTitle = creatorAlbum?.title || 'DPA Album';
    const albumArt = creatorAlbum ? `https://picsum.photos/seed/${creatorAlbum.albumId}/400/400` : '/assets/dpa-default-cover.png';
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

  /**
   * Auto-sync LED playback colors from the device's cover art.
   * Fetches /art/cover.jpg from the device, extracts 2 dominant vibrant colors,
   * and pushes them as play_color + gradEnd so the VU patterns match the album.
   * Runs automatically on WiFi connect from any page.
   */
  private async syncLedColorsFromCover(): Promise<void> {
    const coverOk = await this.wifi.verifyCoverArt();
    if (!coverOk) return;

    const url = this.wifi.coverArtUrl('/art/cover.jpg');
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
    console.log(`[AUTO-LED] Synced album colors from device cover: ${primary} / ${secondary}`);
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
}
