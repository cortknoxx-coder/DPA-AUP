
import { Component, inject, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-fan-auth',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './fan-auth.component.html',
})
export class FanAuthComponent {
  deviceService = inject(DeviceConnectionService);
  private router = inject(Router);

  connectingVia = signal<'ble' | 'nfc' | 'wifi' | null>(null);
  wifiError = signal<string | null>(null);
  autoProbing = signal(true);

  // Feature detection
  hasBle = this.deviceService.ble.isSupported;
  hasNfc = this.deviceService.nfc.isSupported;

  constructor() {
    // If already connected when reaching this page, redirect immediately.
    if (this.deviceService.connectionStatus() !== 'disconnected') {
      this.router.navigate(['/fan/app/home']);
      this.autoProbing.set(false);
    } else {
      // Auto-probe for device on page load — if user is already on device WiFi,
      // skip the manual connect step entirely.
      this.autoProbeDevice();
    }

    // Effect to react to connection status changes
    effect(() => {
      if (this.deviceService.connectionStatus() !== 'disconnected') {
        this.router.navigate(['/fan/app/home']);
      }
    });
  }

  private async autoProbeDevice() {
    this.autoProbing.set(true);
    try {
      const ok = await this.deviceService.detectConnectedDevice({ silent: true, preferCurrent: false });
      if (ok) return; // effect above handles redirect
    } catch {
      // probe failed, show manual options
    }
    this.autoProbing.set(false);
  }

  connectUSB() {
    this.deviceService.connectToBridge();
  }

  async connectBluetooth() {
    this.connectingVia.set('ble');
    try {
      await this.deviceService.connectViaBle();
    } finally {
      this.connectingVia.set(null);
    }
  }

  async connectNFC() {
    this.connectingVia.set('nfc');
    try {
      await this.deviceService.connectViaNfc();
    } finally {
      this.connectingVia.set(null);
    }
  }

  async connectWiFi() {
    this.connectingVia.set('wifi');
    this.wifiError.set(null);
    try {
      const success = await this.deviceService.connectViaWifi();
      if (!success) {
        this.wifiError.set('Could not reach device. Make sure you are connected to the DPA WiFi network.');
      }
    } finally {
      this.connectingVia.set(null);
    }
  }

  useSimulator() {
    this.deviceService.toggleSimulator();
  }
}
