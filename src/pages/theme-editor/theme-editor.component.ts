
import { Component, inject, computed, effect, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Theme, DcnpEventType, FirmwareStatus } from '../../types';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { LedNotificationService } from '../../services/led-notification.service';

@Component({
  selector: 'app-theme-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './theme-editor.component.html'
})
export class ThemeEditorComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb: FormBuilder = inject(FormBuilder);
  
  connectionService = inject(DeviceConnectionService);
  private ledNotification = inject(LedNotificationService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Visualizer State
  previewMode = signal<'idle' | 'playback' | 'charging'>('idle');
  notificationPreviewActive = signal<DcnpEventType | null>(null);
  glowOverride = signal<{ cssClass: string; color: string; customDuration?: string } | null>(null);
  pushStatus = signal<'idle' | 'pushing' | 'ok' | 'error'>('idle');
  isPushingTheme = computed(() => this.pushStatus() === 'pushing');

  deviceLedSyncStatus = signal<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  deviceLedSyncMessage = signal('');
  private ledSyncPollTimer: ReturnType<typeof setInterval> | null = null;
  private ledDevicePullKey = '';

  readonly dcnpTypes: DcnpEventType[] = ['concert', 'video', 'merch', 'signing', 'remix', 'other'];

  form = this.fb.group({
    albumColor: this.fb.group({
      primary: [''],
      accent: [''],
      background: ['']
    }),
    skinImage: [''], // Holds the base64 string for the skin
    skinType: ['partial'],
    led: this.fb.group({
      idle: this.fb.group({ color: [''], pattern: [''] }),
      playback: this.fb.group({ color: [''], pattern: [''] }),
      charging: this.fb.group({ color: [''], pattern: [''] })
    }),
    dcnp: this.fb.group({
      concert: [''],
      video: [''],
      merch: [''],
      signing: [''],
      remix: [''],
      other: ['']
    })
  });

  private formPatched = false;

  constructor() {
    effect(() => {
      const a = this.album();
      if (a && a.themeJson && !this.formPatched) {
        this.formPatched = true;
        const themeData = {
          ...a.themeJson,
          skinType: a.themeJson.skinType || 'partial'
        };
        this.form.patchValue(themeData as any, { emitEvent: false });
      }
    });

    effect(() => {
      const conn = this.connectionService.connectionStatus();
      const a = this.album();
      if (conn !== 'wifi') {
        this.ledDevicePullKey = '';
        this.stopLedDevicePolling();
        return;
      }
      if (!a) return;
      if (this.ledDevicePullKey === a.albumId) {
        this.startLedDevicePolling(a.albumId);
        return;
      }
      this.ledDevicePullKey = a.albumId;
      queueMicrotask(() => {
        if (this.connectionService.connectionStatus() === 'wifi' && this.album()?.albumId === a.albumId) {
          void this.pullLedThemeFromDevice(false);
        }
      });
      this.startLedDevicePolling(a.albumId);
    });
  }

  ngOnDestroy() {
    this.stopLedDevicePolling();
  }

  private startLedDevicePolling(albumId: string) {
    this.stopLedDevicePolling();
    this.ledSyncPollTimer = setInterval(() => {
      if (this.connectionService.connectionStatus() !== 'wifi' || this.album()?.albumId !== albumId) {
        this.stopLedDevicePolling();
        return;
      }
      if (this.form.dirty) return;
      void this.pullLedThemeFromDevice(false);
    }, 5000);
  }

  private stopLedDevicePolling() {
    if (this.ledSyncPollTimer) {
      clearInterval(this.ledSyncPollTimer);
      this.ledSyncPollTimer = null;
    }
  }

  private themeFromFirmwareStatus(base: Theme, st: FirmwareStatus): Theme {
    const L = st.led;
    const D = st.dcnp;
    return {
      ...base,
      led: {
        idle: {
          color: L?.idle?.color ?? base.led.idle.color,
          pattern: (L?.idle?.pattern || base.led.idle.pattern) as Theme['led']['idle']['pattern'],
        },
        playback: {
          color: L?.playback?.color ?? base.led.playback.color,
          pattern: (L?.playback?.pattern || base.led.playback.pattern) as Theme['led']['playback']['pattern'],
        },
        charging: {
          color: L?.charging?.color ?? base.led.charging.color,
          pattern: (L?.charging?.pattern || base.led.charging.pattern) as Theme['led']['charging']['pattern'],
        },
      },
      dcnp: {
        concert: D?.concert ?? base.dcnp.concert,
        video: D?.video ?? base.dcnp.video,
        merch: D?.merch ?? base.dcnp.merch,
        signing: D?.signing ?? base.dcnp.signing,
        remix: D?.remix ?? base.dcnp.remix,
        other: D?.other ?? base.dcnp.other,
      },
    };
  }

  /**
   * Pull LED + DCNP colors from device /api/status and merge into the form + local album theme.
   */
  async pullLedThemeFromDevice(showBanner: boolean) {
    const a = this.album();
    if (!a || this.connectionService.connectionStatus() !== 'wifi') return;

    if (showBanner) {
      this.deviceLedSyncStatus.set('syncing');
      this.deviceLedSyncMessage.set('Reading LED theme from device…');
    }

    try {
      const st = await this.connectionService.wifi.getStatus();
      const merged = this.themeFromFirmwareStatus({ ...a.themeJson } as Theme, st);
      this.form.patchValue(
        {
          led: merged.led,
          dcnp: merged.dcnp,
        } as any,
        { emitEvent: false }
      );
      this.form.markAsPristine();
      this.formPatched = true;
      this.dataService.updateAlbumThemeQuiet(a.albumId, merged);

      if (showBanner) {
        this.deviceLedSyncStatus.set('ok');
        this.deviceLedSyncMessage.set('LED settings synced from device.');
      }
    } catch {
      if (showBanner) {
        this.deviceLedSyncStatus.set('error');
        this.deviceLedSyncMessage.set('Could not read theme from device.');
      }
    }

    if (showBanner) {
      setTimeout(() => {
        if (this.deviceLedSyncStatus() !== 'syncing') {
          this.deviceLedSyncStatus.set('idle');
          this.deviceLedSyncMessage.set('');
        }
      }, 3500);
    }
  }

  setPreviewMode(mode: 'idle' | 'playback' | 'charging') {
    this.previewMode.set(mode);
  }

  downloadTemplate() {
    const skinType = this.form.value.skinType;
    const templateName = skinType === 'full' 
      ? 'DPA_Pro_Landscape_FULL_WRAP_Spec_85x54mm.psd'
      : 'DPA_Pro_Landscape_PARTIAL_WRAP_Spec_85x54mm.psd';
    alert(`Downloading ${templateName} ...`);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.form.patchValue({ skinImage: e.target?.result as string });
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  removeSkin() {
    this.form.patchValue({ skinImage: '' });
  }

  async previewNotification(type: DcnpEventType) {
    if (this.notificationPreviewActive()) return;
    this.notificationPreviewActive.set(type);

    const dcnpValues = this.form.value.dcnp as Record<string, string>;
    const color = dcnpValues?.[type] || '#ffffff';

    await this.ledNotification.playNotification(
      type,
      color,
      (cssClass, c, customDuration) => {
        this.glowOverride.set({ cssClass, color: c, customDuration });
      },
      () => {
        this.glowOverride.set(null);
        this.notificationPreviewActive.set(null);
      }
    );
  }

  async save() {
    const a = this.album();
    if (a && this.form.valid) {
      const theme = this.form.value as Theme;
      this.dataService.updateAlbumTheme(a.albumId, theme);
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.pushStatus.set('pushing');
        const ok = await this.connectionService.wifi.pushTheme(theme);
        this.pushStatus.set(ok ? 'ok' : 'error');
      } else {
        this.pushStatus.set('idle');
      }
    }
  }

  async pushThemeToDevice() {
    const a = this.album();
    if (!a || !this.form.valid) return;
    if (this.connectionService.connectionStatus() !== 'wifi') {
      this.pushStatus.set('error');
      return;
    }

    const theme = this.form.value as Theme;
    this.pushStatus.set('pushing');
    const ok = await this.connectionService.wifi.pushTheme(theme);
    this.pushStatus.set(ok ? 'ok' : 'error');
  }
}
