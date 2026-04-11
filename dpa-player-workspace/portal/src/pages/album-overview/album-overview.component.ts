import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { FirmwareStatus } from '../../types';

@Component({
  selector: 'app-album-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './album-overview.component.html'
})
export class AlbumOverviewComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  connectionService = inject(DeviceConnectionService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  deviceStatus = signal<FirmwareStatus | null>(null);
  deviceTrackCount = signal(0);

  constructor() {
    effect(() => {
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.refreshDeviceStatus();
      } else {
        this.deviceStatus.set(null);
        this.deviceTrackCount.set(0);
      }
    }, { allowSignalWrites: true });
  }

  private async refreshDeviceStatus() {
    try {
      const status = await this.connectionService.wifi.getStatus();
      this.deviceStatus.set(status);
      const tracks = await this.connectionService.wifi.getDeviceTracks();
      this.deviceTrackCount.set(tracks.length);
    } catch {}
  }

  rebuild() {
    const a = this.album();
    if (a) {
      this.dataService.triggerRebuild(a.albumId);
    }
  }
}
