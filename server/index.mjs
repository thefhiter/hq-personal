import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, DATA, HOME, IS_WIN, readJson, safeJoin, exists, expandHome, run, tildify } from './util.mjs';
import { PAGES, PROVIDERS, getSettings, updateSettings, replaceSettings, resetSettings, setLogoFile, setKey, keyStatus, clearSecrets } from './config.mjs';
import { enrichedProjects, findProject, projectNotes, projectImages, githubRepos, discover, editProject, addProjectFolder } from './catalog.mjs';
import { gitLog, gitShow, gitWorking, listDir, readProjectFile, fileHistory, isRepo } from './git.mjs';
import { vaultIndex, readNote, saveNote, searchVault } from './vault.mjs';
import { bus, initTimer, timerState, timerCommand, focusStats, PRESETS } from './timer.mjs';
import { commitActivity, claudeSessions, sessionsForProject, sessionsByDay, refreshSessions } from './activity.mjs';
import { mediaBus, initMedia, library, search as ytSearch, resolveLink, enqueue, retryFailed, clearFailed, removeItem, setVideoScene, saveCookies, removeCookies, mediaFile } from './media.mjs';
import { termBus, cliStatus, listSessions, createSession, sessionSnapshot, writeSession, resizeSession, closeSession, closeAll } from './terminal.mjs';
import { providerInfo, listModels, testProvider, listThreads, getThread, createThread, updateThread, deleteThread, stopThread, send as aiSend } from './ai.mjs';
import { toolsBus, toolStatus, installTool } from './tools.mjs';
import { shortcutStatus, setShortcuts, refreshShortcuts } from './shortcuts.mjs';
import { timeline } from './timeline.mjs';

const PORT = Number(process.env.HQ_PORT || 9120);
const HOST = '127.0.0.1';
const PUBLIC = path.join(ROOT, 'public');
const BRAND = path.join(DATA, 'brand');
const PKG = await readJson(path.join(ROOT, 'package.json'), { version: '0.0.0' });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.bmp': 'image/bmp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.webm': 'video/webm',
};
const VENDOR = {
  'xterm.mjs': path.join(ROOT, 'node_modules/@xterm/xterm/lib/xterm.mjs'),
  'xterm.css': path.join(ROOT, 'node_modules/@xterm/xterm/css/xterm.css'),
  'addon-fit.mjs': path.join(ROOT, 'node_modules/@xterm/addon-fit/lib/addon-fit.mjs'),
};

// ---------- helpers ----------
const send = (res, status, body, headers = {}) => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
};
const ok = (res, body) => send(res, 200, body);
const fail = (res, status, message) => send(res, status, { error: message });

async function body(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Too large'), { status: 413 }); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function sse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': hq\n\n');
  return (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function guard(req) {
  // DNS-rebinding + CSRF protection: only HQ's own page may talk to the API.
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return 'Bad host';
  const origin = req.headers.origin;
  if (origin && !['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT].includes(origin)) return 'Bad origin';
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-hq'] !== '1') return 'Missing X-HQ header';
  return null;
}

function openDetached(cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true, shell: false });
  child.on('error', () => {});
  child.unref();
}

const BROWSERS = {
  chrome: [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`],
  edge: [`${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`],
};
/** Open a site in its own app window (the owner's normal browser profile, so they're signed in). */
async function openAppWindow(url) {
  const pref = (await getSettings()).ai.browser;
  const order = pref === 'edge' ? ['edge', 'chrome'] : ['chrome', 'edge'];
  const exe = pref === 'default' ? null : order.flatMap((b) => BROWSERS[b]).find((f) => f && exists(f));
  if (exe) openDetached(exe, [`--app=${url}`, '--window-size=1280,900']);
  else if (IS_WIN) openDetached(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', url]);
  else openDetached('xdg-open', [url]);
}

/** Windows folder picker on the owner's own desktop. */
async function pickFolder(start) {
  if (!IS_WIN) throw Object.assign(new Error('Type the folder path instead'), { status: 400 });
  const ps = `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose a folder for HQ'
$d.ShowNewFolderButton = $true
$p = $env:HQ_PICK_START
if ($p -and (Test-Path $p)) { $d.SelectedPath = $p }
$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized' }
$o.Show(); $o.Hide()
if ($d.ShowDialog($o) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }`;
  const r = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { timeout: 10 * 60_000, env: { ...process.env, HQ_PICK_START: start ? expandHome(start) : HOME } });
  return r.stdout.trim().split(/\r?\n/).pop() || null;
}

async function publicSettings() {
  const s = await getSettings();
  return { ...s, keys: await keyStatus(), pages: PAGES, version: PKG.version, dataDir: tildify(DATA), home: HOME };
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/health', (req, res) => ok(res, { ok: true, name: 'hq-personal', version: PKG.version, time: new Date().toISOString() }));

// settings & personalization
route('GET', '/api/settings', async (req, res) => ok(res, await publicSettings()));
route('POST', '/api/settings', async (req, res) => {
  const b = await body(req);
  const before = await getSettings();
  await updateSettings(b);
  if (b.profile && before.profile.title !== (await getSettings()).profile.title) refreshShortcuts().catch(() => {});
  if (b.folders) { discover.clear(); commitActivity.clear?.(); timeline.clear?.(); }
  if (b.github) githubRepos.clear?.();
  if (JSON.stringify(before.folders) !== JSON.stringify((await getSettings()).folders)) vaultIndex.clear();
  ok(res, await publicSettings());
});
route('GET', '/api/settings/export', async (req, res) => {
  const s = await getSettings();
  send(res, 200, { app: 'hq-personal', exported: new Date().toISOString(), settings: s }, { 'Content-Disposition': `attachment; filename="hq-settings-${new Date().toISOString().slice(0, 10)}.json"` });
});
route('POST', '/api/settings/import', async (req, res) => {
  const b = await body(req);
  const s = b.settings || b;
  if (!s || typeof s !== 'object' || !s.profile) return fail(res, 400, 'That is not an HQ settings file');
  await replaceSettings({ ...s, setupDone: true });
  discover.clear(); vaultIndex.clear();
  ok(res, await publicSettings());
});
route('POST', '/api/settings/reset', async (req, res) => {
  const b = await body(req);
  await resetSettings();
  if (b.keys) await clearSecrets();
  await fs.rm(BRAND, { recursive: true, force: true });
  discover.clear(); vaultIndex.clear();
  ok(res, await publicSettings());
});
route('POST', '/api/pick-folder', async (req, res) => { const b = await body(req); ok(res, { path: await pickFolder(b.start) }); });
route('POST', '/api/check-folder', async (req, res) => {
  const p = expandHome(String((await body(req)).path || ''));
  let count = 0;
  try { count = (await fs.readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).length; } catch { return ok(res, { exists: false, path: p }); }
  ok(res, { exists: true, path: p, folders: count });
});

// brand: logo upload + generated desktop icon
const IMG = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
route('POST', '/api/brand/logo', async (req, res) => {
  const b = await body(req, 3_000_000);
  if (!b.dataUrl) { await setLogoFile(null); return ok(res, await publicSettings()); }
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(String(b.dataUrl));
  if (!m || !IMG[m[1]]) return fail(res, 400, 'Use a PNG, JPG, WEBP, GIF or SVG image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2_000_000) return fail(res, 413, 'Keep the logo under 2 MB');
  if (IMG[m[1]] === 'svg' && /<script|on\w+\s*=|javascript:/i.test(buf.toString('utf8'))) return fail(res, 400, 'That SVG contains scripts');
  await fs.mkdir(BRAND, { recursive: true });
  for (const f of await fs.readdir(BRAND)) if (f.startsWith('logo.')) await fs.rm(path.join(BRAND, f), { force: true });
  const name = `logo.${IMG[m[1]]}`;
  await fs.writeFile(path.join(BRAND, name), buf);
  await setLogoFile(`${name}?v=${Date.now().toString(36)}`);
  ok(res, await publicSettings());
});
route('POST', '/api/brand/icon', async (req, res) => {
  // PNG renders of the current logo (made by the page) → app.ico for the desktop shortcut.
  const b = await body(req, 3_000_000);
  const pngs = (b.pngs || []).map((p) => ({ size: Number(p.size), data: Buffer.from(String(p.data || '').replace(/^data:image\/png;base64,/, ''), 'base64') }))
    .filter((p) => [16, 24, 32, 48, 64, 128, 256].includes(p.size) && p.data.subarray(1, 4).toString() === 'PNG');
  if (!pngs.length) return fail(res, 400, 'No icon images');
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o); dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(p.data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += p.data.length;
  });
  await fs.mkdir(BRAND, { recursive: true });
  const ico = Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
  // a new file name each time, so Windows shows the new icon instead of a cached one
  for (const f of await fs.readdir(BRAND)) if (/^app-\w+\.ico$/.test(f)) await fs.rm(path.join(BRAND, f), { force: true });
  await fs.writeFile(path.join(BRAND, `app-${Date.now().toString(36)}.ico`), ico);
  await fs.writeFile(path.join(BRAND, 'app.ico'), ico);
  const big = pngs.sort((a, b2) => b2.size - a.size)[0];
  await fs.writeFile(path.join(BRAND, 'icon.png'), big.data);
  refreshShortcuts().catch(() => {});
  ok(res, { ok: true });
});

// projects
route('GET', '/api/catalog', async (req, res, { query }) => ok(res, await enrichedProjects({ light: query.get('light') === '1', hidden: query.get('hidden') === '1' })));
route('GET', '/api/projects/:id', async (req, res, { params }) => {
  const p = await findProject(params.id);
  if (!p) return fail(res, 404, 'Unknown project');
  const [{ projects, categories, statuses }, notes, images] = await Promise.all([enrichedProjects({ hidden: true }), projectNotes(p), projectImages(p)]);
  ok(res, { ...projects.find((x) => x.id === p.id), ...notes, images, categories, statuses });
});
route('POST', '/api/projects/:id', async (req, res, { params }) => { const p = await editProject(params.id, await body(req)); return p ? ok(res, p) : fail(res, 404, 'Unknown project'); });
route('POST', '/api/projects-folder', async (req, res) => { await addProjectFolder(expandHome(String((await body(req)).path || ''))); ok(res, await enrichedProjects({ light: true })); });

const withProject = (fn) => async (req, res, ctx) => {
  const p = await findProject(ctx.params.id);
  if (!p) return fail(res, 404, 'Unknown project');
  if (!p.absPath || !exists(p.absPath)) return fail(res, 404, 'Project folder not found on this PC');
  return fn(req, res, { ...ctx, p });
};

route('GET', '/api/projects/:id/log', withProject(async (req, res, { p, query }) => ok(res, { repo: isRepo(p.absPath), commits: await gitLog(p.absPath, { limit: Number(query.get('limit')) || 300 }) })));
route('GET', '/api/projects/:id/commit/:hash', withProject(async (req, res, { p, params }) => {
  const c = await gitShow(p.absPath, params.hash);
  return c ? ok(res, c) : fail(res, 404, 'Commit not found');
}));
route('GET', '/api/projects/:id/working', withProject(async (req, res, { p }) => ok(res, (await gitWorking(p.absPath)) || { files: [], diff: '', notRepo: true })));
route('GET', '/api/projects/:id/tree', withProject(async (req, res, { p, query }) => ok(res, await listDir(p.absPath, query.get('path') || ''))));
route('GET', '/api/projects/:id/file', withProject(async (req, res, { p, query }) => {
  const f = await readProjectFile(p.absPath, query.get('path') || '');
  const { file, ...rest } = f;
  ok(res, { ...rest, history: await fileHistory(p.absPath, query.get('path')) });
}));
route('GET', '/api/projects/:id/raw', withProject(async (req, res, { p, query }) => {
  const file = safeJoin(p.absPath, query.get('path') || '');
  const ext = path.extname(file || '').toLowerCase();
  if (!file || !exists(file) || !/^image\//.test(MIME[ext] || '')) return fail(res, 404, 'Not an image');
  res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'max-age=60' });
  createReadStream(file).pipe(res);
}));
route('GET', '/api/projects/:id/sessions', withProject(async (req, res, { p }) => ok(res, await sessionsForProject(p.absPath))));

route('POST', '/api/open', async (req, res) => {
  const b = await body(req);
  let target = null;
  if (b.id) { const p = await findProject(b.id); target = p?.absPath; }
  else if (b.data) target = DATA;
  else if (b.path) target = expandHome(b.path);
  if (!target || !exists(target)) return fail(res, 404, 'Nothing to open');
  if (b.target === 'code') openDetached(process.env.ComSpec || 'cmd.exe', ['/c', 'code', target]);
  else openDetached(IS_WIN ? 'explorer.exe' : 'xdg-open', [target]);
  ok(res, { opened: target });
});

route('GET', '/api/activity', async (req, res) => {
  const s = await getSettings();
  const [commits, byDaySessions] = await Promise.all([commitActivity(), sessionsByDay().catch(() => ({}))]);
  ok(res, { commits, focus: focusStats(s.focus.dailyGoalMin), claude: byDaySessions });
});
route('GET', '/api/timeline', async (req, res) => ok(res, await timeline()));
route('GET', '/api/sessions', async (req, res, { query }) => {
  if (query.get('refresh') === '1') refreshSessions();
  const { sessions, built, building } = await claudeSessions();
  ok(res, { built, building, sessions: sessions.slice(0, Number(query.get('limit')) || 400).map(({ editsMap, file, ...s }) => s) });
});

// notes
route('GET', '/api/vault', async (req, res) => ok(res, await vaultIndex()));
route('GET', '/api/vault/note', async (req, res, { query }) => ok(res, await readNote(query.get('id'))));
route('POST', '/api/vault/note', async (req, res) => ok(res, await saveNote(await body(req))));
route('GET', '/api/vault/search', async (req, res, { query }) => ok(res, await searchVault(query.get('q'))));

// focus timer
route('GET', '/api/timer', (req, res) => ok(res, timerState()));
route('POST', '/api/timer', async (req, res) => ok(res, await timerCommand(await body(req))));
route('GET', '/api/focus/stats', async (req, res) => ok(res, focusStats((await getSettings()).focus.dailyGoalMin)));
route('GET', '/api/focus/presets', (req, res) => ok(res, PRESETS));

// media library (YouTube → MP3 / HD background clips)
route('GET', '/api/library', (req, res) => ok(res, library()));
route('GET', '/api/yt/search', async (req, res, { query }) => {
  const q = (query.get('q') || '').trim();
  if (q.length < 2) return ok(res, []);
  ok(res, await ytSearch(q));
});
route('POST', '/api/yt/resolve', async (req, res) => { const b = await body(req); ok(res, await resolveLink(String(b.url || ''))); });
route('POST', '/api/library/download', async (req, res) => {
  const b = await body(req);
  const items = Array.isArray(b.items) ? b.items.slice(0, 200) : [b];
  ok(res, items.map((it) => { try { return enqueue({ id: it.id, kind: b.kind || it.kind, title: it.title, scene: b.scene || it.scene }); } catch (e) { return { id: it.id, error: e.message }; } }));
});
route('POST', '/api/library/retry', (req, res) => ok(res, retryFailed()));
route('POST', '/api/library/clear-failed', (req, res) => { clearFailed(); ok(res, library()); });
route('DELETE', '/api/library/:kind/:id', async (req, res, { params }) => ok(res, { removed: await removeItem(params.kind, params.id) }));
route('POST', '/api/library/video/:id/scene', async (req, res, { params }) => { const v = await setVideoScene(params.id, (await body(req)).scene); return v ? ok(res, v) : fail(res, 404, 'Not in the library'); });
route('POST', '/api/youtube/account', async (req, res) => { await saveCookies((await body(req)).cookies); ok(res, library()); });
route('DELETE', '/api/youtube/account', async (req, res) => { await removeCookies(); ok(res, library()); });

// helper programs
route('GET', '/api/tools', async (req, res) => ok(res, await toolStatus()));
route('POST', '/api/tools/:id/install', async (req, res, { params }) => ok(res, await installTool(params.id)));

// Desktop / Start-menu shortcuts (made only when the owner asks)
route('GET', '/api/shortcuts', async (req, res) => ok(res, await shortcutStatus()));
route('POST', '/api/shortcuts', async (req, res) => { const b = await body(req); ok(res, await setShortcuts({ desktop: b.desktop, startMenu: b.startMenu })); });

// AI: providers, keys, chat, terminals, web apps
route('GET', '/api/ai/providers', async (req, res) => ok(res, await providerInfo()));
route('GET', '/api/ai/models', async (req, res, { query }) => ok(res, await listModels(query.get('provider'), { fresh: query.get('fresh') === '1' })));
route('POST', '/api/ai/key', async (req, res) => {
  const b = await body(req);
  await setKey(b.provider, b.key);
  ok(res, b.key ? await testProvider(b.provider) : { ok: true, removed: true });
});
route('POST', '/api/ai/test', async (req, res) => ok(res, await testProvider((await body(req)).provider)));
route('POST', '/api/ai/open-web', async (req, res) => {
  const b = await body(req);
  const info = (await providerInfo())[b.provider];
  const url = b.url && /^https:\/\//.test(b.url) ? b.url : info?.web;
  if (!url) return fail(res, 400, 'No web address for this AI');
  await openAppWindow(url);
  ok(res, { opened: url });
});
route('GET', '/api/ai/threads', async (req, res) => ok(res, await listThreads()));
route('POST', '/api/ai/threads', async (req, res) => ok(res, await createThread(await body(req))));
route('GET', '/api/ai/threads/:id', async (req, res, { params }) => { const t = await getThread(params.id); return t ? ok(res, t) : fail(res, 404, 'Chat not found'); });
route('PATCH', '/api/ai/threads/:id', async (req, res, { params }) => { const t = await updateThread(params.id, await body(req)); return t ? ok(res, t) : fail(res, 404, 'Chat not found'); });
route('DELETE', '/api/ai/threads/:id', async (req, res, { params }) => { await deleteThread(params.id); ok(res, { deleted: params.id }); });
route('POST', '/api/ai/threads/:id/stop', (req, res, { params }) => ok(res, { stopped: stopThread(params.id) }));
route('POST', '/api/ai/threads/:id/send', async (req, res, { params }) => {
  const b = await body(req, 400_000);
  const push = sse(res);
  let closed = false;
  res.on('close', () => { closed = true; });
  try {
    const msg = await aiSend(params.id, b.text, (d) => { if (!closed) push('delta', { text: d }); });
    const { raw, ...lite } = msg;
    push('done', lite);
  } catch (e) {
    push('error', { error: e.message });
  }
  res.end();
});
route('GET', '/api/ai/cli', async (req, res) => ok(res, await cliStatus()));
route('GET', '/api/term', (req, res) => ok(res, listSessions()));
route('POST', '/api/term', async (req, res) => {
  const b = await body(req);
  let cwd = b.cwd ? expandHome(b.cwd) : HOME;
  if (b.projectId) { const p = await findProject(b.projectId); if (p?.absPath && exists(p.absPath)) cwd = p.absPath; }
  ok(res, await createSession({ cwd, kind: b.kind, provider: b.provider, cols: b.cols, rows: b.rows }));
});
route('POST', '/api/term/:id/input', async (req, res, { params }) => ok(res, { ok: writeSession(params.id, (await body(req)).data ?? '') }));
route('POST', '/api/term/:id/resize', async (req, res, { params }) => { const b = await body(req); ok(res, { ok: resizeSession(params.id, b.cols, b.rows) }); });
route('DELETE', '/api/term/:id', (req, res, { params }) => ok(res, { closed: closeSession(params.id) }));
route('GET', '/api/term/:id', (req, res, { params }) => { const snap = sessionSnapshot(params.id); return snap ? ok(res, snap) : fail(res, 404, 'Session ended'); });

route('GET', '/api/events', (req, res) => {
  const push = sse(res);
  push('timer', timerState());
  const on = [
    [bus, 'timer', (s) => push('timer', s)], [bus, 'timer:done', (d) => push('timer:done', d)], [bus, 'session', (s) => push('session', s)],
    [mediaBus, 'job', (j) => push('media:job', j)], [mediaBus, 'library', () => push('media:library', {})],
    [termBus, 'data', (d) => push('term', d)], [termBus, 'exit', (d) => push('term:exit', d)],
    [toolsBus, 'job', (j) => push('tools:job', j)],
  ];
  for (const [em, ev, fn] of on) em.on(ev, fn);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); for (const [em, ev, fn] of on) em.off(ev, fn); });
});

// ---------- static ----------
/** Stream a file with HTTP Range support so audio/video can seek and start instantly. */
async function sendFile(req, res, file, cache = 'no-cache') {
  const st = await fs.stat(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const extra = type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {};
  if (range && (range[1] !== '' || range[2] !== '')) {
    let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
    if (start < 0) start = 0;
    if (start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': cache, ...extra });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ...extra });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  const m = /^\/media\/(music|videos|thumbs)\/([^/]+)$/.exec(rel);
  if (m) {
    const f = mediaFile(m[1], m[2]);
    return f ? sendFile(req, res, f, 'max-age=86400') : fail(res, 404, 'Not in the library');
  }
  const b = /^\/brand\/(logo\.(png|jpg|webp|svg|gif)|icon\.png)$/.exec(rel);
  if (b) { const f = path.join(BRAND, b[1]); return exists(f) ? sendFile(req, res, f) : fail(res, 404, 'No logo'); }
  const v = /^\/vendor\/([\w.-]+)$/.exec(rel);
  if (v) return VENDOR[v[1]] && exists(VENDOR[v[1]]) ? sendFile(req, res, VENDOR[v[1]], 'max-age=86400') : fail(res, 404, 'Not found');
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = safeJoin(PUBLIC, rel);
  if (!file || !exists(file)) {
    if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
    return fail(res, 404, 'Not found');
  }
  const st = await fs.stat(file);
  if (st.isDirectory()) return fail(res, 404, 'Not found');
  return sendFile(req, res, file);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const blocked = guard(req);
  if (blocked) return fail(res, 403, blocked);
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return await r.handler(req, res, { params, query: url.searchParams });
      }
      return fail(res, 404, 'Unknown API route');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed');
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[hq]', req.method, url.pathname, e.message);
    if (!res.headersSent) fail(res, e.status || 500, e.message);
    else res.end();
  }
});

await Promise.all([initTimer(), initMedia()]);
process.on('exit', closeAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is busy — HQ is probably already running.`); process.exit(1); }
  throw e;
});
server.listen(PORT, HOST, () => {
  console.log(`HQ is up → http://${HOST}:${PORT}  (data: ${DATA})`);
  enrichedProjects().then(() => commitActivity()).then(() => timeline()).catch(() => {});
  refreshSessions().catch(() => {});
  refreshShortcuts().catch(() => {}); // keeps shortcuts right if the HQ folder was moved or updated
  setInterval(() => refreshSessions().catch(() => {}), 10 * 60_000).unref();
});

export { PROVIDERS };
