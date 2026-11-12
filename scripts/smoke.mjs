// Smoke test against a running HQ: `npm test` (start it first with `npm start`).
const BASE = process.env.HQ_URL || 'http://127.0.0.1:9120';
let failed = 0;
async function check(name, fn) {
  try { const note = await fn(); console.log(`ok   ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { failed++; console.log(`FAIL ${name} — ${e.message}`); }
}
const get = async (p, init) => {
  const r = await fetch(BASE + p, init);
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return r.json();
};
const assert = (c, m) => { if (!c) throw new Error(m); };

await check('health', async () => { const h = await get('/api/health'); assert(h.ok && h.name === 'hq-personal', 'not HQ'); return h.version; });
await check('settings', async () => { const s = await get('/api/settings'); assert(s.nav?.length === 8, 'pages'); return `${s.profile.name || '(no name yet)'} · ${s.theme.preset}/${s.theme.mode} · setup ${s.setupDone ? 'done' : 'pending'}`; });
await check('AI providers', async () => { const p = await get('/api/ai/providers'); assert(p.claude && p.chatgpt && p.gemini, 'missing'); return `${Object.keys(p).length} providers`; });
await check('AI terminal apps', async () => { const c = await get('/api/ai/cli'); return `pty ${c.pty ? 'ok' : 'MISSING'} · ${Object.values(c.clis).filter((x) => x.installed).map((x) => x.cli).join(', ') || 'none installed'}`; });
await check('helper programs', async () => { const t = await get('/api/tools'); return t.tools.map((x) => `${x.id} ${x.installed ? '✓' : '✗'}`).join(' · '); });
await check('projects', async () => { const c = await get('/api/catalog?light=1'); return `${c.projects.length} projects`; });
await check('notes', async () => { const v = await get('/api/vault'); return `${v.notes.length} notes in ${v.sources.length} source(s)`; });
await check('music library', async () => { const l = await get('/api/library'); return `${l.tracks.length} songs, ${l.videos.length} backgrounds, ${(l.disk.free / 1e9).toFixed(1)} GB free`; });
await check('YouTube search', async () => { const r = await get('/api/yt/search?q=lofi%20study'); assert(r.length > 0, 'no results'); return `${r.length} results`; });
await check('timer state', async () => { const t = await get('/api/timer'); assert('mode' in t, 'no mode'); return t.mode; });
await check('POST without X-HQ is refused', async () => { const r = await fetch(BASE + '/api/timer', { method: 'POST' }); assert(r.status === 403, `got ${r.status}`); });
await check('foreign Host is refused', async () => {
  const http = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const u = new URL(BASE);
    http.get({ host: u.hostname, port: u.port, path: '/api/health', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert(status === 403, `got ${status}`);
});
await check('files stay inside a project', async () => {
  const c = await get('/api/catalog?light=1');
  const p = c.projects.find((x) => x.exists);
  if (!p) return 'no projects to test with';
  const r = await fetch(`${BASE}/api/projects/${p.id}/file?path=${encodeURIComponent('../../../Windows/win.ini')}`);
  assert(r.status >= 400, `got ${r.status}`);
});
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
