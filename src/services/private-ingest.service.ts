import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { InternalOperatorAuthService } from './internal-operator-auth.service';

export type PrivateIngestStatus = 'staged' | 'verified' | 'archived';

export interface PrivateIngestItem {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  status: PrivateIngestStatus;
  source: 'device-drop';
  deviceId: string;
  albumId: string;
  createdAt: string;
  updatedAt: string;
}

interface PrivateIngestRecord extends PrivateIngestItem {
  storedFilename?: string;
}

export interface PrivateDeviceRegistration {
  id: string;
  deviceId: string;
  label: string;
  albumId: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface PrivateUploadSession {
  id: string;
  deviceId: string;
  albumId: string;
  source: 'operator' | 'device';
  filename: string;
  mimeType: string;
  contentKind: string;
  status: string;
  fileId: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt: string;
}

export interface PrivateIngestSummary {
  albumId: string | null;
  deviceId: string | null;
  totalFiles: number;
  verifiedFiles: number;
  stagedFiles: number;
  archivedFiles: number;
  activeSessions: number;
  lastUploadedAt: string | null;
  lastUploadStatus: string | null;
  lastDeviceId: string | null;
  lastAlbumId: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class PrivateIngestService {
  private auth = inject(InternalOperatorAuthService);

  private itemsSignal = signal<PrivateIngestItem[]>([]);
  private devicesSignal = signal<PrivateDeviceRegistration[]>([]);
  private sessionsSignal = signal<PrivateUploadSession[]>([]);
  private summarySignal = signal<PrivateIngestSummary | null>(null);
  private stateSignal = signal<'loading' | 'ready' | 'unauthorized' | 'error'>('loading');

  items = computed(() => this.itemsSignal());
  devices = computed(() => this.devicesSignal());
  sessions = computed(() => this.sessionsSignal());
  summary = computed(() => this.summarySignal());
  state = computed(() => this.stateSignal());
  stagedCount = computed(() => this.items().filter((item) => item.status === 'staged').length);
  verifiedCount = computed(() => this.items().filter((item) => item.status === 'verified').length);
  archivedCount = computed(() => this.items().filter((item) => item.status === 'archived').length);
  totalBytes = computed(() => this.items().reduce((sum, item) => sum + item.sizeBytes, 0));

  constructor() {
    effect(() => {
      const authState = this.auth.state();
      if (authState === 'authenticated') {
        void this.reload();
      } else if (authState === 'anonymous') {
        this.itemsSignal.set([]);
        this.devicesSignal.set([]);
        this.sessionsSignal.set([]);
        this.summarySignal.set(null);
        this.stateSignal.set('unauthorized');
      }
    }, { allowSignalWrites: true });
  }

  async stageFiles(
    files: File[],
    context: { deviceId?: string; albumId?: string } = {}
  ): Promise<{ count: number; totalBytes: number }> {
    if (files.length === 0) {
      return { count: 0, totalBytes: 0 };
    }
    let uploaded = 0;
    let totalBytes = 0;
    for (const file of files) {
      const sessionResponse = await this.fetchJson<{
        ok: boolean;
        session: PrivateUploadSession;
        uploadToken: string;
      }>('/ingest/sessions', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: context.deviceId?.trim() || 'UNASSIGNED',
          albumId: context.albumId?.trim() || 'UNASSIGNED',
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          source: 'operator',
          contentKind: this.inferContentKind(file.name),
        }),
      });

      if (!sessionResponse?.ok) {
        throw new Error('Failed to create private ingest upload session.');
      }

      const uploadResponse = await fetch(
        `${this.auth.apiBase}/ingest/upload/${sessionResponse.session.id}?filename=${encodeURIComponent(file.name)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-DPA-Upload-Token': sessionResponse.uploadToken,
          },
          body: file,
        }
      );
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed for ${file.name}.`);
      }

      const completeResponse = await this.fetchJson<{ ok: boolean }>(
        `/ingest/complete/${sessionResponse.session.id}`,
        {
          method: 'POST',
          headers: {
            'X-DPA-Upload-Token': sessionResponse.uploadToken,
          },
        }
      );
      if (!completeResponse?.ok) {
        throw new Error(`Verification failed for ${file.name}.`);
      }

      uploaded += 1;
      totalBytes += file.size;
    }

    await this.reload();

    return {
      count: uploaded,
      totalBytes,
    };
  }

  async markStatus(id: string, status: PrivateIngestStatus): Promise<void> {
    await this.fetchJson(`/ingest/files/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    await this.reload();
  }

  async remove(id: string): Promise<void> {
    await fetch(`${this.auth.apiBase}/ingest/files/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await this.reload();
  }

  async getBlob(id: string): Promise<Blob | null> {
    try {
      const response = await fetch(`${this.auth.apiBase}/ingest/download/${id}`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  async registerDevice(payload: {
    deviceId: string;
    albumId?: string;
    label?: string;
  }): Promise<{ device: PrivateDeviceRegistration; deviceToken: string }> {
    const response = await this.fetchJson<{
      ok: boolean;
      device: PrivateDeviceRegistration;
      deviceToken: string;
    }>('/devices/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response?.ok) {
      throw new Error('Device registration failed.');
    }
    await this.reload();
    return {
      device: response.device,
      deviceToken: response.deviceToken,
    };
  }

  async getPublicSummary(params: { albumId?: string; deviceId?: string }): Promise<PrivateIngestSummary | null> {
    try {
      const query = new URLSearchParams();
      if (params.albumId) query.set('albumId', params.albumId);
      if (params.deviceId) query.set('deviceId', params.deviceId);
      const response = await fetch(`${this.auth.apiBase}/public/ingest/summary?${query.toString()}`);
      if (!response.ok) return null;
      const payload = await response.json();
      return payload.summary as PrivateIngestSummary;
    } catch {
      return null;
    }
  }

  async reload(): Promise<void> {
    this.stateSignal.set('loading');
    try {
      const [filesResponse, devicesResponse, sessionsResponse] = await Promise.all([
        this.fetchJson<{ ok: boolean; files: PrivateIngestItem[]; summary: PrivateIngestSummary }>('/ingest/files'),
        this.fetchJson<{ ok: boolean; devices: PrivateDeviceRegistration[] }>('/devices'),
        this.fetchJson<{ ok: boolean; sessions: PrivateUploadSession[] }>('/ingest/sessions'),
      ]);

      this.itemsSignal.set((filesResponse?.files || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      this.devicesSignal.set((devicesResponse?.devices || []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      this.sessionsSignal.set((sessionsResponse?.sessions || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      this.summarySignal.set(filesResponse?.summary || null);
      this.stateSignal.set('ready');
    } catch (error) {
      console.error('[PrivateIngest] Failed to load private ingest state', error);
      this.itemsSignal.set([]);
      this.devicesSignal.set([]);
      this.sessionsSignal.set([]);
      this.summarySignal.set(null);
      this.stateSignal.set('error');
    }
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const apiBase = this.auth.apiBase;
    if (!apiBase) {
      this.stateSignal.set('unauthorized');
      throw new Error('Internal ingest API is not configured for this hosted portal.');
    }
    const response = await fetch(`${apiBase}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      ...init,
    });
    if (response.status === 401) {
      this.stateSignal.set('unauthorized');
      throw new Error('Operator authentication required.');
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Private ingest request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  private inferContentKind(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.dpa')) return 'audio';
    if (lower.endsWith('.wav') || lower.endsWith('.flac')) return 'audio';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp')) return 'art';
    if (lower.endsWith('.json')) return 'manifest';
    return 'support';
  }
}
