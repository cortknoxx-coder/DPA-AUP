import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-device-runtime-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <div class="mb-6 rounded-xl border px-4 py-3" [ngClass]="toneClasses()">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em]">{{ title() }}</p>
            <p class="mt-1 text-sm leading-6">{{ message() }}</p>
          </div>
          @if (runtime()?.lastUploadPath && runtime()?.uploadState !== 'idle') {
            <p class="text-[11px] font-mono opacity-80">{{ runtime()?.lastUploadPath }}</p>
          }
        </div>
      </div>
    }
  `,
})
export class DeviceRuntimeBannerComponent {
  private connection = inject(DeviceConnectionService);

  runtime = this.connection.deviceRuntime;
  message = this.connection.deviceRuntimeMessage;

  visible = computed(() => this.connection.connectionStatus() === 'wifi' && !!this.message());

  title = computed(() => {
    const runtime = this.runtime();
    if (!runtime) return 'Device Status';
    if (runtime.uploadState === 'error') return 'Degraded Mode';
    if (runtime.uploadState !== 'idle' && runtime.uploadState !== 'complete') return 'Upload Mode';
    if (runtime.bootState === 'booting') return 'Booting';
    if (runtime.bootState === 'degraded') return 'Degraded Mode';
    return 'Device Status';
  });

  toneClasses = computed(() => {
    const runtime = this.runtime();
    if (!runtime) return 'border-slate-700 bg-slate-900/60 text-slate-200';
    if (runtime.uploadState !== 'idle' && runtime.uploadState !== 'complete') {
      return 'border-sky-500/40 bg-sky-500/10 text-sky-100';
    }
    if (runtime.bootState === 'booting') {
      return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
    }
    return 'border-rose-500/40 bg-rose-500/10 text-rose-100';
  });
}
