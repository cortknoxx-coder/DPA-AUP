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

export function isHostedHttps(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.protocol === 'https:' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  );
}

export function readDeviceTunnelOverride(): string | undefined {
  return readLocalStorage(LS_DEVICE_HTTP) || readMetaContent('dpa-device-api-base');
}

export function readDeviceUploadTunnelOverride(): string | undefined {
  return readLocalStorage(LS_DEVICE_UPLOAD_HTTP) || readMetaContent('dpa-device-upload-base');
}
