
import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Theme, DcnpEventType } from '../../types';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { LedNotificationService } from '../../services/led-notification.service';

@Component({
  selector: 'app-theme-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './theme-editor.component.html'
})
export class ThemeEditorComponent {
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

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const theme = this.form.value as Theme;
      this.dataService.updateAlbumTheme(a.albumId, theme);
    }
  }
}
