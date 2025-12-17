
import { Injectable, signal, computed, inject } from '@angular/core';
import { DeviceBridgeService } from './device-bridge.service';
import { ApiService } from './api.service';
import { DpaDeviceInfo, LibraryIndex, Album, Track } from '../types';
import { DataService } from './data.service';

export type ConnectionStatus = 'disconnected' | 'usb' | 'bluetooth';
export type RegistrationStatus = 'unregistered' | 'analyzing' | 'registered' | 'lost';

@Injectable({
  providedIn: 'root'
})
export class DeviceConnectionService {
  private bridge = inject(DeviceBridgeService);
  private api = inject(ApiService);
  private dataService = inject(DataService);

  // --- Core State Signals ---
  connectionStatus = signal<ConnectionStatus>('disconnected');
  registrationStatus = signal<RegistrationStatus>('unregistered');
  
  // --- Device-Sourced State ---
  deviceInfo = signal<DpaDeviceInfo | null>(null);
  deviceLibrary = signal<LibraryIndex | null>(null);
  
  // --- Derived State for UI ---
  isSnippetMode = computed(() => this.registrationStatus() !== 'registered');
  registeredDeviceId = computed(() => this.deviceInfo()?.serial ?? null);

  // --- Internal State ---
  private isSimulated = signal(false);

  constructor() {
    this.disconnectDevice(); // Ensure a clean state on startup
  }

  async connectToBridge() {
    const connected = await this.bridge.connect();
    if (connected) {
      this.connectionStatus.set('usb'); // Assume USB for bridge
      this.isSimulated.set(false);
      await this.checkDevice();
    } else {
      alert('Failed to connect to DPA Desktop Bridge. Is the application running on your computer?');
      this.disconnectDevice();
    }
  }

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

      // For the demo, if a device is connected, we'll assume it's registered to the user.
      if (info.serial) {
        this.registrationStatus.set('registered');
      }
    } catch (e) {
      console.error('Failed to get device info/library', e);
      this.disconnectDevice();
    }
  }

  disconnectDevice() {
    this.connectionStatus.set('disconnected');
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

  async registerDevice(deviceId: string): Promise<boolean> {
    this.registrationStatus.set('analyzing');
    
    // In a real flow, this involves a challenge-response with the device's secure element.
    // For the demo, we'll verify the serial against the connected device, then "claim" it with the backend.
    
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
    // This would be a multi-step security flow
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
