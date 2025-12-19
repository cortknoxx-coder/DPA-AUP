
import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Theme } from '../../types';
import { DeviceConnectionService } from '../../services/device-connection.service';

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

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Visualizer State
  previewMode = signal<'idle' | 'playback' | 'charging'>('idle');

  form = this.fb.group({
    albumColor: this.fb.group({
      primary: [''],
      accent: [''],
      background: ['']
    }),
    skinImage: [''], // Holds the base64 string for the skin
    led: this.fb.group({
      idle: this.fb.group({ color: [''], pattern: [''] }),
      playback: this.fb.group({ color: [''], pattern: [''] }),
      charging: this.fb.group({ color: [''], pattern: [''] })
    }),
    dcnp: this.fb.group({
      concert: [''],
      video: [''],
      merch: [''],
      signing: ['']
    })
  });

  constructor() {
    effect(() => {
      const a = this.album();
      if (a && a.themeJson) {
        this.form.patchValue(a.themeJson as any, { emitEvent: false });
      }
    });
  }

  setPreviewMode(mode: 'idle' | 'playback' | 'charging') {
    this.previewMode.set(mode);
  }

  downloadTemplate() {
    // In a real app, this would trigger a download of the .PSD or .AI file
    // We'll use a simple alert to simulate the action for the demo
    alert('Downloading DPA_Pro_Landscape_Spec_85x54mm.psd ...');
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

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const theme = this.form.value as Theme;
      this.dataService.updateAlbumTheme(a.albumId, theme);
    }
  }
}
