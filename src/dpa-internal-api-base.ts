/**
 * Base URL for the internal ingest / operator API (cookies + CORS).
 * - Local dev: same-origin `/internal-api` (see proxy.conf.json).
 * - Hosted HTTPS: opt-in only via the `dpa-internal-api-base` meta tag.
 */
export function dpaInternalApiBaseUrl(): string | null {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:8787/internal-api';
  }
  const meta = document.querySelector('meta[name="dpa-internal-api-base"]');
  const fromMeta = meta?.getAttribute('content')?.trim();
  if (fromMeta) return fromMeta.replace(/\/$/, '');
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') {
    return '/internal-api';
  }
  return null;
}
