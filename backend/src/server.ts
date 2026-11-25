/**
 * C-Studio backend entry point.
 *   GET  /api/health     toolchain + sandbox status
 *   POST /api/compile    build only, returns diagnostics
 *   POST /api/format     clang-format
 *   WS   /ws/run         compile + interactive execution
 *   WS   /ws/debug       compile + GDB/MI debugging
 * Optionally serves the built frontend from ../dist when CSTUDIO_STATIC is set.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { handleApi, json, health } from './api/routes.js';
import { handleRunSession } from './execution/runSession.js';
import { handleDebugSession } from './debugger/gdbSession.js';
import { allowRequest } from './security/rateLimit.js';
import { logger } from './services/logger.js';

const staticRoot = process.env.CSTUDIO_STATIC ? resolve(process.env.CSTUDIO_STATIC) : null;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

function originAllowed(origin: string | undefined): boolean {
  if (config.allowedOrigins.includes('*')) return true;
  return !origin || config.allowedOrigins.includes(origin);
}

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  if (!staticRoot) return false;
  const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  let file = join(staticRoot, rel);
  if (!file.startsWith(staticRoot)) return false;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(staticRoot, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  cors(req, res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) {
    const ip = req.socket.remoteAddress ?? 'unknown';
    if (url.pathname !== '/api/health' && !allowRequest(ip)) return json(res, 429, { error: 'Too many requests' });
    return handleApi(req, res, url.pathname);
  }
  if (await serveStatic(url.pathname, res)) return;
  json(res, 404, { error: 'Not found' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ip = req.socket.remoteAddress ?? 'unknown';
  if (!originAllowed(req.headers.origin) || !allowRequest(ip) || (url.pathname !== '/ws/run' && url.pathname !== '/ws/debug')) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (url.pathname === '/ws/run') handleRunSession(ws);
    else handleDebugSession(ws);
  });
});

server.listen(config.port, config.host, () => {
  const h = health();
  logger.info('C-Studio backend listening', { port: config.port, sandbox: h.sandbox, gcc: h.toolchain.gcc.version, clang: h.toolchain.clang.version });
  if (!h.sandbox.ok) logger.warn('Sandbox is NOT operational: compile/run requests will fail', { detail: h.sandbox.detail });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info('shutting down');
    wss.clients.forEach((c) => c.close());
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
