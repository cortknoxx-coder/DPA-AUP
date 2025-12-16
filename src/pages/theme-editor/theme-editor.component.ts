import { Component, inject, computed, effect } from '@angular/core';
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

  constructor() {
    effect(() => {
      const a = this.album();
      if (a && a.themeJson) {
        this.form.patchValue(a.themeJson as any, { emitEvent: false });
      }
    });
  }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const theme = this.form.value as Theme;
      this.dataService.updateAlbumTheme(a.albumId, theme);
    }
  }
}
