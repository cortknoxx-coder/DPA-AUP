import {
  BookletVideo,
  DeviceAlbumMetaPayload,
  DeviceBookletPayload,
  DeviceCapsuleRecord,
  DcnpEventType,
  FanCapsule,
} from '../types';

const VALID_CAPSULE_TYPES: DcnpEventType[] = ['concert', 'video', 'merch', 'signing', 'remix', 'other'];

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function asIsoDate(value: unknown, fallback?: string): string {
  const raw = asString(value).trim();
  if (!raw) return fallback || new Date().toISOString();
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? (fallback || new Date().toISOString()) : new Date(parsed).toISOString();
}

function asCapsuleType(value: unknown): DcnpEventType {
  const raw = asString(value).toLowerCase() as DcnpEventType;
  return VALID_CAPSULE_TYPES.includes(raw) ? raw : 'other';
}

function normalizeVideo(raw: any, index: number): BookletVideo {
  return {
    id: asString(raw?.id) || `video-${index}`,
    title: asString(raw?.title) || `Video ${index + 1}`,
    url: asString(raw?.url),
    poster: asString(raw?.poster),
  };
}

export function normalizeDeviceCapsuleRecord(raw: any): DeviceCapsuleRecord {
  return {
    id: asString(raw?.id || raw?.capsuleId) || `device-cap-${Date.now().toString(36)}`,
    type: asCapsuleType(raw?.type || raw?.eventType),
    title: asString(raw?.title) || 'Capsule',
    desc: asString(raw?.desc || raw?.description) || undefined,
    date: asString(raw?.date) || undefined,
    delivered: asBoolean(raw?.delivered),
    price: typeof raw?.price === 'number' ? raw.price : undefined,
    ctaLabel: asString(raw?.ctaLabel) || undefined,
    ctaUrl: asString(raw?.ctaUrl) || undefined,
    hasImage: asBoolean(raw?.hasImage),
  };
}

export function mergeCapsuleFeeds(
  localCapsules: FanCapsule[],
  deviceCapsules: DeviceCapsuleRecord[],
  context?: { albumId?: string; albumTitle?: string; artistName?: string }
): FanCapsule[] {
  const localById = new Map(localCapsules.map((capsule) => [capsule.id, capsule]));
  const merged: FanCapsule[] = [];

  for (const raw of deviceCapsules) {
    const local = localById.get(raw.id);
    const createdAt = asIsoDate(raw.date, local?.createdAt);
    const deliveredAt = raw.delivered ? asIsoDate(raw.date, local?.deliveredAt || createdAt) : local?.deliveredAt;
    const ctaAction: 'link' | 'download' = raw.ctaUrl ? 'link' : 'download';
    const cta =
      local?.payload.cta ||
      (raw.ctaLabel
        ? {
            label: raw.ctaLabel,
            url: raw.ctaUrl || undefined,
            action: ctaAction,
          }
        : undefined);

    merged.push({
      id: local?.id || raw.id,
      albumId: local?.albumId || context?.albumId || 'device',
      eventType: local?.eventType || raw.type,
      target: local?.target || 'device',
      payload: {
        title: raw.title || local?.payload.title || 'Capsule',
        description: raw.desc || local?.payload.description || '',
        imageUrl: local?.payload.imageUrl,
        price: raw.price ?? local?.payload.price,
        cta,
        metadata: local?.payload.metadata,
      },
      status: raw.delivered ? 'delivered' : (local?.status || 'pending'),
      createdAt: local?.createdAt || createdAt,
      deliveredAt,
      albumTitle: local?.albumTitle || context?.albumTitle,
      artistName: local?.artistName || context?.artistName,
      source: local ? 'merged' : 'device',
    });

    localById.delete(raw.id);
  }

  for (const leftover of localById.values()) {
    merged.push({ ...leftover, source: leftover.source || 'portal' });
  }

  return merged.sort((a, b) => {
    const aTime = Date.parse(a.deliveredAt || a.createdAt || '') || 0;
    const bTime = Date.parse(b.deliveredAt || b.createdAt || '') || 0;
    return bTime - aTime;
  });
}

export function normalizeDeviceBookletPayload(raw: any): DeviceBookletPayload | null {
  if (!raw || typeof raw !== 'object') return null;

  const gallery = Array.isArray(raw.booklet?.gallery)
    ? raw.booklet.gallery.map(asString).filter(Boolean)
    : [];
  const videos = Array.isArray(raw.booklet?.videos)
    ? raw.booklet.videos.map((video: any, index: number) => normalizeVideo(video, index))
    : [];

  return {
    description: asString(raw.description) || '',
    lyrics: asString(raw.lyrics) || '',
    booklet: {
      credits: asString(raw.booklet?.credits) || '',
      gallery,
      videos,
    },
  };
}

export function normalizeDeviceAlbumMetaPayload(raw: any): DeviceAlbumMetaPayload | null {
  if (!raw || typeof raw !== 'object') return null;

  return {
    genre: asString(raw.genre) || '',
    recordLabel: asString(raw.recordLabel) || '',
    copyright: asString(raw.copyright) || '',
    releaseDate: asString(raw.releaseDate) || '',
    upcCode: asString(raw.upcCode) || '',
    parentalAdvisory: asBoolean(raw.parentalAdvisory),
  };
}
