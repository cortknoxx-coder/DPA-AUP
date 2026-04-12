import { Injectable, inject } from '@angular/core';
import { Album, DeviceAlbumMetaPayload, DeviceBookletPayload } from '../types';
import { DataService } from './data.service';
import { DeviceConnectionService } from './device-connection.service';
import { DEFAULT_COVER_DATA_URL } from '../default-cover';

export interface ReleaseBuildStep {
  label: string;
  status: 'success' | 'warning' | 'error' | 'skipped';
  detail: string;
}

export interface ReleaseBuildResult {
  ok: boolean;
  summary: string;
  steps: ReleaseBuildStep[];
}

@Injectable({ providedIn: 'root' })
export class ReleaseBuildService {
  private data = inject(DataService);
  private connection = inject(DeviceConnectionService);

  async rebuildAndPush(album: Album): Promise<ReleaseBuildResult> {
    const steps: ReleaseBuildStep[] = [];

    if (this.connection.connectionStatus() !== 'wifi') {
      return this.fail(
        steps,
        'Connect the creator portal to the DPA over WiFi before rebuilding and pushing.'
      );
    }

    if (!this.connection.deviceReadyForWrites()) {
      return this.fail(
        steps,
        'The DPA is not ready for writes yet. Wait for uploads or boot tasks to finish, then retry.'
      );
    }

    this.data.patchAlbum(album.albumId, {
      status: 'building',
      lastBuildMessage: 'Compiling release package and pushing to connected DPA...',
    });

    const localOnlyTracks = album.tracks.filter((track) => !this.deviceFilenameForTrack(track.trackId));
    if (localOnlyTracks.length > 0) {
      steps.push({
        label: 'Masters preflight',
        status: 'error',
        detail: `${localOnlyTracks.length} track(s) still exist only in portal metadata. Upload masters from the Tracks tab before a full rebuild can be verified on the device.`,
      });
      this.data.patchAlbum(album.albumId, {
        status: 'error',
        lastBuildMessage: 'Rebuild stopped: upload all masters to the connected DPA first.',
      });
      return {
        ok: false,
        summary: 'Rebuild stopped because some track masters are not on the device yet.',
        steps,
      };
    }

    const metadataOk = await this.pushMetadata(album, steps);
    const coverOk = await this.pushCoverArt(album, steps);
    const trackArtOk = await this.pushTrackArtwork(album, steps);
    const bookletOk = await this.pushBooklet(album, steps);
    const themeOk = await this.pushTheme(album, steps);
    const capsuleOk = await this.pushPendingCapsules(album, steps);
    const verificationOk = await this.verifyDeviceState(album, steps);

    const ok = metadataOk && coverOk && trackArtOk && bookletOk && themeOk && capsuleOk && verificationOk;
    const timestamp = new Date().toISOString();
    const summary = ok
      ? 'Release rebuilt, pushed, and verified against the connected DPA.'
      : 'Release push finished with issues. Review the verification details below.';

    this.data.patchAlbum(album.albumId, {
      status: ok ? 'ready' : 'error',
      dpacVersion: ok ? album.dpacVersion + 1 : album.dpacVersion,
      lastBuiltAt: ok ? timestamp : album.lastBuiltAt,
      lastVerifiedAt: ok ? timestamp : album.lastVerifiedAt,
      lastBuildMessage: summary,
    });

    return { ok, summary, steps };
  }

  private async pushMetadata(album: Album, steps: ReleaseBuildStep[]): Promise<boolean> {
    const artist = (album.artistName || '').trim();
    const title = (album.title || '').trim();
    const result = await this.connection.wifi.pushMetadata(artist, title);
    if (!result.ok) {
      steps.push({
        label: 'Core metadata',
        status: 'error',
        detail: `Artist/title push failed${result.reason ? ` (${result.reason})` : ''}.`,
      });
      return false;
    }

    const albumMetaPayload: DeviceAlbumMetaPayload = {
      genre: album.genre || '',
      recordLabel: album.recordLabel || '',
      copyright: album.copyright || '',
      releaseDate: album.releaseDate || '',
      upcCode: album.upcCode || '',
      parentalAdvisory: !!album.parentalAdvisory,
    };

    const albumMetaOk = await this.connection.wifi.pushAlbumMeta(albumMetaPayload);
    steps.push({
      label: 'Core metadata',
      status: albumMetaOk ? 'success' : 'warning',
      detail: albumMetaOk
        ? 'Artist, title, and extended release metadata pushed to the DPA.'
        : 'Artist/title updated on device, but extended album metadata failed to sync.',
    });
    return albumMetaOk;
  }

  private async pushCoverArt(album: Album, steps: ReleaseBuildStep[]): Promise<boolean> {
    if (!album.artworkUrl || album.artworkUrl === DEFAULT_COVER_DATA_URL) {
      steps.push({
        label: 'Cover art',
        status: 'skipped',
        detail: 'No custom cover art to push from the portal.',
      });
      return true;
    }

    const file = await this.assetToFile(album.artworkUrl, 'cover.jpg', 'image/jpeg').catch(() => null);
    if (!file) {
      steps.push({
        label: 'Cover art',
        status: 'error',
        detail: 'Portal cover art could not be converted into a device upload.',
      });
      return false;
    }

    const ok = await this.connection.wifi.uploadFileToPath(file, '/art/cover.jpg');
    const verified = ok ? await this.connection.wifi.verifyCoverArt('/art/cover.jpg') : false;
    steps.push({
      label: 'Cover art',
      status: verified ? 'success' : 'error',
      detail: verified
        ? 'Album cover uploaded and verified on the DPA.'
        : 'Album cover upload did not verify on the DPA.',
    });
    return verified;
  }

  private async pushTrackArtwork(album: Album, steps: ReleaseBuildStep[]): Promise<boolean> {
    const tracksWithArt = album.tracks
      .map((track) => ({ track, filename: this.deviceFilenameForTrack(track.trackId) }))
      .filter((entry) => !!entry.filename && !!entry.track.artworkUrl);

    if (tracksWithArt.length === 0) {
      steps.push({
        label: 'Track artwork',
        status: 'skipped',
        detail: 'No per-track artwork was present in portal state.',
      });
      return true;
    }

    let uploaded = 0;
    for (const entry of tracksWithArt) {
      const path = `/art/${this.artStem(entry.filename!)}.jpg`;
      const file = await this.assetToFile(entry.track.artworkUrl!, `${this.artStem(entry.filename!)}.jpg`, 'image/jpeg').catch(() => null);
      if (!file) continue;
      const ok = await this.connection.wifi.uploadFileToPath(file, path);
      const verified = ok ? await this.connection.wifi.verifyCoverArt(path) : false;
      if (verified) uploaded += 1;
    }

    const ok = uploaded === tracksWithArt.length;
    steps.push({
      label: 'Track artwork',
      status: ok ? 'success' : 'warning',
      detail: ok
        ? `Verified ${uploaded}/${tracksWithArt.length} track artwork file(s) on the DPA.`
        : `Verified ${uploaded}/${tracksWithArt.length} track artwork file(s). Some track art still needs attention.`,
    });
    return ok;
  }

  private async pushBooklet(album: Album, steps: ReleaseBuildStep[]): Promise<boolean> {
    const payload: DeviceBookletPayload = {
      description: album.description || '',
      lyrics: album.lyrics || '',
      booklet: {
        credits: album.booklet?.credits || '',
        gallery: album.booklet?.gallery || [],
        videos: album.booklet?.videos || [],
      },
    };

    const ok = await this.connection.wifi.pushBookletData(payload);
    steps.push({
      label: 'Booklet',
      status: ok ? 'success' : 'error',
      detail: ok
        ? 'Booklet, credits, lyrics, gallery, and videos pushed to the DPA.'
        : 'Booklet payload failed to sync to the DPA.',
    });
    return ok;
  }

  private async pushTheme(album: Album, steps: ReleaseBuildStep[]): Promise<boolean> {
    const ok = await this.connection.wifi.pushTheme(
      album.themeJson,
      album.themeJson.ledBrightness,
      album.themeJson.ledGradEnd
    );
    steps.push({
      label: 'Theme and LED state',
      status: ok ? 'success' : 'error',
      detail: ok
        ? 'Theme, brightness, gradient, and DCNP colors pushed to the DPA.'
        : 'Theme/LED payload failed to sync to the DPA.',
    });
    return ok;
  }

  private async pushPendingCapsules(album: Album, steps: ReleaseBuildStep[]): Promise<boolean> {
    const pending = album.dcnpEvents.filter((event) => event.status === 'pending');
    if (pending.length === 0) {
      steps.push({
        label: 'Pending capsules',
        status: 'skipped',
        detail: 'No pending capsule pushes were waiting in portal state.',
      });
      return true;
    }

    let delivered = 0;
    for (const event of pending) {
      const ok = await this.connection.wifi.pushCapsule(event.eventType, event.id, event.payload);
      if (ok) {
        this.data.markDcnpEventDelivered(album.albumId, event.id);
        delivered += 1;
      }
    }

    const ok = delivered === pending.length;
    steps.push({
      label: 'Pending capsules',
      status: ok ? 'success' : 'warning',
      detail: ok
        ? `Delivered ${delivered}/${pending.length} pending capsule(s) to the DPA.`
        : `Delivered ${delivered}/${pending.length} pending capsule(s). Retry the remaining pushes from Perks.`,
    });
    return ok;
  }

  private async verifyDeviceState(album: Album, steps: ReleaseBuildStep[]): Promise<boolean> {
    try {
      const status = await this.connection.wifi.getStatus({ forceRefresh: true, maxAgeMs: 0, timeoutMs: 4000 });
      const booklet = await this.connection.wifi.getBookletData();
      const albumMeta = await this.connection.wifi.getAlbumMeta();
      const coverVerified = album.artworkUrl && album.artworkUrl !== DEFAULT_COVER_DATA_URL
        ? await this.connection.wifi.verifyCoverArt('/art/cover.jpg')
        : true;
      const deviceTracks = await this.connection.wifi.getDeviceTracks();
      await this.connection.syncConnectedWifiState();

      const statusMatches = (status.artist || '') === (album.artistName || '') && (status.album || '') === album.title;
      const bookletMatches =
        (booklet?.description || '') === (album.description || '') &&
        (booklet?.lyrics || '') === (album.lyrics || '') &&
        (booklet?.booklet?.credits || '') === (album.booklet?.credits || '');
      const albumMetaMatches =
        (albumMeta?.genre || '') === (album.genre || '') &&
        (albumMeta?.recordLabel || '') === (album.recordLabel || '') &&
        (albumMeta?.copyright || '') === (album.copyright || '') &&
        (albumMeta?.releaseDate || '') === (album.releaseDate || '') &&
        (albumMeta?.upcCode || '') === (album.upcCode || '') &&
        (!!albumMeta?.parentalAdvisory) === (!!album.parentalAdvisory);

      const expectedTracks = album.tracks.length;
      const trackCountMatches = deviceTracks.length >= expectedTracks;
      const ok = statusMatches && bookletMatches && albumMetaMatches && coverVerified && trackCountMatches;

      steps.push({
        label: 'Device readback verification',
        status: ok ? 'success' : 'error',
        detail: ok
          ? `Verified metadata, booklet, cover art, and track count against the connected DPA (${deviceTracks.length} track(s) on device).`
          : `Readback mismatch: metadata=${statusMatches}, booklet=${bookletMatches}, albumMeta=${albumMetaMatches}, cover=${coverVerified}, tracks=${deviceTracks.length}/${expectedTracks}.`,
      });
      return ok;
    } catch {
      steps.push({
        label: 'Device readback verification',
        status: 'error',
        detail: 'Could not complete device readback after the rebuild push.',
      });
      return false;
    }
  }

  private deviceFilenameForTrack(trackId: string): string | null {
    if (!trackId.startsWith('device://')) return null;
    const parts = trackId.replace('device://', '').split('/');
    if (parts.length < 2) return null;
    return parts.slice(1).join('/');
  }

  private artStem(pathOrFilename: string): string {
    const base = pathOrFilename.split('/').pop() || pathOrFilename;
    return base.replace(/\.(wav|dpa|WAV|DPA)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'track';
  }

  private async assetToFile(url: string, filename: string, fallbackMime: string): Promise<File> {
    if (url.startsWith('data:')) {
      const [meta, b64] = url.split(',');
      const mime = /data:([^;]+)/.exec(meta)?.[1] || fallbackMime;
      const raw = meta.includes(';base64') ? atob(b64) : decodeURIComponent(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new File([bytes], filename, { type: mime });
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Asset fetch failed');
    }
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || fallbackMime });
  }

  private fail(steps: ReleaseBuildStep[], summary: string): ReleaseBuildResult {
    steps.push({
      label: 'Preflight',
      status: 'error',
      detail: summary,
    });
    return { ok: false, summary, steps };
  }
}
