
import { Component, inject, computed, signal, Input, effect } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { DataService } from '../../services/data.service';
import { PlayerService, PlayerTrack } from '../../services/player.service';
import { DeviceBridgeService } from '../../services/device-bridge.service';
import { Album, Manifest, Theme } from '../../types';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { DEFAULT_COVER_DATA_URL } from '../../default-cover';
import { CompiledAlbumViewComponent } from '../../components/compiled-album-view/compiled-album-view.component';
import { PrivateIngestSummary } from '../../services/private-ingest.service';
import { PrivateIngestPublicService } from '../../services/private-ingest-public.service';
import { applyAlbumAccent, resetAlbumAccent } from '../../design/tokens';

const FALLBACK_THEME: Theme = {
  albumColor: { primary: '#4f46e5', accent: '#06b6d4', background: '#020617' },
  led: {
    idle: { color: '#4f46e5', pattern: 'breathing' },
    playback: { color: '#06b6d4', pattern: 'vu_classic' },
    charging: { color: '#ffcc33', pattern: 'breathing' },
  },
  dcnp: {
    concert: '#ff4bcb',
    video: '#00f1df',
    merch: '#ffcc33',
    signing: '#7d29ff',
    remix: '#ff4500',
    other: '#ffffff',
  },
};

@Component({
  selector: 'app-fan-album-detail',
  standalone: true,
  imports: [CommonModule, DatePipe, CompiledAlbumViewComponent],
  templateUrl: './fan-album-detail.component.html'
})
export class FanAlbumDetailComponent {
  private dataService = inject(DataService);
  private bridge = inject(DeviceBridgeService);
  private connectionService = inject(DeviceConnectionService);
  private wifi = this.connectionService.wifi;
  private privateIngest = inject(PrivateIngestPublicService);
  playerService = inject(PlayerService);
  defaultCover = DEFAULT_COVER_DATA_URL;

  @Input() id!: string;
  connectedAlbum = computed(() => this.connectionService.connectedAlbum());
  deviceStatus = computed(() => this.connectionService.deviceStatus());

  // Use dataService for metadata, fall back to deviceLibrary info for firmware albums.
  // When WiFi-connected, prefer device-reported artist/album over mock DataService.
  albumMetadata = computed<Album | null>(() => {
    const fromData = this.dataService.getAlbum(this.id)();
    const connectedAlbum = this.connectedAlbum();
    const deviceArtist = connectedAlbum?.artistName || this.deviceStatus()?.artist || '';
    const deviceAlbum = connectedAlbum?.title || this.deviceStatus()?.album || '';

    if (fromData) {
      // Override mock names with real device data when connected
      if (this.connectionService.connectionStatus() === 'wifi' && (deviceArtist || deviceAlbum)) {
        return {
          ...fromData,
          artistName: deviceArtist || fromData.artistName,
          title: deviceAlbum || fromData.title,
        };
      }
      return fromData;
    }

    const lib = this.connectionService.deviceLibrary();
    const libAlbum = lib?.albums?.find(a => a.id === this.id);
    if (libAlbum) {
      return {
        id: '0',
        albumId: libAlbum.id,
        artistId: 'device',
        title: deviceAlbum || libAlbum.title || connectedAlbum?.title || 'DPA Album',
        artistName: deviceArtist || connectedAlbum?.artistName || 'Artist',
        skuType: 'premium',
        status: 'ready',
        dpacVersion: 1,
        themeJson: FALLBACK_THEME,
        genre: 'Audio',
        releaseDate: new Date().toISOString(),
        tracks: [],
        dcnpEvents: [],
        booklet: { credits: '', gallery: [], videos: [] },
        artworkUrl: libAlbum.artworkUrl || connectedAlbum?.artworkUrl || '',
      };
    }
    return null;
  });
  manifest = signal<Manifest | null>(null);
  isLoading = signal(true);
  ingestSummary = signal<PrivateIngestSummary | null>(null);

  activeSection = signal('overview');
  usingLiveDeviceTracks = computed(() => this.connectionService.connectionStatus() === 'wifi');
  galleryImages = computed(() => this.albumMetadata()?.booklet?.gallery || []);
  bookletVideos = computed(() => this.albumMetadata()?.booklet?.videos || []);
  hasExtendedContent = computed(() => {
    const album = this.albumMetadata();
    return !!(
      album?.description ||
      album?.lyrics ||
      album?.booklet?.credits ||
      album?.booklet?.gallery?.length ||
      album?.booklet?.videos?.length
    );
  });

  trackPlayCounts = signal<Record<string, number>>({});

  /** Set of trackIds the fan has hearted */
  favorites = signal<Set<string>>(new Set());
  private firmwarePathByTrackId = signal<Record<string, string>>({});

  /** Per-track artwork URLs from device */
  trackArtUrls = computed(() => {
    const paths = this.firmwarePathByTrackId();
    const urls: Record<string, string> = {};
    for (const [trackId, path] of Object.entries(paths)) {
      urls[trackId] = this.wifi.trackArtUrl(path);
    }
    return urls;
  });

  /** Album cover URL from device (fallback for tracks without per-track art) */
  albumCoverUrl = computed(() => {
    if (this.connectionService.connectionStatus() === 'wifi') {
      const liveArtwork = this.connectionService.deviceLibrary()?.albums?.find((album) => album.id === this.id)?.artworkUrl
        || this.connectedAlbum()?.artworkUrl
        || this.connectionService.deviceLibrary()?.albums?.[0]?.artworkUrl
        || '';
      if (liveArtwork) return liveArtwork;
    }
    return this.albumMetadata()?.artworkUrl || '';
  });

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
    effect(() => {
      const albumId = this.albumMetadata()?.albumId;
      if (!albumId) {
        this.ingestSummary.set(null);
        return;
      }
      void this.loadIngestSummary(albumId);
    }, { allowSignalWrites: true });
    effect(() => {
      const cover = this.albumCoverUrl();
      if (cover) void applyAlbumAccent(cover);
      else resetAlbumAccent();
    });
  }

  ngOnDestroy() {
    resetAlbumAccent();
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
      codec: t.format === 'dpa' ? 'audio/dpa' : 'audio/wav',
      title: t.title,
      trackNo: i + 1,
      durationSec: Math.max(0, Math.round(t.durationMs / 1000)),
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
        mime: t.codec === 'audio/dpa' ? 'audio/dpa' : 'audio/wav',
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

  private async loadIngestSummary(albumId: string) {
    this.ingestSummary.set(await this.privateIngest.getSummary({ albumId }));
  }

  playTrack(track: Manifest['tracks'][0]) {
    const m = this.manifest();
    if (!m) return;
    
    const albumMeta = this.albumMetadata();
    const coverUrl = (albumMeta as any)?.artworkUrl || DEFAULT_COVER_DATA_URL;
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

  handleAlbumCoverError(event: Event) {
    const localArtwork = this.albumMetadata()?.artworkUrl || '';
    const liveCandidates = this.connectionService.connectionStatus() === 'wifi'
      ? this.wifi.coverArtCandidateUrls()
      : [];
    this.advanceImageFallback(event, [...liveCandidates, localArtwork, this.defaultCover].filter(Boolean));
  }

  handleTrackArtError(event: Event, trackId: string) {
    const path = this.firmwarePathByTrackId()[trackId];
    this.advanceImageFallback(event, [
      ...(path ? this.wifi.trackArtCandidateUrls(path) : []),
      this.albumCoverUrl(),
      this.defaultCover,
    ].filter(Boolean));
  }

  /** Toggle heart/favorite for a track */
  toggleFavorite(trackId: string, event: Event) {
    event.stopPropagation();
    const path = this.firmwarePathByTrackId()[trackId];
    if (this.connectionService.connectionStatus() === 'wifi' && path) {
      const want = !this.favorites().has(trackId);
      this.wifi.setFavorite(path, want)
        .then(ok => {
          if (!ok) console.warn('[FanAlbum] setFavorite returned false for', path);
          return this.refreshFavoritesFromDevice();
        })
        .catch(e => console.error('[FanAlbum] setFavorite failed:', e));
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
    try {
      const paths = await this.wifi.getFavorites();
      const reverse = this.firmwarePathByTrackId();
      const next = new Set<string>();
      for (const [trackId, path] of Object.entries(reverse)) {
        if (paths.includes(path)) next.add(trackId);
      }
      this.favorites.set(next);
    } catch (e) {
      console.error('[FanAlbum] Failed to fetch favorites:', e);
    }
  }

  private async refreshAnalyticsFromDevice(m: Manifest) {
    try {
      const analytics = await this.wifi.getAnalytics();
      if (!analytics.length) {
        console.warn('[FanAlbum] Analytics returned empty — device may have no play history yet');
      }
      const byPath = new Map<string, (typeof analytics)[0]>();
      for (const a of analytics) {
        if (a.path) {
          byPath.set(this.normalizeFwPath(a.path), a);
          const base = a.path.split('/').pop();
          if (base) byPath.set(this.normalizeFwPath(base), a);
        }
      }
      const paths = this.firmwarePathByTrackId();
      const counts: Record<string, number> = {};
      for (const t of m.tracks) {
        const rawPath = paths[t.trackId] || t.blobId || '';
        let stat =
          (rawPath && byPath.get(this.normalizeFwPath(rawPath))) ||
          (rawPath && byPath.get(this.normalizeFwPath(rawPath.split('/').pop() || '')));
        if (!stat) {
          const match = t.trackId.match(/^fw-(\d+)$/);
          const fwIdx = match ? Number(match[1]) : -1;
          stat = analytics.find(a => a.idx === fwIdx);
        }
        counts[t.trackId] = stat?.plays ?? 0;
      }
      this.trackPlayCounts.set(counts);
    } catch (e) {
      console.error('[FanAlbum] Failed to fetch analytics:', e);
    }
  }

  private normalizeFwPath(p: string): string {
    return p.trim().replace(/\\/g, '/').toLowerCase();
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
