import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { Theme } from '../../types';

@Component({
  selector: 'app-theme-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './theme-editor.component.html'
})
export class ThemeEditorComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

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

  // Computed state for the visualizer
  currentPreviewStyle = computed(() => {
    // Need to subscribe to form changes for real-time updates.
    // In Angular ReactiveForms, values aren't signals, so we rely on the component change detection
    // or manual signal updates. For simplicity here, we'll let Angular change detection handle the binding
    // in the template by accessing the form value directly in the HTML or via a getter.
    // However, to use signals effectively:
    
    const mode = this.previewMode();
    const ledGroup = this.form.get('led')?.get(mode);
    
    // Fallbacks
    return {
      color: ledGroup?.value?.color || '#333',
      pattern: ledGroup?.value?.pattern || 'solid'
    };
  });

  // Track real-time form values for the template binding without explicit subscription overhead
  // The template will access `form.value` directly.

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

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const theme = this.form.value as Theme;
      this.dataService.updateAlbumTheme(a.albumId, theme);
    }
  }
}