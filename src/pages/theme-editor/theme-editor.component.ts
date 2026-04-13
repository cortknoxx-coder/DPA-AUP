
import { Component, inject, computed, effect, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Theme, DcnpEventType, FirmwareStatus } from '../../types';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { LedNotificationService } from '../../services/led-notification.service';
import { BrandMarkComponent } from '../../components/brand-mark/brand-mark.component';

@Component({
  selector: 'app-theme-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BrandMarkComponent],
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

  /** Which perk color to show on the device mock (creator = perks only; strip modes belong in fan portal). */
  perkPreviewCategory = signal<DcnpEventType | null>(null);
  notificationPreviewActive = signal<DcnpEventType | null>(null);
  glowOverride = signal<{ cssClass: string; color: string; customDuration?: string } | null>(null);
  pushStatus = signal<'idle' | 'pushing' | 'ok' | 'error'>('idle');
  isPushingTheme = computed(() => this.pushStatus() === 'pushing');

  deviceLedSyncStatus = signal<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  deviceLedSyncMessage = signal('');
  private dcnpSyncPollTimer: ReturnType<typeof setInterval> | null = null;
  private dcnpDevicePullKey = '';

  readonly dcnpTypes: DcnpEventType[] = ['concert', 'video', 'merch', 'signing', 'remix', 'other'];

  form = this.fb.group({
    albumColor: this.fb.group({
      primary: [''],
      accent: [''],
      background: ['']
    }),
    skinImage: [''], // Holds the base64 string for the skin
    skinType: ['partial'],
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
        };
        this.form.patchValue(themeData as any, { emitEvent: false });
      }
    });

    effect(() => {
      const conn = this.connectionService.deviceHttpAvailable();
      const a = this.album();
      if (!conn) {
        this.dcnpDevicePullKey = '';
        this.stopDcnpDevicePolling();
        return;
      }
      if (!a) return;
      if (this.dcnpDevicePullKey === a.albumId) {
        this.startDcnpDevicePolling(a.albumId);
        return;
      }
      this.dcnpDevicePullKey = a.albumId;
      queueMicrotask(() => {
        if (this.connectionService.deviceHttpAvailable() && this.album()?.albumId === a.albumId) {
          void this.pullDcnpFromDevice(false);
        }
      });
      this.startDcnpDevicePolling(a.albumId);
    });
  }

  ngOnDestroy() {
    this.stopDcnpDevicePolling();
  }

  private startDcnpDevicePolling(albumId: string) {
    this.stopDcnpDevicePolling();
    this.dcnpSyncPollTimer = setInterval(() => {
      if (!this.connectionService.deviceHttpAvailable() || this.album()?.albumId !== albumId) {
        this.stopDcnpDevicePolling();
        return;
      }
      if (this.form.dirty) return;
      void this.pullDcnpFromDevice(false);
    }, 5000);
  }

  private stopDcnpDevicePolling() {
    if (this.dcnpSyncPollTimer) {
      clearInterval(this.dcnpSyncPollTimer);
      this.dcnpSyncPollTimer = null;
    }
  }

  private dcnpFromFirmwareStatus(base: Theme, st: FirmwareStatus): Theme['dcnp'] {
    const D = st.dcnp;
    return {
      concert: D?.concert ?? base.dcnp.concert,
      video: D?.video ?? base.dcnp.video,
      merch: D?.merch ?? base.dcnp.merch,
      signing: D?.signing ?? base.dcnp.signing,
      remix: D?.remix ?? base.dcnp.remix,
      other: D?.other ?? base.dcnp.other,
    };
  }

  /**
   * Pull DCNP (perk notification) colors from device — does not overwrite fan-owned strip settings.
   */
  async pullDcnpFromDevice(showBanner: boolean) {
    const a = this.album();
    if (!a || !this.connectionService.deviceHttpAvailable()) return;

    if (showBanner) {
      this.deviceLedSyncStatus.set('syncing');
      this.deviceLedSyncMessage.set('Reading perk colors from device…');
    }

    try {
      const st = await this.connectionService.wifi.getStatus();
      const dcnp = this.dcnpFromFirmwareStatus({ ...a.themeJson } as Theme, st);
      const merged: Theme = { ...(a.themeJson as Theme), dcnp };
      this.form.patchValue({ dcnp } as any, { emitEvent: false });
      this.form.markAsPristine();
      this.formPatched = true;
      this.dataService.updateAlbumThemeQuiet(a.albumId, merged);

      if (showBanner) {
        this.deviceLedSyncStatus.set('ok');
        this.deviceLedSyncMessage.set('Perk colors synced from device.');
      }
    } catch {
      if (showBanner) {
        this.deviceLedSyncStatus.set('error');
        this.deviceLedSyncMessage.set('Could not read perk colors from device.');
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

  setPerkPreviewCategory(cat: DcnpEventType | null) {
    this.perkPreviewCategory.set(cat);
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
      const theme: Theme = {
        ...(a.themeJson as Theme),
        ...(this.form.getRawValue() as Partial<Theme>),
      };
      this.dataService.updateAlbumTheme(a.albumId, theme);
      if (this.connectionService.deviceHttpAvailable()) {
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
    if (!this.connectionService.deviceHttpAvailable()) {
      this.pushStatus.set('error');
      return;
    }

    const theme: Theme = {
      ...(a.themeJson as Theme),
      ...(this.form.getRawValue() as Partial<Theme>),
    };
    this.pushStatus.set('pushing');
    const ok = await this.connectionService.wifi.pushTheme(
      theme,
      theme.ledBrightness,
      theme.ledGradEnd
    );
    this.pushStatus.set(ok ? 'ok' : 'error');
  }
}
