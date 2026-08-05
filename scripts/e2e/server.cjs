const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'web/frontend/dist');
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8787;
const BUNDLE = path.join(os.tmpdir(), 'phantom-e2e', 'proxy.bundle.cjs');

// bundle the real Pages Function with esbuild so the proxy under test is the actual code
fs.mkdirSync(path.dirname(BUNDLE), { recursive: true });
execSync(
  `node ${ROOT}/node_modules/esbuild/bin/esbuild ${ROOT}/web/frontend/functions/api/proxy.ts --bundle --platform=node --format=cjs --outfile=${BUNDLE}`,
  { stdio: 'inherit' }
);
const { onRequest, onRequestOptions } = require(BUNDLE);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
};

async function runFunction(handler, nodeReq, nodeRes, url) {
  const headers = {};
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    headers[k] = String(v);
  }
  let body = null;
  const chunks = [];
  for await (const c of nodeReq) chunks.push(c);
  body = Buffer.concat(chunks);
  const req = new Request(`http://localhost:${PORT}${url}`, {
    method: nodeReq.method,
    headers,
    body: body.length ? body : undefined,
  });
  const resp = await handler({ request: req });
  nodeRes.writeHead(resp.status, Object.fromEntries(resp.headers.entries()));
  if (resp.body) {
    const stream = require('node:stream').Readable.fromWeb(resp.body);
    stream.pipe(nodeRes);
  } else {
    nodeRes.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/proxy' || url.startsWith('/proxy?')) {
    const u = new URL(req.url, 'http://localhost');
    console.log('[proxy] ', req.method, u.searchParams.get('u')?.slice(0, 90));
    return runFunction(onRequest, req, res, req.url);
  }
  if (req.method === 'OPTIONS') {
    return runFunction(onRequestOptions, req, res, req.url);
  }
  let filePath = path.join(DIST, decodeURIComponent(url));
  if (url === '/') filePath = path.join(DIST, 'index.html');
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      return res.end('not found: ' + url);
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-store',
      'service-worker-allowed': '/',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`serving ${DIST} on :${PORT} (proxy = real Pages Function)`);
});
