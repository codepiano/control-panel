const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('./backend');

async function createServer({ autoStart = true } = {}) {
  await core.initialize({ autoStart });
  const token = crypto.randomBytes(32).toString('hex');
  const files = new Map([
    ['/', ['src/index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['src/index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['src/styles.css', 'text/css; charset=utf-8']],
    ['/client.js', ['src/client.js', 'text/javascript; charset=utf-8']],
    ['/renderer.js', ['src/renderer.js', 'text/javascript; charset=utf-8']],
    ['/assets/app-icon.png', ['assets/app-icon.png', 'image/png']],
  ]);
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      reply(403, { error: '仅允许本机同源访问' }); return;
    }
    const url = new URL(req.url, origin);
    try {
      if (req.method === 'GET' && url.pathname === '/health') { reply(200, { status: 'running', uptimeSec: Math.floor(process.uptime()) }); return; }
      if (req.method === 'GET' && url.pathname === '/api/session') { reply(200, { token }); return; }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers['x-control-panel-token'] !== token) { reply(403, { error: '会话已失效，请刷新页面' }); return; }
        if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: '需要 JSON 请求' }); return; }
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { reply(413, { error: '请求过大' }); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(body.args)) { reply(400, { error: '参数应为数组' }); return; }
        const data = await core.invoke(url.pathname.slice(5), body.args);
        reply(200, { data }); return;
      }
      const file = files.get(url.pathname);
      if (req.method !== 'GET' || !file) { reply(404, { error: '未找到' }); return; }
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(path.join(__dirname, '..', file[0])));
    } catch (error) { reply(400, { error: String(error.message || error) }); }
  });
  server.on('close', core.shutdown);
  return server;
}

if (require.main === module) {
  const port = Number(process.env.CONTROL_PANEL_PORT || 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CONTROL_PANEL_PORT 应为 1–65535');
  createServer().then((server) => {
    server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Control Panel: http://127.0.0.1:${port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
module.exports = { createServer };
