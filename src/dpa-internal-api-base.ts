/**
 * Base URL for the internal ingest / operator API (cookies + CORS).
 * - Local dev: same-origin `/internal-api` (see proxy.conf.json).
 * - Hosted HTTPS: same-origin Vercel control plane.
 */
export function dpaInternalApiBaseUrl(): string | null {
  if (typeof window === 'undefined') {
    return '/internal-api';
  }
  const meta = document.querySelector('meta[name="dpa-internal-api-base"]');
  const fromMeta = meta?.getAttribute('content')?.trim();
  if (fromMeta) return fromMeta.replace(/\/$/, '');
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') {
    return '/internal-api';
  }
  return `${window.location.origin}/internal-api`;
}
