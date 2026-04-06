

import { Injectable, signal, computed, effect } from '@angular/core';
import { Album, Track, DcnpEvent, Theme, ResaleTransaction, UnitEconomics, MarketplaceListing } from '../types';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private readonly STORAGE_KEY = 'dpa_creator_data';
  private readonly STORAGE_VERSION = 2;

  // Default theme factory
  private getDefaultTheme(): Theme {
    return {
      albumColor: { primary: '#ff4bcb', accent: '#00f1df', background: '#050510' },
      led: {
        idle: { color: '#ff4bcb', pattern: 'breathing' },
        playback: { color: '#00f1df', pattern: 'pulse' },
        charging: { color: '#ffcc33', pattern: 'breathing' }
      },
      dcnp: { concert: '#ff4bcb', video: '#00f1df', merch: '#ffcc33', signing: '#7d29ff', remix: '#ff4500', other: '#ffffff' }
    };
  }

  // Mock Data Generators
  private generateResales(count: number): ResaleTransaction[] {
    const resales: ResaleTransaction[] = [];
    for (let i = 0; i < count; i++) {
      const price = 45 + Math.random() * 80; // Random price between $45 and $125
      const royalty = 0.10; // 10% royalty
      resales.push({
        id: `TX-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        date: new Date(Date.now() - Math.random() * 10000000000).toISOString(),
        deviceId: `0x${Math.random().toString(16).substr(2, 4).toUpperCase()}...${Math.random().toString(16).substr(2, 4).toUpperCase()}`,
        skuType: 'DPA Silver',
        sellerHash: `0x${Math.random().toString(16).substr(2, 4)}...`,
        buyerHash: `0x${Math.random().toString(16).substr(2, 4)}...`,
        priceUsd: price,
        royaltyPercentage: royalty * 100,
        artistEarnings: price * royalty,
        marketRegion: Math.random() > 0.5 ? 'NA-EAST' : (Math.random() > 0.5 ? 'EU-WEST' : 'APAC')
      });
    }
    return resales.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private generateEconomics(): UnitEconomics {
    return {
      totalManufactured: 5000,
      totalSold: 4210,
      manufacturingCost: 12.50,
      wholesalePrice: 35.00,
      grossRevenue: 147350,
      netProfit: 94725,
      secondaryVolume: 12400,
      secondaryRevenue: 1240
    };
  }
  
  private initialMarketplaceListings: MarketplaceListing[] = [];

  // Initial Data — empty starter project, filled in by creator via Metadata tab
  private initialAlbums: Album[] = [
    {
      id: '1',
      albumId: 'ALB-NEW-0001',
      artistId: 'ART-001',
      artistName: '',
      title: 'Untitled Project',
      skuType: 'premium',
      status: 'draft',
      dpacVersion: 0,
      themeJson: this.getDefaultTheme(),
      tracks: [],
      dcnpEvents: [],
      genre: '',
      recordLabel: '',
      copyright: '',
      releaseDate: new Date().toISOString().split('T')[0],
      upcCode: '',
      parentalAdvisory: false,
      description: '',
      lyrics: '',
      booklet: {
        credits: '',
        gallery: [],
        videos: []
      },
      pricing: {
        retailPrice: 0,
        currency: 'USD'
      },
      economics: {
        totalManufactured: 0, totalSold: 0, manufacturingCost: 0, wholesalePrice: 0,
        grossRevenue: 0, netProfit: 0, secondaryVolume: 0, secondaryRevenue: 0
      },
      resales: []
    }
  ];

  // State Signals
  private albumsSignal = signal<Album[]>(this.initialAlbums);
  private marketplaceListingsSignal = signal<MarketplaceListing[]>(this.initialMarketplaceListings);

  public readonly albums = this.albumsSignal.asReadonly();
  public readonly marketplaceListings = this.marketplaceListingsSignal.asReadonly();

  constructor() {
    this.hydrateFromStorage();

    effect(() => {
      if (typeof window === 'undefined') return;
      try {
        const payload = {
          version: this.STORAGE_VERSION,
          albums: this.albumsSignal(),
          marketplaceListings: this.marketplaceListingsSignal(),
        };
        window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn('[DataService] Failed to persist local state', err);
      }
    });
  }

  private hydrateFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      // Clear legacy mock-data key if present
      window.localStorage.removeItem('dpa_mock_data');

      const raw = window.localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        version?: number;
        albums?: Album[];
        marketplaceListings?: MarketplaceListing[];
      };
      if ((parsed.version ?? 0) < this.STORAGE_VERSION) {
        window.localStorage.removeItem(this.STORAGE_KEY);
        return;
      }
      if (Array.isArray(parsed.albums) && parsed.albums.length > 0) {
        this.albumsSignal.set(parsed.albums);
      }
      if (Array.isArray(parsed.marketplaceListings)) {
        this.marketplaceListingsSignal.set(parsed.marketplaceListings);
      }
    } catch (err) {
      console.warn('[DataService] Failed to hydrate local state', err);
    }
  }

  getAlbum(id: string) {
    return computed(() => this.albumsSignal().find(a => a.id === id || a.albumId === id));
  }
  
  getAllCapsules() {
    return computed(() => {
      return this.albumsSignal()
        .flatMap(album =>
          album.dcnpEvents.map(event => ({
            ...event,
            albumTitle: album.title,
            artistName: album.artistName
          }))
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
  }

  createAlbum(title: string) {
    const newAlbum: Album = {
      id: Math.random().toString(36).substr(2, 9),
      albumId: `ALB-${Math.floor(Math.random()*1000)}-2025`,
      artistId: 'ART-001',
      artistName: this.albumsSignal()[0]?.artistName || '',
      title,
      skuType: 'premium',
      status: 'draft',
      dpacVersion: 0,
      themeJson: this.getDefaultTheme(),
      tracks: [],
      dcnpEvents: [],
      booklet: { credits: '', gallery: [], videos: [] }
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

  updateAlbumMetadata(albumId: string, metadata: Partial<Album>) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        return { ...a, ...metadata, status: 'needs-rebuild' };
      }
      return a;
    }));
  }

  addTrack(albumId: string, title: string, durationSec: number, trackIdOverride?: string) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        const newTrack: Track = {
          id: Math.random().toString(36).substr(2, 9),
          albumId,
          trackIndex: a.tracks.length,
          trackId: trackIdOverride || `TRK-${Math.floor(Math.random()*10000)}`,
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
          payload: event.payload!,
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

  // --- Marketplace Methods ---

  listDeviceForSale(listing: MarketplaceListing) {
    this.marketplaceListingsSignal.update(list => [listing, ...list]);
  }

  delistDevice(deviceId: string) {
    this.marketplaceListingsSignal.update(list => list.filter(l => l.deviceId !== deviceId));
  }

  buyDevice(listingId: string) {
    this.marketplaceListingsSignal.update(list => list.filter(l => l.id !== listingId));
  }
}