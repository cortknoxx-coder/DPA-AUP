
import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { PlayerService, PlayerTrack } from '../../services/player.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { CartService } from '../../services/cart.service';
import { DeviceRuntimeBannerComponent } from '../../components/device-runtime-banner/device-runtime-banner.component';
import { DEFAULT_COVER_DATA_URL } from '../../default-cover';

@Component({
  selector: 'app-fan-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, DeviceRuntimeBannerComponent],
  templateUrl: './fan-layout.component.html'
})
export class FanLayoutComponent {
  playerService = inject(PlayerService);
  connectionService = inject(DeviceConnectionService);
  cartService = inject(CartService);
  private router = inject(Router);
  defaultCover = DEFAULT_COVER_DATA_URL;
  
  sidebarOpen = signal(false);
  playlistOverlayVisible = signal(false);
  cartOverlayVisible = signal(false);

  // Battery percentage from device WiFi or BLE status (-1 = unknown)
  batteryPercent = computed(() => {
    const conn = this.connectionService.connectionStatus();
    if (conn === 'wifi') {
      const status = this.connectionService.wifi.lastStatus();
      return status?.battery?.percent ?? -1;
    }
    if (conn === 'bluetooth') {
      const status = this.connectionService.ble.lastStatus();
      return status?.battery?.percent ?? -1;
    }
    return -1;
  });

  togglePlaylistOverlay() {
    this.playlistOverlayVisible.update(v => !v);
  }

  toggleCartOverlay() {
    this.cartOverlayVisible.update(v => !v);
  }

  selectTrack(track: PlayerTrack) {
    this.playerService.play(track);
  }

  logout() {
    this.router.navigate(['/login']);
  }

  openConnectionOptions() {
    this.router.navigate(['/fan/auth']);
  }

  formatTime(sec: number): string {
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

  handlePlayerArtworkError(event: Event, artworkUrl?: string) {
    this.advanceImageFallback(event, [
      ...(this.connectionService.connectionStatus() === 'wifi' ? this.connectionService.wifi.coverArtCandidateUrls() : []),
      artworkUrl || '',
      this.defaultCover,
    ].filter(Boolean));
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
