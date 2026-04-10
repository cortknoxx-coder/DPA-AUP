import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-device-hud-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <aside class="pointer-events-auto w-full max-w-sm rounded-2xl border border-slate-700/70 bg-slate-950/92 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Device HUD</p>
            <div class="mt-2 flex items-center gap-2">
              <span class="h-2.5 w-2.5 rounded-full" [ngClass]="connectionDotClass()"></span>
              <p class="text-sm font-semibold text-slate-100">{{ connectionLabel() }}</p>
            </div>
            @if (serial()) {
              <p class="mt-1 text-[11px] font-mono text-slate-500">{{ serial() }}</p>
            }
          </div>
          @if (runtime()?.degradedReason) {
            <span class="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">
              Degraded
            </span>
          }
        </div>

        @if (runtime(); as state) {
          <div class="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Boot</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.bootState }}</p>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Upload</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.uploadState }}</p>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Storage</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.sdState }}</p>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">HTTP</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.httpMode || 'full' }}</p>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            @if (state.audioVerified) {
              <span class="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                Audio Verified
              </span>
            }
            @if (state.wifiMaintenance) {
              <span class="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-200">
                {{ state.wifiMaintenance }}
              </span>
            }
            @if (state.lastUploadPath) {
              <span class="max-w-full truncate rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-mono text-slate-400">
                {{ state.lastUploadPath }}
              </span>
            }
          </div>
        }

        @if (message()) {
          <div class="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3">
            <p class="text-xs leading-5 text-slate-200">{{ message() }}</p>
          </div>
        }
      </aside>
    }
  `,
})
export class DeviceHudOverlayComponent {
  private connection = inject(DeviceConnectionService);

  runtime = this.connection.deviceRuntime;
  message = computed(() => this.connection.connectionError() || this.connection.deviceRuntimeMessage());
  serial = computed(() => this.connection.deviceInfo()?.serial ?? '');

  visible = computed(() => {
    return this.connection.connectionStatus() !== 'disconnected'
      || !!this.connection.connectionError();
  });

  connectionLabel = computed(() => {
    const status = this.connection.connectionStatus();
    if (status === 'disconnected') return 'Disconnected';
    if (status === 'wifi') return 'WiFi Device';
    if (status === 'bluetooth') return 'Bluetooth Device';
    if (status === 'usb') return this.connection.isSimulationMode() ? 'Simulator' : 'USB Device';
    return 'Device';
  });

  connectionDotClass = computed(() => {
    const status = this.connection.connectionStatus();
    if (status === 'disconnected') return 'bg-rose-500';
    if (status === 'wifi') return 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]';
    if (status === 'bluetooth') return 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.6)]';
    if (this.connection.isSimulationMode()) return 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]';
    return 'bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.6)]';
  });
}
