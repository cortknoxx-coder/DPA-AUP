import http from 'node:http';
import https from 'node:https';

const port = Number(process.env.PORT || 4302);
const targetOrigin = process.env.TARGET_ORIGIN || 'http://192.168.4.1';
const upstream = new URL(targetOrigin);
const transport = upstream.protocol === 'https:' ? https : http;

function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function writeJson(res, status, payload, origin = '*') {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  const target = new URL(req.url || '/', upstream);
  const headers = { ...req.headers, host: upstream.host };
  delete headers['content-length'];

  const proxyReq = transport.request(target, {
    method: req.method,
    headers,
  }, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers, ...corsHeaders(origin) };
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    writeJson(res, 502, {
      error: 'relay_upstream_failed',
      detail: error.message,
      target: target.toString(),
    }, origin);
  });

  req.pipe(proxyReq);
});

server.listen(port, () => {
  console.log(`device relay listening on http://127.0.0.1:${port} -> ${targetOrigin}`);
});
