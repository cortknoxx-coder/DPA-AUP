
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

// All LED patterns supported by firmware (led.h)
export type LedBasePattern =
  | 'off' | 'solid' | 'breathing' | 'pulse'
  | 'comet' | 'rainbow' | 'fire' | 'sparkle'
  | 'wave' | 'dual_comet' | 'meteor' | 'theater' | 'bounce';

export type LedAudioPattern =
  | 'audio_pulse' | 'audio_bass' | 'audio_beat' | 'audio_comet'
  | 'audio_vu' | 'vu_classic' | 'vu_fill' | 'vu_peak'
  | 'vu_split' | 'vu_bass' | 'vu_energy';

export type LedNotifyPattern =
  | 'chase_fwd' | 'chase_rev' | 'heartbeat' | 'fade_out';

export type LedPattern = LedBasePattern | LedAudioPattern | LedNotifyPattern;

export interface LedState {
  color: string;
  pattern: LedPattern;
}

export interface Theme {
  albumColor: ThemeColors;
  skinImage?: string; // Base64 Data URL for the device wrap/skin
  skinType?: 'partial' | 'full';
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
    remix: string;
    other: string;
  };
}

// --- DCNP Notification Types ---

export type DcnpEventType = 'concert' | 'video' | 'merch' | 'signing' | 'remix' | 'other';

export interface LedNotificationStep {
  pattern: LedNotifyPattern | 'pulse' | 'breathing' | 'solid' | 'off';
  durationMs: number;
  repeatCount: number;
  bpm?: number;
}

// --- Firmware Communication Types ---

export type PlaybackMode = 'normal' | 'repeat_all' | 'repeat_one' | 'shuffle';
export type EqPreset = 'flat' | 'bass' | 'vocal' | 'warm';
export type A2dpState = 'disconnected' | 'connecting' | 'connected' | 'playing';

export interface BatteryStatus {
  voltage: number;
  percent: number;
  charging: boolean;
}

export interface AudioStatus {
  volume: number;
  eq: EqPreset;
  mode: PlaybackMode;
  a2dp: A2dpState;
  a2dpDevice: string;
}

export interface StorageStatus {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  trackCount: number;
  capsuleCount: number;
  videoCount: number;
}

export interface DeviceTrack {
  index: number;
  filename: string;
  title: string;
  sizeMB: number;
  plays: number;
  durationMs: number;
}

export interface A2dpDevice {
  name: string;
  addr: string;
  rssi: number;
}

export interface FirmwareStatus {
  name: string;
  ver: string;
  env: string;
  duid: string;
  ble: boolean;
  wifi: boolean;
  ip: string;
  sta?: {
    connected: boolean;
    ssid: string;
    ip: string;
    rssi: number;
  };
  uptime_s: number;
  battery: BatteryStatus;
  audio: AudioStatus;
  storage: StorageStatus;
  espnow: {
    active: boolean;
    peers: number;
    peerList: Array<{ duid: string; age: number }>;
  };
  player: {
    trackIndex: number;
    trackId: string;
    trackTitle: string;
    playing: boolean;
    posMs: number;
    durationMs: number;
  };
  counts: {
    play: number;
    pause: number;
    next: number;
    prev: number;
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

// FIX: Moved UserProfile here from user.service.ts to make it a shared type.
export interface UserProfile {
  name: string;
  artistName: string;
  email: string;
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

// --- .dpa Encrypted Container Format ---

export interface DpaFileHeader {
  magic: 'DPA\x01';
  version: number;
  flags: number; // bit0=FLAC, bit1=video, bit2=capsule
  duidHash: string; // SHA-256 hex of DUID + master key
  ivHex: string; // 12-byte nonce as hex
}

export interface DpaEncryptionConfig {
  masterKey: string; // Compiled constant
  duid: string; // Target device DUID
  contentType: 'audio' | 'video' | 'capsule';
}

// --- WiFi Network Types ---

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  encryption: string;
  channel: number;
}

export interface WifiConnectionStatus {
  connected: boolean;
  ssid: string;
  ip: string;
  rssi: number;
}