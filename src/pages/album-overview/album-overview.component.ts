import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { FirmwareStatus } from '../../types';
import { ReleaseBuildService, ReleaseBuildStep } from '../../services/release-build.service';
import { CompiledAlbumViewComponent } from '../../components/compiled-album-view/compiled-album-view.component';
import { PrivateIngestSummary } from '../../services/private-ingest.service';
import { PrivateIngestPublicService } from '../../services/private-ingest-public.service';

@Component({
  selector: 'app-album-overview',
  standalone: true,
  imports: [CommonModule, CompiledAlbumViewComponent],
  templateUrl: './album-overview.component.html'
})
export class AlbumOverviewComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private releaseBuild = inject(ReleaseBuildService);
  private privateIngest = inject(PrivateIngestPublicService);
  connectionService = inject(DeviceConnectionService);

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());
  compiledTracks = computed(() =>
    (this.album()?.tracks ?? []).map(track => ({
      trackId: track.trackId,
      title: track.title,
      trackNo: track.trackIndex + 1,
      durationSec: track.durationSec,
    }))
  );
  compiledTrackTotalDuration = computed(() =>
    this.album()?.tracks.reduce((sum, track) => sum + track.durationSec, 0) ?? 0
  );

  deviceStatus = signal<FirmwareStatus | null>(null);
  deviceTrackCount = signal(0);
  ingestSummary = signal<PrivateIngestSummary | null>(null);
  rebuildState = signal<'idle' | 'running' | 'success' | 'error'>('idle');
  rebuildSummary = signal('');
  rebuildSteps = signal<ReleaseBuildStep[]>([]);

  constructor() {
    effect(() => {
      const albumId = this.album()?.albumId;
      if (!albumId) {
        this.ingestSummary.set(null);
        return;
      }
      void this.loadIngestSummary(albumId);
    }, { allowSignalWrites: true });

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

  private async loadIngestSummary(albumId: string) {
    this.ingestSummary.set(await this.privateIngest.getSummary({ albumId }));
  }

  async rebuild() {
    const a = this.album();
    if (!a || this.rebuildState() === 'running') {
      return;
    }

    this.rebuildState.set('running');
    this.rebuildSummary.set('Compiling the release package and pushing it to the connected DPA...');
    this.rebuildSteps.set([]);

    try {
      const result = await this.releaseBuild.rebuildAndPush(a);
      this.rebuildState.set(result.ok ? 'success' : 'error');
      this.rebuildSummary.set(result.summary);
      this.rebuildSteps.set(result.steps);
      await this.refreshDeviceStatus();
    } catch {
      this.rebuildState.set('error');
      this.rebuildSummary.set('The rebuild pipeline hit an unexpected error before verification completed.');
      this.rebuildSteps.set([{
        label: 'Release pipeline',
        status: 'error',
        detail: 'The rebuild action did not complete. Check the device connection and retry.',
      }]);
    }
  }
}
