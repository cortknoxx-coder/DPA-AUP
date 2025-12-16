import { Injectable, signal, computed } from '@angular/core';
import { Album, Track, DcnpEvent, Theme } from '../types';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private readonly STORAGE_KEY = 'dpa_mock_data';

  // Default theme factory
  private getDefaultTheme(): Theme {
    return {
      albumColor: { primary: '#ff4bcb', accent: '#00f1df', background: '#050510' },
      led: {
        idle: { color: '#ff4bcb', pattern: 'breathing' },
        playback: { color: '#00f1df', pattern: 'pulse' },
        charging: { color: '#ffcc33', pattern: 'breathing' }
      },
      dcnp: { concert: '#ff4bcb', video: '#00f1df', merch: '#ffcc33', signing: '#7d29ff' }
    };
  }

  // Initial Data
  private initialAlbums: Album[] = [
    {
      id: '1',
      albumId: 'ALB-8A8-2025-0001',
      artistId: 'ART-001',
      title: 'Midnight Horizons',
      skuType: 'premium',
      status: 'ready',
      dpacVersion: 4,
      lastBuiltAt: new Date().toISOString(),
      themeJson: this.getDefaultTheme(),
      tracks: [
        { id: 't1', albumId: 'ALB-8A8-2025-0001', trackIndex: 0, trackId: 'TRK-001', title: 'Neon Rain', durationSec: 215 },
        { id: 't2', albumId: 'ALB-8A8-2025-0001', trackIndex: 1, trackId: 'TRK-002', title: 'Cyber Heart', durationSec: 198 },
        { id: 't3', albumId: 'ALB-8A8-2025-0001', trackIndex: 2, trackId: 'TRK-003', title: 'Analog Dreams', durationSec: 245 }
      ],
      dcnpEvents: [
        { 
          id: 'ev1', albumId: 'ALB-8A8-2025-0001', eventType: 'concert', target: 'album', 
          status: 'delivered', createdAt: new Date(Date.now() - 86400000).toISOString(), deliveredAt: new Date().toISOString(),
          payload: { kind: 'concert', data: { title: 'Live at Dome', city: 'Tokyo' } }
        }
      ]
    },
    {
      id: '2',
      albumId: 'ALB-9X9-2025-0042',
      artistId: 'ART-001',
      title: 'Echoes of Silence',
      skuType: 'premium',
      status: 'draft',
      dpacVersion: 0,
      themeJson: this.getDefaultTheme(),
      tracks: [],
      dcnpEvents: []
    }
  ];

  // State Signals
  private albumsSignal = signal<Album[]>(this.initialAlbums);

  public readonly albums = this.albumsSignal.asReadonly();

  constructor() {}

  getAlbum(id: string) {
    return computed(() => this.albumsSignal().find(a => a.id === id || a.albumId === id));
  }

  createAlbum(title: string) {
    const newAlbum: Album = {
      id: Math.random().toString(36).substr(2, 9),
      albumId: `ALB-${Math.floor(Math.random()*1000)}-2025`,
      artistId: 'ART-001',
      title,
      skuType: 'premium',
      status: 'draft',
      dpacVersion: 0,
      themeJson: this.getDefaultTheme(),
      tracks: [],
      dcnpEvents: []
    };
    this.albumsSignal.update(list => [newAlbum, ...list]);
  }

  updateAlbumTheme(albumId: string, theme: Theme) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        return { ...a, themeJson: theme, status: 'needs-rebuild' };
      }
      return a;
    }));
  }

  addTrack(albumId: string, title: string, durationSec: number) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        const newTrack: Track = {
          id: Math.random().toString(36).substr(2, 9),
          albumId,
          trackIndex: a.tracks.length,
          trackId: `TRK-${Math.floor(Math.random()*10000)}`,
          title,
          durationSec
        };
        return { ...a, tracks: [...a.tracks, newTrack], status: 'needs-rebuild' };
      }
      return a;
    }));
  }

  deleteTrack(albumId: string, trackId: string) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        const filtered = a.tracks.filter(t => t.trackId !== trackId);
        // reindex
        const reindexed = filtered.map((t, idx) => ({ ...t, trackIndex: idx }));
        return { ...a, tracks: reindexed, status: 'needs-rebuild' };
      }
      return a;
    }));
  }

  createDcnpEvent(albumId: string, event: Partial<DcnpEvent>) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        const newEvent: DcnpEvent = {
          id: Math.random().toString(36).substr(2, 9),
          albumId,
          eventType: event.eventType!,
          target: event.target || 'album',
          payload: event.payload,
          status: 'pending',
          createdAt: new Date().toISOString(),
          ...event
        };
        return { ...a, dcnpEvents: [newEvent, ...a.dcnpEvents] };
      }
      return a;
    }));
  }

  triggerRebuild(albumId: string) {
    // Simulate build process
    this.albumsSignal.update(list => list.map(a => 
      a.albumId === albumId ? { ...a, status: 'building' } : a
    ));
    
    setTimeout(() => {
      this.albumsSignal.update(list => list.map(a => 
        a.albumId === albumId ? { 
          ...a, 
          status: 'ready', 
          dpacVersion: a.dpacVersion + 1,
          lastBuiltAt: new Date().toISOString()
        } : a
      ));
    }, 3000);
  }
}