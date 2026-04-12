

import { Injectable, signal, computed, effect } from '@angular/core';
import {
  Album,
  Track,
  DcnpEvent,
  Theme,
  ResaleTransaction,
  UnitEconomics,
  MarketplaceListing,
  FanCapsule,
} from '../types';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private readonly STORAGE_KEY = 'dpa_mock_data';
  private readonly STORAGE_VERSION = 1;
  private readonly MOCK_CAPSULE_TITLES = new Set([
    'Surprise Show in Tokyo!',
    'Neon Rain (Starlight Remix Pack)',
    "Limited 'Horizons' Tour Tee",
    "'Cyber Heart' Official Music Video (4K)",
    'Behind the Scenes: Making Midnight Horizons',
  ]);

  // Default theme factory
  private getDefaultTheme(): Theme {
    return {
      albumColor: { primary: '#ff4bcb', accent: '#00f1df', background: '#050510' },
      ledBrightness: 80,
      ledGradEnd: '#ff6600',
      led: {
        idle: { color: '#ff4bcb', pattern: 'breathing' },
        playback: { color: '#00f1df', pattern: 'vu_classic' },
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
  
  private initialMarketplaceListings: MarketplaceListing[] = [
    {
      id: 'LST-1',
      deviceId: 'DPA-MOCK-BEEF',
      albumId: 'ALB-8A8-2025-0001',
      albumTitle: 'Midnight Horizons',
      albumArtist: '808 Dreams',
      sellerHash: '0x1A2b...C4d5',
      priceUsd: 125.00,
      artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
    },
    {
      id: 'LST-2',
      deviceId: 'DPA-MOCK-C0DE',
      albumId: 'ALB-8A8-2025-0001',
      albumTitle: 'Midnight Horizons',
      albumArtist: '808 Dreams',
      sellerHash: '0x9F8E...B6A7',
      priceUsd: 110.50,
      artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
    },
    {
      id: 'LST-3',
      deviceId: 'DPA-MOCK-F00D',
      albumId: 'ALB-8A8-2025-0001',
      albumTitle: 'Midnight Horizons',
      albumArtist: '808 Dreams',
      sellerHash: '0x5D6C...E3B4',
      priceUsd: 140.00,
      artworkUrl: 'https://picsum.photos/seed/ALB-8A8-2025-0001/400/400'
    }
  ];

  // Initial Data
  private initialAlbums: Album[] = [
    {
      id: '1',
      albumId: 'ALB-8A8-2025-0001',
      artistId: 'ART-001',
      artistName: '808 Dreams',
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
          payload: {
            title: 'Surprise Show in Tokyo!',
            description: 'We are playing a last-minute secret show at the Liquid Room in Tokyo next Friday. Verified DPA owners get priority access to tickets for the first 24 hours.',
            imageUrl: 'https://picsum.photos/seed/concert/800/400',
            cta: { label: 'Get Tickets Now', url: '#', action: 'link' }
          }
        },
        {
          id: 'ev2', albumId: 'ALB-8A8-2025-0001', eventType: 'remix', target: 'album',
          status: 'delivered', createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), deliveredAt: new Date(Date.now() - 86400000 * 1.5).toISOString(),
          payload: {
            title: 'Neon Rain (Starlight Remix Pack)',
            description: 'Exclusive remix pack featuring reworks by Starlight, Cygnus, and a fan-voted winner. Stems included.',
            imageUrl: 'https://picsum.photos/seed/remix/800/400',
            price: 5.99,
            cta: { label: 'Buy & Download Stems', action: 'download' }
          }
        },
        {
          id: 'ev3', albumId: 'ALB-8A8-2025-0001', eventType: 'merch', target: 'album',
          status: 'delivered', createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), deliveredAt: new Date(Date.now() - 86400000 * 2.5).toISOString(),
          payload: {
            title: "Limited 'Horizons' Tour Tee",
            description: "A new limited edition tour t-shirt just dropped in our store. Only 500 available, grab yours before they're gone forever. DPA owners get a 15% discount code applied at checkout.",
            imageUrl: 'https://picsum.photos/seed/merch/800/400',
            cta: { label: 'Shop Now', url: '#', action: 'link' }
          }
        },
        {
          id: 'ev4', albumId: 'ALB-8A8-2025-0001', eventType: 'video', target: 'album',
          status: 'delivered', createdAt: new Date(Date.now() - 86400000 * 4).toISOString(), deliveredAt: new Date(Date.now() - 86400000 * 3.5).toISOString(),
          payload: {
            title: "'Cyber Heart' Official Music Video (4K)",
            description: "The official music video for Cyber Heart is here. Experience the visual world of Midnight Horizons. Download the high-bitrate 4K master file directly to your device.",
            imageUrl: 'https://picsum.photos/seed/video/800/400',
            price: 2.99,
            cta: { label: 'Buy & Download Video', action: 'download' }
          }
        },
        {
          id: 'ev5', albumId: 'ALB-8A8-2025-0001', eventType: 'other', target: 'album',
          status: 'delivered', createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), deliveredAt: new Date(Date.now() - 86400000 * 4.5).toISOString(),
          payload: {
            title: 'Behind the Scenes: Making Midnight Horizons',
            description: 'Step into the studio with us. A short documentary on the creative process, late-night sessions, and synth magic that brought the album to life. Free for owners.',
            imageUrl: 'https://picsum.photos/seed/bts/800/400',
            price: 0,
            cta: { label: 'Download Documentary', action: 'download' }
          }
        }
      ],
      genre: 'Synthwave',
      recordLabel: 'Neon City Records',
      copyright: '© 2025 808 Dreams',
      releaseDate: '2025-11-15',
      upcCode: '19029384756',
      parentalAdvisory: false,
      description: 'A sonic journey through the rain-slicked streets of a future metropolis, Midnight Horizons is the defining sound of a new generation of synthwave.',
      lyrics: "## 1. Neon Rain\n\n(Verse 1)\nStreetlights bleed in the pouring rain\nA digital ghost in a memory pane\nReflections dance on the wet terrain\nWhispering your name, a sweet refrain...\n\n(Chorus)\nIn the neon rain, we lose our way\nChasing echoes of yesterday\nA thousand colors in shades of gray\nIn the neon rain, we'll forever stay.\n\n\n## 2. Cyber Heart\n\n(Verse 1)\nA circuit hums where a heartbeat should be\nBinary code for my love for thee\nIn this silicon cage, I long to be free\nWith you in the static, for eternity...\n\n(Chorus)\nMy cyber heart beats in 1s and 0s\nA love encoded where nobody knows\nThrough firewalls, my affection flows\nA digital seed that forever grows.",
      
      // Booklet Data
      booklet: {
        credits: "PRODUCED BY 808 DREAMS\nMIXED BY NEON SKY\nMASTERED AT CYBER STUDIOS TOKYO\n\nART DIRECTION: PIXEL VOYAGER\nPHOTOGRAPHY: LENS FLARE COLLECTIVE\n\nSPECIAL THANKS TO:\nMom, Dad, The Neon City Crew, and every fan who bought a DPA device.",
        gallery: [
          'https://picsum.photos/seed/studio1/800/600',
          'https://picsum.photos/seed/studio2/800/600',
          'https://picsum.photos/seed/studio3/800/600',
          'https://picsum.photos/seed/studio4/800/600'
        ],
        videos: [
          {
            id: 'v1',
            title: 'Studio Diaries: Episode 1',
            url: '/assets/videos/sample-1.mp4',
            poster: 'https://picsum.photos/seed/video1/800/450'
          },
          {
            id: 'v2',
            title: 'Cyber Heart (Live Rehearsal)',
            url: '/assets/videos/sample-2.mp4',
            poster: 'https://picsum.photos/seed/video2/800/450'
          }
        ]
      },
      // FIX: manufacturingCost does not belong in the pricing object.
      // It is correctly defined within the `economics` object via `generateEconomics()`.
      pricing: {
        retailPrice: 79,
        currency: 'USD'
      },
      // Analytics Data
      economics: this.generateEconomics(),
      resales: this.generateResales(45)
    },
    {
      id: '2',
      albumId: 'ALB-9X9-2025-0042',
      artistId: 'ART-001',
      artistName: '808 Dreams',
      title: 'Echoes of Silence',
      skuType: 'premium',
      status: 'draft',
      dpacVersion: 0,
      themeJson: this.getDefaultTheme(),
      tracks: [],
      dcnpEvents: [],
      booklet: {
        credits: '',
        gallery: [],
        videos: []
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
      const albums = this.albumsSignal();
      const marketplaceListings = this.marketplaceListingsSignal();
      try {
        const payload = {
          version: this.STORAGE_VERSION,
          albums,
          marketplaceListings,
        };
        window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
      } catch (err: any) {
        // localStorage has a ~5MB quota. Data URLs (cover art, booklet images)
        // blow it out instantly. Retry with heavy blobs stripped so the rest
        // of the metadata still persists across reloads.
        if (err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '')) {
          try {
            const lite = {
              version: this.STORAGE_VERSION,
              albums: albums.map((a: any) => this.stripHeavyFields(a)),
              marketplaceListings,
            };
            window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(lite));
            console.warn('[DataService] Persisted lite state (heavy image blobs dropped from localStorage; live in-memory + on-device).');
          } catch (err2) {
            console.warn('[DataService] Lite persist also failed:', err2);
          }
        } else {
          console.warn('[DataService] Failed to persist local state', err);
        }
      }
    });
  }

  /** Strip data URLs > 64KB so localStorage doesn't overflow. Runtime state still has them. */
  private stripHeavyFields(album: any): any {
    const HEAVY = (v: any) => typeof v === 'string' && v.startsWith('data:') && v.length > 64 * 1024;
    const clone: any = { ...album };
    // Cover art / image fields used throughout the codebase
    if (HEAVY(clone.artworkUrl)) clone.artworkUrl = '';
    if (HEAVY(clone.artwork))    clone.artwork = '';
    if (HEAVY(clone.coverArt))   clone.coverArt = '';
    if (HEAVY(clone.imageUrl))   clone.imageUrl = '';
    if (Array.isArray(clone.galleryImages)) {
      clone.galleryImages = clone.galleryImages.map((img: any) =>
        typeof img === 'string' ? (HEAVY(img) ? '' : img)
        : (img && HEAVY(img.url) ? { ...img, url: '' } : img)
      );
    }
    if (Array.isArray(clone.tracks)) {
      clone.tracks = clone.tracks.map((t: any) => {
        const tc = { ...t };
        if (HEAVY(tc.artworkUrl)) tc.artworkUrl = '';
        if (HEAVY(tc.artwork))    tc.artwork = '';
        if (HEAVY(tc.coverArt))   tc.coverArt = '';
        return tc;
      });
    }
    return clone;
  }

  private hydrateFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        version?: number;
        albums?: Album[];
        marketplaceListings?: MarketplaceListing[];
      };
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
    return computed<FanCapsule[]>(() => {
      return this.albumsSignal()
        .flatMap(album =>
          album.dcnpEvents.map(event => ({
            ...event,
            albumTitle: album.title,
            artistName: album.artistName,
            source: 'portal' as const,
          }))
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
  }

  private isMockDcnpEvent(event: DcnpEvent): boolean {
    return this.MOCK_CAPSULE_TITLES.has(event.payload?.title || '');
  }

  createAlbum(title: string) {
    const newAlbum: Album = {
      id: Math.random().toString(36).substr(2, 9),
      albumId: `ALB-${Math.floor(Math.random()*1000)}-2025`,
      artistId: 'ART-001',
      artistName: '808 Dreams',
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

  /** Persist theme without marking album as needs-rebuild (e.g. pull from device sync). */
  updateAlbumThemeQuiet(albumId: string, theme: Theme) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        return { ...a, themeJson: theme };
      }
      return a;
    }));
  }

  /** Sync device-sourced data into album without marking as needs-rebuild. */
  syncAlbumFromDevice(albumId: string, data: {
    artistName?: string;
    title?: string;
    tracks?: { title: string; durationSec: number; filename: string }[];
    artworkUrl?: string;
    description?: string;
    lyrics?: string;
    booklet?: Album['booklet'];
    genre?: string;
    recordLabel?: string;
    copyright?: string;
    releaseDate?: string;
    upcCode?: string;
    parentalAdvisory?: boolean;
  }) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId || a.id === albumId) {
        const updated: any = { ...a };

        // Clear stale mock data when device identity differs OR when fields
        // still contain known mock content from initialAlbums (handles the case
        // where a previous partial sync updated artist but left booklet intact).
        const identityChanged =
          (data.artistName && data.artistName !== a.artistName) ||
          (data.title && data.title !== a.title);
        const hasMockContent =
          (a.description || '').includes('sonic journey') ||
          (a.booklet?.credits || '').includes('808 DREAMS') ||
          (a.lyrics || '').includes('Neon Rain') ||
          a.artistName === '808 Dreams' ||
          a.title === 'Midnight Horizons';

        if (identityChanged || hasMockContent) {
          updated.description = '';
          updated.lyrics = '';
          updated.booklet = { credits: '', gallery: [], videos: [] };
          updated.dcnpEvents = (a.dcnpEvents || []).filter(ev => !this.isMockDcnpEvent(ev));
          updated.genre = '';
          updated.recordLabel = '';
          updated.copyright = '';
          updated.releaseDate = '';
          updated.upcCode = '';
          updated.parentalAdvisory = false;
        }
        if (data.artistName) updated.artistName = data.artistName;
        if (data.title) updated.title = data.title;
        if (data.artworkUrl) updated.artworkUrl = data.artworkUrl;
        if (data.description !== undefined) updated.description = data.description;
        if (data.lyrics !== undefined) updated.lyrics = data.lyrics;
        if (data.booklet !== undefined) updated.booklet = data.booklet;
        if (data.genre !== undefined) updated.genre = data.genre;
        if (data.recordLabel !== undefined) updated.recordLabel = data.recordLabel;
        if (data.copyright !== undefined) updated.copyright = data.copyright;
        if (data.releaseDate !== undefined) updated.releaseDate = data.releaseDate;
        if (data.upcCode !== undefined) updated.upcCode = data.upcCode;
        if (data.parentalAdvisory !== undefined) updated.parentalAdvisory = data.parentalAdvisory;
        if (data.tracks) {
          updated.tracks = data.tracks.map((t, i) => ({
            id: `dev-${i}`,
            albumId: a.albumId,
            trackIndex: i,
            trackId: `device://${t.filename}`,
            title: t.title,
            durationSec: t.durationSec,
          }));
        }
        return updated;
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

  updateAlbumArtwork(albumId: string, artworkUrl: string) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        return { ...a, artworkUrl };
      }
      return a;
    }));
  }

  updateTrackArtwork(albumId: string, trackId: string, artworkUrl: string) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId === albumId) {
        return {
          ...a,
          tracks: a.tracks.map(t =>
            t.trackId === trackId ? { ...t, artworkUrl } : t
          ),
        };
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
          id: event.id || Math.random().toString(36).substr(2, 9),
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

  markDcnpEventDelivered(albumId: string, eventId: string) {
    this.albumsSignal.update(list => list.map(a => {
      if (a.albumId !== albumId) return a;
      return {
        ...a,
        dcnpEvents: a.dcnpEvents.map(ev =>
          ev.id === eventId
            ? { ...ev, status: 'delivered' as const, deliveredAt: new Date().toISOString() }
            : ev
        ),
      };
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

  patchAlbum(albumId: string, patch: Partial<Album>) {
    this.albumsSignal.update(list => list.map(a =>
      a.albumId === albumId ? { ...a, ...patch } : a
    ));
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