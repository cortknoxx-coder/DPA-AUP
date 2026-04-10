
import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { RouterLink, Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { PlayerService } from '../../services/player.service';
import { mergeCapsuleFeeds } from '../../services/device-content.utils';
import { DEFAULT_COVER_DATA_URL } from '../../default-cover';

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
  capsules = computed(() =>
    mergeCapsuleFeeds(this.allCapsules(), this.connectionService.deviceCapsules(), {
      albumId: this.library()?.albums?.[0]?.id,
      albumTitle: this.library()?.albums?.[0]?.title,
      artistName: this.dataService.albums()?.[0]?.artistName,
    })
  );
  latestCapsule = computed(() => this.capsules()?.[0]);

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
}
