// HQ server entry. It listens right away and shows a "Starting HQ…" page while the rest of HQ loads,
// then hands every request to the full app (server/index.mjs). The first start after installing can be
// slow while Windows checks every file, so the window never sits empty or "does nothing".
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HQ_PORT || 9120);
const HOST = '127.0.0.1';
const VERSION = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } })();
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

let app = null; // the loaded app module, once ready
let loadError = null;

const SPLASH = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HQ</title>
<style>
  :root { --ember: #FF7A1A; --bg: #0A0A0A; --ink: #F5F5F5; --dim: #9A9A9A; color-scheme: dark; }
  :root[data-mode='light'] { --bg: #F7F6F4; --ink: #141414; --dim: #5E5E5E; color-scheme: light; }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { display: grid; justify-items: center; gap: 18px; padding: 24px; text-align: center; max-width: 520px; }
  .ring { width: 46px; height: 46px; border-radius: 50%; border: 3px solid color-mix(in oklab, var(--ember) 22%, transparent); border-top-color: var(--ember); animation: spin 0.9s linear infinite; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.01em; }
  p { margin: 0; color: var(--dim); }
  pre { margin: 0; max-width: 100%; white-space: pre-wrap; text-align: left; font: 12px/1.45 Consolas, monospace; color: var(--dim); }
  .err .ring { animation: none; border-color: #E5484D; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .ring { animation-duration: 3s; } }
</style>
<script>
  try { const t = JSON.parse(localStorage.getItem('hq.theme') || 'null'); if (t) { document.documentElement.dataset.mode = t.mode; if (t.vars && t.vars['--ember']) document.documentElement.style.setProperty('--ember', t.vars['--ember']); } } catch {}
</script></head>
<body><main id="box" role="status" aria-live="polite">
  <div class="ring" aria-hidden="true"></div>
  <h1 id="title">Starting HQ…</h1>
  <p id="note">This takes a few seconds. The first start after installing can take up to a minute.</p>
</main>
<script>
  const box = document.getElementById('box');
  async function poll() {
    try {
      const h = await (await fetch('/api/health', { cache: 'no-store' })).json();
      if (h.ready) return location.reload();
      if (h.error) {
        box.classList.add('err');
        document.getElementById('title').textContent = 'HQ could not start';
        document.getElementById('note').textContent = 'Close this window and open HQ again. If it happens again, send this message to the person who gave you HQ.';
        const pre = document.createElement('pre'); pre.textContent = h.error; box.append(pre);
        return;
      }
    } catch {}
    setTimeout(poll, 400);
  }
  poll();
</script></body></html>`;

function reply(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/** Answers while the app is still loading (or failed to load). */
function starting(req, res) {
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return reply(res, 403, { error: 'Bad host' });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/api/health') return reply(res, 200, { ok: true, name: 'hq-personal', version: VERSION, ready: false, error: loadError });
  if (url.pathname === '/api/app/quit' && req.method === 'POST' && req.headers['x-hq'] === '1' && !req.headers.origin) {
    reply(res, 200, { ok: true });
    return setTimeout(() => process.exit(0), 150);
  }
  if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !path.extname(url.pathname)) return reply(res, 200, SPLASH, 'text/html; charset=utf-8');
  reply(res, 503, { error: 'HQ is starting' });
}

const server = http.createServer((req, res) => (app ? app.handle(req, res) : starting(req, res)));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is busy: HQ is probably already running.`); process.exit(3); }
  console.error('[hq] server error:', e);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

server.listen(PORT, HOST, async () => {
  console.log(`HQ ${VERSION} is starting on http://${HOST}:${PORT}`);
  try {
    const mod = await import('./index.mjs');
    await mod.start();
    app = mod;
    console.log(`HQ is up → http://${HOST}:${PORT}  (data: ${mod.DATA})`);
    mod.afterListen();
  } catch (e) {
    loadError = String(e?.stack || e).split('\n').slice(0, 6).join('\n');
    console.error('[hq] could not load:', e);
  }
});
