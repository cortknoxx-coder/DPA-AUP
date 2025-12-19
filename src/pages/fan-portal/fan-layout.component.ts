
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { PlayerService, PlayerTrack } from '../../services/player.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-fan-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './fan-layout.component.html'
})
export class FanLayoutComponent {
  playerService = inject(PlayerService);
  connectionService = inject(DeviceConnectionService);
  cartService = inject(CartService);
  private router = inject(Router);
  
  sidebarOpen = signal(false);
  playlistOverlayVisible = signal(false);
  cartOverlayVisible = signal(false);

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

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
