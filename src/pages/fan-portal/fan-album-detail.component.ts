
import { Component, inject, computed, signal, Input, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { PlayerService, PlayerTrack } from '../../services/player.service';
import { DeviceBridgeService } from '../../services/device-bridge.service';
import { Manifest } from '../../types';
import { DeviceConnectionService } from '../../services/device-connection.service';

@Component({
  selector: 'app-fan-album-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, DatePipe],
  templateUrl: './fan-album-detail.component.html'
})
export class FanAlbumDetailComponent {
  private dataService = inject(DataService);
  private bridge = inject(DeviceBridgeService);
  private connectionService = inject(DeviceConnectionService);
  private wifi = this.connectionService.wifi;
  playerService = inject(PlayerService);

  @Input() id!: string;

  // Use dataService for metadata, fall back to deviceLibrary info for firmware albums
  albumMetadata = computed(() => {
    const fromData = this.dataService.getAlbum(this.id)();
    if (fromData) return fromData;

    const lib = this.connectionService.deviceLibrary();
    const libAlbum = lib?.albums?.find(a => a.id === this.id);
    if (libAlbum) {
      return {
        id: '0',
        albumId: libAlbum.id,
        title: libAlbum.title,
        artistName: 'DPA Device',
        genre: 'Audio',
        releaseDate: new Date().toISOString(),
        tracks: [],
        artworkUrl: libAlbum.artworkUrl || '',
        status: 'published' as const,
        version: 1,
      };
    }
    return null;
  });
  manifest = signal<Manifest | null>(null);
  isLoading = signal(true);

  activeSection = signal('tracks');
  usingLiveDeviceTracks = computed(() => this.connectionService.connectionStatus() === 'wifi');

  trackPlayCounts = signal<Record<string, number>>({});

  /** Set of trackIds the fan has hearted */
  favorites = signal<Set<string>>(new Set());
  private firmwarePathByTrackId = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      const m = this.manifest();
      if (m) {
        if (this.connectionService.connectionStatus() === 'wifi') {
          this.refreshAnalyticsFromDevice(m);
        } else {
          const counts: Record<string, number> = {};
          for (const t of m.tracks) {
            counts[t.trackId] = 0;
          }
          this.trackPlayCounts.set(counts);
        }
      }
    }, { allowSignalWrites: true });
    effect(() => {
      this.loadManifest(this.id);
    }, { allowSignalWrites: true });
    effect(() => {
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.refreshFavoritesFromDevice();
      }
    }, { allowSignalWrites: true });
  }

  async loadManifest(albumId: string) {
    this.isLoading.set(true);
    try {
      let manifestData: Manifest;

      if (this.connectionService.isSimulationMode()) {
        manifestData = this.createMockManifest(albumId);
      } else if (this.connectionService.connectionStatus() === 'wifi') {
        manifestData = await this.createFirmwareManifest(albumId);
      } else {
        manifestData = await this.bridge.getManifest(albumId);
      }
      
      this.manifest.set(manifestData);
      
      const artistName = this.albumMetadata()?.artistName || 'Unknown Artist';
      const albumTitle = this.albumMetadata()?.title || 'Unknown Album';
      this.playerService.setQueueFromManifest(manifestData, { artist: artistName, title: albumTitle });

    } catch (e) {
      console.error('Failed to load manifest', e);
      this.manifest.set(null);
    } finally {
      this.isLoading.set(false);
    }
  }

  private createMockManifest(albumId: string): Manifest {
    const album = this.dataService.getAlbum(albumId)();
    if (!album) {
      throw new Error(`Mock album ${albumId} not found`);
    }

    return {
      version: 1,
      albumId: album.albumId,
      policyHash: 'sha256:demo-policy-hash',
      blobs: album.tracks.map(t => ({
        blobId: `blob_${t.trackId}`,
        sha256: 'mock-sha256-hash',
        size: t.durationSec * 1024 * 15,
        mime: 'application/octet-stream',
        kind: 'audio'
      })),
      tracks: album.tracks.map(t => ({
        trackId: t.trackId,
        blobId: `blob_${t.trackId}`,
        codec: 'audio/wav',
        title: t.title,
        trackNo: t.trackIndex + 1,
        durationSec: t.durationSec,
      })),
      signatures: {
        manifestSigEd25519B64: 'mock-signature-base64',
        publisherPubkeyEd25519B64: 'mock-pubkey-base64',
      }
    };
  }

  private async createFirmwareManifest(albumId: string): Promise<Manifest> {
    const tracks = await this.wifi.getDeviceTracks();
    const album = this.albumMetadata();
    const trackRefs = tracks.map((t, i) => ({
      trackId: `fw-${t.index}`,
      blobId: t.filename,
      codec: 'audio/wav',
      title: t.title,
      trackNo: i + 1,
      durationSec: Math.max(1, Math.round(t.durationMs / 1000)),
    }));
    this.firmwarePathByTrackId.set(
      trackRefs.reduce((acc, t) => {
        acc[t.trackId] = t.blobId;
        return acc;
      }, {} as Record<string, string>)
    );
    return {
      version: 1,
      albumId: album?.albumId || albumId,
      policyHash: 'sha256:firmware-live',
      blobs: trackRefs.map(t => ({
        blobId: t.blobId,
        sha256: '',
        size: 0,
        mime: 'audio/wav',
        kind: 'audio' as const
      })),
      tracks: trackRefs,
      signatures: {
        manifestSigEd25519B64: '',
        publisherPubkeyEd25519B64: '',
      },
    };
  }

  totalDuration = computed(() => {
    const tracks = this.manifest()?.tracks || [];
    return tracks.reduce((acc, t) => acc + t.durationSec, 0);
  });

  playTrack(track: Manifest['tracks'][0]) {
    const m = this.manifest();
    if (!m) return;
    
    const albumMeta = this.albumMetadata();
    const coverUrl = (albumMeta as any)?.artworkUrl || '/assets/dpa-default-cover.png';
    const playerTrack: PlayerTrack = {
      id: track.trackId,
      title: track.title,
      artist: albumMeta?.artistName || 'Artist',
      album: albumMeta?.title || 'Album',
      duration: track.durationSec,
      coverUrl,
      blobId: track.blobId
    };
    const conn = this.connectionService.connectionStatus();
    if (conn === 'wifi') {
      const path = this.firmwarePathByTrackId()[track.trackId] || track.blobId;
      this.wifi.playFile(path).then(ok => {
        if (ok) {
          this.playerService.currentTrack.set(playerTrack);
          this.playerService.isPlaying.set(true);
          this.playerService.currentTime.set(0);
          this.playerService.progress.set(0);
          this.playerService.startWifiPolling();
        }
      });
      return;
    }
    this.playerService.play(playerTrack);
  }

  playAlbum() {
    const firstTrack = this.manifest()?.tracks?.[0];
    if (firstTrack) {
      this.playTrack(firstTrack);
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

  /** Toggle heart/favorite for a track */
  toggleFavorite(trackId: string, event: Event) {
    event.stopPropagation();
    const path = this.firmwarePathByTrackId()[trackId];
    if (this.connectionService.connectionStatus() === 'wifi' && path) {
      const want = !this.favorites().has(trackId);
      this.wifi.setFavorite(path, want).then(() => this.refreshFavoritesFromDevice());
      return;
    }
    const current = new Set(this.favorites());
    if (current.has(trackId)) current.delete(trackId);
    else current.add(trackId);
    this.favorites.set(current);
  }

  /** Returns 0–100 popularity relative to the most-played track */
  getPopularity(trackId: string): number {
    const counts = this.trackPlayCounts();
    const values = Object.values(counts);
    if (!values.length) return 0;
    const max = Math.max(...values);
    if (max === 0) return 0;
    return Math.round(((counts[trackId] ?? 0) / max) * 100);
  }

  private async refreshFavoritesFromDevice() {
    const paths = await this.wifi.getFavorites();
    const reverse = this.firmwarePathByTrackId();
    const next = new Set<string>();
    for (const [trackId, path] of Object.entries(reverse)) {
      if (paths.includes(path)) next.add(trackId);
    }
    this.favorites.set(next);
  }

  private async refreshAnalyticsFromDevice(m: Manifest) {
    const analytics = await this.wifi.getAnalytics();
    const counts: Record<string, number> = {};
    for (const t of m.tracks) {
      const match = t.trackId.match(/^fw-(\d+)$/);
      const fwIdx = match ? Number(match[1]) : -1;
      const stat = analytics.find(a => a.idx === fwIdx);
      counts[t.trackId] = stat?.plays ?? 0;
    }
    this.trackPlayCounts.set(counts);
  }
}
