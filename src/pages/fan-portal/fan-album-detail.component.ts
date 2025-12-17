
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
  playerService = inject(PlayerService);

  @Input() id!: string;

  // Use dataService for metadata fallback
  albumMetadata = computed(() => this.dataService.getAlbum(this.id)());
  manifest = signal<Manifest | null>(null);
  isLoading = signal(true);

  activeSection = signal('tracks');

  constructor() {
    effect(() => {
      this.loadManifest(this.id);
    }, { allowSignalWrites: true });
  }

  async loadManifest(albumId: string) {
    this.isLoading.set(true);
    try {
      let manifestData: Manifest;

      if (this.connectionService.isSimulationMode()) {
        manifestData = this.createMockManifest(albumId);
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

  totalDuration = computed(() => {
    const tracks = this.manifest()?.tracks || [];
    return tracks.reduce((acc, t) => acc + t.durationSec, 0);
  });

  playTrack(track: Manifest['tracks'][0]) {
    const m = this.manifest();
    if (!m) return;
    
    const playerTrack: PlayerTrack = {
      id: track.trackId,
      title: track.title,
      artist: this.albumMetadata()?.artistName || 'Artist',
      album: this.albumMetadata()?.title || 'Album',
      duration: track.durationSec,
      coverUrl: `https://picsum.photos/seed/${m.albumId}/300/300`,
      blobId: track.blobId
    };
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
}
