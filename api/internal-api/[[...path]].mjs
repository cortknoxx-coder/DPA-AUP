import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

const OPERATOR_COOKIE = 'dpa_operator_session';
const BROWSER_BINDING_COOKIE = 'dpa_bound_device_id';
const DEVICE_AUTH_HEADER = 'x-dpa-device-token';
const UPLOAD_AUTH_HEADER = 'x-dpa-upload-token';
const DEFAULT_OPERATOR_PASSPHRASE = 'dpa-internal-operator';
const ACTIVE_DEVICE_WINDOW_MS = 2 * 60 * 1000;

function getStore() {
  if (!globalThis.__dpaCloudControlStore) {
    globalThis.__dpaCloudControlStore = {
      operatorSessions: new Map(),
      devices: new Map(),
      uploadSessions: new Map(),
      ingestFiles: new Map(),
    };
  }
  return globalThis.__dpaCloudControlStore;
}

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

function normalizePathParts(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string' && raw.length > 0) return [raw];
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

function requireOperator(req) {
  const store = getStore();
  const cookies = parseCookies(req);
  const sessionId = cookies[OPERATOR_COOKIE];
  if (!sessionId) return null;
  const session = store.operatorSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAtMs) {
    store.operatorSessions.delete(sessionId);
    return null;
  }
  return session;
}

function requireDevice(req) {
  const token = String(req.headers[DEVICE_AUTH_HEADER] || '').trim();
  if (!token) return null;
  const tokenHash = sha256(token);
  for (const device of getStore().devices.values()) {
    if (device.deviceTokenHash && safeEq(device.deviceTokenHash, tokenHash)) {
      return device;
    }
  }
  return null;
}

function toReachability(device) {
  if (!device?.lastSeenAt) return 'offline';
  return (Date.now() - Date.parse(device.lastSeenAt)) <= ACTIVE_DEVICE_WINDOW_MS ? 'online' : 'stale';
}

function getPreferredDevice(req) {
  const store = getStore();
  const queryId = String(getQueryValue(req, 'deviceId') || '').trim();
  if (queryId && store.devices.has(queryId)) return store.devices.get(queryId);

  const cookies = parseCookies(req);
  const boundId = String(cookies[BROWSER_BINDING_COOKIE] || '').trim();
  if (boundId && store.devices.has(boundId)) return store.devices.get(boundId);

  return [...store.devices.values()]
    .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
    .find((device) => toReachability(device) === 'online')
    || [...store.devices.values()].sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))[0]
    || null;
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
    track?.blobId
    || track?.filename
    || track?.path
    || track?.sdPath
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
    payload?.albumId
    || payload?.albumIds?.[0]
    || payload?.album
    || payload?.status?.album
    || device?.albumId
    || device?.deviceId
    || 'device-album'
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
    payload?.library?.artworkUrl
    || payload?.artworkUrl
    || payload?.coverPath
    || payload?.artPath
    || ''
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

function ingestSummary(device) {
  return {
    albumId: device?.albumId || device?.lastLibrary?.albums?.[0]?.id || null,
    deviceId: device?.deviceId || null,
    totalFiles: Number(device?.lastLibrary?.tracks?.length || 0),
    verifiedFiles: 0,
    stagedFiles: 0,
    archivedFiles: 0,
    activeSessions: [...getStore().uploadSessions.values()].filter((session) => session.deviceId === device?.deviceId && session.status !== 'completed').length,
    lastUploadedAt: null,
    lastUploadStatus: null,
    lastDeviceId: device?.deviceId || null,
    lastAlbumId: device?.albumId || device?.lastLibrary?.albums?.[0]?.id || null,
  };
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

  const path = normalizePathParts(req);
  const route = `/${path.join('/')}`;
  const store = getStore();

  if (route === '/' || route === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'dpa-cloud-control',
      devices: store.devices.size,
      activeDevices: [...store.devices.values()].filter((device) => toReachability(device) === 'online').length,
    });
  }

  if (route === '/auth/session' && req.method === 'GET') {
    const session = requireOperator(req);
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
    store.operatorSessions.set(sessionId, { id: sessionId, expiresAtMs });
    return json(res, 200, { ok: true, expiresAt: new Date(expiresAtMs).toISOString() }, {
      'Set-Cookie': `${OPERATOR_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 60 * 60}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    });
  }

  if (route === '/auth/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies[OPERATOR_COOKIE]) {
      store.operatorSessions.delete(cookies[OPERATOR_COOKIE]);
    }
    clearCookie(res, OPERATOR_COOKIE);
    return json(res, 200, { ok: true });
  }

  if (route === '/devices/register' && req.method === 'POST') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const body = await readJsonBody(req);
    const deviceId = String(body?.deviceId || '').trim();
    if (!deviceId) return json(res, 400, { ok: false, error: 'device_id_required' });
    const label = String(body?.label || deviceId).trim();
    const albumId = String(body?.albumId || deviceId).trim();
    const createdAt = nowIso();
    const existing = store.devices.get(deviceId);
    const rawToken = randomUUID();
    const device = {
      id: existing?.id || randomUUID(),
      deviceId,
      label,
      albumId,
      createdAt: existing?.createdAt || createdAt,
      updatedAt: createdAt,
      lastSeenAt: existing?.lastSeenAt || '',
      firmwareVersion: existing?.firmwareVersion || '',
      deviceTokenHash: sha256(rawToken),
      pendingCommands: existing?.pendingCommands || [],
      lastLibrary: existing?.lastLibrary || { albums: [], tracks: [] },
      lastStatus: existing?.lastStatus || null,
      lastCheckIn: existing?.lastCheckIn || null,
    };
    store.devices.set(deviceId, device);
    return json(res, 200, {
      ok: true,
      device: {
        id: device.id,
        deviceId: device.deviceId,
        label: device.label,
        albumId: device.albumId,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
        lastSeenAt: device.lastSeenAt,
      },
      deviceToken: rawToken,
    });
  }

  if (route === '/devices' && req.method === 'GET') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const devices = [...store.devices.values()]
      .map((device) => ({
        id: device.id,
        deviceId: device.deviceId,
        label: device.label,
        albumId: device.albumId,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
        lastSeenAt: device.lastSeenAt,
        reachability: toReachability(device),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return json(res, 200, { ok: true, devices });
  }

  if (route === '/device/check-in' && req.method === 'POST') {
    const device = requireDevice(req);
    if (!device) return json(res, 403, { ok: false, error: 'device_token_rejected' });
    const body = await readJsonBody(req);
    const checkedAt = nowIso();
    const library = normalizeLibraryPayload(body, device);
    const updated = {
      ...device,
      updatedAt: checkedAt,
      lastSeenAt: checkedAt,
      firmwareVersion: String(body?.firmwareVersion || body?.status?.firmwareVersion || device.firmwareVersion || ''),
      lastStatus: body?.status || body || null,
      lastCheckIn: body,
      lastLibrary: library,
    };
    store.devices.set(device.deviceId, updated);
    const commands = Array.isArray(updated.pendingCommands) ? updated.pendingCommands.splice(0, updated.pendingCommands.length) : [];
    return json(res, 200, {
      ok: true,
      deviceId: updated.deviceId,
      reachability: 'online',
      checkedInAt: checkedAt,
      commands,
      capsules: [],
      relaySession: {
        transport: 'cloud_relay',
        reachability: 'online',
      },
    }, {
      'Set-Cookie': makeBrowserBindingHeader(updated.deviceId),
    });
  }

  if (route === '/device/session' && req.method === 'POST') {
    const device = requireDevice(req);
    if (!device) return json(res, 403, { ok: false, error: 'device_token_rejected' });
    const body = await readJsonBody(req);
    const sessionId = randomUUID();
    const uploadToken = randomUUID();
    const now = nowIso();
    const session = {
      id: sessionId,
      deviceId: device.deviceId,
      albumId: String(body?.albumId || device.albumId || device.deviceId),
      source: 'device',
      filename: String(body?.filename || ''),
      mimeType: String(body?.mimeType || 'application/octet-stream'),
      contentKind: String(body?.contentKind || 'unknown'),
      status: 'created',
      fileId: randomUUID(),
      sizeBytes: 0,
      sha256: '',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + (30 * 60 * 1000)).toISOString(),
      uploadTokenHash: sha256(uploadToken),
    };
    store.uploadSessions.set(sessionId, session);
    return json(res, 200, { ok: true, sessionId, uploadToken, session });
  }

  if (route === '/ingest/sessions' && req.method === 'POST') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const body = await readJsonBody(req);
    const sessionId = randomUUID();
    const uploadToken = randomUUID();
    const now = nowIso();
    const session = {
      id: sessionId,
      deviceId: String(body?.deviceId || 'UNASSIGNED'),
      albumId: String(body?.albumId || 'UNASSIGNED'),
      source: String(body?.source || 'operator'),
      filename: String(body?.filename || ''),
      mimeType: String(body?.mimeType || 'application/octet-stream'),
      contentKind: String(body?.contentKind || 'unknown'),
      status: 'created',
      fileId: randomUUID(),
      sizeBytes: 0,
      sha256: '',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + (30 * 60 * 1000)).toISOString(),
      uploadTokenHash: sha256(uploadToken),
    };
    store.uploadSessions.set(sessionId, session);
    return json(res, 200, { ok: true, session: { ...session, uploadTokenHash: undefined }, uploadToken });
  }

  if (route.startsWith('/ingest/upload/') && req.method === 'PUT') {
    const sessionId = route.split('/').pop();
    const uploadToken = String(req.headers[UPLOAD_AUTH_HEADER] || '').trim();
    const session = sessionId ? store.uploadSessions.get(sessionId) : null;
    if (!session || !uploadToken || !safeEq(session.uploadTokenHash, sha256(uploadToken))) {
      return json(res, 403, { ok: false, error: 'upload_token_rejected' });
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const blob = Buffer.concat(chunks);
    session.sizeBytes = blob.length;
    session.updatedAt = nowIso();
    session.status = 'uploaded';
    store.ingestFiles.set(session.fileId, {
      id: session.fileId,
      filename: session.filename,
      sizeBytes: session.sizeBytes,
      mimeType: session.mimeType,
      status: 'staged',
      source: 'device-drop',
      deviceId: session.deviceId,
      albumId: session.albumId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      buffer: blob,
    });
    return json(res, 200, { ok: true, fileId: session.fileId, sizeBytes: session.sizeBytes });
  }

  if (route.startsWith('/ingest/complete/') && req.method === 'POST') {
    const sessionId = route.split('/').pop();
    const uploadToken = String(req.headers[UPLOAD_AUTH_HEADER] || '').trim();
    const session = sessionId ? store.uploadSessions.get(sessionId) : null;
    if (!session || !uploadToken || !safeEq(session.uploadTokenHash, sha256(uploadToken))) {
      return json(res, 403, { ok: false, error: 'upload_token_rejected' });
    }
    session.status = 'completed';
    session.completedAt = nowIso();
    session.updatedAt = session.completedAt;
    const file = store.ingestFiles.get(session.fileId);
    if (file) file.updatedAt = session.completedAt;
    return json(res, 200, { ok: true });
  }

  if (route === '/ingest/files' && req.method === 'GET') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const files = [...store.ingestFiles.values()]
      .map(({ buffer, ...file }) => file)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const device = getPreferredDevice(req);
    return json(res, 200, { ok: true, files, summary: ingestSummary(device) });
  }

  if (route.startsWith('/ingest/files/') && route.endsWith('/status') && req.method === 'POST') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const parts = route.split('/');
    const fileId = parts[3];
    const file = store.ingestFiles.get(fileId);
    if (!file) return json(res, 404, { ok: false, error: 'file_not_found' });
    const body = await readJsonBody(req);
    file.status = String(body?.status || file.status || 'staged');
    file.updatedAt = nowIso();
    store.ingestFiles.set(fileId, file);
    return json(res, 200, { ok: true, file: { ...file, buffer: undefined } });
  }

  if (route.startsWith('/ingest/files/') && req.method === 'DELETE') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const fileId = route.split('/')[3];
    store.ingestFiles.delete(fileId);
    return json(res, 200, { ok: true });
  }

  if (route === '/ingest/sessions' && req.method === 'GET') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const sessions = [...store.uploadSessions.values()]
      .map(({ uploadTokenHash, ...session }) => session)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(res, 200, { ok: true, sessions });
  }

  if (route.startsWith('/ingest/download/') && req.method === 'GET') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const fileId = route.split('/').pop();
    const file = fileId ? store.ingestFiles.get(fileId) : null;
    if (!file?.buffer) return json(res, 404, { ok: false, error: 'file_not_found' });
    res.statusCode = 200;
    res.setHeader('content-type', file.mimeType || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(file.buffer);
    return;
  }

  if (route === '/public/ingest/summary' && req.method === 'GET') {
    const requestedDeviceId = String(getQueryValue(req, 'deviceId') || '').trim();
    const device = (requestedDeviceId && store.devices.get(requestedDeviceId)) || getPreferredDevice(req);
    return json(res, 200, { ok: true, summary: ingestSummary(device) });
  }

  if (route === '/device/health' && req.method === 'GET') {
    const device = getPreferredDevice(req);
    return json(res, 200, {
      ok: !!device,
      deviceId: device?.deviceId || null,
      reachability: device ? toReachability(device) : 'offline',
    }, device ? { 'Set-Cookie': makeBrowserBindingHeader(device.deviceId) } : {});
  }

  if (route === '/device/device-info' && req.method === 'GET') {
    const device = getPreferredDevice(req);
    if (!device) return json(res, 404, { ok: false, error: 'device_not_available' });
    return json(res, 200, { ok: true, device: buildDeviceInfo(device) }, {
      'Set-Cookie': makeBrowserBindingHeader(device.deviceId),
    });
  }

  if (route === '/device/library' && req.method === 'GET') {
    const device = getPreferredDevice(req);
    if (!device) return json(res, 404, { ok: false, error: 'device_not_available' });
    return json(res, 200, { ok: true, library: device.lastLibrary || { albums: [], tracks: [] } }, {
      'Set-Cookie': makeBrowserBindingHeader(device.deviceId),
    });
  }

  if (route === '/device/manifest' && req.method === 'GET') {
    const device = getPreferredDevice(req);
    if (!device) return json(res, 404, { ok: false, error: 'device_not_available' });
    const albumId = String(getQueryValue(req, 'albumId') || '').trim();
    return json(res, 200, { ok: true, manifest: buildManifest(device, albumId) }, {
      'Set-Cookie': makeBrowserBindingHeader(device.deviceId),
    });
  }

  if (route === '/device/command' && req.method === 'POST') {
    if (!requireOperator(req)) return json(res, 401, { ok: false, error: 'operator_auth_required' });
    const body = await readJsonBody(req);
    const deviceId = String(body?.deviceId || '').trim();
    const command = String(body?.command || '').trim();
    if (!deviceId || !command || !store.devices.has(deviceId)) {
      return json(res, 400, { ok: false, error: 'invalid_command_target' });
    }
    const device = store.devices.get(deviceId);
    const queued = {
      id: randomUUID(),
      command,
      params: body?.params || null,
      queuedAt: nowIso(),
    };
    device.pendingCommands = Array.isArray(device.pendingCommands) ? device.pendingCommands : [];
    device.pendingCommands.push(queued);
    device.updatedAt = nowIso();
    store.devices.set(deviceId, device);
    return json(res, 200, { ok: true, command: queued });
  }

  return json(res, 404, {
    ok: false,
    error: 'not_found',
    route,
  });
}
