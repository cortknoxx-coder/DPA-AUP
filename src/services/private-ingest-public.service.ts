import { Injectable } from '@angular/core';
import { PrivateIngestSummary } from './private-ingest.service';
import { dpaInternalApiBaseUrl } from '../dpa-internal-api-base';

@Injectable({ providedIn: 'root' })
export class PrivateIngestPublicService {
  async getSummary(params: { albumId?: string; deviceId?: string }): Promise<PrivateIngestSummary | null> {
    try {
      const apiBase = dpaInternalApiBaseUrl();
      if (!apiBase) return null;
      const query = new URLSearchParams();
      if (params.albumId) query.set('albumId', params.albumId);
      if (params.deviceId) query.set('deviceId', params.deviceId);
      const response = await fetch(`${apiBase}/public/ingest/summary?${query.toString()}`);
      if (!response.ok) return null;
      const payload = await response.json();
      return (payload.summary || null) as PrivateIngestSummary | null;
    } catch {
      return null;
    }
  }
}
