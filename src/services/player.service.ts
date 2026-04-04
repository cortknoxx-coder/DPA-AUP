
import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { DeviceConnectionService } from './device-connection.service';
import { DeviceBridgeService } from './device-bridge.service';
import { CryptoService } from './crypto.service';
import { BLE_CMD } from './device-ble.service';
import { Manifest, TrackRef } from '../types';

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  coverUrl: string;
  blobId: string;
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
  volume = signal(75); // 0-100 (matches firmware scale)

  // Playback Context
  sessionKey = signal<string | null>(null);
  queue = signal<PlayerTrack[]>([]);

  private timer: any;
  private readonly SNIPPET_LIMIT = 30; // seconds

  effectiveDuration = computed(() => {
    const track = this.currentTrack();
    if (!track) return 0;
    return this.deviceService.isSnippetMode() ? Math.min(track.duration, this.SNIPPET_LIMIT) : track.duration;
  });

  constructor() {
    // Sync player state from BLE status notifications
    effect(() => {
      const status = this.deviceService.ble.lastStatus();
      if (!status || this.deviceService.connectionStatus() !== 'bluetooth') return;

      this.isPlaying.set(status.player.playing);
      this.currentTime.set(Math.floor(status.player.posMs / 1000));
      if (status.audio?.volume !== undefined) {
        this.volume.set(status.audio.volume);
      }
      const duration = this.effectiveDuration();
      if (duration > 0) {
        this.progress.set((this.currentTime() / duration) * 100);
      }
    });

    // Sync player state from WiFi status
    effect(() => {
      const status = this.deviceService.wifi.lastStatus();
      if (!status || this.deviceService.connectionStatus() !== 'wifi') return;

      this.isPlaying.set(status.player.playing);
      this.currentTime.set(Math.floor(status.player.posMs / 1000));
      if (status.audio?.volume !== undefined) {
        this.volume.set(status.audio.volume);
      }
      const duration = this.effectiveDuration();
      if (duration > 0) {
        this.progress.set((this.currentTime() / duration) * 100);
      }
    });
  }

  setQueueFromManifest(manifest: Manifest, albumInfo: { artist: string, title: string }) {
    const newQueue = manifest.tracks.map(t => ({
      id: t.trackId,
      title: t.title,
      artist: albumInfo.artist,
      album: albumInfo.title,
      duration: t.durationSec,
      coverUrl: '/assets/dpa-default-cover.png',
      blobId: t.blobId
    }));
    this.queue.set(newQueue);
  }

  async play(track?: PlayerTrack) {
    if (this.deviceService.isSimulationMode()) {
      this.playSimulated(track);
      return;
    }

    // Route through device transport
    const conn = this.deviceService.connectionStatus();
    if (conn === 'bluetooth') {
      if (track) {
        this.currentTrack.set(track);
        this.progress.set(0);
        this.currentTime.set(0);
      }
      await this.deviceService.ble.sendCommand(BLE_CMD.PLAY);
      this.isPlaying.set(true);
      return;
    }

    if (conn === 'wifi') {
      if (track) {
        this.currentTrack.set(track);
        this.progress.set(0);
        this.currentTime.set(0);
        // Prefer indexed track selection for direct firmware WiFi playback.
        const idx = this.queue().findIndex(t => t.id === track.id);
        if (idx >= 0) {
          await this.deviceService.wifi.selectTrack(idx);
          this.isPlaying.set(true);
          this.startTimer();
          return;
        }
      }
      await this.deviceService.wifi.sendCommand(BLE_CMD.PLAY);
      this.isPlaying.set(true);
      this.startTimer();
      return;
    }

    // USB Bridge flow
    if (track) {
      this.currentTrack.set(track);
      this.progress.set(0);
      this.currentTime.set(0);
    }

    const current = this.currentTrack();
    if (!current) return;

    try {
      console.log(`[Player] Requesting Key for trackId: ${current.id}...`);
      const response = await this.bridge.requestDecryptionKey(current.id);

      if (response.aup.decision !== 'ALLOW') {
        alert(`Playback Denied by Device AUP: ${response.aup.message} (${response.aup.reasonCode})`);
        this.pause();
        return;
      }

      if (response.sessionKeyB64) {
        this.sessionKey.set(response.sessionKeyB64);
        console.log('[Player] Session Key Acquired. Starting Stream Simulation.');
        await this.simulateBlobStream(current.blobId, response.sessionKeyB64);
      } else {
        throw new Error('AUP allowed but no session key was returned.');
      }

      this.isPlaying.set(true);
      this.startTimer();

    } catch (e: any) {
        console.error('Key Request or Playback Flow Failed', e);
        alert(`Device Communication Error: ${e.message}`);
        this.pause();
    }
  }

  private async simulateBlobStream(blobId: string, sessionKey: string) {
    console.log(`[Player] Fetching encrypted blob: ${blobId}...`);
    const blobChunk = await this.bridge.readBlob(blobId, 0, 1024);
    console.log(`[Player] Received ${blobChunk.dataB64.length} base64 chars.`);

    console.log('[Player] Decrypting blob chunk in-browser...');
    const decrypted = await this.crypto.aesGcmDecrypt(blobChunk.dataB64, sessionKey);
    console.log(`[Player] SUCCESS: Decrypted ${decrypted.byteLength} bytes. Ready for AudioContext.`);
  }

  private playSimulated(track?: PlayerTrack) {
    if (track) this.currentTrack.set(track);
    if (!this.currentTrack() && this.queue().length > 0) this.currentTrack.set(this.queue()[0]);
    if (!this.currentTrack()) return;

    this.isPlaying.set(true);
    this.startTimer();
  }

  pause() {
    const conn = this.deviceService.connectionStatus();
    if (conn === 'bluetooth') {
      this.deviceService.ble.sendCommand(BLE_CMD.PAUSE);
    } else if (conn === 'wifi') {
      this.deviceService.wifi.sendCommand(BLE_CMD.PAUSE);
    }

    this.isPlaying.set(false);
    this.stopTimer();
  }

  stop() {
    const conn = this.deviceService.connectionStatus();
    if (conn === 'wifi') {
      this.deviceService.wifi.sendCommand(0x05);
    }

    this.isPlaying.set(false);
    this.stopTimer();
    this.currentTrack.set(null);
    this.progress.set(0);
    this.currentTime.set(0);
    this.sessionKey.set(null);
  }

  togglePlay() {
    if (this.isPlaying()) this.pause();
    else this.play(this.currentTrack()!);
  }

  next() {
    const conn = this.deviceService.connectionStatus();
    if (conn === 'bluetooth') {
      this.deviceService.ble.sendCommand(BLE_CMD.NEXT);
    } else if (conn === 'wifi') {
      this.deviceService.wifi.sendCommand(BLE_CMD.NEXT);
    }

    const current = this.currentTrack();
    const q = this.queue();
    if (current && q.length > 0) {
      const idx = q.findIndex(t => t.id === current.id);
      if (idx > -1 && idx < q.length - 1) this.play(q[idx + 1]);
      else this.play(q[0]);
    }
  }

  prev() {
    const conn = this.deviceService.connectionStatus();
    if (conn === 'bluetooth') {
      this.deviceService.ble.sendCommand(BLE_CMD.PREV);
    } else if (conn === 'wifi') {
      this.deviceService.wifi.sendCommand(BLE_CMD.PREV);
    }

    const current = this.currentTrack();
    const q = this.queue();
    if (current && q.length > 0) {
      const idx = q.findIndex(t => t.id === current.id);
      if (idx > 0) this.play(q[idx - 1]);
      else {
        this.currentTime.set(0);
        this.progress.set(0);
      }
    }
  }

  async volumeUp() {
    const newVol = Math.min(100, this.volume() + 5);
    this.volume.set(newVol);
    const conn = this.deviceService.connectionStatus();
    if (conn === 'wifi') {
      await this.deviceService.wifi.setVolume(newVol);
    } else if (conn === 'bluetooth') {
      await this.deviceService.ble.sendCommand(BLE_CMD.VOLUME_UP);
    }
  }

  async volumeDown() {
    const newVol = Math.max(0, this.volume() - 5);
    this.volume.set(newVol);
    const conn = this.deviceService.connectionStatus();
    if (conn === 'wifi') {
      await this.deviceService.wifi.setVolume(newVol);
    } else if (conn === 'bluetooth') {
      await this.deviceService.ble.sendCommand(BLE_CMD.VOLUME_DOWN);
    }
  }

  async setVolume(vol: number) {
    this.volume.set(vol);
    const conn = this.deviceService.connectionStatus();
    if (conn === 'wifi') {
      await this.deviceService.wifi.setVolume(vol);
    }
  }

  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.isPlaying() && this.currentTrack()) {
        const duration = this.effectiveDuration();
        if (this.currentTime() >= duration) {
            if (this.deviceService.isSnippetMode()) {
                this.pause();
                alert('Snippet Mode: Track finished. Register device to unlock full playback.');
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
