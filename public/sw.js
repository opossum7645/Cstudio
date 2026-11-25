/* C-Studio service worker: offline app shell.
 * - navigation requests: network first, fall back to the cached shell (offline)
 * - same-origin static assets: cache first (hashed file names make them immutable)
 * - /api and /ws (compiler service) are never cached: they require the network */
const VERSION = 'cstudio-__BUILD__';
const TOOLCHAIN_CACHE = 'cstudio-toolchain'; // large Clang/WASM files, kept across app updates
/* filled at build time with every emitted JS/CSS/font/worker asset */
const ASSETS = []; /*__PRECACHE__*/
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).then(() => Promise.all(ASSETS.map((a) => c.add(a).catch(() => undefined))))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TOOLCHAIN_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

/* ───── stdin bridge for programs running in the browser compiler ─────
 * The run worker blocks on a synchronous GET to "__cstudio_stdin__?s=<session>"; the page posts
 * the user's input here and the pending request is answered with it. */
const stdinSessions = new Map();
function stdinSession(s) {
  if (!stdinSessions.has(s)) stdinSessions.set(s, { buf: '', eof: false, waiter: null });
  return stdinSessions.get(s);
}
function flushStdin(sess) {
  if (!sess.waiter || (!sess.buf && !sess.eof)) return;
  const body = sess.buf;
  sess.buf = '';
  sess.waiter(new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cstudio-Eof': !body && sess.eof ? '1' : '0' } }));
  sess.waiter = null;
}
self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (!m.s) return;
  if (m.type === 'cstudio-stdin') {
    const sess = stdinSession(m.s);
    sess.buf += m.data;
    flushStdin(sess);
  } else if (m.type === 'cstudio-stdin-eof') {
    const sess = stdinSession(m.s);
    sess.eof = true;
    flushStdin(sess);
  } else if (m.type === 'cstudio-stdin-end') {
    const sess = stdinSessions.get(m.s);
    if (sess && sess.waiter) sess.waiter(new Response('', { headers: { 'X-Cstudio-Eof': '1' } }));
    stdinSessions.delete(m.s);
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.pathname.endsWith('/__cstudio_stdin__')) {
    const sess = stdinSession(url.searchParams.get('s') || '');
    event.respondWith(new Promise((resolve) => {
      sess.waiter = resolve;
      flushStdin(sess);
    }));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/ws/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreVary: true }).then((r) => r || caches.match('./', { ignoreVary: true }))),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && /\.(wasm|tar)$/.test(url.pathname)) {
            const copy = res.clone();
            caches.open(TOOLCHAIN_CACHE).then((c) => c.put(req, copy));
          } else if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/icons/'))) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
