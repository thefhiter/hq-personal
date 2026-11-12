import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA, readJson, writeJson } from './util.mjs';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const SESSIONS_FILE = path.join(DATA, 'focus', 'sessions.json');
const STATE_FILE = path.join(DATA, 'timer-state.json');

export const PRESETS = {
  deep: { mode: 'focus', minutes: 50, name: 'Deep Work' },
  pomodoro: { mode: 'focus', minutes: 25, name: 'Pomodoro' },
  monk: { mode: 'focus', minutes: 90, name: 'Monk Mode' },
  short: { mode: 'short', minutes: 5, name: 'Short Break' },
  long: { mode: 'long', minutes: 15, name: 'Long Break' },
};

let state = { mode: 'idle', preset: 'deep', label: '', projectId: null, total: PRESETS.deep.minutes * 60, remaining: PRESETS.deep.minutes * 60, running: false, endsAt: null, startedAt: null, cycle: 0, next: 'deep' };
let sessions = [];

export async function initTimer() {
  sessions = (await readJson(SESSIONS_FILE, { sessions: [] })).sessions || [];
  const saved = await readJson(STATE_FILE, null);
  if (saved) {
    state = { ...state, ...saved };
    // A focus block that ended while the server was down still counts.
    if (state.running && state.endsAt && Date.now() >= state.endsAt) await complete();
  }
  setInterval(tick, 1000).unref();
}

const persistState = () => writeJson(STATE_FILE, state);
const persistSessions = () => writeJson(SESSIONS_FILE, { note: 'Focus sessions logged by HQ', sessions });

export function timerState() {
  const remaining = state.running && state.endsAt ? Math.max(0, Math.round((state.endsAt - Date.now()) / 1000)) : state.remaining;
  return {
    mode: state.mode, preset: state.preset, label: state.label, projectId: state.projectId,
    total: state.total, remaining, running: state.running, endsAt: state.endsAt,
    cycle: state.cycle, next: state.next, serverNow: Date.now(),
  };
}

function emit() { bus.emit('timer', timerState()); persistState(); }

async function tick() {
  if (state.running && state.endsAt && Date.now() >= state.endsAt) await complete();
}

function logSession({ completed }) {
  if (state.mode !== 'focus' || !state.startedAt) return null;
  const elapsedSec = completed ? state.total : state.total - timerState().remaining;
  const minutes = Math.round(elapsedSec / 60);
  if (!completed && minutes < 5) return null; // ignore false starts
  const s = {
    id: `s${Date.now().toString(36)}`, start: new Date(state.startedAt).toISOString(), end: new Date().toISOString(),
    minutes, planned: Math.round(state.total / 60), preset: state.preset, label: state.label || '', projectId: state.projectId || null, completed,
  };
  sessions.push(s);
  persistSessions();
  bus.emit('session', s);
  return s;
}

async function complete({ skipped = false } = {}) {
  const finished = state.mode;
  // A skipped block only counts the minutes actually worked (and nothing under 5 min).
  const session = logSession({ completed: !skipped });
  if (finished === 'focus') {
    state.cycle += 1;
    state.next = state.cycle % 4 === 0 ? 'long' : 'short';
  } else {
    state.next = 'deep';
  }
  state = { ...state, mode: 'idle', running: false, endsAt: null, startedAt: null, remaining: (PRESETS[state.next]?.minutes || 5) * 60, total: (PRESETS[state.next]?.minutes || 5) * 60, preset: state.next };
  bus.emit('timer:done', { finished, session, next: state.next });
  emit();
}

/** All timer commands come through here. */
export async function timerCommand(body = {}) {
  const action = body.action;
  if (action === 'start') {
    const preset = PRESETS[body.preset] ? body.preset : null;
    const mode = preset ? PRESETS[preset].mode : (['focus', 'short', 'long'].includes(body.mode) ? body.mode : 'focus');
    const minutes = Math.max(1, Math.min(240, Number(body.minutes) || PRESETS[preset || 'deep'].minutes));
    if (state.running && state.mode === 'focus') logSession({ completed: false });
    state = {
      ...state, mode, preset: preset || 'custom', total: minutes * 60, remaining: minutes * 60, running: true,
      startedAt: Date.now(), endsAt: Date.now() + minutes * 60 * 1000,
      label: typeof body.label === 'string' ? body.label.slice(0, 140) : state.label,
      projectId: body.projectId !== undefined ? body.projectId || null : state.projectId,
    };
  } else if (action === 'pause' && state.running) {
    state.remaining = timerState().remaining; state.running = false; state.endsAt = null;
  } else if (action === 'resume' && !state.running && state.mode !== 'idle') {
    state.running = true; state.endsAt = Date.now() + state.remaining * 1000;
  } else if (action === 'reset') {
    if (state.mode === 'focus') logSession({ completed: false });
    const p = PRESETS[state.preset] || PRESETS.deep;
    state = { ...state, mode: 'idle', running: false, endsAt: null, startedAt: null, total: p.minutes * 60, remaining: p.minutes * 60 };
  } else if (action === 'skip') {
    if (state.mode !== 'idle') { await complete({ skipped: true }); return timerState(); }
  } else if (action === 'extend' && state.mode !== 'idle') {
    const add = 5 * 60;
    state.total += add;
    if (state.running) state.endsAt += add * 1000; else state.remaining += add;
  } else if (action === 'label') {
    state.label = String(body.label || '').slice(0, 140);
    if (body.projectId !== undefined) state.projectId = body.projectId || null;
  } else if (action === 'select') {
    const p = PRESETS[body.preset];
    if (p && !state.running) state = { ...state, preset: body.preset, mode: 'idle', total: p.minutes * 60, remaining: p.minutes * 60 };
  }
  emit();
  return timerState();
}

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export function focusStats(goalMin = 240) {
  const byDay = {};
  const byProject = {};
  let total = 0;
  for (const s of sessions) {
    const k = dayKey(s.start);
    byDay[k] = (byDay[k] || 0) + s.minutes;
    total += s.minutes;
    if (s.projectId) byProject[s.projectId] = (byProject[s.projectId] || 0) + s.minutes;
  }
  const today = dayKey(Date.now());
  const weekAgo = Date.now() - 6 * 86400000;
  let week = 0;
  for (const [k, v] of Object.entries(byDay)) if (new Date(k + 'T12:00:00').getTime() >= weekAgo - 43200000) week += v;

  // Streak: consecutive days with any focus, counting back from today (or yesterday if today is still empty).
  let streak = 0;
  const cursor = new Date();
  if (!byDay[today]) cursor.setDate(cursor.getDate() - 1);
  while (byDay[dayKey(cursor)]) { streak++; cursor.setDate(cursor.getDate() - 1); }
  let longest = 0, run = 0, prev = null;
  for (const k of Object.keys(byDay).sort()) {
    const t = new Date(k + 'T12:00:00').getTime();
    run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  return {
    todayMin: byDay[today] || 0, weekMin: week, totalMin: total, sessions: sessions.length,
    completed: sessions.filter((s) => s.completed).length, streak, longest, goalMin, byDay, byProject,
    recent: sessions.slice(-12).reverse(),
  };
}
