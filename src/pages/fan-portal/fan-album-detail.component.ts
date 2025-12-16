
import { Component, inject, computed, signal, Input } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { PlayerService } from '../../services/player.service';

@Component({
  selector: 'app-fan-album-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe],
  templateUrl: './fan-album-detail.component.html'
})
export class FanAlbumDetailComponent {
  private dataService = inject(DataService);
  playerService = inject(PlayerService);

  @Input() id!: string;

  album = computed(() => this.dataService.getAlbum(this.id)());
  
  activeSection = signal('tracks');

  totalDuration = computed(() => {
    const tracks = this.album()?.tracks || [];
    return tracks.reduce((acc, t) => acc + t.durationSec, 0);
  });

  scrollToSection(id: string) {
    this.activeSection.set(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  playAlbum() {
    const a = this.album();
    if (a && a.tracks.length > 0) {
      const first = a.tracks[0];
      // Reset queue logic in player service would go here in a real app
      // For now we just play first track
      this.playerService.play({
        id: first.trackId,
        title: first.title,
        artist: a.artistName || 'Artist',
        album: a.title,
        duration: first.durationSec,
        coverUrl: 'https://picsum.photos/seed/' + a.albumId + '/300/300'
      });
    }
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatDuration(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  }
}
