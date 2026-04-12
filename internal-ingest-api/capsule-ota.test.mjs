import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

test('capsule OTA contract routes work end-to-end', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dpa-capsule-ota-'));
  const port = await getFreePort();
  const deviceId = 'DPA-SMOKE-001';
  const albumId = 'the-wack-game';
  const capsuleId = 'cap_smoke_001';
  const payload = Buffer.from('smoke capsule payload', 'utf8');
  const server = spawn(process.execPath, ['internal-ingest-api/server.mjs'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DPA_INTERNAL_INGEST_PORT: String(port),
      DPA_INTERNAL_INGEST_DIR: dataDir,
      DPA_INTERNAL_OPERATOR_KEY: 'keepinnovating',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  server.stdout.on('data', (chunk) => logs.push(chunk.toString('utf8')));
  server.stderr.on('data', (chunk) => logs.push(chunk.toString('utf8')));

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(`${baseUrl}/internal-api/health`);

    const login = await requestJson(`${baseUrl}/internal-api/auth/login`, {
      method: 'POST',
      body: { passphrase: 'keepinnovating' },
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.json.ok, true);
    const cookie = readSessionCookie(login.response);
    assert.ok(cookie);

    const registered = await requestJson(`${baseUrl}/internal-api/devices/register`, {
      method: 'POST',
      cookie,
      body: { deviceId, label: 'Smoke device', albumId },
    });
    assert.equal(registered.response.status, 200);
    const deviceToken = registered.json.deviceToken;
    assert.ok(deviceToken);

    const sessionCreated = await requestJson(`${baseUrl}/internal-api/ingest/sessions`, {
      method: 'POST',
      cookie,
      body: {
        deviceId,
        albumId,
        source: 'operator',
        filename: 'cap_smoke_001.dpa',
        mimeType: 'application/octet-stream',
        contentKind: 'capsule',
      },
    });
    assert.equal(sessionCreated.response.status, 200);
    const sessionId = sessionCreated.json.sessionId;
    assert.ok(sessionId);

    const uploaded = await fetch(`${baseUrl}/internal-api/ingest/upload/${sessionId}?filename=cap_smoke_001.dpa`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/octet-stream',
      },
      body: payload,
    });
    assert.equal(uploaded.status, 200);
    const uploadedJson = await uploaded.json();
    assert.equal(uploadedJson.ok, true);
    const fileId = uploadedJson.file.id;
    assert.ok(fileId);

    const completedUpload = await requestJson(`${baseUrl}/internal-api/ingest/complete/${sessionId}`, {
      method: 'POST',
      cookie,
      body: {},
    });
    assert.equal(completedUpload.response.status, 200);
    assert.equal(completedUpload.json.file.status, 'verified');

    const capsuleCreated = await requestJson(`${baseUrl}/internal-api/capsules`, {
      method: 'POST',
      cookie,
      body: {
        capsuleId,
        albumId,
        type: 'audio',
        title: 'Smoke Capsule',
        description: 'Small validation payload.',
        version: 1,
        payloadKind: 'dpa',
        payloadFileId: fileId,
        ledIntent: 'capsule_arrival',
      },
    });
    assert.equal(capsuleCreated.response.status, 200);
    assert.equal(capsuleCreated.json.capsule.payloadFileId, fileId);

    const entitlementCreated = await requestJson(`${baseUrl}/internal-api/entitlements`, {
      method: 'POST',
      cookie,
      body: {
        capsuleId,
        deviceId,
        albumId,
        userId: 'fan_smoke_001',
        sourceType: 'purchase',
        priority: 'normal',
      },
    });
    assert.equal(entitlementCreated.response.status, 200);
    const seededDeliveryId = entitlementCreated.json.delivery.id;
    assert.ok(seededDeliveryId);

    const initialSummary = await requestJson(`${baseUrl}/internal-api/public/capsules/summary?albumId=${albumId}&deviceId=${deviceId}`);
    assert.equal(initialSummary.response.status, 200);
    assert.equal(initialSummary.json.summary.pending, 1);

    const checkIn = await requestJson(`${baseUrl}/internal-api/device/check-in`, {
      method: 'POST',
      deviceToken,
      body: {
        deviceId,
        firmwareVersion: '2.4.1',
        albumIds: [albumId],
        installedCapsules: [],
        freeStorageMb: 1402,
        batteryPercent: -1,
        wifiRssi: -42,
      },
    });
    assert.equal(checkIn.response.status, 200);
    assert.equal(checkIn.json.pendingCount, 1);
    assert.equal(checkIn.json.capsules[0].deliveryId, seededDeliveryId);
    assert.ok(checkIn.json.capsules[0].downloadUrl.includes(`/internal-api/device/capsules/${seededDeliveryId}/download`));

    const downloadResponse = await fetch(checkIn.json.capsules[0].downloadUrl, {
      headers: {
        'X-DPA-Device-Token': deviceToken,
      },
    });
    assert.equal(downloadResponse.status, 200);
    const downloadedPayload = Buffer.from(await downloadResponse.arrayBuffer());
    assert.deepEqual(downloadedPayload, payload);

    const announce = await requestJson(`${baseUrl}/internal-api/device/capsules/${seededDeliveryId}/announce`, {
      method: 'POST',
      deviceToken,
      body: { deviceId, capsuleId },
    });
    assert.equal(announce.response.status, 200);
    assert.equal(announce.json.status, 'announced');

    const progress = await requestJson(`${baseUrl}/internal-api/device/capsules/${seededDeliveryId}/progress`, {
      method: 'POST',
      deviceToken,
      body: {
        deviceId,
        capsuleId,
        status: 'downloading',
        progressBytes: payload.length,
        totalBytes: payload.length,
      },
    });
    assert.equal(progress.response.status, 200);
    assert.equal(progress.json.status, 'downloading');

    const downloaded = await requestJson(`${baseUrl}/internal-api/device/capsules/${seededDeliveryId}/downloaded`, {
      method: 'POST',
      deviceToken,
      body: {
        deviceId,
        capsuleId,
        sha256: uploadedJson.file.sha256,
        sizeBytes: uploadedJson.file.sizeBytes,
        tempPath: '/capsules/.cap_smoke_001_v1.part',
      },
    });
    assert.equal(downloaded.response.status, 200);
    assert.equal(downloaded.json.status, 'verifying');

    const completed = await requestJson(`${baseUrl}/internal-api/device/capsules/${seededDeliveryId}/complete`, {
      method: 'POST',
      deviceToken,
      body: {
        deviceId,
        capsuleId,
        installedPath: '/capsules/cap_smoke_001_v1.dpa',
        sha256: uploadedJson.file.sha256,
        sizeBytes: uploadedJson.file.sizeBytes,
      },
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.json.status, 'installed');

    const installedSummary = await requestJson(`${baseUrl}/internal-api/public/capsules/summary?albumId=${albumId}&deviceId=${deviceId}`);
    assert.equal(installedSummary.response.status, 200);
    assert.equal(installedSummary.json.summary.installed, 1);
    assert.equal(installedSummary.json.summary.unseen, 1);
    assert.equal(installedSummary.json.summary.pending, 0);

    const seen = await requestJson(`${baseUrl}/internal-api/device/capsules/${seededDeliveryId}/seen`, {
      method: 'POST',
      deviceToken,
      body: { deviceId, capsuleId },
    });
    assert.equal(seen.response.status, 200);
    assert.equal(seen.json.status, 'seen');

    const seenSummary = await requestJson(`${baseUrl}/internal-api/public/capsules/summary?albumId=${albumId}&deviceId=${deviceId}`);
    assert.equal(seenSummary.response.status, 200);
    assert.equal(seenSummary.json.summary.installed, 1);
    assert.equal(seenSummary.json.summary.unseen, 0);

    const postInstallCheckIn = await requestJson(`${baseUrl}/internal-api/device/check-in`, {
      method: 'POST',
      deviceToken,
      body: {
        deviceId,
        firmwareVersion: '2.4.1',
        albumIds: [albumId],
        installedCapsules: [{ capsuleId, version: 1, seen: true }],
      },
    });
    assert.equal(postInstallCheckIn.response.status, 200);
    assert.equal(postInstallCheckIn.json.pendingCount, 0);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nServer logs:\n${logs.join('')}`);
  } finally {
    server.kill('SIGTERM');
    await waitForExit(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('capsule publish fans out to matching registered devices and is idempotent', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dpa-capsule-publish-'));
  const port = await getFreePort();
  const albumId = 'the-wack-game';
  const otherAlbumId = 'different-album';
  const deviceA = 'DPA-PUBLISH-001';
  const deviceB = 'DPA-PUBLISH-002';
  const deviceOther = 'DPA-PUBLISH-999';
  const capsuleId = 'cap_publish_001';
  const payload = Buffer.from('publish capsule payload', 'utf8');
  const server = spawn(process.execPath, ['internal-ingest-api/server.mjs'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DPA_INTERNAL_INGEST_PORT: String(port),
      DPA_INTERNAL_INGEST_DIR: dataDir,
      DPA_INTERNAL_OPERATOR_KEY: 'keepinnovating',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  server.stdout.on('data', (chunk) => logs.push(chunk.toString('utf8')));
  server.stderr.on('data', (chunk) => logs.push(chunk.toString('utf8')));

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(`${baseUrl}/internal-api/health`);

    const login = await requestJson(`${baseUrl}/internal-api/auth/login`, {
      method: 'POST',
      body: { passphrase: 'keepinnovating' },
    });
    assert.equal(login.response.status, 200);
    const cookie = readSessionCookie(login.response);
    assert.ok(cookie);

    const registeredA = await requestJson(`${baseUrl}/internal-api/devices/register`, {
      method: 'POST',
      cookie,
      body: { deviceId: deviceA, label: 'Publish A', albumId },
    });
    assert.equal(registeredA.response.status, 200);
    const tokenA = registeredA.json.deviceToken;

    const registeredB = await requestJson(`${baseUrl}/internal-api/devices/register`, {
      method: 'POST',
      cookie,
      body: { deviceId: deviceB, label: 'Publish B', albumId },
    });
    assert.equal(registeredB.response.status, 200);
    const tokenB = registeredB.json.deviceToken;

    const registeredOther = await requestJson(`${baseUrl}/internal-api/devices/register`, {
      method: 'POST',
      cookie,
      body: { deviceId: deviceOther, label: 'Publish Other', albumId: otherAlbumId },
    });
    assert.equal(registeredOther.response.status, 200);
    const tokenOther = registeredOther.json.deviceToken;

    const sessionCreated = await requestJson(`${baseUrl}/internal-api/ingest/sessions`, {
      method: 'POST',
      cookie,
      body: {
        deviceId: deviceA,
        albumId,
        source: 'operator',
        filename: 'cap_publish_001.dpa',
        mimeType: 'application/octet-stream',
        contentKind: 'capsule',
      },
    });
    assert.equal(sessionCreated.response.status, 200);
    const sessionId = sessionCreated.json.sessionId;
    assert.ok(sessionId);

    const uploaded = await fetch(`${baseUrl}/internal-api/ingest/upload/${sessionId}?filename=cap_publish_001.dpa`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/octet-stream',
      },
      body: payload,
    });
    assert.equal(uploaded.status, 200);
    const uploadedJson = await uploaded.json();
    const fileId = uploadedJson.file.id;
    assert.ok(fileId);

    const completedUpload = await requestJson(`${baseUrl}/internal-api/ingest/complete/${sessionId}`, {
      method: 'POST',
      cookie,
      body: {},
    });
    assert.equal(completedUpload.response.status, 200);
    assert.equal(completedUpload.json.file.status, 'verified');

    const capsuleCreated = await requestJson(`${baseUrl}/internal-api/capsules`, {
      method: 'POST',
      cookie,
      body: {
        capsuleId,
        albumId,
        type: 'audio',
        title: 'Publish Capsule',
        description: 'Fan-out capsule publish.',
        version: 1,
        payloadKind: 'dpa',
        payloadFileId: fileId,
        ledIntent: 'capsule_arrival',
      },
    });
    assert.equal(capsuleCreated.response.status, 200);

    const firstPublish = await requestJson(`${baseUrl}/internal-api/capsules/${capsuleId}/publish`, {
      method: 'POST',
      cookie,
      body: {
        albumId,
        userId: 'fan_publish_001',
        sourceType: 'grant',
        priority: 'high',
      },
    });
    assert.equal(firstPublish.response.status, 200);
    assert.equal(firstPublish.json.publish.targetCount, 2);
    assert.equal(firstPublish.json.publish.createdEntitlementCount, 2);
    assert.equal(firstPublish.json.publish.reusedEntitlementCount, 0);
    assert.equal(firstPublish.json.publish.createdDeliveryCount, 2);
    assert.equal(firstPublish.json.publish.reusedDeliveryCount, 0);
    assert.deepEqual(new Set(firstPublish.json.publish.deviceIds), new Set([deviceA, deviceB]));

    const secondPublish = await requestJson(`${baseUrl}/internal-api/capsules/${capsuleId}/publish`, {
      method: 'POST',
      cookie,
      body: {
        albumId,
        userId: 'fan_publish_001',
        sourceType: 'grant',
        priority: 'high',
      },
    });
    assert.equal(secondPublish.response.status, 200);
    assert.equal(secondPublish.json.publish.targetCount, 2);
    assert.equal(secondPublish.json.publish.createdEntitlementCount, 0);
    assert.equal(secondPublish.json.publish.reusedEntitlementCount, 2);
    assert.equal(secondPublish.json.publish.createdDeliveryCount, 0);
    assert.equal(secondPublish.json.publish.reusedDeliveryCount, 2);

    const checkInA = await requestJson(`${baseUrl}/internal-api/device/check-in`, {
      method: 'POST',
      deviceToken: tokenA,
      body: {
        deviceId: deviceA,
        firmwareVersion: '2.4.1',
        albumIds: [albumId],
        installedCapsules: [],
      },
    });
    assert.equal(checkInA.response.status, 200);
    assert.equal(checkInA.json.pendingCount, 1);
    assert.equal(checkInA.json.capsules[0].capsuleId, capsuleId);

    const checkInB = await requestJson(`${baseUrl}/internal-api/device/check-in`, {
      method: 'POST',
      deviceToken: tokenB,
      body: {
        deviceId: deviceB,
        firmwareVersion: '2.4.1',
        albumIds: [albumId],
        installedCapsules: [],
      },
    });
    assert.equal(checkInB.response.status, 200);
    assert.equal(checkInB.json.pendingCount, 1);
    assert.equal(checkInB.json.capsules[0].capsuleId, capsuleId);

    const checkInOther = await requestJson(`${baseUrl}/internal-api/device/check-in`, {
      method: 'POST',
      deviceToken: tokenOther,
      body: {
        deviceId: deviceOther,
        firmwareVersion: '2.4.1',
        albumIds: [otherAlbumId],
        installedCapsules: [],
      },
    });
    assert.equal(checkInOther.response.status, 200);
    assert.equal(checkInOther.json.pendingCount, 0);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nServer logs:\n${logs.join('')}`);
  } finally {
    server.kill('SIGTERM');
    await waitForExit(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

async function requestJson(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.deviceToken) headers['X-DPA-Device-Token'] = options.deviceToken;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    response,
    json: text ? JSON.parse(text) : {},
  };
}

function readSessionCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0] || '';
}

async function waitForServer(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 1000);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
