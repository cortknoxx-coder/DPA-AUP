
import { Component, inject, computed, effect, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { Theme, DcnpEventType, FirmwareStatus } from '../../types';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { LedNotificationService } from '../../services/led-notification.service';
import { FIRMWARE_LED_PATTERN_GROUPS, LedPatternGroup } from '../../constants/led-patterns';

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
  private ledLivePreviewSub: Subscription | null = null;
  private isHydratingLedFromDevice = false;

  readonly dcnpTypes: DcnpEventType[] = ['concert', 'video', 'merch', 'signing', 'remix', 'other'];
  readonly ledPatternGroups: LedPatternGroup[] = FIRMWARE_LED_PATTERN_GROUPS;

  form = this.fb.group({
    albumColor: this.fb.group({
      primary: [''],
      accent: [''],
      background: ['']
    }),
    skinImage: [''], // Holds the base64 string for the skin
    skinType: ['partial'],
    ledBrightness: [80],
    ledGradEnd: ['#ff6600'],
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
        const tj = a.themeJson;
        const themeData = {
          ...tj,
          skinType: tj.skinType || 'partial',
          ledBrightness: tj.ledBrightness ?? 80,
          ledGradEnd: tj.ledGradEnd ?? '#ff6600',
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

    effect(() => {
      const wifi = this.connectionService.connectionStatus() === 'wifi';
      this.ledLivePreviewSub?.unsubscribe();
      this.ledLivePreviewSub = null;
      if (!wifi) return;

      this.ledLivePreviewSub = this.form.valueChanges
        .pipe(debounceTime(220))
        .subscribe(() => {
          if (this.isHydratingLedFromDevice) return;
          void this.sendLiveLedPreviewToDevice();
        });

      return () => {
        this.ledLivePreviewSub?.unsubscribe();
        this.ledLivePreviewSub = null;
      };
    });
  }

  ngOnDestroy() {
    this.stopLedDevicePolling();
    this.ledLivePreviewSub?.unsubscribe();
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
    const bright =
      typeof L?.brightness === 'number'
        ? Math.max(0, Math.min(100, Math.round(L.brightness)))
        : (base.ledBrightness ?? 80);
    const gradEnd = L?.gradEnd?.length ? L.gradEnd : (base.ledGradEnd ?? '#ff6600');
    return {
      ...base,
      ledBrightness: bright,
      ledGradEnd: gradEnd,
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

  /** Send current preview mode strip settings to firmware `/api/led/preview` (matches device dashboard). */
  private async sendLiveLedPreviewToDevice() {
    if (this.connectionService.connectionStatus() !== 'wifi') return;

    const v = this.form.getRawValue() as any;
    const mode = this.previewMode();
    const row = v.led?.[mode];
    let b = typeof v.ledBrightness === 'number' ? v.ledBrightness : Number(v.ledBrightness);
    if (Number.isNaN(b)) b = 80;
    await this.connectionService.wifi.previewLed(mode, {
      color: row?.color,
      pattern: row?.pattern,
      brightness: b,
      gradEnd: v.ledGradEnd,
    });
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
      this.isHydratingLedFromDevice = true;
      try {
        this.form.patchValue(
          {
            ledBrightness: merged.ledBrightness,
            ledGradEnd: merged.ledGradEnd,
            led: merged.led,
            dcnp: merged.dcnp,
          } as any,
          { emitEvent: false }
        );
      } finally {
        this.isHydratingLedFromDevice = false;
      }
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
    if (this.connectionService.connectionStatus() === 'wifi' && !this.isHydratingLedFromDevice) {
      void this.sendLiveLedPreviewToDevice();
    }
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
        const ok = await this.connectionService.wifi.pushTheme(
          theme,
          theme.ledBrightness,
          theme.ledGradEnd
        );
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
    const ok = await this.connectionService.wifi.pushTheme(
      theme,
      theme.ledBrightness,
      theme.ledGradEnd
    );
    this.pushStatus.set(ok ? 'ok' : 'error');
  }
}
