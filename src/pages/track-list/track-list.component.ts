import { Component, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { CryptoService } from '../../services/crypto.service';
import { DeviceConnectionService } from '../../services/device-connection.service';
import { DeviceTrack } from '../../types';

interface UploadItem {
  id: string;
  filename: string;
  size: string;
  progress: number;
  status: 'uploading' | 'processing' | 'encrypting' | 'transferring' | 'done' | 'error';
  error?: string;
}

@Component({
  selector: 'app-track-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './track-list.component.html'
})
export class TrackListComponent {
  private route = inject(ActivatedRoute);
  private dataService = inject(DataService);
  private cryptoService = inject(CryptoService);
  private connectionService = inject(DeviceConnectionService);
  private refreshToken = 0;

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Upload State
  isDragging = signal(false);
  uploads = signal<UploadItem[]>([]);
  uploadGateMessage = signal<string>('');

  private readonly CLOUD_STREAM_BLOCK_MESSAGE =
    'No cloud streaming: connect your DPA over the local helper or live device path before uploading masters.';

  private uploadActiveOrSettling = false;

  // Device tracks (live from firmware when connected)
  deviceTracks = signal<DeviceTrack[]>([]);
  trackPlayCounts = signal<Record<string, number>>({});
  isConnected = computed(() => this.connectionService.deviceHttpAvailable());
  hasLiveTrackSource = computed(() => {
    const connected = this.connectionService.connectionStatus() !== 'disconnected';
    const libraryTrackCount = this.connectionService.deviceLibrary()?.tracks?.length ?? 0;
    return connected && (this.deviceTracks().length > 0 || libraryTrackCount > 0);
  });

  // Combined track list: device tracks when connected, DataService tracks when not
  displayTracks = computed(() => {
    const effectiveDeviceTracks = this.deviceTracks().length > 0
      ? this.deviceTracks()
      : this.synthesizedTracksFromLibrary();

    if (this.hasLiveTrackSource() && effectiveDeviceTracks.length > 0) {
      const counts = this.trackPlayCounts();
      const a = this.album();
      const localByFilename = new Map<string, string>();
      if (a) {
        for (const lt of a.tracks) {
          if (lt.trackId?.startsWith('device://')) {
            const parts = lt.trackId.replace('device://', '').split('/');
            const fn = parts[parts.length - 1];
            if (fn && lt.artworkUrl) localByFilename.set(fn, lt.artworkUrl);
          }
        }
      }
      return effectiveDeviceTracks.map((t, i) => {
        const leaf = t.filename.split('/').pop() || t.filename;
        // Per-track art: local DataService first, then device /api/art, then album cover fallback
        const localArt = localByFilename.get(leaf);
        const deviceArt = localArt || this.connectionService.wifi.trackArtUrl(t.filename);
        return {
          index: i,
          title: t.title,
          id: t.filename,
          durationSec: Math.round(t.durationMs / 1000),
          filename: t.filename,
          route: t.filename,
          format: t.format || 'wav',
          sampleRate: t.sampleRate,
          bitsPerSample: t.bitsPerSample,
          plays:
            counts[t.filename] ??
            counts[t.filename.split('/').pop() || ''] ??
            0,
          artworkUrl: deviceArt,
          isDevice: true,
        };
      });
    }
    const a = this.album();
    if (!a) return [];
    return a.tracks.map(t => ({
      index: t.trackIndex,
      title: t.title,
      id: t.trackId,
      durationSec: t.durationSec,
      filename: '',
      route: t.trackId?.startsWith('device://') ? t.trackId.replace('device://', '/') : t.trackId,
      format: 'local',
      sampleRate: undefined as number | undefined,
      bitsPerSample: undefined as number | undefined,
      plays: 0,
      artworkUrl: t.artworkUrl || '',
      isDevice: false,
    }));
  });

  // Simple Add Form State
  newTitle = signal('');
  newDuration = signal(180);

  constructor() {
    effect(() => {
      const connection = this.connectionService.connectionStatus();
      const httpAvailable = this.connectionService.deviceHttpAvailable();
      const deviceId = this.connectionService.registeredDeviceId();
      const libraryTrackCount = this.connectionService.deviceLibrary()?.tracks?.length ?? 0;
      const contentRevision = this.connectionService.wifi.contentRevision();
      void connection;
      void deviceId;
      void libraryTrackCount;
      void contentRevision;

      if (httpAvailable || connection === 'usb') {
        void this.refreshDeviceTracks();
      } else if (!this.uploadActiveOrSettling) {
        this.deviceTracks.set([]);
        this.trackPlayCounts.set({});
      }
    }, { allowSignalWrites: true });
  }

  private synthesizedTracksFromLibrary(): DeviceTrack[] {
    const libraryTracks = this.connectionService.deviceLibrary()?.tracks ?? [];
    return libraryTracks.map((track, i) => ({
      index: i,
      filename: track.blobId || `/tracks/track_${i + 1}.wav`,
      title: track.title || `Track ${i + 1}`,
      sizeMB: 0,
      plays: 0,
      durationMs: Math.max(0, Math.round((track.durationSec || 0) * 1000)),
      format: 'wav',
      codec: track.codec || 'audio/wav',
    }));
  }

  private async waitForDeviceRecoveryAndRefresh() {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 12; i++) {
      await sleep(1500);
      if (this.connectionService.deviceHttpAvailable()) break;
    }
    await this.refreshDeviceTracks();
    this.uploadActiveOrSettling = false;
    if (this.deviceTracks().length === 0) {
      await sleep(2000);
      await this.refreshDeviceTracks();
    }
  }

  private async refreshDeviceTracks() {
    const refreshToken = ++this.refreshToken;
    if (this.connectionService.connectionStatus() === 'usb') {
      if (refreshToken !== this.refreshToken) return;
      this.deviceTracks.set(this.synthesizedTracksFromLibrary());
      this.trackPlayCounts.set({});
      return;
    }
    const tracks = await this.connectionService.wifi.getDeviceTracks();
    if (refreshToken !== this.refreshToken) return;
    this.deviceTracks.set(tracks.length > 0 ? tracks : this.synthesizedTracksFromLibrary());
    // Fetch play counts
    try {
      const analytics = await this.connectionService.wifi.getAnalytics();
      if (refreshToken !== this.refreshToken) return;
      const counts: Record<string, number> = {};
      for (const a of analytics) {
        if (a.path && a.path.length > 0) {
          counts[a.path] = a.plays;
          const base = a.path.split('/').pop();
          if (base) counts[base] = a.plays;
        } else if (tracks[a.idx]) {
          counts[tracks[a.idx].filename] = a.plays;
        }
      }
      this.trackPlayCounts.set(counts);
    } catch {}
  }

  async playOnDevice(filename: string) {
    if (!this.isConnected()) return;
    await this.connectionService.wifi.playFile(filename);
  }

  async stopOnDevice() {
    if (!this.isConnected()) return;
    await this.connectionService.wifi.sendCommand(0x02);
  }

  async deleteFromDevice(filename: string) {
    if (!this.isConnected()) return;
    const displayName = filename.split('/').pop() || filename;
    if (!confirm(`Delete ${displayName} from device storage?`)) return;
    const ok = await this.connectionService.wifi.deleteFile(filename);
    if (ok) {
      this.deviceTracks.update(tracks => tracks.filter(t => t.filename !== filename));
      await new Promise(r => setTimeout(r, 1500));
      await this.refreshDeviceTracks();
    }
  }

  private deviceArtStem(pathOrFilename: string): string {
    const base = pathOrFilename.split('/').pop() || pathOrFilename;
    const noExt = base.replace(/\.(wav|dpa|WAV|DPA)$/i, '');
    return noExt.replace(/[^a-zA-Z0-9_-]/g, '_') || 'track';
  }

  private sanitizeDeviceFilename(filename: string): string {
    return filename
      .replace(/ /g, '_')
      .replace(/[()']/g, '')
      .replace(/[&#]/g, '_');
  }

  onTrackArtSelected(event: Event, trackId: string) {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const a = this.album();
    if (!a) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      this.dataService.updateTrackArtwork(a.albumId, trackId, dataUrl);

      if (this.isConnected()) {
        const stem = trackId.includes('/')
          ? this.deviceArtStem(trackId)
          : trackId.replace(/[^a-zA-Z0-9_-]/g, '_');
        await this.connectionService.wifi.uploadFileToPath(file, `/art/${stem}.jpg`);
      }
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Manual Add
  addTrack() {
    if (!this.canTransferToDevice()) {
      this.uploadGateMessage.set(
        'Manual track rows are disabled for creator flow. Connect device and upload source files for encrypted transfer.'
      );
      return;
    }
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

  // --- File Upload Logic ---

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    
    if (event.dataTransfer?.files) {
      this.handleFiles(event.dataTransfer.files);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.handleFiles(input.files);
    }
  }

  private handleFiles(files: FileList) {
    if (!this.canTransferToDevice()) {
      this.uploadGateMessage.set(this.CLOUD_STREAM_BLOCK_MESSAGE);
      return;
    }
    this.uploadGateMessage.set('');

    const newUploads: UploadItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Basic validation for audio
      if (file.type.startsWith('audio/') || file.name.endsWith('.wav') || file.name.endsWith('.flac')) {
        const uploadItem: UploadItem = {
          id: Math.random().toString(36).substring(2, 11),
          filename: file.name,
          size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
          progress: 0,
          status: 'uploading',
        };
        newUploads.push(uploadItem);
        void this.processUpload(uploadItem, file);
      }
    }

    this.uploads.update(current => [...newUploads, ...current]);
  }

  private async processUpload(item: UploadItem, file: File) {
    if (!this.canTransferToDevice()) {
      this.failUpload(item.id, this.CLOUD_STREAM_BLOCK_MESSAGE);
      return;
    }

    const duid = this.connectionService.deviceInfo()?.serial;
    if (!duid || duid === 'DPA-SIM-1234') {
      this.failUpload(item.id, 'Connected device is not a real DPA target.');
      return;
    }

    this.updateItemStatus(item.id, 'processing', 10);

    let wavInfo: { sampleRate: number; channels: number; bitsPerSample: number; durationMs: number };
    try {
      const headerSlice = await file.slice(0, 512).arrayBuffer();
      wavInfo = this.cryptoService.inspectWavHeader(headerSlice);
    } catch {
      this.failUpload(item.id, 'File does not appear to be a valid WAV.');
      return;
    }

    const a = this.album();
    const title = file.name.replace(/\.[^/.]+$/, '');
    const dpa1Header = this.cryptoService.buildDpa1Header({
      format: 1,
      sampleRate: wavInfo.sampleRate,
      channels: wavInfo.channels,
      bitsPerSample: wavInfo.bitsPerSample,
      durationMs: wavInfo.durationMs,
      title,
      originalFilename: file.name,
      artist: a?.artistName,
      album: a?.title,
    }, file.size);

    const dpaBlob = new Blob([dpa1Header.buffer as ArrayBuffer, file]);
    const rawStem = file.name.replace(/\.[^/.]+$/, '');
    const deviceFilename = this.sanitizeDeviceFilename(rawStem) + '.dpa';

    this.updateItemStatus(item.id, 'transferring', 0);
    this.uploadActiveOrSettling = true;

    let transferOk = false;
    try {
      transferOk = await this.connectionService.wifi.uploadFileToPath(dpaBlob, `/tracks/${deviceFilename}`, (percent) => {
        this.uploads.update(items => items.map(u =>
          u.id === item.id ? { ...u, progress: percent } : u
        ));
      });
    } catch {
      transferOk = false;
    }

    if (!transferOk) {
      this.uploadActiveOrSettling = false;
      this.failUpload(item.id, 'Transfer to device failed. Nothing stored in portal.');
      return;
    }

    this.uploads.update(items => items.map(u =>
      u.id === item.id ? { ...u, status: 'done' as const, progress: 100 } : u
    ));

    if (a) {
      const duration = Math.round(wavInfo.durationMs / 1000) || await this.getAudioDuration(file);
      this.dataService.addTrack(a.albumId, title, duration, `device://${duid}/${deviceFilename}`);
    }

    await this.waitForDeviceRecoveryAndRefresh();

    setTimeout(() => {
      this.uploads.update(items => items.filter(u => u.id !== item.id));
    }, 2000);
  }

  canTransferToDevice(): boolean {
    return this.connectionService.deviceHttpAvailable()
      && !!this.connectionService.deviceInfo()?.serial
      && this.connectionService.deviceInfo()?.serial !== 'DPA-SIM-1234';
  }

  private failUpload(itemId: string, message: string) {
    this.uploads.update(items => items.map(u =>
      u.id === itemId ? { ...u, status: 'error' as const, progress: 0, error: message } : u
    ));
  }

  private updateItemStatus(itemId: string, status: UploadItem['status'], progress: number) {
    this.uploads.update(items => items.map(u =>
      u.id === itemId ? { ...u, status, progress } : u
    ));
  }

  private async getAudioDuration(file: File): Promise<number> {
    try {
      const audioCtx = new AudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const duration = Math.round(audioBuffer.duration);
      audioCtx.close();
      return duration;
    } catch {
      // Fallback: estimate from file size (~1.4MB per minute for WAV 16/44.1)
      return Math.max(60, Math.round(file.size / (1024 * 1024) * 42));
    }
  }
}
