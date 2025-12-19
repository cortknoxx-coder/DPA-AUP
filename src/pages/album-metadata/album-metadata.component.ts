
import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, PercentPipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators, FormArray } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { UserService } from '../../services/user.service';
import { BookletVideo } from '../../types';

export type PricingTier = 'entry' | 'premium' | 'collector';

// #############################################################################
// ## METADATA COMPONENT (CORE DETAILS)
// #############################################################################

@Component({
  selector: 'app-album-metadata',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="max-w-4xl space-y-12 pb-20">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-12">
        <!-- Core Identity -->
        <div class="space-y-6">
          <div class="border-b border-slate-800 pb-2">
            <h2 class="text-sm font-semibold text-slate-100 uppercase tracking-wider">Core Identity</h2>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Album Title <span class="text-rose-500">*</span></label>
            <input type="text" formControlName="title" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Main Artist Name <span class="text-rose-500">*</span></label>
            <input type="text" formControlName="artistName" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none">
            <p class="text-[10px] text-slate-500 mt-1">As it should appear on streaming platforms and the device display.</p>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Release Type</label>
              <select formControlName="releaseType" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none">
                <option value="album">Album (LP)</option>
                <option value="ep">EP / Mini-Album</option>
                <option value="single">Single</option>
                <option value="compilation">Compilation</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Genre</label>
              <input type="text" formControlName="genre" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none" placeholder="e.g. Pop">
            </div>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Release Date</label>
            <input type="date" formControlName="releaseDate" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none [color-scheme:dark]">
          </div>
        </div>

        <!-- Distribution Rights -->
        <div class="space-y-6">
          <div class="border-b border-slate-800 pb-2">
            <h2 class="text-sm font-semibold text-slate-100 uppercase tracking-wider">Distribution Details</h2>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Record Label</label>
            <input type="text" formControlName="recordLabel" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none" placeholder="e.g. Independent">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">C Line (Copyright)</label>
            <input type="text" formControlName="copyright" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none" placeholder="© 2025 Artist Name">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">UPC / EAN Code</label>
            <input type="text" formControlName="upcCode" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none font-mono">
          </div>
          <div class="flex items-center gap-3 pt-2">
            <input type="checkbox" id="parental" formControlName="parentalAdvisory" class="h-4 w-4 rounded border-slate-800 bg-slate-950 text-teal-600 focus:ring-teal-600 focus:ring-offset-slate-950">
            <label for="parental" class="text-sm text-slate-300 select-none cursor-pointer">Explicit Content (Parental Advisory)</label>
          </div>
        </div>
      </div>
       <div class="flex justify-end pt-8 border-t border-slate-800/50">
        <button type="submit" [disabled]="!form.valid || !form.dirty" class="rounded bg-teal-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 shadow-lg shadow-teal-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          Save Metadata
        </button>
      </div>
    </form>
  `
})
export class AlbumMetadataComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb: FormBuilder = inject(FormBuilder);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  form = this.fb.group({
    title: ['', Validators.required],
    artistName: ['', Validators.required],
    releaseType: ['album'],
    recordLabel: [''],
    genre: [''],
    releaseDate: [''],
    copyright: [''],
    upcCode: [''],
    parentalAdvisory: [false],
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
          releaseType: (a as any).releaseType || 'album'
        });
      }
    });
  }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      this.dataService.updateAlbumMetadata(a.albumId, this.form.value);
      alert('Metadata saved!');
      this.form.markAsPristine();
    }
  }
}

// #############################################################################
// ## BOOKLET COMPONENT
// #############################################################################

@Component({
  selector: 'app-album-booklet',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
   <form [formGroup]="form" (ngSubmit)="save()" class="pb-20">
      <div class="space-y-8">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-slate-100 uppercase tracking-wider">Digital Booklet Configuration</h2>
            <p class="text-xs text-slate-500 mt-1">Configure the rich media experience available in the Fan Portal.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <!-- Left Column: Editors -->
          <div class="space-y-8">
            <div class="space-y-6">
              <div>
                <label class="block text-xs text-slate-400 mb-1">Album Description / Synopsis</label>
                <textarea formControlName="description" rows="4" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none resize-none"></textarea>
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">Lyrics & Liner Notes</label>
                <textarea formControlName="lyrics" rows="6" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 font-mono focus:border-teal-500 outline-none" placeholder="Markdown supported..."></textarea>
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1">Album Credits</label>
                <textarea formControlName="bookletCredits" rows="4" class="w-full rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 outline-none font-mono placeholder:text-slate-600" placeholder="Produced by... Mixed by..."></textarea>
              </div>
            </div>

            <!-- Gallery Images -->
            <div class="space-y-3">
              <div class="flex justify-between items-center">
                <label class="block text-xs text-slate-400">Booklet Gallery Images</label>
                <button type="button" (click)="galleryInput.click()" class="text-xs text-teal-400 hover:text-teal-300">+ Upload Image</button>
                <input #galleryInput type="file" (change)="onGalleryFileSelected($event)" class="hidden" accept="image/*">
              </div>
              <div class="flex gap-4 overflow-x-auto pb-2 min-h-[100px] border border-dashed border-slate-800 rounded-lg p-4 bg-slate-900/30 items-center">
                @for (img of bookletGallery.controls; track $index) {
                  <div class="relative group flex-shrink-0">
                    <img [src]="img.value" class="h-20 w-32 object-cover rounded border border-slate-700">
                    <button type="button" (click)="removeGalleryImage($index)" class="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                  </div>
                } @empty {
                  <div class="w-full text-center text-xs text-slate-500">No images uploaded. Add BTS photos for the booklet.</div>
                }
              </div>
            </div>

            <!-- Videos -->
            <div class="space-y-3" formArrayName="bookletVideos">
              <div class="flex justify-between items-center">
                <label class="block text-xs text-slate-400">Attached Videos (On-Device or Stream)</label>
                <button type="button" (click)="addVideo()" class="text-xs text-teal-400 hover:text-teal-300">+ Add Video URL</button>
              </div>
              <div class="space-y-3">
                @for (video of bookletVideos.controls; track $index) {
                  <div [formGroupName]="$index" class="flex gap-3 items-center bg-slate-900/50 p-3 rounded border border-slate-800">
                      <div class="flex-1 space-y-2">
                        <input type="text" formControlName="title" placeholder="Video Title" class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200">
                        <input type="text" formControlName="url" placeholder="Video URL (mp4 or embed)" class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-400 font-mono">
                      </div>
                      <button type="button" (click)="removeVideo($index)" class="text-rose-500 hover:text-rose-300 p-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                  </div>
                } @empty {
                  <div class="text-xs text-slate-500 italic p-2">No videos linked.</div>
                }
              </div>
            </div>
          </div>

          <!-- Right Column: Live Mockup -->
          <div class="relative flex justify-center lg:block">
            <div class="sticky top-24">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest">Device Preview</h3>
                <span class="text-[10px] px-2 py-1 bg-teal-500/10 text-teal-400 rounded border border-teal-500/20 animate-pulse">Live Sync Active</span>
              </div>
              <div class="w-[320px] h-[640px] bg-slate-950 rounded-[3rem] border-8 border-slate-800 shadow-2xl relative overflow-hidden ring-1 ring-white/10 mx-auto">
                <div class="absolute inset-0 bg-black text-white flex flex-col overflow-hidden">
                  <div class="h-8 bg-black/80 flex items-center justify-between px-6 text-[10px] text-slate-400 font-medium shrink-0 z-20">
                    <span>9:41</span>
                    <div class="flex gap-1"><span class="w-3 h-3 bg-white/20 rounded-full"></span><span class="w-3 h-3 bg-white/20 rounded-full"></span></div>
                  </div>
                  <div class="flex-1 overflow-y-auto relative no-scrollbar bg-slate-900">
                    <div class="relative h-64 shrink-0">
                      <img [src]="previewCover()" class="w-full h-full object-cover">
                      <div class="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent"></div>
                      <div class="absolute bottom-0 left-0 right-0 p-6">
                        <div class="text-xs font-bold text-teal-400 uppercase tracking-wider mb-1">Digital Booklet</div>
                        <h2 class="text-2xl font-bold leading-tight text-white mb-1">{{ form.value.title || 'Album Title' }}</h2>
                        <p class="text-sm text-slate-300">{{ form.value.artistName || 'Artist Name' }}</p>
                      </div>
                    </div>
                    <div class="p-6 pt-0 space-y-6 min-h-[300px]">
                      @if (previewTab() === 'info') {
                        <div class="animate-fade-in-up">
                          <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">About The Album</h3>
                          <p class="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{{ form.value.description || 'Add a description to see it appear here...' }}</p>
                          <div class="mt-6 p-4 bg-slate-800/50 rounded-xl border border-white/5">
                            <h4 class="text-xs font-bold text-white mb-2">Release Details</h4>
                            <div class="space-y-2 text-xs text-slate-400">
                              <div class="flex justify-between"><span>Label</span><span class="text-slate-200">{{ form.value.recordLabel || '-' }}</span></div>
                              <div class="flex justify-between"><span>Date</span><span class="text-slate-200">{{ form.value.releaseDate || '-' }}</span></div>
                              <div class="flex justify-between"><span>UPC</span><span class="text-slate-200 font-mono">{{ form.value.upcCode || '-' }}</span></div>
                            </div>
                          </div>
                        </div>
                      }
                      @if (previewTab() === 'lyrics') {
                        <div class="animate-fade-in-up"><h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Lyrics & Notes</h3><div class="prose prose-invert prose-sm"><p class="text-sm text-slate-300 font-serif leading-relaxed whitespace-pre-wrap">{{ form.value.lyrics || 'Lyrics will appear here...' }}</p></div></div>
                      }
                      @if (previewTab() === 'credits') {
                        <div class="animate-fade-in-up"><h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Full Credits</h3><div class="text-xs text-slate-400 font-mono leading-relaxed whitespace-pre-wrap text-center">{{ form.value.bookletCredits || 'Credits will appear here...' }}</div></div>
                      }
                      @if (previewTab() === 'gallery') {
                        <div class="animate-fade-in-up grid grid-cols-2 gap-2">
                          @for (img of bookletGallery.controls; track $index) {
                            <img [src]="img.value" class="w-full aspect-square object-cover rounded bg-slate-800">
                          } @empty {
                            <div class="col-span-2 py-8 text-center text-xs text-slate-500 border border-dashed border-slate-700 rounded">No photos uploaded</div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                  <div class="h-16 bg-slate-900 border-t border-slate-800 shrink-0 grid grid-cols-4 items-center">
                    <button (click)="previewTab.set('info')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'info'" [class.bg-transparent]="previewTab() !== 'info'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'info'" [class.text-slate-500]="previewTab() !== 'info'">Info</span></button>
                    <button (click)="previewTab.set('lyrics')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'lyrics'" [class.bg-transparent]="previewTab() !== 'lyrics'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'lyrics'" [class.text-slate-500]="previewTab() !== 'lyrics'">Lyrics</span></button>
                    <button (click)="previewTab.set('gallery')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'gallery'" [class.bg-transparent]="previewTab() !== 'gallery'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'gallery'" [class.text-slate-500]="previewTab() !== 'gallery'">Photos</span></button>
                    <button (click)="previewTab.set('credits')" class="flex flex-col items-center gap-1 group"><div class="h-1 w-8 rounded-full transition-colors" [class.bg-teal-500]="previewTab() === 'credits'" [class.bg-transparent]="previewTab() !== 'credits'"></div><span class="text-[10px] font-bold uppercase transition-colors" [class.text-white]="previewTab() === 'credits'" [class.text-slate-500]="previewTab() !== 'credits'">Credits</span></button>
                  </div>
                  <div class="h-6 bg-slate-900 flex justify-center items-start"><div class="w-32 h-1 bg-white/20 rounded-full mt-2"></div></div>
                </div>
              </div>
              <p class="text-center text-xs text-slate-500 mt-4">Interactive Preview • Click tabs to navigate</p>
            </div>
          </div>
        </div>
      </div>
      <div class="flex justify-end pt-8 border-t border-slate-800/50">
        <button type="submit" [disabled]="!form.valid || !form.dirty" class="rounded bg-teal-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 shadow-lg shadow-teal-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          Save Booklet
        </button>
      </div>
    </form>
  `
})
export class AlbumBookletComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb: FormBuilder = inject(FormBuilder);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  form = this.fb.group({
    // Fields for preview
    title: [''],
    artistName: [''],
    recordLabel: [''],
    releaseDate: [''],
    upcCode: [''],

    // Fields to save
    description: [''],
    lyrics: [''],
    bookletCredits: [''],
    bookletVideos: this.fb.array([] as any[]),
    bookletGallery: this.fb.array([] as any[])
  });

  formValues = toSignal(this.form.valueChanges);
  previewTab = signal<'info' | 'lyrics' | 'credits' | 'gallery'>('info');

  previewCover = computed(() => {
    const vals = this.formValues();
    const gallery = vals?.bookletGallery as string[] | undefined;
    if (gallery && gallery.length > 0) return gallery[0];
    return 'https://picsum.photos/seed/placeholder/400/400';
  });

  get bookletVideos() { return this.form.get('bookletVideos') as FormArray; }
  get bookletGallery() { return this.form.get('bookletGallery') as FormArray; }

  constructor() {
    effect(() => {
      const a = this.album();
      if (a) {
        this.bookletVideos.clear();
        this.bookletGallery.clear();
        a.booklet?.videos?.forEach(v => this.bookletVideos.push(this.fb.group({ id: [v.id], title: [v.title], url: [v.url], poster: [v.poster] })));
        a.booklet?.gallery?.forEach(img => this.bookletGallery.push(this.fb.control(img)));

        this.form.patchValue({
          // Preview fields
          title: a.title,
          artistName: a.artistName || '',
          recordLabel: a.recordLabel || '',
          releaseDate: a.releaseDate || '',
          upcCode: a.upcCode || '',
          // Editable fields
          description: a.description || '',
          lyrics: a.lyrics || '',
          bookletCredits: a.booklet?.credits || ''
        });
      }
    });
  }

  addVideo() { this.bookletVideos.push(this.fb.group({ id: [Math.random().toString(36).substr(2, 9)], title: ['New Video'], url: [''], poster: [''] })); }
  removeVideo(index: number) { this.bookletVideos.removeAt(index); }

  onGalleryFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => this.bookletGallery.push(this.fb.control(e.target?.result as string));
      reader.readAsDataURL(input.files[0]);
    }
  }
  removeGalleryImage(index: number) { this.bookletGallery.removeAt(index); }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const val = this.form.value;
      const videos: BookletVideo[] = (val.bookletVideos as any[]).map(v => ({ id: v.id, title: v.title, url: v.url, poster: v.poster || 'https://picsum.photos/seed/poster/800/450' }));
      const gallery: string[] = (val.bookletGallery as string[]);
      const metadata = {
        description: val.description,
        lyrics: val.lyrics,
        booklet: { credits: val.bookletCredits, gallery: gallery, videos: videos }
      };
      this.dataService.updateAlbumMetadata(a.albumId, metadata);
      alert('Booklet saved!');
      this.form.markAsPristine();
    }
  }
}

// #############################################################################
// ## PRICING COMPONENT
// #############################################################################

@Component({
  selector: 'app-album-pricing',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CurrencyPipe, PercentPipe, DecimalPipe],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" class="pb-20">
       <div class="space-y-8">
        <div>
          <h2 class="text-xl font-bold text-slate-50 uppercase tracking-tight">Pricing Strategy & Unit Economics</h2>
          <p class="text-sm text-slate-400 mt-1">Configure your retail model, analyze margins, and schedule manufacturing.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div (click)="selectTier('entry')" class="relative cursor-pointer rounded-xl border p-6 transition-all hover:scale-[1.02]" [class.bg-slate-900]="selectedTier() !== 'entry'" [class.border-slate-800]="selectedTier() !== 'entry'" [class.bg-slate-800]="selectedTier() === 'entry'" [class.border-slate-600]="selectedTier() === 'entry'" [class.ring-1]="selectedTier() === 'entry'" [class.ring-slate-500]="selectedTier() === 'entry'"><div class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{{ TIER_CONFIG['entry'].label }}</div><div class="text-2xl font-bold text-slate-100">{{ TIER_CONFIG['entry'].min | currency }} - {{ TIER_CONFIG['entry'].max | currency }}</div><p class="text-xs text-slate-500 mt-2">{{ TIER_CONFIG['entry'].desc }}</p></div>
          <div (click)="selectTier('premium')" class="relative cursor-pointer rounded-xl border p-6 transition-all transform hover:scale-[1.02]" [class.bg-slate-900]="selectedTier() !== 'premium'" [class.border-slate-800]="selectedTier() !== 'premium'" [class.bg-teal-900/10]="selectedTier() === 'premium'" [class.border-teal-500]="selectedTier() === 'premium'" [class.shadow-lg]="selectedTier() === 'premium'" [class.shadow-teal-900/20]="selectedTier() === 'premium'"><div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-600 text-white text-[10px] font-bold uppercase px-3 py-1 rounded-full shadow-md">Recommended</div><div class="text-xs font-bold text-teal-400 uppercase tracking-widest mb-2">{{ TIER_CONFIG['premium'].label }}</div><div class="text-2xl font-bold text-white">{{ TIER_CONFIG['premium'].min | currency }} - {{ TIER_CONFIG['premium'].max | currency }}</div><p class="text-xs text-slate-400 mt-2">{{ TIER_CONFIG['premium'].desc }}</p></div>
          <div (click)="selectTier('collector')" class="relative cursor-pointer rounded-xl border p-6 transition-all hover:scale-[1.02]" [class.bg-slate-900]="selectedTier() !== 'collector'" [class.border-slate-800]="selectedTier() !== 'collector'" [class.bg-indigo-900/10]="selectedTier() === 'collector'" [class.border-indigo-500]="selectedTier() === 'collector'" [class.ring-1]="selectedTier() === 'collector'" [class.ring-indigo-500]="selectedTier() === 'collector'"><div class="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2">{{ TIER_CONFIG['collector'].label }}</div><div class="text-2xl font-bold text-slate-100">{{ TIER_CONFIG['collector'].min | currency }} - {{ TIER_CONFIG['collector'].max | currency }}</div><p class="text-xs text-slate-500 mt-2">{{ TIER_CONFIG['collector'].desc }}</p></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 bg-slate-900/30 rounded-2xl border border-slate-800 p-8">
          <div class="space-y-10">
            <div>
              <div class="flex justify-between items-end mb-4">
                <div><label class="block text-sm font-semibold text-slate-200">Retail Price Strategy</label><p class="text-[10px] text-slate-500 mt-0.5">Drag to see how price impacts your earnings.</p></div>
                <div class="text-right"><div class="text-xs text-slate-400 mb-1">Your Take / Unit</div><div class="text-xl font-bold" [class.text-teal-400]="artistProfitPerUnit() > 0" [class.text-rose-500]="artistProfitPerUnit() <= 0">{{ artistProfitPerUnit() | currency }}</div></div>
              </div>
              <div class="flex items-center gap-4 mb-3"><div class="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 flex justify-between items-center"><span class="text-xs text-slate-500 uppercase font-bold tracking-wider">Retail Price (Fan Cost)</span><div class="flex items-center gap-1"><span class="text-slate-500 text-sm">$</span><input type="number" [value]="retailPriceVal()" (input)="updatePriceFromInput($event)" (keydown)="preventArrowKeyInput($event)" [min]="priceSliderMin" [max]="priceSliderMax" class="bg-transparent text-white font-bold w-16 text-right outline-none text-lg"></div></div></div>
              <div class="relative w-full pt-8">
                <div class="absolute top-0 h-6 px-2 flex items-center justify-center bg-teal-500 text-white text-xs font-bold rounded-full shadow-lg pointer-events-none" [style.left.%]="priceSliderPositionPercent()" style="transform: translateX(-50%); z-index: 10;">{{ retailPriceVal() | currency:'USD':'symbol':'1.0-0' }}</div>
                <input type="range" formControlName="retailPrice" [min]="priceSliderMin" [max]="priceSliderMax" step="1" class="w-full accent-teal-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer">
              </div>
              <div class="flex justify-between text-[10px] text-slate-500 mt-2 font-mono"><span>{{ TIER_CONFIG['entry'].min | currency }}</span><span>{{ TIER_CONFIG['collector'].max | currency }}</span></div>
            </div>
            <div>
              <div class="flex justify-between items-center mb-4"><label class="text-sm font-semibold text-slate-200">Production Volume</label><div class="text-sm font-mono text-teal-400">{{ productionVolume() | number }} units</div></div>
              <input type="range" [value]="productionVolume()" (input)="updateVolume($event)" min="50" max="100000" step="50" class="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer">
              <div class="flex justify-between text-[10px] text-slate-500 mt-2"><span>50 (Micro Run)</span><span>100k (High Scale)</span></div>
              <p class="text-[10px] text-slate-500 mt-3 flex items-center gap-2"><span class="bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 font-bold">ECONOMIES OF SCALE</span>Wholesale price improves with volume.</p>
            </div>
            <div class="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-900/20 to-slate-900 p-6 flex flex-col gap-4">
              <div class="flex items-center justify-between border-b border-white/5 pb-4">
                <div><h3 class="text-xs font-bold text-indigo-400 uppercase tracking-wider">Manufacturing Order</h3><div class="text-[10px] text-slate-500 mt-1">Total Manufacturing Cost: <span class="text-slate-300">{{ totalManufacturingCost() | currency }}</span></div></div>
                <div class="text-right"><div class="text-xs text-slate-400">Total Units</div><div class="text-lg font-bold text-white">{{ productionVolume() | number }}</div></div>
              </div>
              <div class="py-2">
                <div class="text-xs text-slate-400 uppercase tracking-wider mb-1">What You'll Earn</div><div class="text-3xl font-black" [class.text-emerald-400]="totalProjectedProfit() > 0" [class.text-rose-500]="totalProjectedProfit() <= 0">{{ totalProjectedProfit() | currency }}</div><p class="text-[10px] text-slate-500 mt-1">Total projected profit after platform & hardware costs.</p>
              </div>
              <button type="button" (click)="checkout()" class="w-full rounded bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-900/40 hover:bg-indigo-500 transition-all flex items-center justify-center gap-2 mt-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                Schedule Production Run
              </button>
            </div>
          </div>
          <div class="bg-slate-950 rounded-xl border border-slate-800 p-6 flex flex-col h-full">
            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6 border-b border-slate-800 pb-2">Unit Economics Breakdown</h3>
            <div class="flex-1 flex flex-col justify-center space-y-6">
              <div class="relative">
                <div class="flex justify-between text-sm mb-1"><span class="font-bold text-white">@if (artistProfitPerUnit() >= 0) { Artist Net Profit } @else { Artist Net Loss }</span><span class="font-bold" [class.text-teal-400]="artistProfitPerUnit() >= 0" [class.text-rose-500]="artistProfitPerUnit() < 0">{{ artistProfitPerUnit() | currency }}</span></div>
                <div class="h-4 bg-slate-800 rounded-full overflow-hidden flex relative">
                  @if (artistProfitPerUnit() > 0) { <div class="bg-teal-500 h-full transition-all duration-300" [style.width.%]="(artistProfitPerUnit() / (retailPriceVal() || 1)) * 100"></div> } @else { <div class="bg-rose-500/20 h-full w-full flex items-center justify-center text-[10px] text-rose-400 font-bold tracking-widest">NEGATIVE MARGIN</div> }
                </div>
                <div class="text-[10px] mt-1 font-medium" [class.text-teal-500]="artistProfitPerUnit() >= 0" [class.text-rose-500]="artistProfitPerUnit() < 0">@if (artistProfitPerUnit() >= 0) { Artists keep {{ artistMarginPercent() | percent:'1.0-0' }} of retail } @else { Price is below cost basis. Increase retail price. }</div>
              </div>
              <div class="space-y-2 pt-4 border-t border-slate-800/50">
                <div class="flex items-center justify-between text-xs"><div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-indigo-500"></div><span class="text-slate-400">DPAC Platform Fee (15%)</span></div><span class="text-slate-200 font-mono">{{ platformFee() | currency }}</span></div>
                <div class="flex items-center justify-between text-xs"><div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-slate-600"></div><span class="text-slate-400">Hardware Wholesale Cost</span></div><span class="text-slate-200 font-mono">{{ wholesalePrice() | currency }}</span></div>
              </div>
              @if (connectionService.isSimulationMode()) {
                <div class="mt-8 p-3 bg-slate-900 rounded border border-slate-800 border-l-4 border-l-amber-500">
                  <div class="flex items-center gap-2 mb-2"><div class="text-[10px] font-bold text-amber-500 uppercase tracking-wider">DPAC™ Operator Metrics</div><span class="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[8px] font-bold text-amber-500 uppercase">Simulator Only</span></div>
                  <div class="grid grid-cols-2 gap-4">
                    <div><span class="block text-[10px] text-slate-500">Mfg Cost (COGS)</span><span class="block text-sm font-mono text-white">{{ manufacturingCost() | currency }}</span></div>
                    <div><span class="block text-[10px] text-slate-500">Hardware Margin</span><span class="block text-sm font-mono text-emerald-400">{{ dpacHardwareMargin() | currency }}</span></div>
                    <div class="col-span-2 border-t border-slate-800 pt-2 flex justify-between items-center"><span class="text-[10px] text-indigo-400 font-bold">TOTAL DPAC PROFIT / UNIT</span><span class="text-sm font-bold text-indigo-400">{{ dpacTotalProfitPerUnit() | currency }}</span></div>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      </div>
       <div class="flex justify-end pt-8 border-t border-slate-800/50">
        <button type="submit" [disabled]="!form.valid || !form.dirty" class="rounded bg-teal-600 px-8 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 shadow-lg shadow-teal-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          Save Pricing
        </button>
      </div>

      <!-- Checkout Modal -->
      @if (showCheckoutModal()) {
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div class="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-950 shadow-2xl animate-fade-in-up" style="animation-duration: 0.2s;">
            <div class="p-6 border-b border-slate-800"><h3 class="text-lg font-bold text-slate-100">Schedule Production Run</h3><p class="text-sm text-slate-400 mt-1">Pay the scheduling deposit to secure your manufacturing date.</p></div>
            <div class="p-6 space-y-6">
              
              <div class="rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-3">
                <div class="flex justify-between text-sm"><span class="text-slate-400">Production Volume</span><span class="text-white font-semibold">{{ productionVolume() | number }} units</span></div>
                <div class="flex justify-between text-sm"><span class="text-slate-400">Total Manufacturing Cost</span><span class="text-white font-semibold">{{ totalManufacturingCost() | currency }}</span></div>
              </div>

              <div class="space-y-2">
                <label class="block text-xs text-slate-400">Payment Options</label>
                <div class="grid grid-cols-2 gap-2">
                    <label (click)="paymentOption.set('deposit')" class="cursor-pointer rounded-lg border p-3 text-center transition-colors" [class.border-indigo-500]="paymentOption() === 'deposit'" [class.bg-indigo-900/20]="paymentOption() === 'deposit'" [class.border-slate-700]="paymentOption() !== 'deposit'">
                        <div class="font-semibold text-sm text-slate-100">Pay Deposit Only</div>
                        <div class="text-xs text-slate-400">{{ SCHEDULING_DEPOSIT | currency }}</div>
                    </label>
                    <label (click)="paymentOption.set('full')" class="cursor-pointer rounded-lg border p-3 text-center transition-colors" [class.border-indigo-500]="paymentOption() === 'full'" [class.bg-indigo-900/20]="paymentOption() === 'full'" [class.border-slate-700]="paymentOption() !== 'full'">
                        <div class="font-semibold text-sm text-slate-100">Pay Full Amount</div>
                        <div class="text-xs text-slate-400">{{ totalManufacturingCost() | currency }}</div>
                    </label>
                </div>
              </div>

              <div class="rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-3">
                @if (paymentOption() === 'deposit') {
                  <div class="flex justify-between text-sm"><span class="text-slate-400">Scheduling Deposit</span><span class="text-white font-semibold">{{ SCHEDULING_DEPOSIT | currency }}</span></div>
                  <div class="flex justify-between text-xs"><span class="text-slate-500">Remaining Balance (due before shipping)</span><span class="text-slate-500">{{ (totalManufacturingCost() - SCHEDULING_DEPOSIT) | currency }}</span></div>
                }
                <div class="border-t border-slate-700/50 pt-3 flex justify-between">
                  <span class="text-sm font-bold text-slate-300">Amount Due Today</span>
                  <span class="text-xl font-bold text-indigo-400">{{ amountDueToday() | currency }}</span>
                </div>
              </div>
              
              <div [formGroup]="checkoutForm" class="space-y-2">
                <label class="block text-xs text-slate-400">Payment Method</label>
                <div class="flex items-center gap-3">
                  <select formControlName="paymentMethodId" class="flex-1 w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 focus:border-indigo-500 outline-none">
                    @for (method of userService.paymentMethods(); track method.id) { <option [value]="method.id">{{ method.name }} (**** {{ method.last4 }})</option> } @empty { <option value="" disabled>No payment methods found</option> }
                  </select>
                  <button type="button" (click)="showAddMethodModal.set(true)" class="rounded bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 border border-slate-700">+ Add</button>
                </div>
              </div>
            </div>
            <div class="p-4 bg-slate-900/50 rounded-b-xl flex justify-end gap-3">
              <button (click)="showCheckoutModal.set(false)" class="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button (click)="confirmAndPay()" [disabled]="checkoutForm.invalid" class="rounded bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50 shadow-lg shadow-indigo-900/20">
                Pay {{ amountDueToday() | currency }} & Schedule
              </button>
            </div>
          </div>
        </div>
      }
      <!-- Add Method Modal -->
      @if (showAddMethodModal()) {
        <div class="fixed inset-0 z-[101] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-6 shadow-2xl animate-fade-in" [formGroup]="addMethodForm">
            <div class="flex items-center justify-between mb-6"><h3 class="text-lg font-bold text-slate-100">Add Payout Method</h3><button (click)="showAddMethodModal.set(false)" class="text-slate-500 hover:text-white">✕</button></div>
            <div class="space-y-4">
              <div class="flex gap-4 mb-2">
                <label class="flex items-center gap-2 cursor-pointer"><input type="radio" formControlName="type" value="bank" class="text-indigo-500 focus:ring-indigo-500 bg-slate-900 border-slate-700"><span class="text-sm text-slate-300">Bank Account</span></label>
                <label class="flex items-center gap-2 cursor-pointer"><input type="radio" formControlName="type" value="card" class="text-indigo-500 focus:ring-indigo-500 bg-slate-900 border-slate-700"><span class="text-sm text-slate-300">Debit Card</span></label>
              </div>
              <div><label class="block text-xs text-slate-400 mb-1">{{ addMethodForm.value.type === 'bank' ? 'Bank Name' : 'Card Brand' }}</label><input type="text" formControlName="name" class="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 focus:border-indigo-500 outline-none"></div>
              <div><label class="block text-xs text-slate-400 mb-1">{{ addMethodForm.value.type === 'bank' ? 'Account Number' : 'Card Number' }}</label><input type="text" formControlName="number" class="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 font-mono focus:border-indigo-500 outline-none"></div>
              @if (addMethodForm.value.type === 'bank') { <div><label class="block text-xs text-slate-400 mb-1">Routing Number</label><input type="text" formControlName="routing" class="w-full rounded bg-slate-900 border border-slate-800 px-3 py-2 text-slate-100 font-mono focus:border-indigo-500 outline-none"></div> }
            </div>
            <div class="mt-6 flex justify-end gap-3"><button (click)="showAddMethodModal.set(false)" class="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button><button (click)="submitAddMethod()" [disabled]="addMethodForm.invalid" class="rounded bg-indigo-600 px-6 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">Save Method</button></div>
          </div>
        </div>
      }
    </form>
  `
})
export class AlbumPricingComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private fb: FormBuilder = inject(FormBuilder);
  connectionService = inject(DeviceConnectionService);
  userService = inject(UserService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  showCheckoutModal = signal(false);
  showAddMethodModal = signal(false);
  readonly SCHEDULING_DEPOSIT = 500;
  paymentOption = signal<'deposit' | 'full'>('deposit');

  form = this.fb.group({
    retailPrice: [79, [Validators.required, Validators.min(39)]],
  });

  checkoutForm = this.fb.group({ paymentMethodId: ['', Validators.required] });
  addMethodForm = this.fb.group({ type: ['bank', Validators.required], name: ['', Validators.required], number: ['', [Validators.required, Validators.minLength(4)]], routing: [''] });

  readonly TIER_CONFIG = { entry: { min: 39, max: 49, label: 'Entry / EP', desc: 'Impulse-friendly / Fan onboarding' }, premium: { min: 59, max: 79, label: 'Album / Premium', desc: 'Best balance of artist profit & value' }, collector: { min: 99, max: 149, label: 'Collector / Limited', desc: 'High margin / limited volume' } };
  selectedTier = signal<PricingTier>('premium');
  
  productionVolume = signal<number>(50);
  
  wholesalePrice = computed(() => {
    const vol = this.productionVolume();
    if (vol > 50000) return 25.00;
    if (vol > 25000) return 26.00;
    if (vol > 10000) return 27.00;
    if (vol > 2500) return 28.00;
    return 29.00;
  });

  retailPriceVal = toSignal(this.form.get('retailPrice')!.valueChanges, { initialValue: 79 });
  readonly priceSliderMin = this.TIER_CONFIG['entry'].min;
  readonly priceSliderMax = this.TIER_CONFIG['collector'].max;

  priceSliderPositionPercent = computed(() => { const retailPrice = this.retailPriceVal() ?? this.priceSliderMin; const range = this.priceSliderMax - this.priceSliderMin; if (range === 0) return 0; const position = ((retailPrice - this.priceSliderMin) / range) * 100; return Math.max(0, Math.min(100, position)); });
  manufacturingCost = computed(() => { const vol = this.productionVolume(); if (vol >= 50000) return 14.00; if (vol >= 10000) return 18.00; return 22.00; });
  platformFee = computed(() => (this.retailPriceVal() || 0) * 0.15);
  artistCostsPerUnit = computed(() => this.wholesalePrice() + this.platformFee());
  artistProfitPerUnit = computed(() => (this.retailPriceVal() || 0) - this.artistCostsPerUnit());
  artistMarginPercent = computed(() => (this.artistProfitPerUnit() / (this.retailPriceVal() || 1)));
  dpacHardwareMargin = computed(() => this.wholesalePrice() - this.manufacturingCost());
  dpacTotalProfitPerUnit = computed(() => this.platformFee() + this.dpacHardwareMargin());
  totalManufacturingCost = computed(() => this.productionVolume() * this.wholesalePrice());
  totalProjectedProfit = computed(() => this.artistProfitPerUnit() * this.productionVolume());
  
  amountDueToday = computed(() => this.paymentOption() === 'deposit' ? this.SCHEDULING_DEPOSIT : this.totalManufacturingCost());

  constructor() {
    effect(() => { const a = this.album(); if (a) { this.form.patchValue({ retailPrice: a.pricing?.retailPrice || 79 }); } });
    this.form.get('retailPrice')?.valueChanges.subscribe(val => { if (val !== null && val !== undefined) { if (val <= 49) { this.selectedTier.set('entry'); } else if (val > 49 && val <= 79) { this.selectedTier.set('premium'); } else if (val > 79) { this.selectedTier.set('collector'); } } });
    effect(() => { const methods = this.userService.paymentMethods(); if (methods.length > 0) { const defaultMethod = methods.find(m => m.isDefault) || methods[0]; if (defaultMethod) { this.checkoutForm.patchValue({ paymentMethodId: defaultMethod.id }); } } });
  }

  preventArrowKeyInput(event: KeyboardEvent) { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault(); }
  updatePriceFromInput(event: Event) { const valueAsNumber = Number((event.target as HTMLInputElement).value); if (!isNaN(valueAsNumber)) this.form.get('retailPrice')?.setValue(valueAsNumber); }
  selectTier(tier: PricingTier) { this.selectedTier.set(tier); let optimalPrice = this.TIER_CONFIG[tier].max; if (tier === 'entry') optimalPrice = 49; if (tier === 'premium') optimalPrice = 79; if (tier === 'collector') optimalPrice = 129; this.form.get('retailPrice')?.setValue(optimalPrice); }
  updateVolume(event: Event) { const val = parseInt((event.target as HTMLInputElement).value, 10); if (!isNaN(val)) { this.productionVolume.set(val); } }
  
  checkout() {
    this.paymentOption.set('deposit');
    this.showCheckoutModal.set(true);
  }

  confirmAndPay() {
    if (this.checkoutForm.invalid) { alert('Please select a payment method.'); return; }
    const cost = this.amountDueToday();
    const selectedMethod = this.userService.paymentMethods().find(m => m.id === this.checkoutForm.value.paymentMethodId);
    const paymentType = this.paymentOption() === 'deposit' ? 'scheduling deposit' : 'full manufacturing cost';
    
    if (confirm(`Confirm payment of ${cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} (${paymentType}) to ${selectedMethod?.name} (**** ${selectedMethod?.last4}) for ${this.productionVolume()} units?`)) {
      this.save();
      alert('Payment successful! Production run scheduled.');
      this.showCheckoutModal.set(false);
    }
  }

  submitAddMethod() {
    if (this.addMethodForm.valid) {
      const val = this.addMethodForm.value;
      this.userService.addPaymentMethod({ type: val.type as 'bank' | 'card', name: val.name || 'Unknown', last4: val.number?.slice(-4) || '0000', isDefault: this.userService.paymentMethods().length === 0 });
      this.showAddMethodModal.set(false);
      this.addMethodForm.reset({ type: 'bank' });
      const paymentMethods = this.userService.paymentMethods();
      const newMethod = paymentMethods[paymentMethods.length - 1];
      if (newMethod) { this.checkoutForm.patchValue({ paymentMethodId: newMethod.id }); }
    }
  }

  save() {
    const a = this.album();
    if (a && this.form.valid) {
      const metadata = { pricing: { retailPrice: this.form.value.retailPrice, manufacturingCost: this.manufacturingCost(), currency: 'USD' } };
      this.dataService.updateAlbumMetadata(a.albumId, metadata as any);
      alert('Pricing saved!');
      this.form.markAsPristine();
    }
  }
}
