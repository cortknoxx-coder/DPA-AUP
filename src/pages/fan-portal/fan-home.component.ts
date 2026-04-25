
import { Component, DestroyRef, effect, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { RouterLink, Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { PlayerService } from '../../services/player.service';
import { mergeCapsuleFeeds } from '../../services/device-content.utils';
import { DEFAULT_COVER_DATA_URL } from '../../default-cover';
import { applyAlbumAccent, resetAlbumAccent } from '../../design/tokens';

@Component({
  selector: 'app-fan-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './fan-home.component.html'
})
export class FanHomeComponent {
  connectionService = inject(DeviceConnectionService);
  playerService = inject(PlayerService);
  private dataService = inject(DataService);
  private router = inject(Router);
  defaultCover = DEFAULT_COVER_DATA_URL;
  allCapsules = this.dataService.getAllCapsules();
  library = computed(() => this.connectionService.deviceLibrary());
  connectedAlbum = computed(() => this.connectionService.connectedAlbum());
  capsules = computed(() =>
    mergeCapsuleFeeds(this.allCapsules(), this.connectionService.deviceCapsules(), {
      albumId: this.connectedAlbum()?.id,
      albumTitle: this.connectedAlbum()?.title,
      artistName: this.connectedAlbum()?.artistName,
    })
  );
  latestCapsule = computed(() => this.capsules()?.[0]);
  private destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const album = this.connectedAlbum();
      const art = album?.artworkUrl;
      if (art) void applyAlbumAccent(art);
      else resetAlbumAccent();
    });
    this.destroyRef.onDestroy(() => resetAlbumAccent());
  }

  logout() {
    this.router.navigate(['/login']);
  }

  openConnectionOptions() {
    this.router.navigate(['/fan/auth']);
  }

  formatTrackDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  handleAlbumArtworkError(event: Event, artworkUrl?: string) {
    const candidates = [
      ...(this.connectionService.connectionStatus() === 'wifi' ? this.connectionService.wifi.coverArtCandidateUrls() : []),
      artworkUrl || '',
      this.defaultCover,
    ].filter(Boolean);
    this.advanceImageFallback(event, candidates);
  }

  private advanceImageFallback(event: Event, candidates: string[]) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    const current = this.normalizeImageUrl(target.currentSrc || target.src);
    const next = candidates.find((candidate) => this.normalizeImageUrl(candidate) !== current);
    if (next) {
      target.src = next;
    }
  }

  private normalizeImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.pathname.endsWith('/api/art')) {
        return `${parsed.origin}${parsed.pathname}?path=${parsed.searchParams.get('path') ?? ''}`;
      }
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  }
}
