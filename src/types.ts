
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
  metadata?: {
    venue?: string;
    date?: string;
    discountCode?: string;
    format?: string;
    exclusive?: boolean;
    capacity?: number;
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

export interface MarketplaceListing {
  id: string;
  deviceId: string;
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  sellerHash: string;
  priceUsd: number;
  artworkUrl: string;
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

// --- DPA Hardware & Architecture Types ---

export interface DpaDeviceInfo {
  serial: string;
  model: string;
  firmwareVersion: string;
  capabilities: string[];
  pubkeyB64: string;
}

export interface AupDecision {
  decision: 'ALLOW' | 'DENY' | 'CHALLENGE';
  reasonCode: string;
  message: string;
  policyHash: string;
  retryAfterSec: number;
  requiredAction: 'NONE' | 'REAUTH' | 'UPDATE_APP' | 'UPDATE_FW';
}

export interface DecryptionKeyResponse {
  sessionKeyB64?: string;
  expiresAtIso?: string;
  aup: AupDecision;
}

export interface DeviceRpcRequest {
  id: string;
  method:
    | 'GET_DEVICE_INFO'
    | 'GET_ATTESTATION'
    | 'GET_AUP_HASH'
    | 'LIST_LIBRARY'
    | 'GET_MANIFEST'
    | 'READ_BLOB'
    | 'REQUEST_DECRYPTION_KEY';
  params?: any;
}

export interface DeviceRpcResponse {
  id: string;
  ok: boolean;
  result?: any;
  error?: { code: string; message: string };
}

export interface AlbumRef { 
  id: string; 
  title: string; 
  artworkUrl?: string; 
}

export interface TrackRef { 
  id: string; 
  albumId: string; 
  title: string; 
  durationSec: number; 
  trackNo: number; 
  codec: string; 
}

export interface LibraryIndex {
  albums: AlbumRef[];
  tracks: TrackRef[];
}

export interface Manifest {
  version: 1;
  albumId: string;
  policyHash: string;
  blobs: Array<{ blobId: string; sha256: string; size: number; mime: string; kind: 'audio' | 'art' | 'capsule' }>;
  tracks: Array<{ trackId: string; blobId: string; codec: string; title: string; trackNo: number; durationSec: number }>;
  signatures: {
    manifestSigEd25519B64: string;
    publisherPubkeyEd25519B64: string;
  };
}