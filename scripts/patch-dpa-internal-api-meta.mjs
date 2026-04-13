/**
 * Post-build: patch dist/index.html meta tags from environment (Vercel / CI).
 * - DPA_INTERNAL_API_BASE → dpa-internal-api-base
 * - DPA_CLOUD_CONTROL_BASE → dpa-cloud-control-base
 * - DPA_RELAY_WS_URL → dpa-relay-ws-url
 * - DPA_BRIDGE_WS_URL → dpa-bridge-ws-url
 * - DPA_BRIDGE_HTTP_URL → dpa-bridge-http-url
 * - DPA_API_BASE_URL → dpa-api-base-url
 * - DPA_DEVICE_API_BASE → dpa-device-api-base (browser HTTPS tunnel to :80, optional)
 * - DPA_DEVICE_UPLOAD_BASE → dpa-device-upload-base (browser HTTPS tunnel to :81, optional)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = resolve(root, 'dist/index.html');

const patches = [
  ['dpa-internal-api-base', 'DPA_INTERNAL_API_BASE'],
  ['dpa-cloud-control-base', 'DPA_CLOUD_CONTROL_BASE'],
  ['dpa-relay-ws-url', 'DPA_RELAY_WS_URL'],
  ['dpa-bridge-ws-url', 'DPA_BRIDGE_WS_URL'],
  ['dpa-bridge-http-url', 'DPA_BRIDGE_HTTP_URL'],
  ['dpa-api-base-url', 'DPA_API_BASE_URL'],
  ['dpa-device-api-base', 'DPA_DEVICE_API_BASE'],
  ['dpa-device-upload-base', 'DPA_DEVICE_UPLOAD_BASE'],
];

function isTemporaryTunnel(value) {
  try {
    return new URL(value).hostname.toLowerCase().includes('pinggy');
  } catch {
    return false;
  }
}

const any = patches.some(([, k]) => (process.env[k] || '').trim());
if (!any) process.exit(0);

let html = readFileSync(distIndex, 'utf8');
let changed = false;
for (const [metaName, envKey] of patches) {
  const value = (process.env[envKey] || '').trim();
  if (!value) continue;
  if ((metaName === 'dpa-device-api-base' || metaName === 'dpa-device-upload-base') && isTemporaryTunnel(value)) {
    continue;
  }
  const escaped = value.replace(/"/g, '&quot;');
  const marker = new RegExp(
    `<meta\\s+name="${metaName}"\\s+content(?:="")?(\\s*\\/?)>`,
    'i'
  );
  if (!marker.test(html)) continue;
  html = html.replace(
    marker,
    `<meta name="${metaName}" content="${escaped}"$1>`
  );
  changed = true;
}
if (changed) {
  writeFileSync(distIndex, html, 'utf8');
  console.log('[patch-dpa-internal-api-meta] patched dist/index.html');
}
