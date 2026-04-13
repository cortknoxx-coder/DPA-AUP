import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Album } from '../../types';
import { DEFAULT_COVER_DATA_URL } from '../../default-cover';

export interface CompiledAlbumTrack {
  trackId: string;
  title: string;
  trackNo: number;
  durationSec: number;
  route?: string;
}

@Component({
  selector: 'app-compiled-album-view',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 sm:p-8">
      <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div class="w-full max-w-[220px] shrink-0">
          <img
            [src]="coverUrl || defaultCover"
            alt="Album cover"
            class="aspect-square w-full rounded-2xl border border-white/10 object-cover shadow-2xl shadow-black/40"
            (error)="$any($event.target).src = defaultCover"
          >
        </div>

        <div class="min-w-0 flex-1">
          <div class="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-400">
            {{ sourceLabel || 'Compiled Album View' }}
          </div>
          <h2 class="mt-3 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
            {{ album?.title || 'Untitled Album' }}
          </h2>
          <p class="mt-2 text-base text-slate-300">
            {{ album?.artistName || 'Unknown Artist' }}
          </p>

          <div class="mt-5 flex flex-wrap gap-2 text-xs">
            <span class="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
              {{ tracks.length }} tracks
            </span>
            <span class="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
              {{ formatDuration(totalDuration) }}
            </span>
            <span *ngIf="album?.genre" class="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
              {{ album?.genre }}
            </span>
            <span *ngIf="album?.recordLabel" class="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
              {{ album?.recordLabel }}
            </span>
            <span *ngIf="album?.releaseDate" class="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
              {{ album?.releaseDate | date:'longDate' }}
            </span>
            <span *ngIf="buildVersion !== null" class="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 font-mono text-slate-200">
              v{{ buildVersion }}
            </span>
            <span *ngIf="album?.parentalAdvisory" class="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-300">
              Parental Advisory
            </span>
            <span *ngIf="policyHash" class="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 font-mono text-emerald-300">
              {{ policyHash }}
            </span>
          </div>

          <div class="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Lyrics</div>
              <div class="mt-2 text-sm font-semibold text-slate-200">
                {{ album?.lyrics ? 'Included' : 'Not added' }}
              </div>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Credits</div>
              <div class="mt-2 text-sm font-semibold text-slate-200">
                {{ album?.booklet?.credits ? 'Included' : 'Not added' }}
              </div>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Gallery</div>
              <div class="mt-2 text-sm font-semibold text-slate-200">
                {{ album?.booklet?.gallery?.length || 0 }} image(s)
              </div>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
              <div class="text-[11px] uppercase tracking-[0.2em] text-slate-500">Capsules</div>
              <div class="mt-2 text-sm font-semibold text-slate-200">
                {{ album?.dcnpEvents?.length || 0 }} active
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
          <div class="flex items-center justify-between gap-3">
            <div class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Tracklist</div>
            <div class="text-xs text-slate-500">{{ tracks.length }} total</div>
          </div>
          <div class="mt-4 space-y-2">
            <div *ngFor="let track of tracks" class="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div class="min-w-0 flex items-center gap-3">
                <div class="w-8 text-center font-mono text-sm text-slate-500">{{ track.trackNo }}</div>
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-slate-100">{{ track.title }}</div>
                  <div *ngIf="track.route" class="mt-1 truncate font-mono text-[11px] text-teal-400/80">{{ track.route }}</div>
                </div>
              </div>
              <div class="shrink-0 font-mono text-xs text-slate-400">{{ formatTime(track.durationSec) }}</div>
            </div>
            <div *ngIf="tracks.length === 0" class="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
              No tracks are available in this compiled view yet.
            </div>
          </div>
        </section>

        <section class="space-y-6">
          <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
            <div class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Liner Notes</div>
            <div class="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">
              {{ album?.description || 'No liner notes added yet.' }}
            </div>
          </div>

          <div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
            <div class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Credits</div>
            <div class="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">
              {{ album?.booklet?.credits || 'No credits added yet.' }}
            </div>
          </div>
        </section>
      </div>

      <section class="mt-6 rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
        <div class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Lyrics</div>
        <div class="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">
          {{ album?.lyrics || 'No lyrics added yet.' }}
        </div>
      </section>

      <div class="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
          <div class="flex items-center justify-between gap-3">
            <div class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Gallery</div>
            <div class="text-xs text-slate-500">{{ album?.booklet?.gallery?.length || 0 }} image(s)</div>
          </div>
          <div *ngIf="(album?.booklet?.gallery?.length || 0) > 0; else emptyGallery" class="mt-4 grid gap-3 sm:grid-cols-2">
            <div *ngFor="let image of album?.booklet?.gallery" class="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
              <img [src]="image" class="aspect-square w-full object-cover" loading="lazy">
            </div>
          </div>
          <ng-template #emptyGallery>
            <div class="mt-4 rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
              No gallery images added yet.
            </div>
          </ng-template>
        </section>

        <section class="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
          <div class="flex items-center justify-between gap-3">
            <div class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Videos</div>
            <div class="text-xs text-slate-500">{{ album?.booklet?.videos?.length || 0 }} video(s)</div>
          </div>
          <div *ngIf="(album?.booklet?.videos?.length || 0) > 0; else emptyVideos" class="mt-4 space-y-3">
            <div *ngFor="let video of album?.booklet?.videos" class="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
              <div class="aspect-video bg-slate-950">
                <img *ngIf="video.poster; else videoFallback" [src]="video.poster" class="h-full w-full object-cover" loading="lazy">
                <ng-template #videoFallback>
                  <div class="flex h-full items-center justify-center text-sm text-slate-500">No poster uploaded</div>
                </ng-template>
              </div>
              <div class="border-t border-slate-800 px-4 py-3">
                <div class="text-sm font-medium text-slate-100">{{ video.title }}</div>
                <div class="mt-1 truncate text-xs text-slate-500">{{ video.url }}</div>
              </div>
            </div>
          </div>
          <ng-template #emptyVideos>
            <div class="mt-4 rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
              No videos added yet.
            </div>
          </ng-template>
        </section>
      </div>
    </div>
  `,
})
export class CompiledAlbumViewComponent {
  @Input() album: Album | null = null;
  @Input() tracks: CompiledAlbumTrack[] = [];
  @Input() totalDuration = 0;
  @Input() coverUrl = '';
  @Input() sourceLabel = '';
  @Input() policyHash = '';
  @Input() buildVersion: number | null = null;

  defaultCover = DEFAULT_COVER_DATA_URL;

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatDuration(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
}
