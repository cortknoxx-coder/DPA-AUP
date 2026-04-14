import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { query, queryOne, ensureSchema } from './db.mjs';
import { setDeviceHeartbeat, getDeviceHeartbeat, getOnlineDevices, setOperatorSession, getOperatorSession, deleteOperatorSession } from './redis.mjs';
import { uploadIngestFile, uploadFirmware, uploadArtwork, uploadBackup, getLatestBackup, deleteBlob } from './blob.mjs';
import { getFirmwarePointer, edgeConfigStatus } from './edge-config.mjs';

const OPERATOR_COOKIE = 'dpa_operator_session';
const BROWSER_BINDING_COOKIE = 'dpa_bound_device_id';
const DEVICE_AUTH_HEADER = 'x-dpa-device-token';
const UPLOAD_AUTH_HEADER = 'x-dpa-upload-token';
const DEFAULT_OPERATOR_PASSPHRASE = 'dpa-internal-operator';
const ACTIVE_DEVICE_WINDOW_MS = 2 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function json(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    out[key] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function clearCookie(res, name) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (!req.body && req.method === 'GET') return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function readRawBody(req) {
  if (req.body instanceof Buffer) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function normalizePathParts(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw) && raw.length > 0) return raw.filter(Boolean);
  if (typeof raw === 'string' && raw.length > 0) return raw.split('/').filter(Boolean);

  const url = req.url || '';
  const prefix = '/api/internal-api';
  const idx = url.indexOf(prefix);
  if (idx !== -1) {
    const rest = url.slice(idx + prefix.length).split('?')[0];
    return rest.split('/').filter(Boolean);
  }
  return [];
}

function getQueryValue(req, key) {
  const value = req.query?.[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function safeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function operatorPassphrase() {
  return process.env.DPA_OPERATOR_PASSPHRASE || DEFAULT_OPERATOR_PASSPHRASE;
}

async function requireOperator(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[OPERATOR_COOKIE];
  if (!sessionId) return null;

  const cached = await getOperatorSession(sessionId);
  if (cached) {
    if (Date.now() > cached.expiresAtMs) {
      await deleteOperatorSession(sessionId);
      return null;
    }
    return cached;
  }

  const row = await queryOne(
    'SELECT session_id, expires_at FROM operator_sessions WHERE session_id = $1',
    [sessionId]
  );
  if (!row) return null;
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Date.now() > expiresAtMs) {
    await query('DELETE FROM operator_sessions WHERE session_id = $1', [sessionId]);
    return null;
  }
  const session = { id: sessionId, expiresAtMs };
  await setOperatorSession(sessionId, session);
  return session;
}

async function requireDevice(req) {
  const token = String(req.headers[DEVICE_AUTH_HEADER] || '').trim();
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = await queryOne(
    'SELECT * FROM devices WHERE device_token_hash = $1',
    [tokenHash]
  );
  if (!row) return null;
  return rowToDevice(row);
}

function rowToDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    label: row.label || '',
    albumId: row.album_id || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : '',
    firmwareVersion: row.firmware_ver || '',
    deviceTokenHash: row.device_token_hash || '',
    pendingCommands: row.pending_commands || [],
    lastLibrary: row.last_library || { albums: [], tracks: [] },
    lastStatus: row.last_status || null,
    lastCheckIn: row.last_check_in || null,
  };
}

function toReachability(device) {
  if (!device?.lastSeenAt) return 'offline';
  return (Date.now() - Date.parse(device.lastSeenAt)) <= ACTIVE_DEVICE_WINDOW_MS ? 'online' : 'stale';
}

async function getPreferredDevice(req) {
  const queryId = String(getQueryValue(req, 'deviceId') || '').trim();
  if (queryId) {
    const row = await queryOne('SELECT * FROM devices WHERE device_id = $1', [queryId]);
    if (row) return rowToDevice(row);
  }

  const cookies = parseCookies(req);
  const boundId = String(cookies[BROWSER_BINDING_COOKIE] || '').trim();
  if (boundId) {
    const row = await queryOne('SELECT * FROM devices WHERE device_id = $1', [boundId]);
    if (row) return rowToDevice(row);
  }

  const rows = await query('SELECT * FROM devices ORDER BY last_seen_at DESC NULLS LAST LIMIT 10');
  const devices = rows.map(rowToDevice);
  return devices.find((d) => toReachability(d) === 'online') || devices[0] || null;
}

function sanitizeBlobId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function deriveTrackTitle(track, blobId, fallbackIndex) {
  const explicit = String(track?.title || '').trim();
  if (explicit) return explicit;
  const leaf = blobId.split('/').pop() || `track_${fallbackIndex + 1}.wav`;
  return leaf.replace(/\.(wav|dpa)$/i, '').replace(/_/g, ' ');
}

function normalizeTrack(track, index, albumId) {
  const blobId = sanitizeBlobId(
    track?.blobId || track?.filename || track?.path || track?.sdPath
  );
  if (!blobId) return null;
  const durationMs = Math.max(0, Number(track?.durationMs || 0));
  const sizeBytes = Math.max(
    0,
    Number(track?.sizeBytes || track?.size || Math.trunc(Number(track?.sizeMB || 0) * 1024 * 1024))
  );
  return {
    id: String(track?.id || `cloud-${albumId}-${index}`),
    albumId,
    title: deriveTrackTitle(track, blobId, index),
    durationSec: Math.max(0, Math.round(durationMs / 1000)),
    trackNo: Math.max(1, Number(track?.trackNo || track?.index || index) + (track?.trackNo ? 0 : 1)),
    codec: String(track?.codec || track?.format || 'audio/wav'),
    blobId,
    sizeBytes,
  };
}

function normalizeLibraryPayload(payload, device) {
  const albumId = String(
    payload?.albumId || payload?.albumIds?.[0] || payload?.album
    || payload?.status?.album || device?.albumId || device?.deviceId || 'device-album'
  );
  const tracks = Array.isArray(payload?.library?.tracks)
    ? payload.library.tracks
    : Array.isArray(payload?.tracks)
      ? payload.tracks
      : Array.isArray(payload?.trackSnapshot)
        ? payload.trackSnapshot
        : [];
  const normalizedTracks = tracks
    .map((track, index) => normalizeTrack(track, index, albumId))
    .filter(Boolean);
  const artworkUrl = String(
    payload?.library?.artworkUrl || payload?.artworkUrl
    || payload?.coverPath || payload?.artPath || ''
  ).trim() || undefined;

  return {
    albumId,
    artworkUrl,
    albums: [{
      id: albumId,
      title: String(payload?.status?.album || payload?.albumTitle || device?.label || 'DPA Device').trim(),
      ...(artworkUrl ? { artworkUrl } : {}),
    }],
    tracks: normalizedTracks,
  };
}

function buildDeviceInfo(device) {
  const status = device?.lastStatus || {};
  return {
    serial: String(device?.deviceId || ''),
    model: String(status?.model || 'DPA'),
    firmwareVersion: String(status?.firmwareVersion || status?.fw || device?.firmwareVersion || 'unknown'),
    capabilities: Array.isArray(status?.capabilities) ? status.capabilities : ['cloud_relay', 'local_direct'],
    pubkeyB64: String(status?.pubkeyB64 || ''),
  };
}

function buildManifest(device, albumId) {
  const library = device?.lastLibrary || { tracks: [] };
  const resolvedAlbumId = String(albumId || library.albums?.[0]?.id || device?.albumId || device?.deviceId || 'device-album');
  const tracks = (library.tracks || []).filter((track) => track.albumId === resolvedAlbumId || !track.albumId);
  return {
    version: 1,
    albumId: resolvedAlbumId,
    policyHash: '',
    blobs: tracks.map((track) => ({
      blobId: track.blobId,
      sha256: '',
      size: Math.max(0, Number(track.sizeBytes || 0)),
      mime: String(track.codec || 'audio/wav'),
      kind: 'audio',
    })),
    tracks: tracks.map((track) => ({
      trackId: String(track.id),
      blobId: track.blobId,
      codec: String(track.codec || 'audio/wav'),
      title: String(track.title || 'Untitled Track'),
      trackNo: Math.max(1, Number(track.trackNo || 1)),
      durationSec: Math.max(0, Number(track.durationSec || 0)),
    })),
    signatures: {
      manifestSigEd25519B64: '',
      publisherPubkeyEd25519B64: '',
    },
  };
}

async function ingestSummary(device) {
  const deviceId = device?.deviceId || null;
  let activeSessions = 0;
  if (deviceId) {
    const row = await queryOne(
      "SELECT COUNT(*)::int AS cnt FROM upload_sessions WHERE device_id = $1 AND status != 'completed'",
      [deviceId]
    );
    activeSessions = row?.cnt || 0;
  }
  return {
    albumId: device?.albumId || device?.lastLibrary?.albums?.[0]?.id || null,
    deviceId,
    totalFiles: Number(device?.lastLibrary?.tracks?.length || 0),
    verifiedFiles: 0,
    stagedFiles: 0,
    archivedFiles: 0,
    activeSessions,
    lastUploadedAt: null,
    lastUploadStatus: null,
    lastDeviceId: deviceId,
    lastAlbumId: device?.albumId || device?.lastLibrary?.albums?.[0]?.id || null,
  };
}

async function ingestAnalyticsSnapshot(deviceId, albumId, tracks) {
  for (const t of tracks.slice(0, 32)) {
    const trackPath = String(t?.path || t?.track_path || '').trim();
    if (!trackPath) continue;
    const trackTitle = String(t?.title || t?.track_title || '').trim()
      || trackPath.split('/').pop()?.replace(/\.(wav|dpa)$/i, '').replace(/_/g, ' ') || '';

    const plays = Math.max(0, Number(t?.plays || t?.playCount || 0));
    const skips = Math.max(0, Number(t?.skips || t?.skipCount || 0));
    const listenMs = Math.max(0, Number(t?.listenMs || t?.totalListenMs || 0));
    const isFavorited = !!(t?.favoritedAt || t?.favorited || t?.hearted);

    // Use upsert-style: check last known counts from a snapshot marker in Redis/Postgres
    // to avoid double-counting. For simplicity, we store cumulative snapshots and compute deltas.
    const snapshotKey = `${deviceId}:${trackPath}`;
    const existing = await queryOne(
      "SELECT value FROM device_events WHERE device_id = $1 AND track_path = $2 AND event_type = 'snapshot_plays' ORDER BY created_at DESC LIMIT 1",
      [deviceId, trackPath]
    );
    const lastKnownPlays = existing?.value || 0;
    const newPlays = plays - lastKnownPlays;

    if (newPlays > 0) {
      for (let i = 0; i < Math.min(newPlays, 50); i++) {
        await query(
          `INSERT INTO device_events (id, device_id, event_type, track_path, track_title, album_id, value)
           VALUES ($1, $2, 'play', $3, $4, $5, 1)`,
          [randomUUID(), deviceId, trackPath, trackTitle, albumId]
        );
      }
    }

    const existingSkips = await queryOne(
      "SELECT value FROM device_events WHERE device_id = $1 AND track_path = $2 AND event_type = 'snapshot_skips' ORDER BY created_at DESC LIMIT 1",
      [deviceId, trackPath]
    );
    const lastKnownSkips = existingSkips?.value || 0;
    const newSkips = skips - lastKnownSkips;

    if (newSkips > 0) {
      for (let i = 0; i < Math.min(newSkips, 50); i++) {
        await query(
          `INSERT INTO device_events (id, device_id, event_type, track_path, track_title, album_id, value)
           VALUES ($1, $2, 'skip', $3, $4, $5, 1)`,
          [randomUUID(), deviceId, trackPath, trackTitle, albumId]
        );
      }
    }

    // Store cumulative snapshot markers for delta computation on next check-in
    if (plays > 0) {
      await query(
        `INSERT INTO device_events (id, device_id, event_type, track_path, track_title, album_id, value)
         VALUES ($1, $2, 'snapshot_plays', $3, $4, $5, $6)`,
        [randomUUID(), deviceId, trackPath, trackTitle, albumId, plays]
      );
    }
    if (skips > 0) {
      await query(
        `INSERT INTO device_events (id, device_id, event_type, track_path, track_title, album_id, value)
         VALUES ($1, $2, 'snapshot_skips', $3, $4, $5, $6)`,
        [randomUUID(), deviceId, trackPath, trackTitle, albumId, skips]
      );
    }
    if (listenMs > 0) {
      await query(
        `INSERT INTO device_events (id, device_id, event_type, track_path, track_title, album_id, value)
         VALUES ($1, $2, 'listen_ms', $3, $4, $5, $6)`,
        [randomUUID(), deviceId, trackPath, trackTitle, albumId, listenMs]
      );
    }
    if (isFavorited) {
      const alreadyHearted = await queryOne(
        "SELECT id FROM device_events WHERE device_id = $1 AND track_path = $2 AND event_type = 'heart' ORDER BY created_at DESC LIMIT 1",
        [deviceId, trackPath]
      );
      if (!alreadyHearted) {
        await query(
          `INSERT INTO device_events (id, device_id, event_type, track_path, track_title, album_id, value)
           VALUES ($1, $2, 'heart', $3, $4, $5, 1)`,
          [randomUUID(), deviceId, trackPath, trackTitle, albumId]
        );
      }
    }
  }
}

function makeBrowserBindingHeader(deviceId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${BROWSER_BINDING_COOKIE}=${encodeURIComponent(deviceId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${secure}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  await ensureSchema();

  const path = normalizePathParts(req);
  const route = `/${path.join('/')}`;

  // ── Health ──
  if (route === '/' || route === '/health') {
    const [countRow, onlineDevices, ecStatus] = await Promise.all([
      queryOne('SELECT COUNT(*)::int AS total FROM devices'),
      getOnlineDevices(),
      edgeConfigStatus(),
    ]);
    return json(res, 200, {
      ok: true,
      service: 'dpa-cloud-control',
      storage: 'postgres+redis+blob',
      devices: countRow?.total || 0,
      activeDevices: onlineDevices.length,
      edgeConfig: ecStatus,
    });
  }

  // ── Auth ──
  if (route === '/auth/session' && req.method === 'GET') {
    const session = await requireOperator(req);
    return json(res, 200, {
      authenticated: !!session,
      expiresAt: session ? new Date(session.expiresAtMs).toISOString() : null,
    });
  }

  if (route === '/auth/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const passphrase = String(body?.passphrase || '');
    if (!safeEq(passphrase, operatorPassphrase())) {
      return json(res, 401, { ok: false, error: 'invalid_passphrase' });
    }
    const sessionId = randomUUID();
    const expiresAtMs = Date.now() + (12 * 60 * 60 * 1000);
    await query(
      'INSERT INTO operator_sessions (session_id, expires_at) VALUES ($1, $2)',
      [sessionId, new Date(expiresAtMs).toISOString()]
    );
    await setOperatorSession(sessionId, { id: sessionId, expiresAtMs });
    return json(res, 200, { ok: true, expiresAt: new Date(expiresAtMs).toISOString() }, {
      'Set-Cookie': `${OPERATOR_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    });
  }

  if (route === '/auth/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies[OPERATOR_COOKIE]) {
      await deleteOperatorSession(cookies[OPERATOR_COOKIE]);
      await query('DELETE FROM operator_sessions WHERE session_id = $1', [cookies[OPERATOR_COOKIE]]);
    }
    clearCookie(res, OPERATOR_COOKIE);
    return json(res, 200, { ok: true });
  }

  // ── Device Registration ──
  if (route === '/devices/register' && req.method === 'POST') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const body = await readJsonBody(req);
    const deviceId = String(body?.deviceId || '').trim();
    if (!deviceId) return json(res, 400, { ok: false, error: 'device_id_required' });
    const label = String(body?.label || deviceId).trim();
    const albumId = String(body?.albumId || deviceId).trim();
    const rawToken = randomUUID();
    const tokenHash = sha256(rawToken);
    const id = randomUUID();

    const existing = await queryOne('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (existing) {
      await query(
        'UPDATE devices SET label = $1, album_id = $2, device_token_hash = $3, updated_at = now() WHERE device_id = $4',
        [label, albumId, tokenHash, deviceId]
      );
    } else {
      await query(
        'INSERT INTO devices (device_id, id, label, album_id, device_token_hash) VALUES ($1, $2, $3, $4, $5)',
        [deviceId, id, label, albumId, tokenHash]
      );
    }
    const device = await queryOne('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    const d = rowToDevice(device);
    return json(res, 200, {
      ok: true,
      device: {
        id: d.id,
        deviceId: d.deviceId,
        label: d.label,
        albumId: d.albumId,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        lastSeenAt: d.lastSeenAt,
      },
      deviceToken: rawToken,
    });
  }

  // ── Device List ──
  if (route === '/devices' && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const rows = await query('SELECT * FROM devices ORDER BY updated_at DESC');
    const onlineSet = new Set(await getOnlineDevices());
    const devices = rows.map((row) => {
      const d = rowToDevice(row);
      return {
        id: d.id,
        deviceId: d.deviceId,
        label: d.label,
        albumId: d.albumId,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        lastSeenAt: d.lastSeenAt,
        reachability: onlineSet.has(d.deviceId) ? 'online' : toReachability(d),
      };
    });
    return json(res, 200, { ok: true, devices });
  }

  // ── Device Check-in ──
  if (route === '/device/check-in' && req.method === 'POST') {
    let device = await requireDevice(req);
    if (!device) {
      const operator = await requireOperator(req);
      if (operator) {
        const body0 = await readJsonBody(req);
        const duid = String(body0?.duid || body0?.deviceId || '').trim();
        if (duid) {
          const row = await queryOne('SELECT * FROM devices WHERE device_id = $1', [duid]);
          if (row) device = rowToDevice(row);
          else {
            const id = randomUUID();
            await query(
              'INSERT INTO devices (device_id, id, label) VALUES ($1, $2, $3)',
              [duid, id, String(body0?.label || duid)]
            );
            const newRow = await queryOne('SELECT * FROM devices WHERE device_id = $1', [duid]);
            device = rowToDevice(newRow);
          }
        }
        if (body0 && typeof body0 === 'object') req._parsedBody = body0;
      }
    }
    if (!device) return json(res, 403, { ok: false, error: 'device_token_rejected' });
    const body = req._parsedBody || await readJsonBody(req);
    const checkedAt = nowIso();
    const library = normalizeLibraryPayload(body, device);
    const fwVer = String(body?.firmware || body?.firmwareVersion || body?.status?.firmwareVersion || device.firmwareVersion || '');

    await query(
      `UPDATE devices SET
        updated_at = now(), last_seen_at = now(),
        firmware_ver = $1, last_status = $2,
        last_check_in = $3, last_library = $4,
        pending_commands = '[]'::jsonb
      WHERE device_id = $5`,
      [fwVer, JSON.stringify(body?.status || body || null), JSON.stringify(body), JSON.stringify(library), device.deviceId]
    );

    await setDeviceHeartbeat(device.deviceId, { checkedAt, fwVer });

    // Ingest analytics snapshot from device check-in payload
    const analyticsSnapshot = body?.analytics?.tracks || body?.status?.analytics?.tracks || [];
    if (Array.isArray(analyticsSnapshot) && analyticsSnapshot.length > 0) {
      await ingestAnalyticsSnapshot(device.deviceId, device.albumId, analyticsSnapshot);
    }

    const commands = Array.isArray(device.pendingCommands) ? device.pendingCommands : [];
    return json(res, 200, {
      ok: true,
      deviceId: device.deviceId,
      reachability: 'online',
      checkedInAt: checkedAt,
      commands,
      capsules: [],
      relaySession: { transport: 'cloud_relay', reachability: 'online' },
    }, {
      'Set-Cookie': makeBrowserBindingHeader(device.deviceId),
    });
  }

  // ── Device Upload Session ──
  if (route === '/device/session' && req.method === 'POST') {
    const device = await requireDevice(req);
    if (!device) return json(res, 403, { ok: false, error: 'device_token_rejected' });
    const body = await readJsonBody(req);
    const sessionId = randomUUID();
    const uploadToken = randomUUID();
    const fileId = randomUUID();
    const expiresAt = new Date(Date.now() + (30 * 60 * 1000)).toISOString();

    await query(
      `INSERT INTO upload_sessions (id, device_id, album_id, source, filename, mime_type, content_kind, status, file_id, upload_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9, $10)`,
      [sessionId, device.deviceId, String(body?.albumId || device.albumId || device.deviceId),
       'device', String(body?.filename || ''), String(body?.mimeType || 'application/octet-stream'),
       String(body?.contentKind || 'unknown'), fileId, sha256(uploadToken), expiresAt]
    );

    const session = await queryOne('SELECT * FROM upload_sessions WHERE id = $1', [sessionId]);
    return json(res, 200, { ok: true, sessionId, uploadToken, session: rowToUploadSession(session) });
  }

  // ── Operator Ingest Session ──
  if (route === '/ingest/sessions' && req.method === 'POST') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const body = await readJsonBody(req);
    const sessionId = randomUUID();
    const uploadToken = randomUUID();
    const fileId = randomUUID();
    const expiresAt = new Date(Date.now() + (30 * 60 * 1000)).toISOString();

    await query(
      `INSERT INTO upload_sessions (id, device_id, album_id, source, filename, mime_type, content_kind, status, file_id, upload_token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9, $10)`,
      [sessionId, String(body?.deviceId || 'UNASSIGNED'), String(body?.albumId || 'UNASSIGNED'),
       String(body?.source || 'operator'), String(body?.filename || ''),
       String(body?.mimeType || 'application/octet-stream'),
       String(body?.contentKind || 'unknown'), fileId, sha256(uploadToken), expiresAt]
    );

    const session = await queryOne('SELECT * FROM upload_sessions WHERE id = $1', [sessionId]);
    return json(res, 200, { ok: true, session: rowToUploadSession(session), uploadToken });
  }

  // ── Ingest Upload ──
  if (route.startsWith('/ingest/upload/') && req.method === 'PUT') {
    const sessionId = route.split('/').pop();
    const uploadToken = String(req.headers[UPLOAD_AUTH_HEADER] || '').trim();
    const session = sessionId ? await queryOne('SELECT * FROM upload_sessions WHERE id = $1', [sessionId]) : null;
    if (!session || !uploadToken || !safeEq(session.upload_token_hash, sha256(uploadToken))) {
      return json(res, 403, { ok: false, error: 'upload_token_rejected' });
    }

    const blob = await readRawBody(req);
    const blobResult = await uploadIngestFile(blob, session.file_id, session.filename || 'upload.bin');

    await query(
      `UPDATE upload_sessions SET size_bytes = $1, status = 'uploaded', updated_at = now() WHERE id = $2`,
      [blob.length, sessionId]
    );

    await query(
      `INSERT INTO ingest_files (id, device_id, album_id, filename, blob_url, size_bytes, mime_type, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'staged', 'device-drop')`,
      [session.file_id, session.device_id, session.album_id, session.filename, blobResult.url, blob.length, session.mime_type]
    );

    return json(res, 200, { ok: true, fileId: session.file_id, sizeBytes: blob.length });
  }

  // ── Ingest Complete ──
  if (route.startsWith('/ingest/complete/') && req.method === 'POST') {
    const sessionId = route.split('/').pop();
    const uploadToken = String(req.headers[UPLOAD_AUTH_HEADER] || '').trim();
    const session = sessionId ? await queryOne('SELECT * FROM upload_sessions WHERE id = $1', [sessionId]) : null;
    if (!session || !uploadToken || !safeEq(session.upload_token_hash, sha256(uploadToken))) {
      return json(res, 403, { ok: false, error: 'upload_token_rejected' });
    }
    await query(
      `UPDATE upload_sessions SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1`,
      [sessionId]
    );
    const file = await queryOne('SELECT * FROM ingest_files WHERE id = $1', [session.file_id]);
    if (file) {
      await query('UPDATE ingest_files SET updated_at = now() WHERE id = $1', [session.file_id]);
    }
    return json(res, 200, { ok: true });
  }

  // ── Ingest File List ──
  if (route === '/ingest/files' && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const rows = await query('SELECT * FROM ingest_files ORDER BY created_at DESC');
    const files = rows.map(rowToIngestFile);
    const device = await getPreferredDevice(req);
    return json(res, 200, { ok: true, files, summary: await ingestSummary(device) });
  }

  // ── Ingest File Status Update ──
  if (route.startsWith('/ingest/files/') && route.endsWith('/status') && req.method === 'POST') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const parts = route.split('/');
    const fileId = parts[3];
    const file = await queryOne('SELECT * FROM ingest_files WHERE id = $1', [fileId]);
    if (!file) return json(res, 404, { ok: false, error: 'file_not_found' });
    const body = await readJsonBody(req);
    const newStatus = String(body?.status || file.status || 'staged');
    await query('UPDATE ingest_files SET status = $1, updated_at = now() WHERE id = $2', [newStatus, fileId]);
    const updated = await queryOne('SELECT * FROM ingest_files WHERE id = $1', [fileId]);
    return json(res, 200, { ok: true, file: rowToIngestFile(updated) });
  }

  // ── Ingest File Delete ──
  if (route.startsWith('/ingest/files/') && req.method === 'DELETE') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const fileId = route.split('/')[3];
    const file = await queryOne('SELECT * FROM ingest_files WHERE id = $1', [fileId]);
    if (file?.blob_url) {
      try { await deleteBlob(file.blob_url); } catch { /* blob may already be gone */ }
    }
    await query('DELETE FROM ingest_files WHERE id = $1', [fileId]);
    return json(res, 200, { ok: true });
  }

  // ── Ingest Sessions List ──
  if (route === '/ingest/sessions' && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const rows = await query('SELECT * FROM upload_sessions ORDER BY created_at DESC');
    const sessions = rows.map(rowToUploadSession);
    return json(res, 200, { ok: true, sessions });
  }

  // ── Ingest Download ──
  if (route.startsWith('/ingest/download/') && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const fileId = route.split('/').pop();
    const file = fileId ? await queryOne('SELECT * FROM ingest_files WHERE id = $1', [fileId]) : null;
    if (!file?.blob_url) return json(res, 404, { ok: false, error: 'file_not_found' });
    res.statusCode = 302;
    res.setHeader('location', file.blob_url);
    res.end();
    return;
  }

  // ── Public Ingest Summary ──
  if (route === '/public/ingest/summary' && req.method === 'GET') {
    const requestedDeviceId = String(getQueryValue(req, 'deviceId') || '').trim();
    let device = null;
    if (requestedDeviceId) {
      const row = await queryOne('SELECT * FROM devices WHERE device_id = $1', [requestedDeviceId]);
      device = rowToDevice(row);
    }
    if (!device) device = await getPreferredDevice(req);
    return json(res, 200, { ok: true, summary: await ingestSummary(device) });
  }

  // ── Device Health ──
  if (route === '/device/health' && req.method === 'GET') {
    const device = await getPreferredDevice(req);
    const heartbeat = device ? await getDeviceHeartbeat(device.deviceId) : null;
    const reachability = heartbeat ? 'online' : (device ? toReachability(device) : 'offline');
    return json(res, 200, {
      ok: !!device,
      deviceId: device?.deviceId || null,
      reachability,
    }, device ? { 'Set-Cookie': makeBrowserBindingHeader(device.deviceId) } : {});
  }

  // ── Device Info ──
  if (route === '/device/device-info' && req.method === 'GET') {
    const device = await getPreferredDevice(req);
    if (!device) return json(res, 404, { ok: false, error: 'device_not_available' });
    return json(res, 200, { ok: true, device: buildDeviceInfo(device) }, {
      'Set-Cookie': makeBrowserBindingHeader(device.deviceId),
    });
  }

  // ── Device Library ──
  if (route === '/device/library' && req.method === 'GET') {
    const device = await getPreferredDevice(req);
    if (!device) return json(res, 404, { ok: false, error: 'device_not_available' });
    return json(res, 200, { ok: true, library: device.lastLibrary || { albums: [], tracks: [] } }, {
      'Set-Cookie': makeBrowserBindingHeader(device.deviceId),
    });
  }

  // ── Device Manifest ──
  if (route === '/device/manifest' && req.method === 'GET') {
    const device = await getPreferredDevice(req);
    if (!device) return json(res, 404, { ok: false, error: 'device_not_available' });
    const albumId = String(getQueryValue(req, 'albumId') || '').trim();
    return json(res, 200, { ok: true, manifest: buildManifest(device, albumId) }, {
      'Set-Cookie': makeBrowserBindingHeader(device.deviceId),
    });
  }

  // ── Device Command ──
  if (route === '/device/command' && req.method === 'POST') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const body = await readJsonBody(req);
    const deviceId = String(body?.deviceId || '').trim();
    const command = String(body?.command || '').trim();
    if (!deviceId || !command) {
      return json(res, 400, { ok: false, error: 'invalid_command_target' });
    }
    const deviceRow = await queryOne('SELECT * FROM devices WHERE device_id = $1', [deviceId]);
    if (!deviceRow) return json(res, 400, { ok: false, error: 'invalid_command_target' });

    const queued = {
      id: randomUUID(),
      command,
      params: body?.params || null,
      queuedAt: nowIso(),
    };
    const currentCmds = deviceRow.pending_commands || [];
    currentCmds.push(queued);
    await query(
      'UPDATE devices SET pending_commands = $1, updated_at = now() WHERE device_id = $2',
      [JSON.stringify(currentCmds), deviceId]
    );
    return json(res, 200, { ok: true, command: queued });
  }

  // ═══════════════════════════════════════════════════════════
  // NEW ROUTES: Firmware, Backup, Artwork, Fleet
  // ═══════════════════════════════════════════════════════════

  // ── Firmware Upload ──
  if (route === '/firmware/upload' && req.method === 'POST') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const version = String(getQueryValue(req, 'version') || '').trim();
    if (!version) return json(res, 400, { ok: false, error: 'version_required' });
    const releaseNotes = String(getQueryValue(req, 'notes') || '');
    const isStable = getQueryValue(req, 'stable') !== 'false';
    const buffer = await readRawBody(req);
    const blobResult = await uploadFirmware(buffer, version);
    const id = randomUUID();
    await query(
      `INSERT INTO firmware_versions (id, version, blob_url, is_stable, release_notes, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (version) DO UPDATE SET blob_url = $3, is_stable = $4, release_notes = $5, size_bytes = $6`,
      [id, version, blobResult.url, isStable, releaseNotes, buffer.length]
    );
    return json(res, 200, { ok: true, version, url: blobResult.url, sizeBytes: buffer.length });
  }

  // ── Firmware Latest ──
  if (route === '/firmware/latest' && req.method === 'GET') {
    const edgeVersion = await getFirmwarePointer();
    let row = null;
    if (edgeVersion) {
      row = await queryOne(
        'SELECT * FROM firmware_versions WHERE version = $1 LIMIT 1',
        [edgeVersion]
      );
    }
    if (!row) {
      row = await queryOne(
        'SELECT * FROM firmware_versions WHERE is_stable = true ORDER BY created_at DESC LIMIT 1'
      );
    }
    if (!row) return json(res, 404, { ok: false, error: 'no_stable_firmware' });
    return json(res, 200, {
      ok: true,
      version: row.version,
      url: row.blob_url,
      sizeBytes: Number(row.size_bytes),
      releaseNotes: row.release_notes,
      createdAt: new Date(row.created_at).toISOString(),
      source: edgeVersion ? 'edge_config' : 'database',
    });
  }

  // ── Firmware Version List ──
  if (route === '/firmware/versions' && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const rows = await query('SELECT * FROM firmware_versions ORDER BY created_at DESC');
    return json(res, 200, {
      ok: true,
      versions: rows.map((r) => ({
        version: r.version,
        url: r.blob_url,
        isStable: r.is_stable,
        sizeBytes: Number(r.size_bytes),
        releaseNotes: r.release_notes,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    });
  }

  // ── Backup Snapshot Push ──
  if (route === '/backup/snapshot' && req.method === 'POST') {
    const device = await requireDevice(req);
    if (!device) return json(res, 403, { ok: false, error: 'device_token_rejected' });
    const body = await readJsonBody(req);
    const blobResult = await uploadBackup(body, device.deviceId);
    return json(res, 200, { ok: true, url: blobResult.url, deviceId: device.deviceId });
  }

  // ── Backup Snapshot Get ──
  if (route.startsWith('/backup/snapshot/') && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const duid = route.split('/').pop();
    const latest = await getLatestBackup(duid);
    if (!latest) return json(res, 404, { ok: false, error: 'no_backup_found' });
    return json(res, 200, {
      ok: true,
      url: latest.url,
      size: latest.size,
      uploadedAt: latest.uploadedAt,
    });
  }

  // ── Artwork Upload ──
  if (route === '/artwork/upload' && req.method === 'POST') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const duid = String(getQueryValue(req, 'deviceId') || getQueryValue(req, 'duid') || '').trim();
    const filename = String(getQueryValue(req, 'filename') || 'cover.png').trim();
    if (!duid) return json(res, 400, { ok: false, error: 'device_id_required' });
    const buffer = await readRawBody(req);
    const blobResult = await uploadArtwork(buffer, duid, filename);
    return json(res, 200, { ok: true, url: blobResult.url, duid, filename });
  }

  // ── Fleet Status ──
  if (route === '/fleet/status' && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const rows = await query('SELECT * FROM devices ORDER BY last_seen_at DESC NULLS LAST');
    const onlineSet = new Set(await getOnlineDevices());
    const fleet = rows.map((row) => {
      const d = rowToDevice(row);
      return {
        deviceId: d.deviceId,
        label: d.label,
        firmwareVersion: d.firmwareVersion,
        lastSeenAt: d.lastSeenAt,
        reachability: onlineSet.has(d.deviceId) ? 'online' : toReachability(d),
        albumId: d.albumId,
      };
    });
    return json(res, 200, { ok: true, fleet, total: fleet.length, online: fleet.filter((d) => d.reachability === 'online').length });
  }

  // ── Fleet Analytics (enhanced) ──
  if (route === '/fleet/analytics' && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });

    const [deviceCount, fileCount, totalSize, fwCount, totalPlays, totalSkips, totalHearts, totalListenMs, topTracks, recentEvents, deviceBreakdown] = await Promise.all([
      queryOne('SELECT COUNT(*)::int AS cnt FROM devices'),
      queryOne('SELECT COUNT(*)::int AS cnt FROM ingest_files'),
      queryOne('SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total FROM ingest_files'),
      queryOne('SELECT COUNT(*)::int AS cnt FROM firmware_versions'),
      queryOne("SELECT COUNT(*)::int AS cnt FROM device_events WHERE event_type = 'play'"),
      queryOne("SELECT COUNT(*)::int AS cnt FROM device_events WHERE event_type = 'skip'"),
      queryOne("SELECT COUNT(*)::int AS cnt FROM device_events WHERE event_type = 'heart'"),
      queryOne("SELECT COALESCE(SUM(value), 0)::bigint AS total FROM device_events WHERE event_type = 'listen_ms'"),
      query(`SELECT track_path, track_title, COUNT(*)::int AS plays
             FROM device_events WHERE event_type = 'play' AND track_path != ''
             GROUP BY track_path, track_title ORDER BY plays DESC LIMIT 10`),
      query(`SELECT id, device_id, event_type, track_title, created_at
             FROM device_events ORDER BY created_at DESC LIMIT 20`),
      query(`SELECT device_id, event_type, COUNT(*)::int AS cnt
             FROM device_events GROUP BY device_id, event_type ORDER BY device_id`),
    ]);

    const perDevice = {};
    for (const row of deviceBreakdown) {
      if (!perDevice[row.device_id]) perDevice[row.device_id] = {};
      perDevice[row.device_id][row.event_type] = row.cnt;
    }

    return json(res, 200, {
      ok: true,
      analytics: {
        totalDevices: deviceCount?.cnt || 0,
        totalIngestFiles: fileCount?.cnt || 0,
        totalIngestBytes: Number(totalSize?.total || 0),
        totalFirmwareVersions: fwCount?.cnt || 0,
        totalPlays: totalPlays?.cnt || 0,
        totalSkips: totalSkips?.cnt || 0,
        totalHearts: totalHearts?.cnt || 0,
        totalListenMs: Number(totalListenMs?.total || 0),
        topTracks: topTracks.map((r) => ({ path: r.track_path, title: r.track_title, plays: r.plays })),
        recentEvents: recentEvents.map((r) => ({
          id: r.id, deviceId: r.device_id, type: r.event_type,
          trackTitle: r.track_title, at: new Date(r.created_at).toISOString(),
        })),
        perDevice,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ANALYTICS: Event ingestion + per-device + summary
  // ═══════════════════════════════════════════════════════════

  // ── Batch Event Ingestion (device or operator) ──
  if (route === '/analytics/events' && req.method === 'POST') {
    const device = await requireDevice(req);
    const operator = device ? null : await requireOperator(req);
    if (!device && !operator) return json(res, 403, { ok: false, error: 'auth_required' });

    const body = await readJsonBody(req);
    const events = Array.isArray(body?.events) ? body.events : (body?.event ? [body] : []);
    if (!events.length) return json(res, 400, { ok: false, error: 'events_required' });

    const VALID_TYPES = new Set(['play', 'skip', 'heart', 'unheart', 'listen_ms', 'pause', 'resume', 'seek', 'volume', 'eq_change', 'led_change', 'power_on', 'power_off']);
    let inserted = 0;

    for (const evt of events.slice(0, 100)) {
      const eventType = String(evt?.type || evt?.event_type || '').toLowerCase();
      if (!VALID_TYPES.has(eventType)) continue;
      const deviceId = device?.deviceId || String(evt?.deviceId || evt?.device_id || '').trim();
      if (!deviceId) continue;

      const id = randomUUID();
      const trackPath = String(evt?.trackPath || evt?.track_path || evt?.path || '').trim();
      const trackTitle = String(evt?.trackTitle || evt?.track_title || evt?.title || '').trim();
      const albumId = String(evt?.albumId || evt?.album_id || device?.albumId || '').trim();
      const value = Math.max(0, Number(evt?.value ?? 1));
      const metadata = evt?.metadata ? JSON.stringify(evt.metadata) : null;

      await query(
        `INSERT INTO device_events (id, device_id, event_type, track_path, track_title, album_id, value, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, deviceId, eventType, trackPath, trackTitle, albumId, value, metadata]
      );
      inserted++;
    }

    return json(res, 200, { ok: true, inserted, total: events.length });
  }

  // ── Per-Device Analytics ──
  if (route.startsWith('/analytics/device/') && req.method === 'GET') {
    if (!(await requireOperator(req))) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const duid = route.split('/').pop();
    if (!duid) return json(res, 400, { ok: false, error: 'device_id_required' });

    const [summary, topTracks, timeline, heartedTracks] = await Promise.all([
      query(
        `SELECT event_type, COUNT(*)::int AS cnt, COALESCE(SUM(value), 0)::bigint AS total_value
         FROM device_events WHERE device_id = $1 GROUP BY event_type`,
        [duid]
      ),
      query(
        `SELECT track_path, track_title, COUNT(*)::int AS plays
         FROM device_events WHERE device_id = $1 AND event_type = 'play' AND track_path != ''
         GROUP BY track_path, track_title ORDER BY plays DESC LIMIT 20`,
        [duid]
      ),
      query(
        `SELECT date_trunc('hour', created_at) AS hour, event_type, COUNT(*)::int AS cnt
         FROM device_events WHERE device_id = $1 AND created_at > now() - interval '7 days'
         GROUP BY hour, event_type ORDER BY hour DESC`,
        [duid]
      ),
      query(
        `SELECT DISTINCT ON (track_path) track_path, track_title, created_at
         FROM device_events WHERE device_id = $1 AND event_type = 'heart' AND track_path != ''
         ORDER BY track_path, created_at DESC`,
        [duid]
      ),
    ]);

    const counts = {};
    for (const row of summary) {
      counts[row.event_type] = { count: row.cnt, totalValue: Number(row.total_value) };
    }

    return json(res, 200, {
      ok: true,
      deviceId: duid,
      counts,
      topTracks: topTracks.map((r) => ({ path: r.track_path, title: r.track_title, plays: r.plays })),
      heartedTracks: heartedTracks.map((r) => ({
        path: r.track_path, title: r.track_title, heartedAt: new Date(r.created_at).toISOString(),
      })),
      timeline: timeline.map((r) => ({
        hour: new Date(r.hour).toISOString(), type: r.event_type, count: r.cnt,
      })),
    });
  }

  // ── Analytics Summary (public, no auth) ──
  if (route === '/analytics/summary' && req.method === 'GET') {
    const duid = String(getQueryValue(req, 'deviceId') || '').trim();
    const baseWhere = duid ? 'WHERE device_id = $1' : '';
    const params = duid ? [duid] : [];

    const [plays, hearts, listenMs] = await Promise.all([
      queryOne(`SELECT COUNT(*)::int AS cnt FROM device_events ${baseWhere ? baseWhere + " AND event_type = 'play'" : "WHERE event_type = 'play'"}`, params),
      queryOne(`SELECT COUNT(*)::int AS cnt FROM device_events ${baseWhere ? baseWhere + " AND event_type = 'heart'" : "WHERE event_type = 'heart'"}`, params),
      queryOne(`SELECT COALESCE(SUM(value), 0)::bigint AS total FROM device_events ${baseWhere ? baseWhere + " AND event_type = 'listen_ms'" : "WHERE event_type = 'listen_ms'"}`, params),
    ]);

    return json(res, 200, {
      ok: true,
      ...(duid ? { deviceId: duid } : {}),
      totalPlays: plays?.cnt || 0,
      totalHearts: hearts?.cnt || 0,
      totalListenMs: Number(listenMs?.total || 0),
    });
  }

  return json(res, 404, { ok: false, error: 'not_found', route });
}

// ── Row Mappers ──

function rowToUploadSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    deviceId: row.device_id,
    albumId: row.album_id,
    source: row.source,
    filename: row.filename,
    mimeType: row.mime_type,
    contentKind: row.content_kind,
    status: row.status,
    fileId: row.file_id,
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256 || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : '',
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
}

function rowToIngestFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes || 0),
    mimeType: row.mime_type,
    status: row.status,
    source: row.source,
    deviceId: row.device_id,
    albumId: row.album_id,
    blobUrl: row.blob_url,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
}
