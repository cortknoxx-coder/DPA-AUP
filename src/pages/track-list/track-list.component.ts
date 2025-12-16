import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';

interface UploadItem {
  id: string;
  filename: string;
  size: string;
  progress: number;
  status: 'uploading' | 'processing' | 'done';
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
          status: 'uploading'
        };
        newUploads.push(uploadItem);
        this.simulateUpload(uploadItem);
      }
    }

    this.uploads.update(current => [...newUploads, ...current]);
  }

  private simulateUpload(item: UploadItem) {
    const speed = 2 + Math.random() * 5; // Random speed
    
    const interval = setInterval(() => {
      this.uploads.update(items => items.map(u => {
        if (u.id === item.id) {
          const newProgress = Math.min(u.progress + speed, 100);
          
          if (newProgress === 100 && u.status === 'uploading') {
            // Trigger processing phase
            setTimeout(() => this.finalizeUpload(u), 1000);
            return { ...u, progress: 100, status: 'processing' };
          }
          
          return { ...u, progress: newProgress };
        }
        return u;
      }));
      
      const currentItem = this.uploads().find(u => u.id === item.id);
      if (currentItem && currentItem.progress >= 100) {
        clearInterval(interval);
      }
    }, 100);
  }

  private finalizeUpload(item: UploadItem) {
    // 1. Mark upload as done (and remove after delay)
    this.uploads.update(items => items.map(u => u.id === item.id ? { ...u, status: 'done' } : u));
    
    setTimeout(() => {
      this.uploads.update(items => items.filter(u => u.id !== item.id));
    }, 2000);

    // 2. Add to Album Data
    const a = this.album();
    if (a) {
      // Strip extension for title
      const title = item.filename.replace(/\.[^/.]+$/, "");
      // Mock duration (random between 2:30 and 4:30)
      const duration = 150 + Math.floor(Math.random() * 120);
      
      this.dataService.addTrack(a.albumId, title, duration);
    }
  }
}
