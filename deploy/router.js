// jam's router: one port for nginx proxy manager (3000), by path to the three apps on this machine.
//
//   nginx proxy manager (192.168.88.20)  jam.geyser.at  ->  http://192.168.88.100:3000  (this router)
//       /tabs  -> 127.0.0.1:3001      /beats -> 127.0.0.1:3002      /time -> 127.0.0.1:3003      / -> /tabs
//
// The path is passed on unchanged — each app knows its own (BASE_PATH). Websockets (tabs' /tabs/ws)
// are handed through. deploy/jam.mjs runs it. No dependencies.

const http = require('http');
const net = require('net');

const parseRoutes = raw => String(raw).split(',').map(part => {
  const [p, port] = part.split('=').map(s => s.trim());
  return p && /^\/[\w-]+$/.test(p) && Number(port) ? { path: p, port: Number(port) } : null;
}).filter(Boolean);

/**
 * the router: a plain http server — listen() it on a port.
 * `canonical` (e.g. "jam.geyser.at"): every other <name>.<same domain> whose name is an app goes there —
 * tabs.geyser.at/x → https://jam.geyser.at/tabs/x, beats.geyser.at → …/beats, time.geyser.at → …/time.
 */
function createRouter(routes, { home = routes[0]?.path || '/', canonical = '' } = {}) {
  const domain = canonical.includes('.') ? canonical.slice(canonical.indexOf('.') + 1).toLowerCase() : '';

  /** "https://jam.geyser.at/tabs/x" for a request to tabs.geyser.at/x — null for everything else */
  const alias = req => {
    if (!domain) return null;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
    if (!host.endsWith(`.${domain}`) || host === canonical.toLowerCase()) return null;
    const route = routes.find(r => r.path === `/${host.slice(0, -(domain.length + 1))}`);
    if (!route) return null;
    const url = req.url === '/' ? '' : req.url;
    return `https://${canonical}${url === route.path || url.startsWith(`${route.path}/`) || url.startsWith(`${route.path}?`) ? url : route.path + url}`;
  };

  const target = url => {
    const p = url.split('?')[0];
    return routes.find(r => p === r.path || p.startsWith(`${r.path}/`));
  };

  const server = http.createServer((req, res) => {
    const to = alias(req);
    if (to) { res.writeHead(302, { Location: to, 'X-Jam': 'router' }); res.end(); return; }
    const route = target(req.url);
    // the header lets a second jam see that this one is running already
    if (!route) { res.writeHead(302, { Location: home, 'X-Jam': 'router' }); res.end(); return; }
    const headers = {
      ...req.headers,
      // the proxy in front (npm) told us who the client is — keep that, add who called us
      'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http',
      'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host,
    };
    const up = http.request({ host: '127.0.0.1', port: route.port, method: req.method, path: req.url, headers }, r => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`${route.path.slice(1)} is not running on this machine right now`);
    });
    req.pipe(up);
  });

  // websockets: hand the raw connection through
  server.on('upgrade', (req, socket, head) => {
    const route = target(req.url);
    if (!route) { socket.destroy(); return; }
    const up = net.connect(route.port, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head && head.length) up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });

  return server;
}

module.exports = { createRouter, parseRoutes };
