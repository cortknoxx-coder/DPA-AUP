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
  status: 'uploading' | 'processing' | 'encrypting' | 'transferring' | 'done';
  file?: File;
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
    const newUploads: UploadItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Basic validation for audio
      if (file.type.startsWith('audio/') || file.name.endsWith('.wav') || file.name.endsWith('.flac')) {
        const uploadItem: UploadItem = {
          id: Math.random().toString(36).substr(2, 9),
          filename: file.name,
          size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
          progress: 0,
          status: 'uploading',
          file: file
        };
        newUploads.push(uploadItem);
        this.processUpload(uploadItem, file);
      }
    }

    this.uploads.update(current => [...newUploads, ...current]);
  }

  private async processUpload(item: UploadItem, file: File) {
    const conn = this.connectionService.connectionStatus();
    const duid = this.connectionService.deviceInfo()?.serial;

    // Phase 1: Read file into ArrayBuffer (simulate progress)
    const arrayBuffer = await this.readFileWithProgress(file, item.id);

    // Phase 2: Encrypt to .dpa format if we have a device DUID
    if (duid && duid !== 'DPA-SIM-1234') {
      this.updateItemStatus(item.id, 'encrypting', 0);

      try {
        const dpaData = await this.cryptoService.encryptToDpa(arrayBuffer, duid, 'audio');
        const dpaFilename = file.name.replace(/\.[^/.]+$/, '.dpa');
        const dpaFile = new File([dpaData], dpaFilename, { type: 'application/octet-stream' });

        console.log(`[Upload] Encrypted ${file.name} → ${dpaFilename} (${(dpaData.byteLength / (1024 * 1024)).toFixed(2)} MB) for device ${duid}`);

        // Phase 3: Transfer to device if WiFi connected
        if (conn === 'wifi') {
          this.updateItemStatus(item.id, 'transferring', 0);

          const success = await this.connectionService.wifi.uploadDpaFile(dpaFile, (percent) => {
            this.uploads.update(items => items.map(u =>
              u.id === item.id ? { ...u, progress: percent } : u
            ));
          });

          if (success) {
            console.log(`[Upload] Successfully transferred ${dpaFilename} to device`);
          } else {
            console.warn(`[Upload] Transfer failed for ${dpaFilename}, file saved locally`);
          }
        } else {
          console.log(`[Upload] .dpa file created (device not on WiFi — transfer manually)`);
        }
      } catch (err) {
        console.error('[Upload] Encryption failed:', err);
      }
    } else {
      // No real device — simulate processing
      this.updateItemStatus(item.id, 'processing', 100);
      await new Promise(r => setTimeout(r, 1000));
    }

    // Phase 4: Finalize
    this.uploads.update(items => items.map(u => u.id === item.id ? { ...u, status: 'done' as const, progress: 100 } : u));

    setTimeout(() => {
      this.uploads.update(items => items.filter(u => u.id !== item.id));
    }, 2000);

    // Add to Album Data
    const a = this.album();
    if (a) {
      const title = file.name.replace(/\.[^/.]+$/, '');
      // Try to get real duration from AudioContext, fallback to estimate
      const duration = await this.getAudioDuration(file);
      this.dataService.addTrack(a.albumId, title, duration);
    }
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
