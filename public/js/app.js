import { icon, hydrateIcons } from './lib/icons.js';
import { api, toast, esc, mmss, catalog, debounce } from './lib/ui.js';
import { applyTheme, logoHtml, renderIcon, cssVar } from './lib/theme.js';
import * as player from './lib/player.js';
import * as stage from './lib/stage.js';

const PAGE_ICON = { home: 'home', focus: 'flame', music: 'music', ai: 'sparkles', projects: 'grid', notes: 'memory', timeline: 'clock', settings: 'sliders' };

const VIEWS = {
  welcome: () => import('./views/welcome.js'),
  home: () => import('./views/home.js'),
  projects: () => import('./views/projects.js'),
  project: () => import('./views/project.js'),
  focus: () => import('./views/focus.js'),
  music: () => import('./views/music.js'),
  ai: () => import('./views/ai.js'),
  notes: () => import('./views/notes.js'),
  timeline: () => import('./views/timeline.js'),
  settings: () => import('./views/settings.js'),
};

export const state = { timer: null, settings: null, providers: null, events: new EventTarget() };
const main = document.getElementById('main');
const titleEl = document.getElementById('page-title');
let cleanup = null;
let navToken = 0;

// ---------- personalization ----------
/** Label shown for a page in the sidebar (owner's own label, or the AI they chose). */
export function pageLabel(id, s = state.settings) {
  const n = s?.nav?.find((x) => x.id === id);
  if (n?.label) return n.label;
  if (id === 'ai') return state.providers?.[s?.ai?.primary]?.name || 'AI';
  return s?.pages?.find((p) => p.id === id)?.label || id;
}
export const appTitle = () => state.settings?.profile?.title || 'HQ';

function drawNav() {
  const s = state.settings;
  const items = (s?.nav || []).filter((n) => n.on).map((n) => `<li><a href="#/${n.id === 'home' ? '' : n.id}" data-nav="${n.id}">${icon(PAGE_ICON[n.id] || 'sparkles')}<span>${esc(pageLabel(n.id))}</span></a></li>`);
  const links = (s?.links || []).map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener" class="nav-link">${icon('external')}<span>${esc(l.name)}</span></a></li>`);
  document.getElementById('nav').innerHTML = items.join('') + (links.length ? `<li class="nav-sep" role="separator"></li>${links.join('')}` : '');
  markNav();
}

function drawBrand() {
  const s = state.settings;
  document.getElementById('brand-mark').innerHTML = logoHtml(s.theme, s.profile.name, { size: 40 });
  document.getElementById('brand-title').textContent = appTitle();
  document.getElementById('brand-name').textContent = s.profile.name || '';
  document.querySelector('meta[name="description"]').setAttribute('content', `${s.profile.name ? `${s.profile.name}'s` : 'Your'} ${appTitle()}: focus room, music, AI, projects and notes.`);
}

const pushIcon = debounce(async () => {
  // The desktop shortcut uses this icon, so it follows the owner's logo and colors.
  try {
    const s = state.settings;
    const pngs = [];
    for (const size of [256, 64, 48, 32, 16]) pngs.push({ size, data: await renderIcon(s.theme, s.profile.name, size) });
    await api('/api/brand/icon', { method: 'POST', body: { pngs } });
  } catch {}
}, 1500);

async function drawFavicon() {
  try { document.getElementById('favicon').href = await renderIcon(state.settings.theme, state.settings.profile.name, 64); } catch {}
}

/** Re-apply everything that depends on the settings (theme, logo, names, sidebar). */
export function applySettings(s, { icon: updateIcon = true } = {}) {
  if (s) state.settings = s;
  applyTheme(state.settings.theme);
  drawBrand();
  drawNav();
  drawFavicon();
  embers.sync();
  if (updateIcon && state.settings.setupDone) pushIcon();
  state.events.dispatchEvent(new Event('settings'));
}

export async function saveSettings(patch) {
  const s = await api('/api/settings', { method: 'POST', body: patch });
  applySettings(s);
  return s;
}

export async function loadProviders(force = false) {
  if (force || !state.providers) state.providers = await api('/api/ai/providers').catch(() => ({}));
  return state.providers;
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state.settings?.theme.mode === 'system') applySettings(null, { icon: false }); });

// ---------- routing ----------
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, qs] = hash.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(qs || '');
  if (!parts.length) return { view: 'home', params: {}, query };
  if (parts[0] === 'projects' && parts[1]) return { view: 'project', params: { id: parts[1], tab: parts[2] || 'overview' }, query, nav: 'projects' };
  if (parts[0] === 'notes') return { view: 'notes', params: { id: parts.slice(1).join('/') || null }, query };
  if (parts[0] === 'ai') return { view: 'ai', params: { id: parts[1] || null }, query };
  if (parts[0] === 'settings') return { view: 'settings', params: { section: parts[1] || null }, query };
  return { view: VIEWS[parts[0]] ? parts[0] : 'home', params: {}, query };
}

function markNav() {
  const route = parseRoute();
  document.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === (route.nav || route.view)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}

export function setTitle(t) {
  titleEl.textContent = t;
  document.title = t === appTitle() ? appTitle() : `${t} · ${appTitle()}`;
}

async function render() {
  let route = parseRoute();
  if (!state.settings?.setupDone && route.view !== 'welcome') { location.replace('#/welcome'); return; }
  const token = ++navToken;
  document.body.classList.toggle('onboarding', route.view === 'welcome');
  document.body.classList.remove('nav-open');
  markNav();
  stage.setVisible(route.view === 'focus');
  embers.setActive(route.view !== 'focus');
  try {
    const mod = await VIEWS[route.view]();
    if (token !== navToken) return;
    // Views can keep themselves alive across param changes (notes, chats).
    if (cleanup?.view === route.view && cleanup.update) { cleanup.update(route.params, route.query); return; }
    if (typeof cleanup?.fn === 'function') cleanup.fn();
    cleanup = null;
    document.body.classList.remove('zen');
    main.innerHTML = '';
    main.scrollTop = 0;
    const view = document.createElement('div');
    view.className = 'view';
    main.append(view);
    const result = await mod.default.render(view, route.params, route.query);
    if (token !== navToken) { if (typeof result === 'function') result(); else result?.cleanup?.(); return; }
    cleanup = typeof result === 'function' ? { view: route.view, fn: result } : { view: route.view, fn: result?.cleanup, update: result?.update };
    hydrateIcons(main);
    if (!view.classList.contains('full')) view.classList.add('view-enter');
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="empty">${icon('alert')}<div><b>This page didn't load.</b><br><span class="dim">${esc(e.message)}</span></div></div>`;
  }
}
window.addEventListener('hashchange', render);

// small screens: the sidebar slides in
document.getElementById('menu-btn').addEventListener('click', () => {
  const on = !document.body.classList.contains('nav-open');
  document.body.classList.toggle('nav-open', on);
  document.getElementById('menu-btn').setAttribute('aria-expanded', String(on));
});
document.querySelector('.sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });

// ---------- live events ----------
function connectEvents() {
  const es = new EventSource('/api/events');
  const relay = (name) => es.addEventListener(name, (e) => state.events.dispatchEvent(new CustomEvent(name, { detail: JSON.parse(e.data) })));
  es.addEventListener('timer', (e) => { state.timer = JSON.parse(e.data); state.timer.clientAt = Date.now(); state.events.dispatchEvent(new CustomEvent('timer', { detail: state.timer })); updateMiniTimer(); });
  es.addEventListener('timer:done', (e) => { chime(); state.events.dispatchEvent(new CustomEvent('timer:done', { detail: JSON.parse(e.data) })); });
  ['session', 'media:job', 'term', 'term:exit', 'tools:job'].forEach(relay);
  es.addEventListener('media:library', () => { player.refresh(); stage.refresh(); state.events.dispatchEvent(new Event('media:library')); });
}

export function timerRemaining() {
  const t = state.timer;
  if (!t) return 0;
  if (!t.running || !t.endsAt) return t.remaining;
  const skew = t.serverNow - t.clientAt;
  return Math.max(0, Math.round((t.endsAt - (Date.now() + skew)) / 1000));
}

const mini = document.getElementById('mini-timer');
function updateMiniTimer() {
  const t = state.timer;
  const show = t && t.mode !== 'idle' && !location.hash.startsWith('#/focus');
  mini.hidden = !show;
  if (!show) return;
  mini.querySelector('.t').textContent = mmss(timerRemaining());
  mini.classList.toggle('break', t.mode !== 'focus');
  mini.classList.toggle('paused', !t.running);
  mini.title = `${t.mode === 'focus' ? 'Focus' : 'Break'}${t.label ? ` — ${t.label}` : ''}${t.running ? '' : ' (paused)'}`;
}
setInterval(updateMiniTimer, 1000);
window.addEventListener('hashchange', updateMiniTimer);

export function chime() {
  if (state.settings?.focus?.chime === false) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [523.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.22, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 1.6);
      o.connect(g).connect(ctx.destination); o.start(now + i * 0.18); o.stop(now + i * 0.18 + 1.7);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch {}
}

// ---------- ember particles (cheap: one pre-rendered sprite, 30 fps, off in the Focus Room) ----------
const embers = (() => {
  const canvas = document.getElementById('embers');
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 32;
  const sg = sprite.getContext('2d');
  function paintSprite() {
    sg.clearRect(0, 0, 32, 32);
    const grad = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
    const light = cssVar('--gold-bright') || '#FFD27A', mid = cssVar('--ember') || '#FF7A1A', deep = cssVar('--flame') || '#E8261C';
    grad.addColorStop(0, light); grad.addColorStop(0.35, mid + '8C'); grad.addColorStop(1, deep + '00');
    sg.fillStyle = grad; sg.fillRect(0, 0, 32, 32);
  }
  let w, h, parts = [], raf = 0, last = 0, active = true;
  const enabled = () => state.settings?.theme?.effects !== false && !reduce && document.documentElement.dataset.mode !== 'light';
  const spawn = (y) => ({ x: Math.random() * w, y: y ?? h + 20, s: 6 + Math.random() * 12, vy: 0.3 + Math.random() * 0.7, sway: Math.random() * 6.28, a: 0.3 + Math.random() * 0.5 });
  function resize() {
    w = canvas.width = innerWidth; h = canvas.height = innerHeight;
    parts = Array.from({ length: Math.min(26, Math.round((w * h) / 60000)) }, () => spawn(Math.random() * h));
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 33) return;
    last = t;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.y -= p.vy; p.sway += 0.03; p.x += Math.sin(p.sway) * 0.4;
      if (p.y < -20) Object.assign(p, spawn());
      ctx.globalAlpha = p.a * Math.min(1, p.y / h + 0.2);
      ctx.drawImage(sprite, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
  }
  function sync() {
    cancelAnimationFrame(raf); raf = 0;
    paintSprite();
    const on = active && enabled() && !document.hidden;
    canvas.style.display = on ? '' : 'none';
    if (on) raf = requestAnimationFrame(frame);
  }
  resize();
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', sync);
  return { setActive(v) { active = v; sync(); }, sync };
})();
export const refreshEffects = () => embers.sync();

// ---------- command palette ----------
const palette = document.getElementById('palette');
const pInput = document.getElementById('palette-input');
const pList = document.getElementById('palette-list');
let pItems = [], pSel = 0, pSource = null;

async function paletteSource() {
  const s = state.settings;
  const on = new Set(s.nav.filter((n) => n.on).map((n) => n.id));
  const [cat, vault] = await Promise.all([
    on.has('projects') ? catalog().catch(() => ({ projects: [] })) : { projects: [] },
    on.has('notes') ? api('/api/vault').catch(() => ({ notes: [] })) : { notes: [] },
  ]);
  const ai = pageLabel('ai');
  return [
    { k: 'Action', t: 'Start a 50-minute deep work block', i: 'flame', go: async () => { await api('/api/timer', { method: 'POST', body: { action: 'start', preset: 'deep' } }); location.hash = '#/focus'; } },
    { k: 'Action', t: 'Start a 25-minute pomodoro', i: 'flame', go: async () => { await api('/api/timer', { method: 'POST', body: { action: 'start', preset: 'pomodoro' } }); location.hash = '#/focus'; } },
    { k: 'Action', t: 'Play my music', i: 'music', go: () => player.playAll() },
    { k: 'Action', t: `New chat with ${ai}`, i: 'sparkles', go: () => { location.hash = '#/ai?new=1'; } },
    { k: 'Action', t: 'Write a note', i: 'book', go: () => { location.hash = '#/notes?new=1'; } },
    { k: 'Action', t: 'Change theme and colors', i: 'sliders', go: () => { location.hash = '#/settings/look'; } },
    ...s.nav.filter((n) => n.on).map((n) => ({ k: 'Page', t: pageLabel(n.id), i: PAGE_ICON[n.id], go: () => { location.hash = `#/${n.id === 'home' ? '' : n.id}`; } })),
    ...s.links.map((l) => ({ k: 'Link', t: l.name, s: l.url, i: 'external', go: () => window.open(l.url, '_blank', 'noopener') })),
    ...player.library().map((x) => ({ k: 'Song', t: x.title, s: x.channel, i: 'music', go: () => player.playTrack(x.id) })),
    ...cat.projects.map((p) => ({ k: 'Project', t: p.name, s: p.tagline, i: 'folder', go: () => { location.hash = `#/projects/${p.id}`; } })),
    ...vault.notes.map((n) => ({ k: 'Note', t: n.title, s: n.description, i: 'book', go: () => { location.hash = `#/notes/${encodeURIComponent(n.id)}`; } })),
  ];
}

function score(item, q) {
  const t = item.t.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 60 - t.indexOf(q) * 0.1;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  if (i === q.length) return 20;
  return (item.s || '').toLowerCase().includes(q) ? 8 : 0;
}

function drawPalette() {
  const q = pInput.value.trim().toLowerCase();
  pItems = (pSource || []).map((x) => ({ x, s: score(x, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.x);
  pSel = Math.min(pSel, Math.max(0, pItems.length - 1));
  pList.innerHTML = pItems.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === pSel}">${icon(it.i)}<span><span>${esc(it.t)}</span>${it.s ? `<span class="sub">${esc(it.s.slice(0, 90))}</span>` : ''}</span><span class="k">${it.k}</span></li>`).join('') || '<li class="dim">Nothing found</li>';
  pList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

export async function openPalette() {
  if (!state.settings?.setupDone) return;
  palette.hidden = false;
  pInput.value = ''; pSel = 0;
  pInput.focus();
  pSource = await paletteSource();
  drawPalette();
}
const closePalette = () => { palette.hidden = true; };
async function choose(i) { const it = pItems[i]; if (!it) return; closePalette(); try { await it.go(); } catch (e) { toast(e.message, 'err'); } }

pInput.addEventListener('input', () => { pSel = 0; drawPalette(); });
pInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { pSel = Math.min(pItems.length - 1, pSel + 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { pSel = Math.max(0, pSel - 1); drawPalette(); e.preventDefault(); }
  else if (e.key === 'Enter') choose(pSel);
  else if (e.key === 'Escape') closePalette();
});
pList.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) choose(Number(li.dataset.i)); });
palette.addEventListener('mousedown', (e) => { if (e.target === palette) closePalette(); });
document.getElementById('open-palette').addEventListener('click', openPalette);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.target.closest('.xterm')) { e.preventDefault(); palette.hidden ? openPalette() : closePalette(); }
});

// ---------- boot ----------
hydrateIcons();
connectEvents();
try {
  const [s] = await Promise.all([api('/api/settings'), loadProviders()]);
  applySettings(s, { icon: false });
} catch (e) {
  main.innerHTML = `<div class="empty">${icon('alert')}<div><b>HQ could not start.</b><br><span class="dim">${esc(e.message)}</span></div></div>`;
}
Promise.all([player.refresh(), stage.refresh()]).finally(render);
