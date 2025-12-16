
import { Injectable, signal, computed } from '@angular/core';

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  coverUrl: string;
}

@Injectable({
  providedIn: 'root'
})
export class PlayerService {
  // State
  isPlaying = signal(false);
  currentTrack = signal<PlayerTrack | null>(null);
  progress = signal(0); // 0 to 100
  currentTime = signal(0);
  volume = signal(0.8);

  // Mock Queue
  queue = signal<PlayerTrack[]>([
    { id: '1', title: 'Neon Rain', artist: '808 Dreams', album: 'Midnight Horizons', duration: 215, coverUrl: 'https://picsum.photos/seed/neon/300/300' },
    { id: '2', title: 'Cyber Heart', artist: '808 Dreams', album: 'Midnight Horizons', duration: 198, coverUrl: 'https://picsum.photos/seed/cyber/300/300' },
    { id: '3', title: 'Analog Dreams', artist: '808 Dreams', album: 'Midnight Horizons', duration: 245, coverUrl: 'https://picsum.photos/seed/analog/300/300' }
  ]);

  private timer: any;

  constructor() {}

  play(track?: PlayerTrack) {
    if (track) {
      this.currentTrack.set(track);
      this.progress.set(0);
      this.currentTime.set(0);
    }
    
    if (!this.currentTrack() && this.queue().length > 0) {
      this.currentTrack.set(this.queue()[0]);
    }

    this.isPlaying.set(true);
    this.startTimer();
  }

  pause() {
    this.isPlaying.set(false);
    this.stopTimer();
  }

  togglePlay() {
    if (this.isPlaying()) {
      this.pause();
    } else {
      this.play();
    }
  }

  next() {
    const current = this.currentTrack();
    const q = this.queue();
    if (current && q.length > 0) {
      const idx = q.findIndex(t => t.id === current.id);
      if (idx > -1 && idx < q.length - 1) {
        this.play(q[idx + 1]);
      } else {
        // Loop to start
        this.play(q[0]);
      }
    }
  }

  prev() {
    const current = this.currentTrack();
    const q = this.queue();
    if (current && q.length > 0) {
      const idx = q.findIndex(t => t.id === current.id);
      if (idx > 0) {
        this.play(q[idx - 1]);
      } else {
        this.currentTime.set(0);
        this.progress.set(0);
      }
    }
  }

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.isPlaying() && this.currentTrack()) {
        const duration = this.currentTrack()!.duration;
        this.currentTime.update(t => {
          if (t >= duration) {
            this.next();
            return 0;
          }
          return t + 1;
        });
        this.progress.set((this.currentTime() / duration) * 100);
      }
    }, 1000);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
  }
}
