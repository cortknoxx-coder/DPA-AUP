import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-track-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './track-list.component.html'
})
export class TrackListComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Simple Add Form State
  newTitle = signal('');
  newDuration = signal(180);

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  addTrack() {
    if (this.newTitle().trim()) {
      const a = this.album();
      if (a) {
        this.dataService.addTrack(a.albumId, this.newTitle(), this.newDuration());
        this.newTitle.set('');
        this.newDuration.set(180);
      }
    }
  }

  deleteTrack(trackId: string) {
    const a = this.album();
    if (a) {
      if (confirm('Delete this track?')) {
        this.dataService.deleteTrack(a.albumId, trackId);
      }
    }
  }
}
