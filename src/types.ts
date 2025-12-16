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

export interface DcnpEvent {
  id: string;
  albumId: string;
  eventType: 'concert' | 'video' | 'merch' | 'signing';
  target: 'album' | 'device';
  targetDeviceIdHex?: string;
  payload: any;
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
}