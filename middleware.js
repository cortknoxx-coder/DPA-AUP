/**
 * Vercel Edge Middleware — same-origin HTTPS proxy to the DPA on your LAN.
 *
 * Set in the Vercel project (Production + Preview as needed):
 *   DPA_DEVICE_API_TUNNEL     e.g. https://your-tunnel.example (must reach http://192.168.4.1/)
 *   DPA_DEVICE_UPLOAD_TUNNEL  optional; defaults to DPA_DEVICE_API_TUNNEL (port 81 must be exposed on tunnel)
 *
 * Browser → https://<vercel>/dpa-api/api/status → this middleware → DPA_DEVICE_API_TUNNEL/api/status
 */

function trimSlash(s) {
  return (s || '').trim().replace(/\/+$/, '');
}

function isTemporaryTunnel(base) {
  try {
    return new URL(base).hostname.toLowerCase().includes('pinggy');
  } catch {
    return false;
  }
}

function upstreamBase(prefix, envMain, envUpload) {
  if (prefix === '/dpa-upload') {
    const u = trimSlash(envUpload || envMain);
    return u || null;
  }
  return trimSlash(envMain) || null;
}

export const config = {
  matcher: ['/dpa-api/:path*', '/dpa-upload/:path*'],
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const envMain = process.env.DPA_DEVICE_API_TUNNEL;
  const envUpload = process.env.DPA_DEVICE_UPLOAD_TUNNEL;

  let prefix = '';
  if (pathname === '/dpa-api' || pathname.startsWith('/dpa-api/')) {
    prefix = '/dpa-api';
  } else if (pathname === '/dpa-upload' || pathname.startsWith('/dpa-upload/')) {
    prefix = '/dpa-upload';
  }

  const base = upstreamBase(prefix, envMain, envUpload);
  if (!base || isTemporaryTunnel(base)) {
    return new Response(
      JSON.stringify({
        error: 'dpa_cloud_or_local_direct_required',
        detail: 'This hosted path is only for an explicitly configured device gateway. Use the Vercel cloud-control path for relay access, or connect directly to the DPA on the same network.',
      }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

  const rel = pathname.slice(prefix.length).replace(/^\/+/, '');
  const target = new URL(rel || '', base.endsWith('/') ? base : `${base}/`);
  url.searchParams.forEach((v, k) => {
    target.searchParams.set(k, v);
  });

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  const accept = request.headers.get('accept');
  if (contentType) headers.set('content-type', contentType);
  if (accept) headers.set('accept', accept);
  headers.set('cache-control', 'no-cache');

  try {
    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }
    return await fetch(target.toString(), init);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'dpa_tunnel_fetch_failed',
        detail: error instanceof Error ? error.message : String(error),
        target: target.toString(),
      }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } },
    );
  }
}
