import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.DPA_INTERNAL_INGEST_PORT || 8787);
const DATA_ROOT = process.env.DPA_INTERNAL_INGEST_DIR
  ? path.resolve(process.env.DPA_INTERNAL_INGEST_DIR)
  : path.join(process.cwd(), '.internal-ingest-data');
const FILE_ROOT = path.join(DATA_ROOT, 'files');
const DB_PATH = path.join(DATA_ROOT, 'state.json');
const INTERNAL_API_PREFIX = '/internal-api';
const BRIDGE_PREFIX = '/bridge';
const DEVICE_API_PREFIX = '/device-api';
const DEVICE_UPLOAD_PREFIX = '/device-upload';
const OPERATOR_COOKIE = 'dpa_internal_session';
const OPERATOR_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000;
const OPERATOR_KEY = process.env.DPA_INTERNAL_OPERATOR_KEY || 'dpa-operator-preview';
const DEVICE_HTTP_ORIGIN = process.env.DPA_DEVICE_HTTP_ORIGIN || 'http://192.168.4.1';
const DEVICE_UPLOAD_ORIGIN = process.env.DPA_DEVICE_UPLOAD_ORIGIN || 'http://192.168.4.1:81';
const DELIVERY_STATUS_ACTIVE = new Set(['pending', 'announced', 'downloading', 'downloaded', 'verifying']);
const DELIVERY_STATUS_ALL = new Set(['pending', 'announced', 'downloading', 'downloaded', 'verifying', 'installed', 'seen', 'failed', 'expired']);
const DELIVERY_FAILURE_ERRORS = new Set([
  'device token rejected',
  'storage_insufficient',
  'download_failed',
  'checksum_mismatch',
  'rename_failed',
  'install_index_failed',
  'unsupported_payload',
  'sta_not_connected',
]);

const defaultState = () => ({
  operatorSessions: [],
  devices: [],
  uploadSessions: [],
  files: [],
  capsules: [],
  entitlements: [],
  deliveries: [],
});

mkdirSync(FILE_ROOT, { recursive: true });

let state = loadState();
cleanupState();

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const pathname = requestUrl.pathname;
  const method = req.method || 'GET';

  setCors(res, req.headers.origin);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (pathname === `${BRIDGE_PREFIX}/health` && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        service: 'dpa-local-helper',
        deviceApiOrigin: DEVICE_HTTP_ORIGIN,
        deviceUploadOrigin: DEVICE_UPLOAD_ORIGIN,
      });
    }

    if (pathname === `${BRIDGE_PREFIX}/device-info` && method === 'GET') {
      const info = await buildBridgeDeviceInfo();
      return sendJson(res, 200, { ok: true, device: info });
    }

    if (pathname === `${BRIDGE_PREFIX}/library` && method === 'GET') {
      const library = await buildBridgeLibrary();
      return sendJson(res, 200, { ok: true, library });
    }

    if (pathname === `${BRIDGE_PREFIX}/manifest` && method === 'GET') {
      const albumId = String(requestUrl.searchParams.get('albumId') || '').trim();
      const manifest = await buildBridgeManifest(albumId);
      return sendJson(res, 200, { ok: true, manifest });
    }

    if (pathname === DEVICE_API_PREFIX || pathname.startsWith(`${DEVICE_API_PREFIX}/`)) {
      return proxyToDevice(req, res, DEVICE_HTTP_ORIGIN, DEVICE_API_PREFIX);
    }

    if (pathname === DEVICE_UPLOAD_PREFIX || pathname.startsWith(`${DEVICE_UPLOAD_PREFIX}/`)) {
      return proxyToDevice(req, res, DEVICE_UPLOAD_ORIGIN, DEVICE_UPLOAD_PREFIX);
    }

    if (pathname === `${INTERNAL_API_PREFIX}/health` && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        service: 'private-dpac-ingest',
        operatorAuthRequired: true,
        storageRoot: DATA_ROOT,
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/auth/login` && method === 'POST') {
      const body = await readJson(req);
      if ((body.passphrase || '') !== OPERATOR_KEY) {
        return sendJson(res, 403, { ok: false, error: 'invalid passphrase' });
      }

      const token = randomToken();
      const session = {
        id: randomId('ops'),
        tokenHash: sha256(token),
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + OPERATOR_SESSION_TTL_MS).toISOString(),
      };
      state.operatorSessions.push(session);
      persistState();

      res.setHeader('Set-Cookie', buildCookie(OPERATOR_COOKIE, token, session.expiresAt));
      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        expiresAt: session.expiresAt,
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/auth/logout` && method === 'POST') {
      const token = readCookie(req, OPERATOR_COOKIE);
      if (token) {
        state.operatorSessions = state.operatorSessions.filter((session) => session.tokenHash !== sha256(token));
        persistState();
      }
      res.setHeader('Set-Cookie', buildCookie(OPERATOR_COOKIE, '', new Date(0).toISOString()));
      return sendJson(res, 200, { ok: true, authenticated: false });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/auth/session` && method === 'GET') {
      const session = getOperatorSession(req);
      return sendJson(res, 200, {
        ok: true,
        authenticated: !!session,
        expiresAt: session?.expiresAt || null,
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/devices` && method === 'GET') {
      if (!requireOperator(req, res)) return;
      return sendJson(res, 200, { ok: true, devices: listDevices() });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/devices/register` && method === 'POST') {
      if (!requireOperator(req, res)) return;
      const body = await readJson(req);
      const deviceId = String(body.deviceId || '').trim();
      if (!deviceId) {
        return sendJson(res, 400, { ok: false, error: 'deviceId required' });
      }

      const deviceToken = randomToken();
      const now = nowIso();
      const existing = state.devices.find((device) => device.deviceId === deviceId);
      if (existing) {
        existing.label = String(body.label || existing.label || '').trim();
        existing.albumId = String(body.albumId || existing.albumId || '').trim();
        existing.tokenHash = sha256(deviceToken);
        existing.updatedAt = now;
      } else {
        state.devices.push({
          id: randomId('dev'),
          deviceId,
          label: String(body.label || '').trim(),
          albumId: String(body.albumId || '').trim(),
          tokenHash: sha256(deviceToken),
          createdAt: now,
          updatedAt: now,
          lastSeenAt: '',
        });
      }
      persistState();

      const registered = state.devices.find((device) => device.deviceId === deviceId);
      return sendJson(res, 200, {
        ok: true,
        device: sanitizeDevice(registered),
        deviceToken,
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/capsules` && method === 'GET') {
      if (!requireOperator(req, res)) return;
      return sendJson(res, 200, { ok: true, capsules: listCapsules() });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/capsules` && method === 'POST') {
      if (!requireOperator(req, res)) return;
      const body = await readJson(req);
      const result = upsertCapsule(body);
      if (!result.ok) {
        return sendJson(res, result.statusCode, { ok: false, error: result.error });
      }
      return sendJson(res, 200, { ok: true, capsule: presentCapsule(result.capsule) });
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/capsules/`) && method === 'POST' && pathname.endsWith('/publish')) {
      if (!requireOperator(req, res)) return;
      const parts = pathname.split('/');
      const capsuleId = decodeURIComponent(parts[3] || '');
      const body = await readJson(req);
      const result = publishCapsule(capsuleId, body);
      if (!result.ok) {
        return sendJson(res, result.statusCode, { ok: false, error: result.error });
      }
      return sendJson(res, 200, {
        ok: true,
        capsule: presentCapsule(result.capsule),
        publish: result.publish,
        entitlements: result.entitlements.map((entry) => presentEntitlement(entry)),
        deliveries: result.deliveries.map((entry) => presentDelivery(entry)),
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/entitlements` && method === 'GET') {
      if (!requireOperator(req, res)) return;
      return sendJson(res, 200, { ok: true, entitlements: listEntitlements(), deliveries: listDeliveries() });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/entitlements` && method === 'POST') {
      if (!requireOperator(req, res)) return;
      const body = await readJson(req);
      const result = createEntitlement(body);
      if (!result.ok) {
        return sendJson(res, result.statusCode, { ok: false, error: result.error });
      }
      return sendJson(res, 200, {
        ok: true,
        entitlement: presentEntitlement(result.entitlement),
        delivery: presentDelivery(result.delivery),
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/ingest/files` && method === 'GET') {
      if (!requireOperator(req, res)) return;
      return sendJson(res, 200, {
        ok: true,
        files: listFiles(),
        summary: computeSummary({}),
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/ingest/sessions` && method === 'GET') {
      if (!requireOperator(req, res)) return;
      return sendJson(res, 200, {
        ok: true,
        sessions: listUploadSessions(),
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/ingest/sessions` && method === 'POST') {
      if (!requireOperator(req, res)) return;
      const body = await readJson(req);
      const session = createUploadSession({
        deviceId: String(body.deviceId || '').trim() || 'UNASSIGNED',
        albumId: String(body.albumId || '').trim() || 'UNASSIGNED',
        source: String(body.source || 'operator') === 'device' ? 'device' : 'operator',
        filename: String(body.filename || '').trim(),
        mimeType: String(body.mimeType || 'application/octet-stream'),
        contentKind: String(body.contentKind || 'support'),
      });
      return sendJson(res, 200, {
        ok: true,
        sessionId: session.id,
        session: presentSession(session),
        uploadToken: session.uploadTokenPlain,
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/device/session` && method === 'POST') {
      const deviceToken = String(req.headers['x-dpa-device-token'] || '');
      const body = await readJson(req);
      const deviceId = String(body.deviceId || '').trim();
      const device = state.devices.find((entry) => entry.deviceId === deviceId && entry.tokenHash === sha256(deviceToken));
      if (!device) {
        return sendJson(res, 403, { ok: false, error: 'device token rejected' });
      }

      device.lastSeenAt = nowIso();
      device.updatedAt = nowIso();
      persistState();

      const session = createUploadSession({
        deviceId,
        albumId: String(body.albumId || device.albumId || '').trim() || 'UNASSIGNED',
        source: 'device',
        filename: String(body.filename || '').trim(),
        mimeType: String(body.mimeType || 'application/octet-stream'),
        contentKind: String(body.contentKind || 'support'),
      });
      return sendJson(res, 200, {
        ok: true,
        sessionId: session.id,
        session: presentSession(session),
        uploadToken: session.uploadTokenPlain,
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/device/check-in` && method === 'POST') {
      const body = await readJson(req);
      const deviceId = String(body.deviceId || '').trim();
      const auth = authenticateDeviceRequest(req, deviceId);
      if (!auth.ok) {
        return sendJson(res, auth.statusCode, { ok: false, error: auth.error });
      }

      const installedCapsules = normalizeInstalledCapsules(body.installedCapsules);
      touchDevice(auth.device, {
        firmwareVersion: String(body.firmwareVersion || '').trim(),
        albumIds: normalizeStringArray(body.albumIds),
        freeStorageMb: normalizeNumber(body.freeStorageMb),
        batteryPercent: normalizeNumber(body.batteryPercent),
        wifiRssi: normalizeNumber(body.wifiRssi),
      });
      reconcileInstalledCapsules(deviceId, installedCapsules);
      ensureDeviceDeliveries(deviceId, normalizeStringArray(body.albumIds));
      persistState();

      const capsules = buildPendingCapsulePayloads({
        deviceId,
        installedCapsules,
        requestUrl,
      });

      return sendJson(res, 200, {
        ok: true,
        deviceId,
        serverTime: nowIso(),
        pendingCount: capsules.length,
        capsules,
      });
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/device/capsules/`) && method === 'GET' && pathname.endsWith('/download')) {
      const parts = pathname.split('/');
      const deliveryId = parts[parts.length - 2] || '';
      const result = authenticateDeliveryRequest(req, deliveryId);
      if (!result.ok) {
        return sendJson(res, result.statusCode, { ok: false, error: result.error });
      }
      const download = resolveCapsuleDownload(result.capsule);
      if (!download.ok) {
        return sendJson(res, download.statusCode, { ok: false, error: download.error });
      }

      if (download.kind === 'redirect') {
        res.writeHead(302, { Location: download.location, Connection: 'close' });
        res.end();
        return;
      }

      const buffer = readFileSync(download.path);
      res.writeHead(200, {
        'Content-Type': download.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${download.filename}"`,
        'Content-Length': buffer.length,
        Connection: 'close',
      });
      res.end(buffer);
      return;
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/device/capsules/`) && method === 'POST') {
      const parts = pathname.split('/');
      const deliveryId = parts[parts.length - 2] || '';
      const action = parts[parts.length - 1] || '';
      if (parts.length >= 6 && deliveryId && action) {
        const body = await readJson(req);
        const result = authenticateDeliveryRequest(req, deliveryId, body);
        if (!result.ok) {
          return sendJson(res, result.statusCode, { ok: false, error: result.error });
        }

        if (action === 'announce') {
          markDeliveryAnnounced(result.delivery);
          persistState();
          return sendJson(res, 200, {
            ok: true,
            deliveryId: result.delivery.id,
            status: result.delivery.status,
            updatedAt: result.delivery.updatedAt,
          });
        }

        if (action === 'progress') {
          const nextStatus = String(body.status || 'downloading');
          if (!['downloading', 'verifying'].includes(nextStatus)) {
            return sendJson(res, 400, { ok: false, error: 'invalid status' });
          }
          updateDeliveryProgress(result.delivery, body, nextStatus);
          persistState();
          return sendJson(res, 200, {
            ok: true,
            deliveryId: result.delivery.id,
            status: result.delivery.status,
            progressBytes: result.delivery.progressBytes,
            updatedAt: result.delivery.updatedAt,
          });
        }

        if (action === 'downloaded') {
          const validation = markDeliveryDownloaded(result.delivery, result.capsule, body);
          if (!validation.ok) {
            persistState();
            return sendJson(res, validation.statusCode, { ok: false, error: validation.error });
          }
          persistState();
          return sendJson(res, 200, {
            ok: true,
            deliveryId: result.delivery.id,
            status: result.delivery.status,
          });
        }

        if (action === 'complete') {
          const completion = markDeliveryComplete(result.delivery, result.capsule, body);
          if (!completion.ok) {
            persistState();
            return sendJson(res, completion.statusCode, { ok: false, error: completion.error });
          }
          persistState();
          return sendJson(res, 200, {
            ok: true,
            deliveryId: result.delivery.id,
            status: result.delivery.status,
            installedAt: result.delivery.installedAt,
          });
        }

        if (action === 'fail') {
          const error = String(body.error || '').trim();
          if (error && !DELIVERY_FAILURE_ERRORS.has(error)) {
            return sendJson(res, 400, { ok: false, error: 'invalid error' });
          }
          markDeliveryFailed(result.delivery, error || 'download_failed');
          persistState();
          return sendJson(res, 200, {
            ok: true,
            deliveryId: result.delivery.id,
            status: result.delivery.status,
            retryEligible: deliveryRetryEligible(result.delivery.lastError),
          });
        }

        if (action === 'seen') {
          markDeliverySeen(result.delivery);
          persistState();
          return sendJson(res, 200, {
            ok: true,
            deliveryId: result.delivery.id,
            status: result.delivery.status,
            seenAt: result.delivery.seenAt,
          });
        }
      }
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/ingest/upload/`) && method === 'PUT') {
      const sessionId = pathname.split('/').pop() || '';
      const session = state.uploadSessions.find((entry) => entry.id === sessionId);
      if (!session) {
        return sendJson(res, 404, { ok: false, error: 'upload session not found' });
      }

      const authorized = hasOperatorSession(req) || validateUploadToken(req, session);
      if (!authorized) {
        return sendJson(res, 403, { ok: false, error: 'upload token required' });
      }
      if (new Date(session.expiresAt).getTime() < Date.now()) {
        session.status = 'expired';
        persistState();
        return sendJson(res, 410, { ok: false, error: 'upload session expired' });
      }

      const requestedFilename = sanitizeFilename(requestUrl.searchParams.get('filename') || session.filename || 'payload.bin');
      const mimeType = String(req.headers['content-type'] || session.mimeType || 'application/octet-stream');
      const fileId = randomId('file');
      const extension = path.extname(requestedFilename) || '';
      const targetName = `${fileId}${extension}`;
      const targetPath = path.join(FILE_ROOT, targetName);
      const hash = crypto.createHash('sha256');
      let sizeBytes = 0;

      session.status = 'uploading';
      session.updatedAt = nowIso();
      persistState();

      const tracker = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          sizeBytes += chunk.length;
          callback(null, chunk);
        },
      });

      await pipeline(req, tracker, createWriteStream(targetPath));

      const fileRecord = {
        id: fileId,
        sessionId: session.id,
        deviceId: session.deviceId,
        albumId: session.albumId,
        filename: requestedFilename,
        storedFilename: targetName,
        mimeType,
        contentKind: session.contentKind,
        source: session.source,
        sizeBytes,
        sha256: hash.digest('hex'),
        status: 'staged',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      state.files.push(fileRecord);
      session.fileId = fileId;
      session.filename = requestedFilename;
      session.mimeType = mimeType;
      session.sizeBytes = sizeBytes;
      session.sha256 = fileRecord.sha256;
      session.status = 'uploaded';
      session.updatedAt = nowIso();
      persistState();

      return sendJson(res, 200, {
        ok: true,
        file: sanitizeFile(fileRecord),
      });
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/ingest/complete/`) && method === 'POST') {
      const sessionId = pathname.split('/').pop() || '';
      const session = state.uploadSessions.find((entry) => entry.id === sessionId);
      if (!session) {
        return sendJson(res, 404, { ok: false, error: 'upload session not found' });
      }
      const authorized = hasOperatorSession(req) || validateUploadToken(req, session);
      if (!authorized) {
        return sendJson(res, 403, { ok: false, error: 'upload token required' });
      }
      const fileRecord = state.files.find((entry) => entry.id === session.fileId);
      if (!fileRecord) {
        return sendJson(res, 409, { ok: false, error: 'upload missing file payload' });
      }
      fileRecord.status = 'verified';
      fileRecord.updatedAt = nowIso();
      session.status = 'complete';
      session.completedAt = nowIso();
      session.updatedAt = nowIso();
      persistState();
      return sendJson(res, 200, {
        ok: true,
        session: presentSession(session),
        file: sanitizeFile(fileRecord),
      });
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/ingest/files/`) && pathname.endsWith('/status') && method === 'POST') {
      if (!requireOperator(req, res)) return;
      const parts = pathname.split('/');
      const fileId = parts[parts.length - 2];
      const fileRecord = state.files.find((entry) => entry.id === fileId);
      if (!fileRecord) {
        return sendJson(res, 404, { ok: false, error: 'file not found' });
      }
      const body = await readJson(req);
      const nextStatus = String(body.status || '');
      if (!['staged', 'verified', 'archived'].includes(nextStatus)) {
        return sendJson(res, 400, { ok: false, error: 'invalid status' });
      }
      fileRecord.status = nextStatus;
      fileRecord.updatedAt = nowIso();
      persistState();
      return sendJson(res, 200, { ok: true, file: sanitizeFile(fileRecord) });
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/ingest/files/`) && method === 'DELETE') {
      if (!requireOperator(req, res)) return;
      const fileId = pathname.split('/').pop() || '';
      const index = state.files.findIndex((entry) => entry.id === fileId);
      if (index === -1) {
        return sendJson(res, 404, { ok: false, error: 'file not found' });
      }
      const [fileRecord] = state.files.splice(index, 1);
      state.uploadSessions.forEach((session) => {
        if (session.fileId === fileRecord.id) {
          session.fileId = '';
          session.status = 'deleted';
          session.updatedAt = nowIso();
        }
      });
      const targetPath = path.join(FILE_ROOT, fileRecord.storedFilename);
      if (existsSync(targetPath)) unlinkSync(targetPath);
      persistState();
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith(`${INTERNAL_API_PREFIX}/ingest/download/`) && method === 'GET') {
      if (!requireOperator(req, res)) return;
      const fileId = pathname.split('/').pop() || '';
      const fileRecord = state.files.find((entry) => entry.id === fileId);
      if (!fileRecord) {
        return sendJson(res, 404, { ok: false, error: 'file not found' });
      }
      const targetPath = path.join(FILE_ROOT, fileRecord.storedFilename);
      if (!existsSync(targetPath)) {
        return sendJson(res, 404, { ok: false, error: 'stored file missing' });
      }
      const buffer = readFileSync(targetPath);
      res.writeHead(200, {
        'Content-Type': fileRecord.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileRecord.filename}"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
      return;
    }

    if (pathname === `${INTERNAL_API_PREFIX}/public/ingest/summary` && method === 'GET') {
      const albumId = String(requestUrl.searchParams.get('albumId') || '').trim();
      const deviceId = String(requestUrl.searchParams.get('deviceId') || '').trim();
      return sendJson(res, 200, {
        ok: true,
        summary: computeSummary({ albumId, deviceId }),
      });
    }

    if (pathname === `${INTERNAL_API_PREFIX}/public/capsules/summary` && method === 'GET') {
      const albumId = String(requestUrl.searchParams.get('albumId') || '').trim();
      const deviceId = String(requestUrl.searchParams.get('deviceId') || '').trim();
      return sendJson(res, 200, {
        ok: true,
        summary: computeCapsuleSummary({ albumId, deviceId }),
      });
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    console.error('[PrivateIngestApi] Request failed', error);
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'internal error',
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PrivateIngestApi] listening on http://0.0.0.0:${PORT}`);
  console.log(`[PrivateIngestApi] storage root ${DATA_ROOT}`);
});

function loadState() {
  if (!existsSync(DB_PATH)) {
    const initial = defaultState();
    writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    return { ...defaultState(), ...JSON.parse(readFileSync(DB_PATH, 'utf8')) };
  } catch (error) {
    console.warn('[PrivateIngestApi] state file invalid, rebuilding', error);
    const initial = defaultState();
    writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function persistState() {
  cleanupState();
  writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

function cleanupState() {
  const now = Date.now();
  state.operatorSessions = state.operatorSessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  state.uploadSessions = state.uploadSessions.map((session) => {
    if (new Date(session.expiresAt).getTime() <= now && !['complete', 'deleted'].includes(session.status)) {
      return { ...session, status: 'expired' };
    }
    return session;
  });
  state.deliveries = state.deliveries.map((delivery) => {
    const entitlement = state.entitlements.find((entry) => entry.id === delivery.entitlementId);
    if (!entitlement?.expiresAt) return delivery;
    if (new Date(entitlement.expiresAt).getTime() > now) return delivery;
    if (['installed', 'seen'].includes(delivery.status)) return delivery;
    return { ...delivery, status: 'expired', updatedAt: nowIso() };
  });
}

function setCors(res, origin) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DPA-Device-Token, X-DPA-Upload-Token, Range, Cache-Control, Pragma, Accept, Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    Connection: 'close',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function readCookie(req, key) {
  return parseCookies(req)[key] || '';
}

function buildCookie(name, value, expiresAt) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}

function hasOperatorSession(req) {
  return !!getOperatorSession(req);
}

function getOperatorSession(req) {
  const token = readCookie(req, OPERATOR_COOKIE);
  if (!token) return null;
  return state.operatorSessions.find((session) => session.tokenHash === sha256(token)) || null;
}

function requireOperator(req, res) {
  if (getOperatorSession(req)) return true;
  sendJson(res, 401, { ok: false, error: 'operator authentication required' });
  return false;
}

function validateUploadToken(req, session) {
  const token = String(req.headers['x-dpa-upload-token'] || '');
  return !!token && sha256(token) === session.uploadTokenHash;
}

function createUploadSession({ deviceId, albumId, source, filename, mimeType, contentKind }) {
  const uploadTokenPlain = randomToken();
  const session = {
    id: randomId('upl'),
    deviceId,
    albumId,
    source,
    filename,
    mimeType,
    contentKind,
    status: 'pending',
    fileId: '',
    sizeBytes: 0,
    sha256: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    completedAt: '',
    expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString(),
    uploadTokenHash: sha256(uploadTokenPlain),
    uploadTokenPlain,
  };
  state.uploadSessions.push(session);
  persistState();
  return session;
}

function listDevices() {
  return state.devices
    .map((device) => sanitizeDevice(device))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function listFiles() {
  return state.files
    .map((file) => sanitizeFile(file))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function listUploadSessions() {
  return state.uploadSessions
    .map((session) => presentSession(session))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function presentSession(session) {
  const { uploadTokenPlain, uploadTokenHash, ...safe } = session;
  return safe;
}

function sanitizeFile(file) {
  const { storedFilename, ...safe } = file;
  return safe;
}

function sanitizeDevice(device) {
  const { tokenHash, ...safe } = device;
  return safe;
}

function listCapsules() {
  return state.capsules
    .map((capsule) => presentCapsule(capsule))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function listEntitlements() {
  return state.entitlements
    .map((entitlement) => presentEntitlement(entitlement))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function listDeliveries() {
  return state.deliveries
    .map((delivery) => presentDelivery(delivery))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function presentCapsule(capsule) {
  return { ...capsule };
}

function presentEntitlement(entitlement) {
  return { ...entitlement };
}

function presentDelivery(delivery) {
  return { ...delivery };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

function normalizeInstalledCapsules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      capsuleId: String(entry?.capsuleId || '').trim(),
      version: Number.isFinite(Number(entry?.version)) ? Number(entry.version) : undefined,
      seen: entry?.seen === true,
    }))
    .filter((entry) => entry.capsuleId);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function authenticateDeviceRequest(req, deviceId) {
  if (!deviceId) {
    return { ok: false, statusCode: 400, error: 'deviceId required' };
  }
  const device = state.devices.find((entry) => entry.deviceId === deviceId);
  if (!device) {
    return { ok: false, statusCode: 409, error: 'device not registered' };
  }
  const token = String(req.headers['x-dpa-device-token'] || '');
  if (!token || sha256(token) !== device.tokenHash) {
    return { ok: false, statusCode: 403, error: 'device token rejected' };
  }
  return { ok: true, device };
}

function touchDevice(device, patch = {}) {
  const now = nowIso();
  device.lastSeenAt = now;
  device.updatedAt = now;
  if (patch.firmwareVersion) device.firmwareVersion = patch.firmwareVersion;
  if (Array.isArray(patch.albumIds)) {
    device.albumIds = [...patch.albumIds];
    if (!device.albumId && patch.albumIds[0]) {
      device.albumId = patch.albumIds[0];
    }
  }
  if (patch.freeStorageMb !== undefined) device.freeStorageMb = patch.freeStorageMb;
  if (patch.batteryPercent !== undefined) device.batteryPercent = patch.batteryPercent;
  if (patch.wifiRssi !== undefined) device.wifiRssi = patch.wifiRssi;
  device.lastCheckInAt = now;
}

function upsertCapsule(body) {
  const capsuleId = String(body.id || body.capsuleId || '').trim() || randomId('cap');
  const albumId = String(body.albumId || '').trim();
  const title = String(body.title || '').trim();
  if (!albumId) return { ok: false, statusCode: 400, error: 'albumId required' };
  if (!title) return { ok: false, statusCode: 400, error: 'title required' };

  const payloadFileId = String(body.payloadFileId || '').trim();
  const payloadFile = payloadFileId ? state.files.find((entry) => entry.id === payloadFileId) : null;
  if (payloadFileId && !payloadFile) {
    return { ok: false, statusCode: 404, error: 'payload file not found' };
  }
  const payloadUrl = String(body.payloadUrl || '').trim();
  if (!payloadFile && !payloadUrl) {
    return { ok: false, statusCode: 400, error: 'payloadFileId or payloadUrl required' };
  }

  const version = Math.max(1, Math.trunc(normalizeNumber(body.version) || 1));
  const now = nowIso();
  const existing = state.capsules.find((entry) => entry.id === capsuleId);
  const capsule = existing || {
    id: capsuleId,
    createdAt: now,
  };

  capsule.albumId = albumId;
  capsule.type = String(body.type || 'other').trim() || 'other';
  capsule.title = title;
  capsule.description = String(body.description || '').trim();
  capsule.version = version;
  capsule.payloadKind = String(body.payloadKind || 'dpa').trim() || 'dpa';
  capsule.payloadFileId = payloadFile?.id || '';
  capsule.payloadUrl = payloadUrl;
  capsule.payloadFilename = payloadFile?.filename || String(body.payloadFilename || '').trim();
  capsule.payloadMimeType = payloadFile?.mimeType || String(body.payloadMimeType || 'application/octet-stream');
  capsule.payloadSha256 = String(body.payloadSha256 || payloadFile?.sha256 || '').trim();
  capsule.payloadSizeBytes = Math.max(0, Math.trunc(normalizeNumber(body.payloadSizeBytes) || payloadFile?.sizeBytes || 0));
  capsule.artworkUrl = String(body.artworkUrl || '').trim();
  capsule.ledIntent = String(body.ledIntent || 'capsule_arrival').trim() || 'capsule_arrival';
  capsule.updatedAt = now;

  if (!existing) state.capsules.push(capsule);
  persistState();
  return { ok: true, capsule };
}

function publishCapsule(capsuleId, body = {}) {
  const capsule = state.capsules.find((entry) => entry.id === capsuleId);
  if (!capsule) return { ok: false, statusCode: 404, error: 'capsule not found' };

  const requestedAlbumId = String(body.albumId || capsule.albumId || '').trim();
  const explicitDeviceIds = normalizeStringArray(body.deviceIds);
  if (!requestedAlbumId && explicitDeviceIds.length === 0) {
    return { ok: false, statusCode: 400, error: 'albumId or deviceIds required' };
  }

  const resolved = resolvePublishDevices({
    albumId: requestedAlbumId,
    deviceIds: explicitDeviceIds,
  });
  if (!resolved.ok) return resolved;

  const publish = {
    capsuleId: capsule.id,
    albumId: requestedAlbumId || capsule.albumId || null,
    targetCount: resolved.devices.length,
    createdEntitlementCount: 0,
    reusedEntitlementCount: 0,
    createdDeliveryCount: 0,
    reusedDeliveryCount: 0,
    deviceIds: resolved.devices.map((device) => device.deviceId),
  };

  const entitlements = [];
  const deliveries = [];
  for (const device of resolved.devices) {
    const result = createEntitlement({
      ...body,
      capsuleId: capsule.id,
      deviceId: device.deviceId,
      albumId: requestedAlbumId || capsule.albumId || device.albumId || '',
    }, {
      skipPersist: true,
      dedupeByCapsuleVersion: true,
    });
    if (!result.ok) return result;
    entitlements.push(result.entitlement);
    deliveries.push(result.delivery);
    if (result.reused) publish.reusedEntitlementCount += 1;
    else publish.createdEntitlementCount += 1;
    if (result.reusedDelivery) publish.reusedDeliveryCount += 1;
    else publish.createdDeliveryCount += 1;
  }

  persistState();
  return { ok: true, capsule, publish, entitlements, deliveries };
}

function resolvePublishDevices({ albumId, deviceIds = [] }) {
  const uniqueDeviceIds = [...new Set(deviceIds.filter(Boolean))];
  if (uniqueDeviceIds.length > 0) {
    const devices = [];
    const missing = [];
    for (const deviceId of uniqueDeviceIds) {
      const device = state.devices.find((entry) => entry.deviceId === deviceId);
      if (!device) missing.push(deviceId);
      else devices.push(device);
    }
    if (missing.length > 0) {
      return { ok: false, statusCode: 404, error: `device not found: ${missing.join(', ')}` };
    }
    return { ok: true, devices };
  }

  const devices = state.devices.filter((device) => deviceMatchesAlbum(device, albumId));
  return { ok: true, devices };
}

function deviceMatchesAlbum(device, albumId) {
  if (!albumId) return true;
  if (String(device.albumId || '').trim() === albumId) return true;
  return Array.isArray(device.albumIds) && device.albumIds.includes(albumId);
}

function findExistingEntitlementForCapsuleVersion(capsuleId, deviceId, version) {
  return state.entitlements.find((entitlement) => {
    if (entitlement.capsuleId !== capsuleId) return false;
    if (entitlement.deviceId !== deviceId) return false;
    const capsule = state.capsules.find((entry) => entry.id === entitlement.capsuleId);
    if (!capsule) return false;
    if (Math.trunc(Number(capsule.version || 0)) !== Math.trunc(Number(version || 0))) return false;
    const delivery = state.deliveries.find((entry) => entry.entitlementId === entitlement.id && entry.deviceId === deviceId);
    return delivery?.status !== 'expired';
  });
}

function createEntitlement(body, options = {}) {
  const skipPersist = options.skipPersist === true;
  const dedupeByCapsuleVersion = options.dedupeByCapsuleVersion === true;
  const capsuleId = String(body.capsuleId || '').trim();
  const deviceId = String(body.deviceId || '').trim();
  if (!capsuleId) return { ok: false, statusCode: 400, error: 'capsuleId required' };
  if (!deviceId) return { ok: false, statusCode: 400, error: 'deviceId required' };

  const capsule = state.capsules.find((entry) => entry.id === capsuleId);
  if (!capsule) return { ok: false, statusCode: 404, error: 'capsule not found' };
  const device = state.devices.find((entry) => entry.deviceId === deviceId);
  if (!device) return { ok: false, statusCode: 404, error: 'device not found' };

  let entitlement = null;
  let reused = false;
  if (dedupeByCapsuleVersion) {
    entitlement = findExistingEntitlementForCapsuleVersion(capsuleId, deviceId, capsule.version);
    reused = !!entitlement;
  }

  if (!entitlement) {
    entitlement = {
      id: randomId('ent'),
      capsuleId,
      userId: String(body.userId || '').trim(),
      deviceId,
      albumId: String(body.albumId || capsule.albumId || device.albumId || '').trim(),
      sourceType: String(body.sourceType || 'grant').trim() || 'grant',
      priority: String(body.priority || 'normal').trim() || 'normal',
      availableAt: String(body.availableAt || nowIso()).trim() || nowIso(),
      expiresAt: String(body.expiresAt || '').trim() || null,
      createdAt: nowIso(),
    };
    state.entitlements.push(entitlement);
  }

  const deliveryCountBefore = state.deliveries.length;
  const delivery = createOrGetDeliveryForEntitlement(entitlement);
  const reusedDelivery = state.deliveries.length == deliveryCountBefore;
  if (!skipPersist) persistState();
  return { ok: true, entitlement, delivery, reused, reusedDelivery };
}

function createOrGetDeliveryForEntitlement(entitlement) {
  const existing = state.deliveries.find((entry) => entry.entitlementId === entitlement.id && entry.deviceId === entitlement.deviceId);
  if (existing) return existing;
  const capsule = state.capsules.find((entry) => entry.id === entitlement.capsuleId);
  const now = nowIso();
  const delivery = {
    id: randomId('del'),
    entitlementId: entitlement.id,
    capsuleId: entitlement.capsuleId,
    deviceId: entitlement.deviceId,
    albumId: String(entitlement.albumId || capsule?.albumId || '').trim(),
    status: entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() <= Date.now() ? 'expired' : 'pending',
    attemptCount: 0,
    progressBytes: 0,
    installedPath: '',
    lastError: '',
    announcedAt: '',
    downloadStartedAt: '',
    downloadCompletedAt: '',
    installedAt: '',
    seenAt: '',
    updatedAt: now,
  };
  state.deliveries.push(delivery);
  return delivery;
}

function ensureDeviceDeliveries(deviceId, albumIds = []) {
  const allowedAlbums = new Set(albumIds.filter(Boolean));
  for (const entitlement of state.entitlements) {
    if (entitlement.deviceId !== deviceId) continue;
    if (allowedAlbums.size && entitlement.albumId && !allowedAlbums.has(entitlement.albumId)) continue;
    const delivery = createOrGetDeliveryForEntitlement(entitlement);
    if (entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() <= Date.now() && !['installed', 'seen'].includes(delivery.status)) {
      delivery.status = 'expired';
      delivery.updatedAt = nowIso();
    }
  }
}

function reconcileInstalledCapsules(deviceId, installedCapsules) {
  for (const installed of installedCapsules) {
    const matches = state.deliveries.filter((delivery) => {
      if (delivery.deviceId !== deviceId) return false;
      if (delivery.capsuleId !== installed.capsuleId) return false;
      const capsule = state.capsules.find((entry) => entry.id === delivery.capsuleId);
      if (!capsule) return false;
      if (installed.version !== undefined && Number(capsule.version || 0) !== installed.version) return false;
      return true;
    });

    for (const delivery of matches) {
      const capsule = state.capsules.find((entry) => entry.id === delivery.capsuleId);
      const now = nowIso();
      delivery.status = installed.seen ? 'seen' : 'installed';
      delivery.progressBytes = Math.max(delivery.progressBytes || 0, capsule?.payloadSizeBytes || 0);
      if (!delivery.downloadCompletedAt) delivery.downloadCompletedAt = now;
      if (!delivery.installedAt) delivery.installedAt = now;
      if (installed.seen && !delivery.seenAt) delivery.seenAt = now;
      delivery.lastError = '';
      delivery.updatedAt = now;
    }
  }
}

function buildPendingCapsulePayloads({ deviceId, installedCapsules, requestUrl }) {
  const device = state.devices.find((entry) => entry.deviceId === deviceId);
  const installedKeys = new Set(installedCapsules.map((entry) => `${entry.capsuleId}:${entry.version ?? '*'}`));
  const allowedAlbums = new Set(Array.isArray(device?.albumIds) ? device.albumIds.filter(Boolean) : []);
  const now = Date.now();

  return state.deliveries
    .filter((delivery) => {
      if (delivery.deviceId !== deviceId) return false;
      if (!DELIVERY_STATUS_ACTIVE.has(delivery.status)) return false;
      const entitlement = state.entitlements.find((entry) => entry.id === delivery.entitlementId);
      const capsule = state.capsules.find((entry) => entry.id === delivery.capsuleId);
      if (!entitlement || !capsule) return false;
      if (delivery.status === 'expired') return false;
      if (entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() <= now) {
        delivery.status = 'expired';
        delivery.updatedAt = nowIso();
        return false;
      }
      if (entitlement.availableAt && new Date(entitlement.availableAt).getTime() > now) return false;
      if (allowedAlbums.size && entitlement.albumId && !allowedAlbums.has(entitlement.albumId)) return false;
      if (installedKeys.has(`${capsule.id}:${capsule.version}`)) return false;
      return true;
    })
    .sort((a, b) => {
      const entA = state.entitlements.find((entry) => entry.id === a.entitlementId);
      const entB = state.entitlements.find((entry) => entry.id === b.entitlementId);
      const rankDiff = entitlementPriorityRank(entA?.priority) - entitlementPriorityRank(entB?.priority);
      if (rankDiff !== 0) return rankDiff;
      return String(entA?.availableAt || '').localeCompare(String(entB?.availableAt || ''));
    })
    .map((delivery) => {
      const entitlement = state.entitlements.find((entry) => entry.id === delivery.entitlementId);
      const capsule = state.capsules.find((entry) => entry.id === delivery.capsuleId);
      return {
        deliveryId: delivery.id,
        entitlementId: entitlement.id,
        capsuleId: capsule.id,
        albumId: String(delivery.albumId || capsule.albumId || ''),
        title: capsule.title,
        description: capsule.description,
        type: capsule.type,
        version: capsule.version,
        payloadKind: capsule.payloadKind,
        payloadSha256: capsule.payloadSha256,
        payloadSizeBytes: capsule.payloadSizeBytes,
        downloadUrl: buildCapsuleDownloadUrl(requestUrl, delivery, capsule),
        installPath: buildCapsuleInstallPath(capsule),
        artworkUrl: capsule.artworkUrl || '',
        ledIntent: capsule.ledIntent || 'capsule_arrival',
      };
    })
    .filter((entry) => !!entry.downloadUrl);
}

function entitlementPriorityRank(priority) {
  const normalized = String(priority || 'normal').toLowerCase();
  if (normalized === 'critical') return 0;
  if (normalized === 'high') return 1;
  if (normalized === 'normal') return 2;
  if (normalized === 'low') return 3;
  return 2;
}

function buildCapsuleDownloadUrl(requestUrl, delivery, capsule) {
  if (capsule.payloadFileId) {
    return new URL(`${INTERNAL_API_PREFIX}/device/capsules/${delivery.id}/download`, requestUrl).toString();
  }
  return capsule.payloadUrl || '';
}

function buildCapsuleInstallPath(capsule) {
  const explicit = String(capsule.installPath || '').trim();
  if (explicit) return explicit;
  const fileLike = String(capsule.payloadFilename || capsule.payloadUrl || '').split('?')[0];
  const extension = path.extname(fileLike) || (capsule.payloadKind === 'dpa' ? '.dpa' : '.bin');
  return `/capsules/${sanitizeFilename(capsule.id)}_v${Math.max(1, Math.trunc(Number(capsule.version || 1)))}${extension}`;
}

function authenticateDeliveryRequest(req, deliveryId, body = {}) {
  if (!deliveryId) return { ok: false, statusCode: 400, error: 'deliveryId required' };
  const delivery = state.deliveries.find((entry) => entry.id === deliveryId);
  if (!delivery) return { ok: false, statusCode: 404, error: 'delivery not found' };
  const deviceId = String(body.deviceId || delivery.deviceId || '').trim();
  const auth = authenticateDeviceRequest(req, deviceId);
  if (!auth.ok) return auth;
  if (auth.device.deviceId !== delivery.deviceId) {
    return { ok: false, statusCode: 404, error: 'delivery not found' };
  }
  const capsule = state.capsules.find((entry) => entry.id === delivery.capsuleId);
  if (!capsule) return { ok: false, statusCode: 409, error: 'capsule missing for delivery' };
  const requestedCapsuleId = String(body.capsuleId || '').trim();
  if (requestedCapsuleId && requestedCapsuleId !== delivery.capsuleId) {
    return { ok: false, statusCode: 409, error: 'capsuleId mismatch' };
  }
  touchDevice(auth.device);
  return { ok: true, device: auth.device, delivery, capsule };
}

function resolveCapsuleDownload(capsule) {
  if (capsule.payloadFileId) {
    const fileRecord = state.files.find((entry) => entry.id === capsule.payloadFileId);
    if (!fileRecord) return { ok: false, statusCode: 404, error: 'payload file missing' };
    const targetPath = path.join(FILE_ROOT, fileRecord.storedFilename);
    if (!existsSync(targetPath)) return { ok: false, statusCode: 404, error: 'stored payload missing' };
    return {
      ok: true,
      kind: 'file',
      path: targetPath,
      filename: fileRecord.filename,
      mimeType: fileRecord.mimeType,
    };
  }
  if (capsule.payloadUrl) {
    return { ok: true, kind: 'redirect', location: capsule.payloadUrl };
  }
  return { ok: false, statusCode: 404, error: 'capsule payload unavailable' };
}

function markDeliveryAnnounced(delivery) {
  const now = nowIso();
  delivery.status = 'announced';
  delivery.attemptCount = Math.max(0, Number(delivery.attemptCount || 0)) + 1;
  if (!delivery.announcedAt) delivery.announcedAt = now;
  delivery.lastError = '';
  delivery.updatedAt = now;
}

function updateDeliveryProgress(delivery, body, nextStatus) {
  const now = nowIso();
  const progressBytes = normalizeNumber(body.progressBytes);
  const totalBytes = normalizeNumber(body.totalBytes);
  delivery.status = nextStatus;
  if (!delivery.downloadStartedAt) delivery.downloadStartedAt = now;
  if (progressBytes !== undefined) delivery.progressBytes = Math.max(0, Math.trunc(progressBytes));
  if (totalBytes !== undefined) delivery.totalBytes = Math.max(0, Math.trunc(totalBytes));
  if (nextStatus === 'verifying' && !delivery.downloadCompletedAt) delivery.downloadCompletedAt = now;
  delivery.updatedAt = now;
}

function markDeliveryDownloaded(delivery, capsule, body) {
  const sha256Value = String(body.sha256 || '').trim();
  const sizeBytes = normalizeNumber(body.sizeBytes);
  if (capsule.payloadSha256 && sha256Value && sha256Value !== capsule.payloadSha256) {
    markDeliveryFailed(delivery, 'checksum_mismatch');
    return { ok: false, statusCode: 409, error: 'checksum mismatch' };
  }
  if (capsule.payloadSizeBytes && sizeBytes !== undefined && Math.trunc(sizeBytes) !== Math.trunc(capsule.payloadSizeBytes)) {
    markDeliveryFailed(delivery, 'checksum_mismatch');
    return { ok: false, statusCode: 409, error: 'payload size mismatch' };
  }
  const now = nowIso();
  delivery.status = 'verifying';
  delivery.downloadCompletedAt = now;
  delivery.updatedAt = now;
  delivery.lastError = '';
  if (sizeBytes !== undefined) delivery.progressBytes = Math.max(0, Math.trunc(sizeBytes));
  if (sizeBytes !== undefined) delivery.totalBytes = Math.max(0, Math.trunc(sizeBytes));
  if (sha256Value) delivery.reportedSha256 = sha256Value;
  if (body.tempPath) delivery.tempPath = String(body.tempPath);
  return { ok: true };
}

function markDeliveryComplete(delivery, capsule, body) {
  const installedPath = String(body.installedPath || '').trim();
  if (!installedPath) return { ok: false, statusCode: 400, error: 'installedPath required' };
  const sha256Value = String(body.sha256 || '').trim();
  const sizeBytes = normalizeNumber(body.sizeBytes);
  if (capsule.payloadSha256 && sha256Value && sha256Value !== capsule.payloadSha256) {
    markDeliveryFailed(delivery, 'checksum_mismatch');
    return { ok: false, statusCode: 409, error: 'checksum mismatch' };
  }
  if (capsule.payloadSizeBytes && sizeBytes !== undefined && Math.trunc(sizeBytes) !== Math.trunc(capsule.payloadSizeBytes)) {
    markDeliveryFailed(delivery, 'checksum_mismatch');
    return { ok: false, statusCode: 409, error: 'payload size mismatch' };
  }
  const now = nowIso();
  delivery.status = 'installed';
  delivery.installedPath = installedPath;
  delivery.installedAt = now;
  if (!delivery.downloadCompletedAt) delivery.downloadCompletedAt = now;
  if (sizeBytes !== undefined) delivery.progressBytes = Math.max(0, Math.trunc(sizeBytes));
  delivery.lastError = '';
  delivery.updatedAt = now;
  return { ok: true };
}

function markDeliveryFailed(delivery, error) {
  delivery.status = 'failed';
  delivery.lastError = error || 'download_failed';
  delivery.updatedAt = nowIso();
}

function markDeliverySeen(delivery) {
  const now = nowIso();
  if (!delivery.installedAt) delivery.installedAt = now;
  delivery.status = 'seen';
  delivery.seenAt = now;
  delivery.updatedAt = now;
  delivery.lastError = '';
}

function deliveryRetryEligible(error) {
  return !['device token rejected', 'unsupported_payload'].includes(String(error || '').trim());
}

function computeSummary({ albumId, deviceId }) {
  const relevantFiles = state.files.filter((file) => {
    if (albumId && file.albumId !== albumId) return false;
    if (deviceId && file.deviceId !== deviceId) return false;
    return true;
  });
  const relevantSessions = state.uploadSessions.filter((session) => {
    if (albumId && session.albumId !== albumId) return false;
    if (deviceId && session.deviceId !== deviceId) return false;
    return true;
  });
  const latestFile = [...relevantFiles].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latestSession = [...relevantSessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  return {
    albumId: albumId || null,
    deviceId: deviceId || null,
    totalFiles: relevantFiles.length,
    verifiedFiles: relevantFiles.filter((file) => file.status === 'verified').length,
    stagedFiles: relevantFiles.filter((file) => file.status === 'staged').length,
    archivedFiles: relevantFiles.filter((file) => file.status === 'archived').length,
    activeSessions: relevantSessions.filter((session) => ['pending', 'uploading', 'uploaded'].includes(session.status)).length,
    lastUploadedAt: latestFile?.updatedAt || null,
    lastUploadStatus: latestSession?.status || null,
    lastDeviceId: latestFile?.deviceId || latestSession?.deviceId || null,
    lastAlbumId: latestFile?.albumId || latestSession?.albumId || null,
  };
}

function computeCapsuleSummary({ albumId, deviceId }) {
  const relevantDeliveries = state.deliveries.filter((delivery) => {
    if (albumId && delivery.albumId !== albumId) return false;
    if (deviceId && delivery.deviceId !== deviceId) return false;
    return true;
  });

  const installedDeliveries = relevantDeliveries.filter((delivery) => ['installed', 'seen'].includes(delivery.status));
  const lastInstalledAt = installedDeliveries
    .map((delivery) => delivery.installedAt)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || null;

  return {
    albumId: albumId || null,
    deviceId: deviceId || null,
    pending: relevantDeliveries.filter((delivery) => ['pending', 'announced'].includes(delivery.status)).length,
    downloading: relevantDeliveries.filter((delivery) => ['downloading', 'downloaded', 'verifying'].includes(delivery.status)).length,
    installed: installedDeliveries.length,
    unseen: relevantDeliveries.filter((delivery) => delivery.status === 'installed').length,
    failed: relevantDeliveries.filter((delivery) => delivery.status === 'failed').length,
    lastInstalledAt,
  };
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'payload.bin';
}

function nowIso() {
  return new Date().toISOString();
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function buildBridgeDeviceInfo() {
  const status = await fetchDeviceStatus();
  return {
    serial: status.duid || 'DPA',
    model: status.name || 'DPA Device',
    firmwareVersion: status.ver || 'unknown',
    capabilities: ['USB', 'WIFI', 'LOCAL_HELPER'],
    pubkeyB64: '',
  };
}

async function buildBridgeLibrary() {
  const status = await fetchDeviceStatus();
  const tracks = (await fetchDeviceTracks().catch(() => []))
    .map((track, index) => normalizeBridgeTrack(track, index));
  const albumId = String(status.duid || status.album || 'device-album');
  return {
    albums: [{
      id: albumId,
      title: status.album || 'DPA Device',
      artworkUrl: `${DEVICE_HTTP_ORIGIN}/api/art?path=${encodeURIComponent('/art/cover.jpg')}`,
    }],
    tracks: tracks.map((track, index) => ({
      id: `fw-${track.index ?? index}`,
      albumId,
      title: track.title,
      durationSec: Math.max(0, Math.round(Number(track.durationMs || 0) / 1000)),
      trackNo: index + 1,
      codec: track.codec || track.format || 'audio/wav',
      blobId: track.filename,
    })),
  };
}

async function buildBridgeManifest(albumId) {
  const status = await fetchDeviceStatus();
  const tracks = (await fetchDeviceTracks().catch(() => []))
    .map((track, index) => normalizeBridgeTrack(track, index));
  const resolvedAlbumId = albumId || String(status.duid || status.album || 'device-album');
  return {
    version: 1,
    albumId: resolvedAlbumId,
    policyHash: 'sha256:local-helper',
    blobs: tracks.map((track) => ({
      blobId: track.filename,
      sha256: '',
      size: Math.max(0, Math.trunc(Number(track.sizeBytes || 0))),
      mime: 'audio/wav',
      kind: 'audio',
    })),
    tracks: tracks.map((track, index) => ({
      trackId: `fw-${track.index ?? index}`,
      blobId: track.filename,
      codec: track.codec || track.format || 'audio/wav',
      title: track.title,
      trackNo: index + 1,
      durationSec: Math.max(0, Math.round(Number(track.durationMs || 0) / 1000)),
    })),
    signatures: {
      manifestSigEd25519B64: '',
      publisherPubkeyEd25519B64: '',
    },
  };
}

function normalizeBridgeTrack(track, index) {
  const filename = String(track?.filename || track?.path || track?.file || '').trim();
  const fallbackLeaf = filename.split('/').pop() || '';
  const title = String(track?.title || '').trim()
    || fallbackLeaf.replace(/\.(wav|dpa)$/i, '').replace(/_/g, ' ')
    || `Track ${index + 1}`;
  return {
    ...track,
    index: Number(track?.index ?? track?.idx ?? index),
    filename,
    title,
    codec: track?.codec || track?.format || 'audio/wav',
    sizeBytes: Number(track?.size || track?.sizeBytes || 0),
  };
}

async function fetchDeviceStatus() {
  const candidates = [
    `${DEVICE_HTTP_ORIGIN}/api/status`,
    `${DEVICE_UPLOAD_ORIGIN}/api/status`,
  ];
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      });
      if (!response.ok) continue;
      return response.json();
    } catch {
      // Try the next status plane.
    }
  }
  throw new Error('device status failed');
}

async function fetchDeviceTracks() {
  const candidates = [
    `${DEVICE_HTTP_ORIGIN}/api/audio/tracks`,
    `${DEVICE_HTTP_ORIGIN}/api/audio/wavs`,
  ];
  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const tracks = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.tracks)
          ? payload.tracks
          : Array.isArray(payload?.wavs)
            ? payload.wavs
            : [];
      if (tracks.length > 0) return tracks;
    } catch {
      // Try the next track endpoint.
    }
  }
  throw new Error('device tracks failed');
}

function proxyToDevice(req, res, targetOrigin, prefix) {
  return new Promise((resolve) => {
    const origin = req.headers.origin || '*';
    const upstream = new URL(targetOrigin);
    const transport = upstream.protocol === 'https:' ? https : http;
    const trimmedPath = (req.url || '/').replace(prefix, '') || '/';
    const target = new URL(trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`, upstream);
    const headers = { ...req.headers, host: upstream.host };

    const proxyReq = transport.request(target, {
      method: req.method,
      headers,
    }, (proxyRes) => {
      const responseHeaders = {
        ...proxyRes.headers,
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'Content-Type, X-DPA-Device-Token, X-DPA-Upload-Token, Range, Cache-Control, Pragma, Accept, Origin',
      };
      res.writeHead(proxyRes.statusCode || 502, responseHeaders);
      proxyRes.pipe(res);
      proxyRes.on('end', resolve);
    });

    proxyReq.on('error', (error) => {
      sendJson(res, 502, {
        ok: false,
        error: 'device proxy failed',
        detail: error instanceof Error ? error.message : String(error),
        target: target.toString(),
      });
      resolve();
    });

    req.on('error', () => proxyReq.destroy());
    req.pipe(proxyReq);
  });
}
