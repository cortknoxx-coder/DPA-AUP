
import { Component, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-album-metadata',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './album-metadata.component.html'
})
export class AlbumMetadataComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb = inject(FormBuilder);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  form = this.fb.group({
    title: ['', Validators.required],
    artistName: ['', Validators.required],
    recordLabel: [''],
    genre: [''],
    releaseDate: [''],
    copyright: [''],
    upcCode: [''],
    parentalAdvisory: [false],
    description: [''],
    lyrics: ['']
  });

  constructor() {
    effect(() => {
      const a = this.album();
      if (a) {
        this.form.patchValue({
          title: a.title,
          artistName: a.artistName || '',
          recordLabel: a.recordLabel || '',
          genre: a.genre || '',
          releaseDate: a.releaseDate || '',
          copyright: a.copyright || '',
          upcCode: a.upcCode || '',
          parentalAdvisory: a.parentalAdvisory || false,
          description: a.description || '',
          lyrics: a.lyrics || ''
        }, { emitEvent: false });
      }
    });
  }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      this.dataService.updateAlbumMetadata(a.albumId, this.form.value as any);
      // Optional: Add a toast notification here
    }
  }
}
