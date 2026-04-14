/**
 * Vercel Edge Middleware
 *
 * 1. Same-origin HTTPS proxy to the DPA on your LAN (/dpa-api, /dpa-upload).
 * 2. Admin gate for fleet/firmware internal-api routes — requires operator session cookie.
 * 3. Maintenance mode via Edge Config — returns 503 when enabled.
 * 4. Geo header injection for analytics.
 * 5. Portal announcement header from Edge Config.
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

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('=') || '');
  }
  return null;
}

export const config = {
  matcher: ['/dpa-api/:path*', '/dpa-upload/:path*', '/internal-api/:path*'],
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // ── Internal API routes: admin gate + maintenance + headers ──
  if (pathname.startsWith('/internal-api')) {
    const responseHeaders = {};

    // Geo header for analytics
    const geo = request.geo;
    if (geo) {
      const region = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
      if (region) responseHeaders['x-dpa-region'] = region;
    }

    // Maintenance mode check via Edge Config
    try {
      const ecConn = process.env.EDGE_CONFIG;
      if (ecConn) {
        const { createClient } = await import('@vercel/edge-config');
        const ec = createClient(ecConn);
        const maintenance = await ec.get('maintenance_mode');
        if (maintenance === true) {
          return new Response(
            JSON.stringify({ error: 'maintenance_mode', detail: 'The DPA cloud platform is under maintenance. Please try again shortly.' }),
            { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' } },
          );
        }
        const announcement = await ec.get('portal_announcement');
        if (announcement && typeof announcement === 'string' && announcement.length > 0) {
          responseHeaders['x-dpa-announcement'] = announcement;
        }
      }
    } catch {
      // Edge Config unavailable — continue without it
    }

    // Admin gate for protected routes (public endpoints excluded)
    const publicPaths = ['/internal-api/firmware/latest', '/internal-api/analytics/summary', '/internal-api/analytics/events', '/internal-api/device/check-in', '/internal-api/device/health'];
    const adminPrefixes = ['/internal-api/fleet/', '/internal-api/firmware/', '/internal-api/devices', '/internal-api/ingest/'];
    const isPublic = publicPaths.some(p => pathname === p);
    const needsAdmin = !isPublic && adminPrefixes.some(p => pathname.startsWith(p));

    if (needsAdmin && request.method !== 'OPTIONS') {
      const sessionCookie = parseCookie(request.headers.get('cookie'), 'dpa_operator_session');
      if (!sessionCookie) {
        return new Response(
          JSON.stringify({ ok: false, error: 'operator_auth_required', detail: 'This route requires an authenticated operator session.' }),
          { status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
        );
      }
    }

    // Pass through to the serverless function with added headers
    if (Object.keys(responseHeaders).length > 0) {
      const response = await fetch(request);
      const newResponse = new Response(response.body, response);
      for (const [key, value] of Object.entries(responseHeaders)) {
        newResponse.headers.set(key, value);
      }
      return newResponse;
    }

    return undefined;
  }

  // ── Device proxy routes (/dpa-api, /dpa-upload) ──
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
