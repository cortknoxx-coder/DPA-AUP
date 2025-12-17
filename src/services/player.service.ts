
import { Injectable, signal, computed, inject } from '@angular/core';
import { DeviceConnectionService } from './device-connection.service';
import { DeviceBridgeService } from './device-bridge.service';
import { CryptoService } from './crypto.service';

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
  private deviceService = inject(DeviceConnectionService);
  private bridge = inject(DeviceBridgeService);
  private crypto = inject(CryptoService);

  // State
  isPlaying = signal(false);
  currentTrack = signal<PlayerTrack | null>(null);
  progress = signal(0); // 0 to 100
  currentTime = signal(0);
  volume = signal(0.8);
  
  // Playback Context
  sessionKey = signal<string | null>(null);

  // Mock Queue
  queue = signal<PlayerTrack[]>([
    { id: '1', title: 'Neon Rain', artist: '808 Dreams', album: 'Midnight Horizons', duration: 215, coverUrl: 'https://picsum.photos/seed/neon/300/300' },
    { id: '2', title: 'Cyber Heart', artist: '808 Dreams', album: 'Midnight Horizons', duration: 198, coverUrl: 'https://picsum.photos/seed/cyber/300/300' },
    { id: '3', title: 'Analog Dreams', artist: '808 Dreams', album: 'Midnight Horizons', duration: 245, coverUrl: 'https://picsum.photos/seed/analog/300/300' }
  ]);

  private timer: any;
  private readonly SNIPPET_LIMIT = 30; // seconds

  // Computed Duration that respects snippet mode
  effectiveDuration = computed(() => {
    const track = this.currentTrack();
    if (!track) return 0;
    return this.deviceService.isSnippetMode() ? Math.min(track.duration, this.SNIPPET_LIMIT) : track.duration;
  });

  constructor() {}

  async play(track?: PlayerTrack) {
    // 1. Set Track Info
    if (track) {
      this.currentTrack.set(track);
      this.progress.set(0);
      this.currentTime.set(0);
    }
    
    if (!this.currentTrack() && this.queue().length > 0) {
      this.currentTrack.set(this.queue()[0]);
    }
    
    const current = this.currentTrack();
    if (!current) return;

    // 2. AUP Check & Decryption Request (Real Hardware Path)
    if (!this.deviceService.isSimulationMode() && this.bridge.isConnected()) {
        try {
            console.log(`[Player] Requesting Key for ${current.id}...`);
            const response = await this.bridge.requestDecryptionKey(current.id);
            
            // Check AUP Decision
            if (response.aup.decision === 'DENY') {
                alert(`Playback Denied by Device AUP: ${response.aup.message} (${response.aup.reasonCode})`);
                this.pause();
                return;
            } else if (response.aup.decision === 'CHALLENGE') {
                alert(`Security Challenge: ${response.aup.message}`);
                this.pause();
                return;
            }

            if (response.sessionKeyB64) {
                this.sessionKey.set(response.sessionKeyB64);
                console.log('[Player] Session Key Acquired. Starting Stream.');
                // In a real implementation, we would now fetch readBlob() chunks and 
                // pipe them through this.crypto.aesGcmDecrypt() to an AudioContext.
            }
        } catch (e) {
            console.error('Key Request Failed', e);
            alert('Device Communication Error. Check Bridge.');
            return;
        }
    }

    // 3. Start Timer (Simulated Playback for UI)
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
        const duration = this.effectiveDuration();
        
        // Check playback limits
        if (this.currentTime() >= duration) {
            if (this.deviceService.isSnippetMode()) {
                this.pause();
                this.currentTime.set(0);
                alert('Snippet Mode: Track finished (limited to 30s). Register device to unlock full playback.');
            } else {
                this.next();
            }
            return;
        }

        this.currentTime.update(t => t + 1);
        this.progress.set((this.currentTime() / duration) * 100);
      }
    }, 1000);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
  }
}
