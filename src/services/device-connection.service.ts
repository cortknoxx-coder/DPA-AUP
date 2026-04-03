
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
      return true;
    }
    this.connectionError.set('Could not reach DPA over WiFi. Confirm you are on the DPA-Portal network and retry.');
    return false;
  }

  // --- NFC Tap (initiates BLE connection) ---

  async connectViaNfc(): Promise<boolean> {
    const duid = await this.nfc.startScan();
    if (duid) {
      // NFC gives us the DUID, now try BLE connection
      const bleSuccess = await this.connectViaBle();
      return bleSuccess;
    }
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
    this.deviceLibrary.set({
      albums: [
        {
          id: duid,
          title: `${duid} Library`,
          artworkUrl: `https://picsum.photos/seed/${duid}/400/400`,
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
