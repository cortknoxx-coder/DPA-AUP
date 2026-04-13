/**
 * Resolve how the browser reaches the DPA HTTP API (main :80 and upload :81).
 *
 * - Local dev (ng serve): same-origin `/dpa-api` + `/dpa-upload` → dev proxy → 192.168.4.1
 * - Hosted HTTPS (e.g. Vercel): same-origin `/dpa-api` + `/dpa-upload` → Edge middleware → DPA_DEVICE_*_TUNNEL env
 * - Optional override: meta `dpa-device-api-base` or localStorage `dpa_device_api_base` (HTTPS tunnel URL)
 * - Plain http:// portal on LAN: direct `http://<device-ip>`
 */

export const LS_DEVICE_HTTP = 'dpa_device_api_base';
export const LS_DEVICE_UPLOAD_HTTP = 'dpa_device_upload_base';
export const DPA_LOCAL_HELPER_ORIGIN = 'http://127.0.0.1:8787';

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '::1'
    || hostname.startsWith('127.');
}

function isTemporaryTunnelHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower.includes('pinggy');
}

function readLocalStorage(key: string): string | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const v = localStorage.getItem(key)?.trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}

function readMetaContent(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const v = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim();
  return v || undefined;
}

function normalizeDeviceBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (isTemporaryTunnelHost(url.hostname)) return undefined;
    if (isHostedHttps() && url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      return undefined;
    }
    if (!/^https?:$/.test(url.protocol)) return undefined;
    return url.origin.replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function readValidatedOverride(localStorageKey: string, metaName: string): string | undefined {
  const fromStorage = readLocalStorage(localStorageKey);
  const normalizedStorage = normalizeDeviceBaseUrl(fromStorage);
  if (fromStorage && !normalizedStorage && typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(localStorageKey);
    } catch {
      // best effort
    }
  }
  if (normalizedStorage) return normalizedStorage;
  return normalizeDeviceBaseUrl(readMetaContent(metaName));
}

export function isHostedHttps(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.protocol === 'https:' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  );
}

export function readDeviceTunnelOverride(): string | undefined {
  return readValidatedOverride(LS_DEVICE_HTTP, 'dpa-device-api-base');
}

export function readDeviceUploadTunnelOverride(): string | undefined {
  return readValidatedOverride(LS_DEVICE_UPLOAD_HTTP, 'dpa-device-upload-base');
}
