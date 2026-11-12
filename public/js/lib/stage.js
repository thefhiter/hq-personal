// Focus Room background: HD clips stored on this PC, crossfading into each other forever.
// It sits outside the pages, so switching views never restarts it; it only pauses while hidden
// (no point decoding video you can't see) or when you press pause.
import { api } from './ui.js';

const stageEl = document.getElementById('stage');
const layers = [document.getElementById('bg-a'), document.getElementById('bg-b')];
const store = {
  get(k, d) { try { const v = localStorage.getItem(`hq.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`hq.${k}`, JSON.stringify(v)); } catch {} },
};
const FADE = 1.4; // seconds of crossfade

export const stage = new EventTarget();
let videos = [];
let scene = store.get('scene', '');
let playlist = [];
let idx = 0;
let front = 0;
let visible = false;
let userPaused = store.get('bgPaused', false);
let switching = false;
let pending = null; // a pick made mid-crossfade runs right after it instead of being dropped

export const SCENE_NAMES = { mine: 'My clips', motivation: 'Motivation', sport: 'Gym & sport', nature: 'Nature', rain: 'Rain & cozy', city: 'City at night', space: 'Space', study: 'Study & work', cinematic: 'Cinematic' };
export const sceneName = (s) => SCENE_NAMES[s] || s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function scenes() {
  const counts = {};
  for (const v of videos) counts[v.scene] = (counts[v.scene] || 0) + 1;
  return Object.entries(counts).map(([id, n]) => ({ id, name: sceneName(id), count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
export const currentScene = () => scene;
export const currentClip = () => playlist[idx] || null;
export const isPaused = () => userPaused;
export const hasClips = () => videos.length > 0;
export const clips = () => videos;

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function buildPlaylist() {
  let pool = videos.filter((v) => v.scene === scene);
  if (!pool.length) { pool = videos; }
  const keep = store.get('clip', null);
  playlist = shuffled(pool);
  const at = playlist.findIndex((v) => v.id === keep?.id);
  idx = at >= 0 ? at : 0;
}

const src = (v) => `/media/videos/${v.file}`;

function prepare(el, clip, startAt = 0) {
  if (!el.src.endsWith(src(clip))) {
    el.src = src(clip);
    el.poster = clip.poster ? `/media/thumbs/${clip.poster}` : '';
  }
  el.loop = playlist.length === 1;
  try { el.currentTime = startAt; } catch {}
}

function show(i) {
  layers.forEach((el, k) => el.classList.toggle('on', k === i));
}

function playFront() {
  const el = layers[front];
  if (!visible || userPaused) return;
  el.play().catch(() => {});
}

/** Crossfade to the next clip in the playlist (or a specific index). */
export function nextClip(toIndex) {
  if (!playlist.length) return;
  if (switching) { pending = toIndex ?? 'next'; return; }
  switching = true;
  idx = toIndex ?? (idx + 1) % playlist.length;
  const clip = playlist[idx];
  const back = 1 - front;
  const el = layers[back];
  prepare(el, clip, 0);
  const go = () => {
    el.removeEventListener('canplay', go);
    if (visible && !userPaused) el.play().catch(() => {});
    show(back);
    const old = layers[front];
    front = back;
    // release the old layer's file so it doesn't hold one of the browser's few connections
    setTimeout(() => {
      old.pause(); old.removeAttribute('src'); old.load();
      switching = false;
      if (pending !== null) { const p = pending; pending = null; nextClip(p === 'next' ? undefined : p); }
    }, FADE * 1000 + 100);
    store.set('clip', { id: clip.id, t: 0 });
    stage.dispatchEvent(new Event('change'));
  };
  if (el.readyState >= 3) go(); else el.addEventListener('canplay', go);
  setTimeout(() => { if (switching && el.readyState < 3) { el.removeEventListener('canplay', go); go(); } }, 4000);
}

export function setScene(id) {
  scene = id;
  store.set('scene', id);
  store.set('clip', null);
  buildPlaylist();
  nextClip(idx);
}

/** Crossfade to one specific clip, switching to its group if needed. */
export function playClip(id) {
  const clip = videos.find((v) => v.id === id);
  if (!clip || (currentClip()?.id === id && pending === null)) return;
  if (clip.scene !== scene) {
    scene = clip.scene;
    store.set('scene', scene);
    playlist = shuffled(videos.filter((v) => v.scene === scene));
  }
  nextClip(playlist.findIndex((v) => v.id === id));
}

export function togglePause() {
  userPaused = !userPaused;
  store.set('bgPaused', userPaused);
  const el = layers[front];
  if (userPaused) el.pause(); else playFront();
  stage.dispatchEvent(new Event('change'));
}

/** Called by the router: the stage shows (and plays) only in the Focus Room. */
export function setVisible(on) {
  visible = on;
  document.body.classList.toggle('stage-on', on);
  document.body.classList.toggle('stage-empty', videos.length === 0);
  const el = layers[front];
  if (!on) { el.pause(); if (currentClip()) store.set('clip', { id: currentClip().id, t: el.currentTime }); return; }
  if (!el.src && playlist.length) {
    const saved = store.get('clip', null);
    prepare(el, playlist[idx], saved?.id === playlist[idx].id ? saved.t || 0 : 0);
    show(front);
  }
  playFront();
}

// Crossfade a little before the end so there's never a black frame or a stop.
layers.forEach((el, k) => {
  el.addEventListener('timeupdate', () => {
    if (k !== front || el.loop || !el.duration || switching) return;
    if (el.duration - el.currentTime < FADE + 0.3) nextClip();
  });
  el.addEventListener('ended', () => { if (k === front && !switching) nextClip(); });
  el.addEventListener('error', () => { if (k === front && playlist.length > 1) setTimeout(() => nextClip(), 300); });
});

export async function refresh() {
  try {
    const lib = await api('/api/library');
    const before = videos.map((v) => v.id).join();
    videos = lib.videos;
    if (videos.map((v) => v.id).join() !== before) {
      const cur = currentClip()?.id;
      buildPlaylist();
      if (cur) { const i = playlist.findIndex((v) => v.id === cur); if (i >= 0) idx = i; }
      if (visible) setVisible(true);
    }
    document.body.classList.toggle('stage-on', visible);
    document.body.classList.toggle('stage-empty', videos.length === 0);
    stage.dispatchEvent(new Event('change'));
  } catch {}
}

export function posterOf(sceneId = scene) {
  const v = videos.find((x) => x.scene === sceneId && x.poster) || videos.find((x) => x.poster);
  return v ? `/media/thumbs/${v.poster}` : null;
}

stageEl.addEventListener('dblclick', () => nextClip());
