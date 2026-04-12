import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BrandMarkComponent } from '../../components/brand-mark/brand-mark.component';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-creator-connect',
  standalone: true,
  imports: [CommonModule, BrandMarkComponent],
  template: `
    <div class="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div class="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-teal-900/10 to-transparent pointer-events-none"></div>
      <div class="absolute bottom-0 right-0 w-96 h-96 bg-indigo-900/10 rounded-full blur-3xl pointer-events-none"></div>

      <div class="w-full max-w-md text-center z-10">
        <app-brand-mark tone="teal" size="hero" class="justify-center" />
        <h1 class="mt-8 text-3xl font-bold text-slate-100 tracking-tight">Connect Your DPA Before Creator Access</h1>
        @if (autoProbing()) {
          <p class="text-teal-400 mt-3 flex items-center justify-center gap-2">
            <span class="h-4 w-4 rounded-full border-2 border-teal-400/30 border-t-teal-400 animate-spin"></span>
            Checking for a connected device...
          </p>
        } @else {
          <p class="text-slate-400 mt-3">
            The creator dashboard stays locked until WiFi, USB-C, NFC, or another confirmed device transport is active.
          </p>
        }
      </div>

      <div class="w-full max-w-sm space-y-4 mt-12 z-10" [class.opacity-50]="autoProbing()" [class.pointer-events-none]="autoProbing()">
        <button (click)="connectUsb()" [disabled]="connectingVia() !== null" class="w-full group relative flex items-center gap-4 px-6 py-4 rounded-xl border border-slate-700 bg-slate-900/50 hover:bg-slate-800/70 hover:border-teal-500/50 transition-all duration-300 transform hover:-translate-y-1 shadow-lg overflow-hidden disabled:opacity-50 disabled:hover:translate-y-0">
          <div class="absolute left-0 top-0 bottom-0 w-1 bg-teal-500 rounded-l-xl transition-transform duration-300 scale-y-0 group-hover:scale-y-100 origin-center"></div>
          <div class="text-teal-400">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
          </div>
          <div class="text-left flex-1">
            <h3 class="font-semibold text-white">USB-C Bridge</h3>
            <p class="text-xs text-slate-400">Best for creator uploads, transfer verification, and desktop workflows.</p>
          </div>
        </button>

        <button (click)="connectWiFi()" [disabled]="connectingVia() !== null" class="w-full group relative flex items-center gap-4 px-6 py-4 rounded-xl border border-slate-700 bg-slate-900/50 hover:bg-slate-800/70 hover:border-emerald-500/50 transition-all duration-300 transform hover:-translate-y-1 shadow-lg overflow-hidden disabled:opacity-50 disabled:hover:translate-y-0">
          <div class="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 rounded-l-xl transition-transform duration-300 scale-y-0 group-hover:scale-y-100 origin-center"></div>
          <div class="text-emerald-400">
            @if (connectingVia() === 'wifi') {
              <div class="h-8 w-8 flex items-center justify-center">
                <div class="h-5 w-5 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin"></div>
              </div>
            } @else {
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" /></svg>
            }
          </div>
          <div class="text-left flex-1">
            <h3 class="font-semibold text-white">WiFi Direct</h3>
            <p class="text-xs text-slate-400">Join the DPA SSID first, then confirm the creator portal can reach the device.</p>
          </div>
        </button>

        <button (click)="connectNfc()" [disabled]="connectingVia() !== null || !deviceService.nfc.isSupported()" class="w-full group relative flex items-center gap-4 px-6 py-4 rounded-xl border border-slate-700 bg-slate-900/50 hover:bg-slate-800/70 hover:border-sky-500/50 transition-all duration-300 transform hover:-translate-y-1 shadow-lg overflow-hidden disabled:opacity-50 disabled:hover:translate-y-0">
          <div class="absolute left-0 top-0 bottom-0 w-1 bg-sky-500 rounded-l-xl transition-transform duration-300 scale-y-0 group-hover:scale-y-100 origin-center"></div>
          <div class="text-sky-400">
            @if (connectingVia() === 'nfc') {
              <div class="h-8 w-8 flex items-center justify-center">
                <div class="h-5 w-5 rounded-full border-2 border-sky-400/30 border-t-sky-400 animate-spin"></div>
              </div>
            } @else {
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h5M4 15v5h5M15 4h5v5M15 20h5v-5" /></svg>
            }
          </div>
          <div class="text-left flex-1">
            <h3 class="font-semibold text-white">NFC Tap</h3>
            <p class="text-xs text-slate-400">Authenticate ownership first, then reveal the creator dashboard.</p>
          </div>
        </button>
      </div>

      @if (deviceService.connectionError()) {
        <div class="mt-4 max-w-sm w-full z-10 p-3 rounded-lg bg-rose-900/20 border border-rose-900/50 text-rose-400 text-xs flex items-center gap-2 animate-fade-in-up">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {{ deviceService.connectionError() }}
        </div>
      }
    </div>
  `,
})
export class CreatorConnectComponent {
  deviceService = inject(DeviceConnectionService);
  private router = inject(Router);

  connectingVia = signal<'wifi' | 'usb' | 'nfc' | null>(null);
  autoProbing = signal(true);

  constructor() {
    if (this.deviceService.connectionStatus() !== 'disconnected') {
      void this.router.navigate(['/artist/dashboard']);
      this.autoProbing.set(false);
    } else {
      void this.autoProbeDevice();
    }

    effect(() => {
      if (this.deviceService.connectionStatus() !== 'disconnected') {
        void this.router.navigate(['/artist/dashboard']);
      }
    });
  }

  private async autoProbeDevice() {
    this.autoProbing.set(true);
    try {
      const ok = await this.deviceService.detectConnectedDevice({ silent: true, preferCurrent: false });
      if (ok) return;
    } catch {
      // Fall through to manual connection options.
    }
    this.autoProbing.set(false);
  }

  async connectUsb() {
    this.connectingVia.set('usb');
    try {
      await this.deviceService.connectToBridge();
    } finally {
      this.connectingVia.set(null);
    }
  }

  async connectWiFi() {
    this.connectingVia.set('wifi');
    try {
      await this.deviceService.connectViaWifi();
    } finally {
      this.connectingVia.set(null);
    }
  }

  async connectNfc() {
    this.connectingVia.set('nfc');
    try {
      await this.deviceService.connectViaNfc();
    } finally {
      this.connectingVia.set(null);
    }
  }
}
