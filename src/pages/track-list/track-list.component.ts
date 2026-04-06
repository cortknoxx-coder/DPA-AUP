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

  private id = computed(() => this.route.parent?.snapshot.params['id']);
  album = computed(() => this.dataService.getAlbum(this.id())());

  // Upload State
  isDragging = signal(false);
  uploads = signal<UploadItem[]>([]);
  uploadGateMessage = signal<string>('');

  private readonly CLOUD_STREAM_BLOCK_MESSAGE =
    'No cloud streaming: connect your DPA over WiFi before uploading masters.';

  // Device tracks (live from firmware when connected)
  deviceTracks = signal<DeviceTrack[]>([]);
  trackPlayCounts = signal<Record<string, number>>({});
  isConnected = computed(() => this.connectionService.connectionStatus() === 'wifi');

  // Combined track list: device tracks when connected, DataService tracks when not
  displayTracks = computed(() => {
    if (this.isConnected() && this.deviceTracks().length > 0) {
      const counts = this.trackPlayCounts();
      return this.deviceTracks().map((t, i) => ({
        index: i,
        title: t.title,
        id: t.filename,
        durationSec: Math.round(t.durationMs / 1000),
        filename: t.filename,
        format: t.format || 'wav',
        sampleRate: t.sampleRate,
        bitsPerSample: t.bitsPerSample,
        plays:
          counts[t.filename] ??
          counts[t.filename.split('/').pop() || ''] ??
          0,
        artworkUrl: '',
        isDevice: true,
      }));
    }
    const a = this.album();
    if (!a) return [];
    return a.tracks.map(t => ({
      index: t.trackIndex,
      title: t.title,
      id: t.trackId,
      durationSec: t.durationSec,
      filename: '',
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
      if (this.connectionService.connectionStatus() === 'wifi') {
        this.refreshDeviceTracks();
      } else {
        this.deviceTracks.set([]);
      }
    }, { allowSignalWrites: true });
  }

  private async refreshDeviceTracks() {
    const tracks = await this.connectionService.wifi.getDeviceTracks();
    this.deviceTracks.set(tracks);
    // Fetch play counts
    try {
      const analytics = await this.connectionService.wifi.getAnalytics();
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
    if (!confirm(`Delete ${filename} from device storage?`)) return;
    const ok = await this.connectionService.wifi.deleteFile(filename);
    if (ok) {
      await this.refreshDeviceTracks();
    }
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
        const safeName = trackId.replace(/[^a-zA-Z0-9_-]/g, '_');
        await this.connectionService.wifi.uploadFileToPath(
          file, `/art/${safeName}.jpg`
        );
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

    let arrayBuffer: ArrayBuffer;
    try {
      // Phase 1: Read file into memory
      arrayBuffer = await this.readFileWithProgress(file, item.id);
    } catch {
      this.failUpload(item.id, 'Could not read source master file.');
      return;
    }

    this.updateItemStatus(item.id, 'transferring', 0);

    let transferOk = false;
    try {
      transferOk = await this.connectionService.wifi.uploadFileToPath(file, `/tracks/${file.name}`, (percent) => {
        this.uploads.update(items => items.map(u =>
          u.id === item.id ? { ...u, progress: percent } : u
        ));
      });
    } catch {
      transferOk = false;
    }

    // Release the read buffer now that transfer is done or failed.
    const plainBytes = new Uint8Array(arrayBuffer);
    plainBytes.fill(0);

    if (!transferOk) {
      this.failUpload(item.id, 'Transfer to device failed. Nothing stored in portal.');
      return;
    }

    // Phase 4: Finalize successful transfer
    this.uploads.update(items => items.map(u =>
      u.id === item.id ? { ...u, status: 'done' as const, progress: 100 } : u
    ));

    // Add to Album Data only after device transfer succeeds.
    const a = this.album();
    if (a) {
      const title = file.name.replace(/\.[^/.]+$/, '');
      const duration = await this.getAudioDuration(file);
      this.dataService.addTrack(a.albumId, title, duration, `device://${duid}/${file.name}`);
    }

    // Refresh device track list after successful upload
    await this.refreshDeviceTracks();

    setTimeout(() => {
      this.uploads.update(items => items.filter(u => u.id !== item.id));
    }, 2000);
  }

  canTransferToDevice(): boolean {
    return this.connectionService.connectionStatus() === 'wifi'
      && !!this.connectionService.deviceInfo()?.serial
      && this.connectionService.deviceInfo()?.serial !== 'DPA-SIM-1234';
  }

  private failUpload(itemId: string, message: string) {
    this.uploads.update(items => items.map(u =>
      u.id === itemId ? { ...u, status: 'error' as const, progress: 0, error: message } : u
    ));
  }

  private readFileWithProgress(file: File, itemId: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          this.uploads.update(items => items.map(u =>
            u.id === itemId ? { ...u, progress: percent } : u
          ));
        }
      };
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
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
