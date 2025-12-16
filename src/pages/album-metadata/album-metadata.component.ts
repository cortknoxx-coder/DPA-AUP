
import { Component, inject, computed, effect } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators, FormArray } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { BookletVideo } from '../../types';

@Component({
  selector: 'app-album-metadata',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe],
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
    lyrics: [''],
    
    // Pricing
    retailPrice: [39, [Validators.required, Validators.min(39)]],
    manufacturingCost: [14.50], // Read-only mostly

    // Booklet
    bookletCredits: [''],
    bookletVideos: this.fb.array([]),
    bookletGallery: this.fb.array([])
  });

  // Derived state for profit calculation
  profitPerUnit = computed(() => {
    const retail = this.form.value.retailPrice || 0;
    const cost = this.form.value.manufacturingCost || 0;
    return Math.max(0, retail - cost);
  });

  royaltyPerResale = computed(() => {
    const retail = this.form.value.retailPrice || 0;
    // Estimated resale at retail price * 10%
    return retail * 0.10;
  });

  get bookletVideos() {
    return this.form.get('bookletVideos') as FormArray;
  }
  
  get bookletGallery() {
    return this.form.get('bookletGallery') as FormArray;
  }

  constructor() {
    effect(() => {
      const a = this.album();
      if (a) {
        // Clear Form Arrays
        this.bookletVideos.clear();
        this.bookletGallery.clear();

        // Populate Videos
        a.booklet?.videos?.forEach(v => {
          this.bookletVideos.push(this.fb.group({
            id: [v.id],
            title: [v.title],
            url: [v.url],
            poster: [v.poster]
          }));
        });

        // Populate Gallery
        a.booklet?.gallery?.forEach(img => {
          this.bookletGallery.push(this.fb.control(img));
        });

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
          lyrics: a.lyrics || '',
          retailPrice: a.pricing?.retailPrice || 39,
          manufacturingCost: 14.50, // Mock baseline cost
          bookletCredits: a.booklet?.credits || ''
        }, { emitEvent: false });
      }
    });
  }

  addVideo() {
    this.bookletVideos.push(this.fb.group({
      id: [Math.random().toString(36).substr(2, 9)],
      title: ['New Video'],
      url: [''],
      poster: ['']
    }));
  }

  removeVideo(index: number) {
    this.bookletVideos.removeAt(index);
  }

  onGalleryFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        this.bookletGallery.push(this.fb.control(result));
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  removeGalleryImage(index: number) {
    this.bookletGallery.removeAt(index);
  }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const val = this.form.value;
      
      const videos: BookletVideo[] = (val.bookletVideos as any[]).map(v => ({
        id: v.id,
        title: v.title,
        url: v.url,
        poster: v.poster || 'https://picsum.photos/seed/poster/800/450' // default poster
      }));

      const gallery: string[] = (val.bookletGallery as string[]);

      const metadata: Partial<any> = {
        title: val.title,
        artistName: val.artistName,
        recordLabel: val.recordLabel,
        genre: val.genre,
        releaseDate: val.releaseDate,
        copyright: val.copyright,
        upcCode: val.upcCode,
        parentalAdvisory: val.parentalAdvisory,
        description: val.description,
        lyrics: val.lyrics,
        pricing: {
          retailPrice: val.retailPrice,
          manufacturingCost: val.manufacturingCost,
          currency: 'USD'
        },
        booklet: {
          credits: val.bookletCredits,
          gallery: gallery,
          videos: videos
        }
      };
      
      this.dataService.updateAlbumMetadata(a.albumId, metadata);
    }
  }
}
