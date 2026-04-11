
import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { DeviceWifiService } from '../../services/device-wifi.service';
import { DeviceBleService, BLE_CMD } from '../../services/device-ble.service';
import { A2dpDevice, A2dpState, EqPreset, PlaybackMode, FirmwareStatus } from '../../types';

@Component({
  selector: 'app-fan-audio',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bg-slate-950 text-slate-50 p-4 space-y-6 pb-8">
      <h1 class="text-2xl font-extrabold tracking-tight">Audio Settings</h1>

      <!-- Connection Check -->
      @if (connectionService.connectionStatus() === 'disconnected') {
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center">
          <div class="text-4xl mb-3">🔌</div>
          <p class="text-slate-400 text-sm">Connect your DPA device via WiFi or Bluetooth to manage audio settings.</p>
        </div>
      } @else {
        <!-- Volume Control -->
        <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Volume</h2>
          <div class="flex items-center gap-4">
            <button (click)="volumeDown()" class="w-10 h-10 rounded-full border border-slate-700 bg-slate-800 flex items-center justify-center text-lg hover:bg-slate-700 transition-colors">−</button>
            <div class="flex-1">
              <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div class="h-full bg-teal-500 rounded-full transition-all duration-200" [style.width.%]="currentVolume()"></div>
              </div>
              <p class="text-center text-xs text-slate-400 mt-1">{{ currentVolume() }}%</p>
            </div>
            <button (click)="volumeUp()" class="w-10 h-10 rounded-full border border-slate-700 bg-slate-800 flex items-center justify-center text-lg hover:bg-slate-700 transition-colors">+</button>
          </div>
        </section>

        <!-- EQ Presets -->
        <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Equalizer</h2>
          <div class="grid grid-cols-4 gap-2">
            @for (preset of eqPresets; track preset.id) {
              <button (click)="setEq(preset.id)"
                [class]="'rounded-xl py-3 px-2 text-xs font-bold transition-all ' + (currentEq() === preset.id ? 'bg-teal-600 text-white border-teal-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750') + ' border'">
                <div class="text-lg mb-1">{{ preset.icon }}</div>
                {{ preset.label }}
              </button>
            }
          </div>
        </section>

        <!-- Playback Mode -->
        <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Playback Mode</h2>
          <div class="grid grid-cols-4 gap-2">
            @for (mode of playbackModes; track mode.id) {
              <button (click)="setMode(mode.id)"
                [class]="'rounded-xl py-3 px-2 text-xs font-bold transition-all ' + (currentMode() === mode.id ? 'bg-teal-600 text-white border-teal-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750') + ' border'">
                <div class="text-lg mb-1">{{ mode.icon }}</div>
                {{ mode.label }}
              </button>
            }
          </div>
        </section>

        <!-- Bluetooth A2DP Audio -->
        <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Bluetooth Audio</h2>

          <!-- Current Connection -->
          <div class="flex items-center gap-3 mb-4 p-3 rounded-lg bg-slate-800/50">
            <div [class]="'w-3 h-3 rounded-full ' + (a2dpConnected() ? 'bg-emerald-400' : 'bg-slate-600')"></div>
            <div class="flex-1">
              <p class="text-sm font-semibold">{{ a2dpStatusLabel() }}</p>
              @if (a2dpDeviceName()) {
                <p class="text-xs text-slate-400">{{ a2dpDeviceName() }}</p>
              }
            </div>
            @if (a2dpConnected()) {
              <button (click)="disconnectA2dp()" class="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600/20 text-rose-400 border border-rose-800 hover:bg-rose-600/30 transition-colors">
                Disconnect
              </button>
            }
          </div>

          <!-- Scan Button -->
          <button (click)="scanA2dp()" [disabled]="scanning()"
            class="w-full py-3 rounded-xl font-bold text-sm transition-all border border-slate-700 hover:border-teal-600"
            [class.bg-slate-800]="!scanning()"
            [class.bg-teal-900/30]="scanning()">
            @if (scanning()) {
              <span class="inline-block animate-spin mr-2">⟳</span> Scanning for devices...
            } @else {
              🔍 Scan for Bluetooth Speakers & Headphones
            }
          </button>

          <!-- Discovered Devices -->
          @if (discoveredDevices().length > 0) {
            <div class="mt-4 space-y-2">
              <p class="text-xs text-slate-500 uppercase font-bold tracking-wider">Available Devices</p>
              @for (device of discoveredDevices(); track device.addr) {
                <button (click)="connectA2dp(device.addr)"
                  [disabled]="connecting()"
                  class="w-full flex items-center gap-3 p-3 rounded-lg bg-slate-800 border border-slate-700 hover:border-teal-600 transition-all text-left">
                  <div class="text-xl">🎧</div>
                  <div class="flex-1">
                    <p class="text-sm font-semibold">{{ device.name || 'Unknown Device' }}</p>
                    <p class="text-xs text-slate-500">{{ device.addr }}</p>
                  </div>
                  <div class="text-xs text-slate-500">{{ device.rssi }}dBm</div>
                </button>
              }
            </div>
          }
        </section>

        <!-- Battery Info -->
        @if (batteryInfo()) {
          <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Battery</h2>
            <div class="flex items-center gap-4">
              <div class="text-3xl">{{ batteryIcon() }}</div>
              <div class="flex-1">
                <div class="h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all duration-500"
                    [style.width.%]="batteryInfo()!.percent"
                    [class.bg-emerald-500]="batteryInfo()!.percent > 50"
                    [class.bg-amber-500]="batteryInfo()!.percent > 20 && batteryInfo()!.percent <= 50"
                    [class.bg-rose-500]="batteryInfo()!.percent <= 20">
                  </div>
                </div>
                <div class="flex justify-between mt-1">
                  <span class="text-xs text-slate-400">{{ batteryInfo()!.percent }}%</span>
                  <span class="text-xs text-slate-500">{{ batteryInfo()!.voltage.toFixed(2) }}V</span>
                  @if (batteryInfo()!.charging) {
                    <span class="text-xs text-emerald-400">⚡ Charging</span>
                  }
                </div>
              </div>
            </div>
          </section>
        }

        <!-- Storage Info -->
        @if (storageInfo()) {
          <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Storage</h2>
            <div class="h-3 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div class="h-full bg-indigo-500 rounded-full transition-all" [style.width.%]="storageUsedPercent()"></div>
            </div>
            <div class="flex justify-between text-xs text-slate-400">
              <span>{{ storageInfo()!.usedMB }}MB used</span>
              <span>{{ storageInfo()!.freeMB }}MB free</span>
            </div>
            <div class="grid grid-cols-3 gap-3 mt-3">
              <div class="text-center p-2 rounded-lg bg-slate-800">
                <p class="text-lg font-bold">{{ storageInfo()!.trackCount }}</p>
                <p class="text-xs text-slate-500">Tracks</p>
              </div>
              <div class="text-center p-2 rounded-lg bg-slate-800">
                <p class="text-lg font-bold">{{ storageInfo()!.capsuleCount }}</p>
                <p class="text-xs text-slate-500">Capsules</p>
              </div>
              <div class="text-center p-2 rounded-lg bg-slate-800">
                <p class="text-lg font-bold">{{ storageInfo()!.videoCount }}</p>
                <p class="text-xs text-slate-500">Videos</p>
              </div>
            </div>
          </section>
        }
      }
    </div>
  `
})
export class FanAudioComponent {
  connectionService = inject(DeviceConnectionService);
  private wifiService = inject(DeviceWifiService);
  private bleService = inject(DeviceBleService);

  scanning = signal(false);
  connecting = signal(false);
  discoveredDevices = signal<A2dpDevice[]>([]);

  eqPresets = [
    { id: 'flat' as EqPreset, label: 'Flat', icon: '🎵' },
    { id: 'bass_boost' as EqPreset, label: 'Bass', icon: '🔊' },
    { id: 'vocal' as EqPreset, label: 'Vocal', icon: '🎤' },
    { id: 'warm' as EqPreset, label: 'Warm', icon: '🔥' },
  ];

  playbackModes = [
    { id: 'normal' as PlaybackMode, label: 'Normal', icon: '▶️' },
    { id: 'repeat_one' as PlaybackMode, label: 'Repeat 1', icon: '🔂' },
  ];

  private status = computed(() => this.wifiService.lastStatus());

  currentVolume = computed(() => this.status()?.audio?.volume ?? 75);
  currentEq = computed(() => this.status()?.audio?.eq ?? 'flat');
  currentMode = computed(() => this.status()?.audio?.mode ?? 'normal');
  a2dpConnected = computed(() => {
    const s = this.status()?.audio?.a2dp;
    return s === 'connected' || s === 'playing';
  });
  a2dpDeviceName = computed(() => this.status()?.audio?.a2dpDevice ?? '');
  a2dpStatusLabel = computed(() => {
    const s = this.status()?.audio?.a2dp ?? 'disconnected';
    switch (s) {
      case 'connected': return 'Connected';
      case 'playing': return 'Playing';
      case 'connecting': return 'Connecting...';
      default: return 'Not Connected';
    }
  });

  batteryInfo = computed(() => this.status()?.battery ?? null);
  batteryIcon = computed(() => {
    const pct = this.batteryInfo()?.percent ?? 0;
    if (this.batteryInfo()?.charging) return '🔋';
    if (pct > 75) return '🔋';
    if (pct > 50) return '🔋';
    if (pct > 20) return '🪫';
    return '🪫';
  });

  storageInfo = computed(() => this.status()?.storage ?? null);
  storageUsedPercent = computed(() => {
    const s = this.storageInfo();
    if (!s || s.totalMB === 0) return 0;
    return Math.round((s.usedMB / s.totalMB) * 100);
  });

  async volumeUp() {
    const newVol = Math.min(100, this.currentVolume() + 5);
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setVolume(newVol);
    } else {
      await this.bleService.sendCommand(BLE_CMD.VOLUME_UP);
    }
    await this.refreshStatus();
  }

  async volumeDown() {
    const newVol = Math.max(0, this.currentVolume() - 5);
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setVolume(newVol);
    } else {
      await this.bleService.sendCommand(BLE_CMD.VOLUME_DOWN);
    }
    await this.refreshStatus();
  }

  async setEq(preset: EqPreset) {
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setEqPreset(preset);
    } else {
      await this.bleService.sendCommand(BLE_CMD.CYCLE_EQ);
    }
    await this.refreshStatus();
  }

  async setMode(mode: PlaybackMode) {
    if (this.connectionService.connectionStatus() === 'wifi') {
      await this.wifiService.setPlaybackMode(mode);
    } else {
      await this.bleService.sendCommand(BLE_CMD.CYCLE_MODE);
    }
    await this.refreshStatus();
  }

  async scanA2dp() {
    this.scanning.set(true);
    this.discoveredDevices.set([]);
    try {
      if (this.connectionService.connectionStatus() === 'wifi') {
        const devices = await this.wifiService.scanA2dpDevices();
        this.discoveredDevices.set(devices);
      } else {
        await this.bleService.sendCommand(BLE_CMD.A2DP_SCAN);
        // Wait for scan results via status notification
        await new Promise(r => setTimeout(r, 5000));
        const devices = await this.wifiService.getA2dpDevices();
        this.discoveredDevices.set(devices);
      }
    } finally {
      this.scanning.set(false);
    }
  }

  async connectA2dp(addr: string) {
    this.connecting.set(true);
    try {
      await this.wifiService.connectA2dp(addr);
      await this.refreshStatus();
    } finally {
      this.connecting.set(false);
    }
  }

  async disconnectA2dp() {
    await this.wifiService.disconnectA2dp();
    await this.refreshStatus();
  }

  private async refreshStatus() {
    try {
      await this.wifiService.getStatus();
    } catch { /* ignore */ }
  }
}
