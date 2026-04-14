
import { Injectable, signal } from '@angular/core';
import { dpaInternalApiBaseUrl } from '../dpa-internal-api-base';

export interface ActivityEvent {
  id: string;
  type: 'play' | 'skip' | 'heart' | 'listen_ms' | string;
  message: string;
  deviceId: string;
  trackTitle: string;
  timestamp: Date;
}

export interface FleetDevice {
  deviceId: string;
  label: string;
  firmwareVersion: string;
  lastSeenAt: string;
  reachability: 'online' | 'stale' | 'offline';
  albumId: string;
  plays?: number;
  hearts?: number;
}

export interface TopTrack {
  path: string;
  title: string;
  plays: number;
}

export interface FleetKpis {
  totalDevices: number;
  onlineDevices: number;
  totalPlays: number;
  totalHearts: number;
  totalListenMs: number;
  totalSkips: number;
}

export interface DeviceAnalytics {
  deviceId: string;
  counts: Record<string, { count: number; totalValue: number }>;
  topTracks: TopTrack[];
  heartedTracks: { path: string; title: string; heartedAt: string }[];
  timeline: { hour: string; type: string; count: number }[];
}

@Injectable({ providedIn: 'root' })
export class FleetService {
  kpis = signal<FleetKpis>({ totalDevices: 0, onlineDevices: 0, totalPlays: 0, totalHearts: 0, totalListenMs: 0, totalSkips: 0 });
  fleetDevices = signal<FleetDevice[]>([]);
  topTracks = signal<TopTrack[]>([]);
  activityFeed = signal<ActivityEvent[]>([]);
  loading = signal(false);
  error = signal('');

  private feedPollTimer: ReturnType<typeof setInterval> | null = null;

  private apiBase(): string | null {
    return dpaInternalApiBaseUrl();
  }

  async refreshAll(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await Promise.all([this.fetchAnalytics(), this.fetchFleetStatus()]);
    } catch (e: any) {
      this.error.set(e?.message || 'Failed to load fleet data');
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchAnalytics(): Promise<void> {
    const base = this.apiBase();
    if (!base) return;
    try {
      const res = await fetch(`${base}/fleet/analytics`, { credentials: 'include' });
      if (!res.ok) throw new Error(`fleet/analytics ${res.status}`);
      const data = await res.json();
      const a = data.analytics || {};
      this.kpis.set({
        totalDevices: a.totalDevices || 0,
        onlineDevices: 0,
        totalPlays: a.totalPlays || 0,
        totalHearts: a.totalHearts || 0,
        totalListenMs: Number(a.totalListenMs || 0),
        totalSkips: a.totalSkips || 0,
      });
      this.topTracks.set(Array.isArray(a.topTracks) ? a.topTracks : []);
      const events: ActivityEvent[] = (a.recentEvents || []).map((e: any) => ({
        id: e.id,
        type: e.type,
        message: this.describeEvent(e.type, e.trackTitle),
        deviceId: e.deviceId || '',
        trackTitle: e.trackTitle || '',
        timestamp: new Date(e.at),
      }));
      this.activityFeed.set(events);
    } catch {
      // leave current state
    }
  }

  private async fetchFleetStatus(): Promise<void> {
    const base = this.apiBase();
    if (!base) return;
    try {
      const res = await fetch(`${base}/fleet/status`, { credentials: 'include' });
      if (!res.ok) throw new Error(`fleet/status ${res.status}`);
      const data = await res.json();
      const fleet: FleetDevice[] = (data.fleet || []).map((d: any) => ({
        deviceId: d.deviceId,
        label: d.label || d.deviceId,
        firmwareVersion: d.firmwareVersion || '',
        lastSeenAt: d.lastSeenAt || '',
        reachability: d.reachability || 'offline',
        albumId: d.albumId || '',
      }));
      this.fleetDevices.set(fleet);
      const online = data.online || fleet.filter((d: FleetDevice) => d.reachability === 'online').length;
      this.kpis.update(k => ({ ...k, onlineDevices: online, totalDevices: Math.max(k.totalDevices, data.total || fleet.length) }));
    } catch {
      // leave current state
    }
  }

  async getDeviceAnalytics(duid: string): Promise<DeviceAnalytics | null> {
    const base = this.apiBase();
    if (!base) return null;
    try {
      const res = await fetch(`${base}/analytics/device/${encodeURIComponent(duid)}`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  startActivityPolling(): void {
    this.stopActivityPolling();
    this.feedPollTimer = setInterval(() => void this.fetchAnalytics(), 10000);
  }

  stopActivityPolling(): void {
    if (this.feedPollTimer) {
      clearInterval(this.feedPollTimer);
      this.feedPollTimer = null;
    }
  }

  private describeEvent(type: string, trackTitle: string): string {
    const track = trackTitle || 'Unknown Track';
    switch (type) {
      case 'play': return `'${track}' played`;
      case 'skip': return `'${track}' skipped`;
      case 'heart': return `'${track}' hearted`;
      case 'listen_ms': return `Listening to '${track}'`;
      default: return `${type} event`;
    }
  }
}
