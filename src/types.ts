
export interface Track {
  id: string;
  albumId: string;
  trackIndex: number;
  trackId: string;
  title: string;
  durationSec: number;
  isrcCode?: string;
  notes?: string;
}

export interface DpacJob {
  status: 'pending' | 'running' | 'success' | 'failed';
  errorMessage?: string;
}

export interface DcnpPayload {
  title: string;
  description?: string;
  imageUrl?: string; // base64
  price?: number; // Revenue for the artist
  cta?: {
    label: string;
    url?: string;
    action: 'link' | 'download'; // Differentiates web links from device transfers
  };
}

export interface DcnpEvent {
  id: string;
  albumId: string;
  eventType: 'concert' | 'video' | 'merch' | 'signing' | 'remix' | 'other';
  target: 'album' | 'device';
  targetDeviceIdHex?: string;
  payload: DcnpPayload;
  status: 'pending' | 'delivered' | 'cancelled';
  createdAt: string;
  deliveredAt?: string;
}

export interface ThemeColors {
  primary: string;
  accent: string;
  background: string;
}

export interface LedState {
  color: string;
  pattern: 'breathing' | 'solid' | 'pulse' | 'off';
}

export interface Theme {
  albumColor: ThemeColors;
  skinImage?: string; // Base64 Data URL for the device wrap/skin
  led: {
    idle: LedState;
    playback: LedState;
    charging: LedState;
  };
  dcnp: {
    concert: string;
    video: string;
    merch: string;
    signing: string;
  };
}

export interface ResaleTransaction {
  id: string;
  date: string;
  deviceId: string;
  skuType: string;
  sellerHash: string;
  buyerHash: string;
  priceUsd: number;
  royaltyPercentage: number;
  artistEarnings: number;
  marketRegion: string;
}

export interface UnitEconomics {
  totalManufactured: number;
  totalSold: number;
  manufacturingCost: number; // per unit
  wholesalePrice: number; // per unit
  grossRevenue: number;
  netProfit: number;
  secondaryVolume: number; // Total resale volume
  secondaryRevenue: number; // Artist cut from resales
}

export interface PaymentMethod {
  id: string;
  type: 'bank' | 'card';
  name: string; // Bank Name or Card Brand
  last4: string;
  isDefault: boolean;
}

// Analytics Interfaces
export interface RegionStat {
  regionCode: string; // US, UK, JP, etc.
  regionName: string;
  deviceSales: number;
  streamingSessions: number;
  revenue: number;
  percentage: number;
}

export interface TopAsset {
  id: string;
  title: string;
  type: 'album' | 'track';
  totalPlays: number;
  revenue: number;
  trend: number; // percent change
}

export interface BookletVideo {
  id: string;
  title: string;
  url: string; // URL to mp4 or embed
  poster: string; // Thumbnail
}

export interface Album {
  id: string;
  albumId: string;
  artistId: string;
  title: string;
  skuType: 'premium';
  status: 'draft' | 'uploaded' | 'building' | 'ready' | 'needs-rebuild' | 'error';
  dpacVersion: number;
  themeJson: Theme;
  tracks: Track[];
  dcnpEvents: DcnpEvent[];
  lastBuiltAt?: string;
  
  // Distribution Metadata
  artistName?: string;
  genre?: string;
  recordLabel?: string;
  copyright?: string;
  releaseDate?: string;
  upcCode?: string;
  parentalAdvisory?: boolean;
  description?: string;
  lyrics?: string; // Global album lyrics or liner notes
  
  // Digital Booklet Content
  booklet?: {
    credits: string;
    gallery: string[]; // Array of image URLs/Base64
    videos: BookletVideo[];
  };

  // Pricing & Distribution
  pricing?: {
    retailPrice: number;
    manufacturingCost: number;
    currency: string;
  };

  // Analytics
  economics?: UnitEconomics;
  resales?: ResaleTransaction[];
}
