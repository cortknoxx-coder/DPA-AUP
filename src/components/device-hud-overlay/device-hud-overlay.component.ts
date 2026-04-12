import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-device-hud-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (showRestoreChip()) {
      <button
        type="button"
        class="pointer-events-auto ml-auto inline-flex items-center gap-2 rounded-full border border-slate-800/80 bg-slate-950/92 px-3 py-2 text-xs font-semibold text-slate-200 shadow-xl shadow-black/30 backdrop-blur-xl"
        (click)="restoreHud()"
        aria-label="Restore device status">
        <span class="h-2 w-2 rounded-full" [ngClass]="connectionDotClass()"></span>
        Device Status
      </button>
    }

    @if (visible()) {
      <aside
        class="pointer-events-auto border border-slate-800/80 bg-slate-950/88 shadow-2xl shadow-black/30 backdrop-blur-xl"
        [class.w-full]="!mobileCompact()"
        [class.max-w-[19rem]]="!mobileCompact()"
        [class.rounded-[1.35rem]]="!mobileCompact()"
        [class.p-3.5]="!mobileCompact()"
        [class.ml-auto]="mobileCompact()"
        [class.w-auto]="mobileCompact()"
        [class.max-w-max]="mobileCompact()"
        [class.rounded-full]="mobileCompact()"
        [class.px-3]="mobileCompact()"
        [class.py-2]="mobileCompact()">
        <div class="flex items-start justify-between gap-3">
          <div>
            @if (mobileCompact()) {
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full" [ngClass]="connectionDotClass()"></span>
                <p class="text-sm font-semibold text-slate-100">{{ connectionLabel() }}</p>
              </div>
            } @else {
              <p class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Device Status</p>
              <div class="mt-1.5 flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full" [ngClass]="connectionDotClass()"></span>
                <p class="text-sm font-semibold text-slate-100">{{ connectionLabel() }}</p>
              </div>
            }
            @if (!mobileCompact() && serial()) {
              <p class="mt-1 text-[11px] font-mono text-slate-500">{{ serial() }}</p>
            }
          </div>
          <div class="flex items-center gap-1">
            @if (!mobileCompact() && runtime()?.degradedReason) {
              <span class="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-300">
                Degraded
              </span>
            }
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800/80 bg-slate-900/80 text-slate-300 transition hover:border-slate-700 hover:text-white"
              (click)="toggleCollapsed()"
              [attr.aria-label]="collapsed() ? 'Expand device status' : 'Collapse device status'">
              {{ collapsed() ? '+' : '−' }}
            </button>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800/80 bg-slate-900/80 text-slate-300 transition hover:border-slate-700 hover:text-white sm:hidden"
              (click)="dismissHud()"
              aria-label="Close device status">
              ×
            </button>
          </div>
        </div>

        @if (!collapsed() && runtime(); as state) {
          <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Boot</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.bootState }}</p>
            </div>
            <div class="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Upload</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.uploadState }}</p>
            </div>
            <div class="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">Storage</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.sdState }}</p>
            </div>
            <div class="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2">
              <p class="text-[10px] uppercase tracking-[0.18em] text-slate-500">HTTP</p>
              <p class="mt-1 font-semibold text-slate-100">{{ state.httpMode || 'full' }}</p>
            </div>
          </div>

          <div class="mt-2.5 flex flex-wrap gap-1.5">
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

        @if (collapsed() && compactSummary() && !mobileCompact()) {
          <div class="mt-3 rounded-xl border border-slate-800/80 bg-slate-900/60 px-3 py-2.5">
            <p class="text-xs leading-5 text-slate-200">{{ compactSummary() }}</p>
          </div>
        }

        @if (!collapsed() && message()) {
          <div class="mt-3 rounded-xl border border-slate-800/80 bg-slate-900/60 px-3 py-2.5">
            <p class="text-xs leading-5 text-slate-200">{{ message() }}</p>
          </div>
        }

        @if (!collapsed() && lastDisconnect()) {
          <div class="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300">Last Disconnect</p>
            <p class="mt-1 text-[11px] leading-5 text-amber-100/90">{{ lastDisconnect() }}</p>
          </div>
        }
      </aside>
    }
  `,
})
export class DeviceHudOverlayComponent {
  private connection = inject(DeviceConnectionService);
  private destroyRef = inject(DestroyRef);
  private mobileMediaQuery =
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)') : null;
  readonly isSmallScreen = signal(this.mobileMediaQuery?.matches ?? false);
  collapsed = signal(this.mobileMediaQuery?.matches ?? false);
  dismissed = signal(false);
  private lastConnectionStatus: string | null = null;

  runtime = this.connection.deviceRuntime;
  message = computed(() => this.connection.connectionError() || this.connection.deviceRuntimeMessage());
  lastDisconnect = this.connection.lastDisconnectSummary;
  serial = computed(() => this.connection.deviceInfo()?.serial ?? '');
  compactSummary = computed(() => {
    const runtime = this.runtime();
    const tokens = [
      this.message(),
      runtime?.bootState ? `Boot ${runtime.bootState}` : '',
      runtime?.httpMode ? `HTTP ${runtime.httpMode}` : '',
      this.lastDisconnect() ? 'Disconnect logged' : '',
    ].filter(Boolean);
    return tokens[0] || '';
  });
  mobileCompact = computed(() => this.isSmallScreen() && this.collapsed());

  constructor() {
    if (this.mobileMediaQuery) {
      const syncSmallScreen = (matches: boolean) => {
        this.isSmallScreen.set(matches);
        if (matches) {
          this.collapsed.set(true);
        }
      };

      syncSmallScreen(this.mobileMediaQuery.matches);
      const handleChange = (event: MediaQueryListEvent) => syncSmallScreen(event.matches);
      this.mobileMediaQuery.addEventListener('change', handleChange);
      this.destroyRef.onDestroy(() => this.mobileMediaQuery?.removeEventListener('change', handleChange));
    }

    effect(() => {
      const status = this.connection.connectionStatus();
      if (this.lastConnectionStatus !== null && status !== this.lastConnectionStatus) {
        this.dismissed.set(false);
        this.collapsed.set(this.isSmallScreen());
      }
      this.lastConnectionStatus = status;
    });
  }

  visible = computed(() => {
    return !this.dismissed() && (
      this.connection.connectionStatus() !== 'disconnected'
      || !!this.connection.connectionError()
    );
  });

  showRestoreChip = computed(() => {
    return this.dismissed() && (
      this.connection.connectionStatus() !== 'disconnected'
      || !!this.connection.connectionError()
    );
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

  toggleCollapsed() {
    this.collapsed.update((value) => !value);
  }

  dismissHud() {
    this.dismissed.set(true);
    this.collapsed.set(true);
  }

  restoreHud() {
    this.dismissed.set(false);
  }
}
