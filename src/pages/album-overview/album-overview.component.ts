import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { DeviceTrack, FirmwareStatus } from '../../types';
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

  private refreshToken = 0;
  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());
  liveDeviceTracks = signal<DeviceTrack[]>([]);
  compiledTracks = computed(() => {
    const liveTracks = this.liveDeviceTracks();
    if (liveTracks.length > 0) {
      return liveTracks.map((track, index) => ({
        trackId: track.filename,
        title: track.title,
        trackNo: index + 1,
        durationSec: Math.max(0, Math.round(track.durationMs / 1000)),
        route: track.filename,
      }));
    }
    return (this.album()?.tracks ?? []).map(track => ({
      trackId: track.trackId,
      title: track.title,
      trackNo: track.trackIndex + 1,
      durationSec: track.durationSec,
      route: this.normalizeTrackRoute(track.trackId),
    }));
  });
  compiledTrackTotalDuration = computed(() =>
    this.compiledTracks().reduce((sum, track) => sum + track.durationSec, 0)
  );
  private lastKnownCoverUrl = '';
  compiledCoverUrl = computed(() => {
    const deviceArt = this.connectionService.deviceLibrary()?.albums?.[0]?.artworkUrl;
    const localArt = this.album()?.artworkUrl;
    const url = deviceArt || localArt || '';
    if (url) this.lastKnownCoverUrl = url;
    return url || this.lastKnownCoverUrl;
  });
  compiledSourceLabel = computed(() =>
    this.liveDeviceTracks().length > 0 ? 'Creator Portal Live Device Preview' : 'Creator Portal Compiled Preview'
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
      const httpAvailable = this.connectionService.deviceHttpAvailable();
      const contentRevision = this.connectionService.wifi.contentRevision();
      const libraryTrackCount = this.connectionService.deviceLibrary()?.tracks?.length ?? 0;
      void contentRevision;
      void libraryTrackCount;
      if (httpAvailable) {
        void this.refreshDeviceStatus();
      } else {
        this.deviceStatus.set(null);
        this.deviceTrackCount.set(0);
        this.liveDeviceTracks.set([]);
      }
    }, { allowSignalWrites: true });
  }

  private async refreshDeviceStatus() {
    const refreshToken = ++this.refreshToken;
    try {
      const status = await this.connectionService.wifi.getStatus();
      if (refreshToken !== this.refreshToken) return;
      this.deviceStatus.set(status);
      const tracks = await this.connectionService.wifi.getDeviceTracks();
      if (refreshToken !== this.refreshToken) return;
      this.liveDeviceTracks.set(tracks);
      this.deviceTrackCount.set(tracks.length);
    } catch {}
  }

  private normalizeTrackRoute(trackId: string): string | undefined {
    if (!trackId?.startsWith('device://')) return undefined;
    const raw = trackId.replace(/^device:\/\//, '');
    return raw.startsWith('/') ? raw : `/${raw}`;
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
