// The music player lives in the app shell, so songs keep playing while you move between pages.
// It plays the MP3 library from this PC: instant, gapless-ish and immune to YouTube embed limits.
import { icon } from './icons.js';
import { api, esc } from './ui.js';

const audio = document.getElementById('music');
const ui = {
  box: document.getElementById('player'), art: document.getElementById('pl-art'), title: document.getElementById('pl-title'),
  sub: document.getElementById('pl-sub'), bar: document.querySelector('#pl-bar i'), barBox: document.getElementById('pl-bar'),
  play: document.getElementById('pl-play'), prev: document.getElementById('pl-prev'), next: document.getElementById('pl-next'),
  shuffle: document.getElementById('pl-shuffle'), vol: document.getElementById('pl-vol'),
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(`hq.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`hq.${k}`, JSON.stringify(v)); } catch {} },
};

export const player = new EventTarget();
let tracks = [];
let order = [];
let pos = -1;
let shuffle = store.get('shuffle', true);
let fadeTimer = null;
const targetVolume = () => Number(ui.vol.value);

function buildOrder(startId) {
  order = tracks.map((t) => t.id);
  if (shuffle) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  }
  if (startId) { order = [startId, ...order.filter((x) => x !== startId)]; pos = 0; }
}

export function current() { return pos >= 0 ? tracks.find((t) => t.id === order[pos]) || null : null; }
export function isPlaying() { return !audio.paused && !audio.ended; }
export function library() { return tracks; }

function emit() { player.dispatchEvent(new Event('change')); render(); }

function fadeTo(vol, ms, done) {
  clearInterval(fadeTimer);
  const start = audio.volume;
  const t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    audio.volume = Math.max(0, Math.min(1, start + (vol - start) * k));
    if (k >= 1) { clearInterval(fadeTimer); done?.(); }
  }, 30);
}

function load(track, autoplay) {
  audio.src = `/media/music/${track.file}`;
  store.set('track', track.id);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.channel || '', artwork: [{ src: track.thumb, sizes: '320x180', type: 'image/jpeg' }] });
  }
  if (autoplay) {
    audio.volume = 0;
    audio.play().then(() => fadeTo(targetVolume(), 600)).catch(() => {});
  }
  emit();
}

export function playTrack(id) {
  if (!tracks.length) return;
  if (!order.includes(id)) buildOrder();
  const i = order.indexOf(id);
  if (i === -1) return;
  // keep the current shuffle order but jump to this song
  pos = i;
  load(current(), true);
}

export function playAll(startId) {
  if (!tracks.length) return;
  buildOrder(startId || null);
  if (!startId) pos = 0;
  load(current(), true);
}

export function toggle() {
  if (!current()) return playAll();
  if (audio.paused) { audio.volume = 0; audio.play().then(() => fadeTo(targetVolume(), 400)).catch(() => {}); }
  else fadeTo(0, 250, () => { audio.pause(); audio.volume = targetVolume(); });
}

export function next(step = 1) {
  if (!order.length) return playAll();
  pos = (pos + step + order.length) % order.length;
  const wasPlaying = isPlaying();
  if (wasPlaying) fadeTo(0, 300, () => load(current(), true)); else load(current(), true);
}

export function setShuffle(on) {
  shuffle = !!on;
  store.set('shuffle', shuffle);
  const id = current()?.id;
  buildOrder(id);
  emit();
}

function render() {
  const t = current();
  ui.box.hidden = !tracks.length;
  if (!t) { ui.title.textContent = 'Your music'; ui.sub.textContent = `${tracks.length} songs · press play`; ui.art.removeAttribute('src'); }
  else { ui.title.textContent = t.title; ui.sub.textContent = t.channel || ''; ui.art.src = t.thumb; }
  ui.play.innerHTML = icon(isPlaying() ? 'pause' : 'play');
  ui.play.setAttribute('aria-label', isPlaying() ? 'Pause music' : 'Play music');
  ui.shuffle.setAttribute('aria-pressed', String(shuffle));
}

export async function refresh() {
  try {
    const lib = await api('/api/library');
    const known = new Set(tracks.map((t) => t.id));
    tracks = lib.tracks;
    const cur = current()?.id || store.get('track', null);
    if (!order.length || tracks.some((t) => !known.has(t.id))) { buildOrder(); if (cur && order.includes(cur)) pos = order.indexOf(cur); }
    if (pos === -1 && cur && order.includes(cur)) pos = order.indexOf(cur);
    if (pos >= 0 && !audio.src && current()) audio.src = `/media/music/${current().file}`;
    emit();
  } catch {}
}

audio.addEventListener('ended', () => next(1));
audio.addEventListener('play', emit);
audio.addEventListener('pause', emit);
audio.addEventListener('error', () => { if (current()) setTimeout(() => next(1), 400); });
audio.addEventListener('timeupdate', () => {
  if (audio.duration) ui.bar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  // soft fade into the next song
  if (audio.duration && audio.duration - audio.currentTime < 1.2 && !audio.dataset.fading) {
    audio.dataset.fading = '1';
    fadeTo(0.05, 1000);
  }
});
audio.addEventListener('loadstart', () => { delete audio.dataset.fading; });

ui.play.addEventListener('click', toggle);
ui.prev.addEventListener('click', () => (audio.currentTime > 4 ? (audio.currentTime = 0) : next(-1)));
ui.next.addEventListener('click', () => next(1));
ui.shuffle.addEventListener('click', () => setShuffle(!shuffle));
ui.barBox.addEventListener('click', (e) => { if (!audio.duration) return; const r = ui.barBox.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; });
ui.vol.value = String(store.get('volume', 0.7));
audio.volume = targetVolume();
ui.vol.addEventListener('input', () => { clearInterval(fadeTimer); audio.volume = targetVolume(); store.set('volume', targetVolume()); });

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', toggle);
  navigator.mediaSession.setActionHandler('pause', toggle);
  navigator.mediaSession.setActionHandler('nexttrack', () => next(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => next(-1));
}

export function mountMini(el) {
  // small "now playing" used inside the Focus Room when the sidebar is hidden
  const draw = () => {
    const t = current();
    el.innerHTML = t || tracks.length ? `<button type="button" class="round-btn" data-a="toggle" aria-label="${isPlaying() ? 'Pause music' : 'Play music'}">${icon(isPlaying() ? 'pause' : 'play')}</button>
      <div class="np-meta"><b>${esc(t ? t.title : 'Your music')}</b><span>${esc(t ? t.channel || '' : `${tracks.length} songs`)}</span></div>
      <button type="button" class="round-btn" data-a="next" aria-label="Next song">${icon('skip')}</button>` : `<a class="np-empty" href="#/music">${icon('music', 'ico-sm')} Add music</a>`;
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'toggle') toggle(); else next(1); });
  player.addEventListener('change', draw);
  draw();
  return () => player.removeEventListener('change', draw);
}

render();
