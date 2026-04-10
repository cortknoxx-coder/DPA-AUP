import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { DeviceConnectionService } from '../../services/device-connection.service';

type ToastTone = 'info' | 'success' | 'warn' | 'error';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message: string;
}

@Component({
  selector: 'app-device-notification-center',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (notifications().length) {
      <div class="pointer-events-none flex w-full max-w-sm flex-col gap-3">
        @for (notification of notifications(); track notification.id) {
          <article class="pointer-events-auto rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl" [ngClass]="toneClass(notification.tone)">
            <p class="text-[11px] font-semibold uppercase tracking-[0.2em]">{{ notification.title }}</p>
            <p class="mt-1 text-sm leading-5">{{ notification.message }}</p>
          </article>
        }
      </div>
    }
  `,
})
export class DeviceNotificationCenterComponent {
  private connection = inject(DeviceConnectionService);
  notifications = signal<ToastItem[]>([]);

  private nextId = 1;
  private initialized = false;
  private lastConnectionStatus = this.connection.connectionStatus();
  private lastConnectionError = this.connection.connectionError();
  private lastBootState = this.connection.deviceRuntime()?.bootState ?? '';
  private lastUploadState = this.connection.deviceRuntime()?.uploadState ?? '';

  constructor() {
    effect(() => {
      const connectionStatus = this.connection.connectionStatus();
      const connectionError = this.connection.connectionError();
      const runtime = this.connection.deviceRuntime();
      const bootState = runtime?.bootState ?? '';
      const uploadState = runtime?.uploadState ?? '';

      if (!this.initialized) {
        this.initialized = true;
        this.lastConnectionStatus = connectionStatus;
        this.lastConnectionError = connectionError;
        this.lastBootState = bootState;
        this.lastUploadState = uploadState;
        return;
      }

      if (connectionStatus !== this.lastConnectionStatus) {
        if (connectionStatus === 'wifi') {
          this.push('success', 'Connected', 'DPA WiFi link is active.');
        } else if (connectionStatus === 'bluetooth') {
          this.push('info', 'Bluetooth', 'BLE control link is active.');
        } else if (connectionStatus === 'usb') {
          this.push(this.connection.isSimulationMode() ? 'warn' : 'info', this.connection.isSimulationMode() ? 'Simulator' : 'USB', this.connection.isSimulationMode() ? 'Simulator mode is active.' : 'USB device link is active.');
        } else if (connectionStatus === 'disconnected' && this.lastConnectionStatus !== 'disconnected') {
          this.push('warn', 'Disconnected', 'Device link dropped or was closed.');
        }
      }

      if (connectionError && connectionError !== this.lastConnectionError) {
        this.push('error', 'Connection Alert', connectionError);
      }

      if (bootState !== this.lastBootState) {
        if (bootState === 'booting') {
          this.push('info', 'Booting', 'Device is validating SD, audio, WiFi, and HTTP.');
        } else if (bootState === 'degraded') {
          this.push('warn', 'Degraded Mode', this.connection.deviceRuntimeMessage() || 'Device is online in a degraded state.');
        } else if (bootState === 'ready' && this.lastBootState) {
          this.push('success', 'Ready', 'Device returned to a ready state.');
        }
      }

      if (uploadState !== this.lastUploadState) {
        if (['preparing', 'receiving', 'verifying', 'finalizing'].includes(uploadState)) {
          this.push('info', 'Upload Mode', this.connection.deviceRuntimeMessage() || 'Large upload in progress.');
        } else if (uploadState === 'complete') {
          this.push('success', 'Upload Complete', 'Device finalized the latest transfer.');
        } else if (uploadState === 'error') {
          this.push('error', 'Upload Failed', this.connection.deviceRuntimeMessage() || 'The latest upload did not finalize cleanly.');
        }
      }

      this.lastConnectionStatus = connectionStatus;
      this.lastConnectionError = connectionError;
      this.lastBootState = bootState;
      this.lastUploadState = uploadState;
    });
  }

  toneClass(tone: ToastTone): string {
    switch (tone) {
      case 'success':
        return 'border-emerald-500/40 bg-emerald-500/12 text-emerald-100';
      case 'warn':
        return 'border-amber-500/40 bg-amber-500/12 text-amber-100';
      case 'error':
        return 'border-rose-500/40 bg-rose-500/12 text-rose-100';
      default:
        return 'border-sky-500/40 bg-sky-500/12 text-sky-100';
    }
  }

  private push(tone: ToastTone, title: string, message: string) {
    if (!message) return;
    const id = this.nextId++;
    this.notifications.update((items) => [...items, { id, tone, title, message }].slice(-4));
    setTimeout(() => {
      this.notifications.update((items) => items.filter((item) => item.id !== id));
    }, 5200);
  }
}
