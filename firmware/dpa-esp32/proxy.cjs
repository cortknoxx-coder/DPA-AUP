// Proxy server: serves dashboard.html locally but proxies all /api/* calls to the real DPA device
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEVICE = 'http://192.168.4.1';
const PORT = 4301;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    // Proxy to real device
    const deviceUrl = DEVICE + req.url;
    http.get(deviceUrl, { timeout: 5000 }, (devRes) => {
      res.writeHead(devRes.statusCode, devRes.headers);
      devRes.pipe(res);
    }).on('error', (e) => {
      res.writeHead(502, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error: 'device unreachable', detail: e.message}));
    });
  } else {
    // Serve dashboard.html for everything else
    const fp = path.join(__dirname, 'dashboard.html');
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(fs.readFileSync(fp));
  }
}).listen(PORT, () => console.log('Proxy on http://localhost:' + PORT + ' -> ' + DEVICE));
