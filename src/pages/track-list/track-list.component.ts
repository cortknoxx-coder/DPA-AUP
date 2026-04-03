import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { CryptoService } from '../../services/crypto.service';
import { DeviceConnectionService } from '../../services/device-connection.service';

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

  // Simple Add Form State
  newTitle = signal('');
  newDuration = signal(180);

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

    this.updateItemStatus(item.id, 'encrypting', 0);
    let dpaData: ArrayBuffer;
    let dpaFilename = '';
    try {
      // Phase 2: Encrypt to .dpa format for this device only
      dpaData = await this.cryptoService.encryptToDpa(arrayBuffer, duid, 'audio');
      dpaFilename = file.name.replace(/\.[^/.]+$/, '.dpa');
      console.log(
        `[Upload] Encrypted ${file.name} → ${dpaFilename} (${(dpaData.byteLength / (1024 * 1024)).toFixed(2)} MB) for device ${duid}`
      );
    } catch (err) {
      console.error('[Upload] Encryption failed:', err);
      this.failUpload(item.id, 'Encryption to .dpa failed.');
      return;
    } finally {
      // Scrub plain master bytes from memory after encryption attempt.
      const plainBytes = new Uint8Array(arrayBuffer);
      plainBytes.fill(0);
    }

    this.updateItemStatus(item.id, 'transferring', 0);
    const dpaFile = new File([dpaData], dpaFilename, { type: 'application/octet-stream' });

    let transferOk = false;
    try {
      transferOk = await this.connectionService.wifi.uploadDpaFile(dpaFile, (percent) => {
        this.uploads.update(items => items.map(u =>
          u.id === item.id ? { ...u, progress: percent } : u
        ));
      });
    } catch {
      transferOk = false;
    } finally {
      // Scrub encrypted payload bytes after transfer attempt.
      const encBytes = new Uint8Array(dpaData);
      encBytes.fill(0);
    }

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
      this.dataService.addTrack(a.albumId, title, duration, `device://${duid}/${dpaFilename}`);
    }

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
