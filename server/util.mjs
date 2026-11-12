import { execFile } from 'node:child_process';
import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = os.homedir();
export const IS_WIN = process.platform === 'win32';

// Everything personal (settings, keys, chats, music, backgrounds) lives OUTSIDE the app folder,
// so installing a new version never touches it. Override with HQ_DATA_DIR.
const defaultData = IS_WIN
  ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'HQ')
  : path.join(HOME, '.hq');
export const DATA = path.resolve(process.env.HQ_DATA_DIR || defaultData);
export const LOCAL = DATA;
export const CLAUDE_PROJECTS_DIR = path.resolve(process.env.HQ_CLAUDE_DIR || path.join(HOME, '.claude', 'projects'));
mkdirSync(DATA, { recursive: true });

// Helper programs HQ installs on request (yt-dlp, FFmpeg) and AI terminal apps installed with npm
// live in the data folder too, so they survive updates. The Node.js that runs HQ (bundled in the
// package) comes first on PATH so `npm` is always found.
export const RUNTIME = path.join(DATA, 'tools');
export const NPM_PREFIX = path.join(DATA, 'npm');
export const NODE_DIR = path.dirname(process.execPath);
export const RUNTIME_DIRS = [path.join(RUNTIME, 'bin'), path.join(RUNTIME, 'ffmpeg'), NPM_PREFIX, NODE_DIR];
{
  const sep = IS_WIN ? ';' : ':';
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const parts = String(process.env[key] || '').split(sep);
  process.env[key] = [...RUNTIME_DIRS.filter((d) => !parts.includes(d)), ...parts].join(sep);
  // `npm install -g` from inside HQ goes to the data folder instead of the app folder.
  if (!process.env.npm_config_prefix && !process.env.NPM_CONFIG_PREFIX) process.env.npm_config_prefix = NPM_PREFIX;
}

/** Expand "~/x" to an absolute path. */
export function expandHome(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (s === '~') return HOME;
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(HOME, s.slice(2));
  return path.resolve(s);
}

/** Show a path with the home folder shortened to "~". */
export function tildify(p) {
  if (!p) return p;
  return p.toLowerCase().startsWith(HOME.toLowerCase()) ? '~' + p.slice(HOME.length) : p;
}

/** Resolve `rel` inside `base`; returns null when it would escape `base`. */
export function safeJoin(base, rel = '') {
  const target = path.resolve(base, '.' + path.sep + String(rel).replace(/^[/\\]+/, ''));
  const b = path.resolve(base);
  if (target !== b && !target.startsWith(b + path.sep)) return null;
  return target;
}

export function run(cmd, args, { cwd, timeout = 20000, maxBuffer = 32 * 1024 * 1024, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer, windowsHide: true, env: env || process.env }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** Full path of a program on PATH (runtime folder first), or null. */
export async function which(name) {
  for (const dir of RUNTIME_DIRS) {
    for (const ext of IS_WIN ? ['.exe', '.cmd', ''] : ['']) {
      const f = path.join(dir, name + ext);
      if (existsSync(f)) return f;
    }
  }
  const r = await run(IS_WIN ? 'where' : 'which', [name], { timeout: 6000 });
  if (!r.ok) return null;
  const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // prefer real executables / .cmd shims over extension-less npm shell scripts
  return lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) || lines[0] || null;
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

const writeQueues = new Map();
/** Atomic-ish JSON write, serialized per file. */
export function writeJson(file, value) {
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
  }).catch((e) => console.error('[writeJson]', file, e.message));
  writeQueues.set(file, next);
  return next;
}

export function exists(p) { return !!p && existsSync(p); }

/** TTL cache with stale-while-revalidate: once a value exists, callers get it instantly
 *  and a refresh runs in the background when it is older than `ttlMs`. `clear()` drops it. */
export function cached(ttlMs, fn) {
  const store = new Map();
  const get = async (...args) => {
    const key = JSON.stringify(args);
    let e = store.get(key);
    if (!e) { e = { t: 0, v: undefined, has: false, p: null }; store.set(key, e); }
    const refresh = () => {
      if (!e.p) {
        e.p = Promise.resolve().then(() => fn(...args))
          .then((v) => { e.v = v; e.has = true; e.t = Date.now(); return v; })
          .finally(() => { e.p = null; });
      }
      return e.p;
    };
    if (e.has) {
      if (Date.now() - e.t > ttlMs) refresh().catch(() => {});
      return e.v;
    }
    return refresh();
  };
  get.clear = () => store.clear();
  return get;
}

export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 80) || 'item';
}

export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s).toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
