// Real terminals for the AI page: the official command-line apps (Claude Code, OpenAI Codex,
// Gemini CLI) inside a pseudo-terminal (ConPTY). Because HQ launches the installed programs, the
// owner signs in with their own account inside them, and every update shows up here automatically.
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { HOME, IS_WIN, exists, run, which } from './util.mjs';
import { PROVIDERS } from './config.mjs';

const require = createRequire(import.meta.url);
let pty = null;
try { pty = require('node-pty'); } catch (e) { console.error('[terminal] node-pty unavailable:', e.message); }

const MAX_BUFFER = 400 * 1024;
const sessions = new Map();
// All terminal output goes out on the app's one event stream (browsers allow only 6 connections per site).
export const termBus = new EventEmitter();
termBus.setMaxListeners(50);

const CLI_OF = Object.fromEntries(Object.entries(PROVIDERS).filter(([, p]) => p.cli).map(([id, p]) => [id, p]));

/** Installed state + version of each AI terminal app. */
export async function cliStatus() {
  const out = {};
  await Promise.all(Object.entries(CLI_OF).map(async ([id, p]) => {
    const bin = await which(p.cli);
    let version = null;
    if (bin) {
      const r = /\.cmd$/i.test(bin) ? await run(process.env.ComSpec || 'cmd.exe', ['/c', bin, '--version'], { timeout: 20000 }) : await run(bin, ['--version'], { timeout: 20000 });
      if (r.ok) version = (r.stdout.trim().split(/\s/)[0] || '').replace(/^v/, '') || null;
    }
    out[id] = { id, name: p.name, cli: p.cli, pkg: p.cliPkg, installed: !!bin, path: bin, version };
  }));
  return { pty: !!pty, npm: !!(await which('npm')), clis: out };
}

function cleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1' };
  // When HQ itself was started from inside a Claude Code session, don't let the child think it's nested.
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  return env;
}

export function listSessions() {
  return [...sessions.values()].map(({ id, title, cwd, kind, provider, created, exited, exitCode }) => ({ id, title, cwd, kind, provider, created, exited, exitCode }));
}

/** kind: 'ai' (run a provider's CLI), 'install' / 'update' (npm for that CLI), or 'shell'. */
export async function createSession({ cwd, kind = 'ai', provider = 'claude', cols = 120, rows = 32 } = {}) {
  if (!pty) throw Object.assign(new Error('Terminal support (node-pty) is missing from this install. Reinstall HQ.'), { status: 500 });
  const dir = cwd && exists(cwd) ? cwd : HOME;
  const p = CLI_OF[provider];
  let file, argv, title;
  if (kind === 'shell') {
    file = IS_WIN ? 'powershell.exe' : (process.env.SHELL || 'bash'); argv = IS_WIN ? ['-NoLogo'] : []; title = IS_WIN ? 'PowerShell' : 'Shell';
  } else {
    if (!p) throw Object.assign(new Error('That AI has no terminal app'), { status: 400 });
    if (kind === 'install' || kind === 'update') {
      const npm = await which('npm');
      if (!npm) throw Object.assign(new Error('npm was not found. Run the HQ installer again to get Node.js.'), { status: 400 });
      // Claude Code updates itself; the others update through npm.
      const bin = await which(p.cli);
      if (kind === 'update' && provider === 'claude' && bin) { file = bin; argv = ['update']; }
      else { file = IS_WIN ? (process.env.ComSpec || 'cmd.exe') : npm; argv = IS_WIN ? ['/c', npm, 'install', '-g', `${p.cliPkg}@latest`] : ['install', '-g', `${p.cliPkg}@latest`]; }
      title = `${kind === 'install' ? 'Install' : 'Update'} ${p.name}`;
    } else {
      const bin = await which(p.cli);
      if (!bin) throw Object.assign(new Error(`${p.name}'s terminal app is not installed yet`), { status: 400 });
      if (/\.cmd$/i.test(bin)) { file = process.env.ComSpec || 'cmd.exe'; argv = ['/c', bin]; } else { file = bin; argv = []; }
      title = `${p.name} · ${path.basename(dir)}`;
    }
  }
  const proc = pty.spawn(file, argv, { name: 'xterm-256color', cols: Math.max(20, cols | 0), rows: Math.max(5, rows | 0), cwd: dir, env: cleanEnv(), useConpty: true });
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const s = { id, title, cwd: dir, kind, provider, created: new Date().toISOString(), exited: false, exitCode: null, buffer: '', seq: 0, pending: '', flushTimer: null, pty: proc };
  proc.onData((d) => {
    s.buffer += d;
    if (s.buffer.length > MAX_BUFFER) s.buffer = s.buffer.slice(-MAX_BUFFER);
    // batch output for ~8 ms so a busy TUI doesn't flood the browser with tiny messages
    s.pending += d;
    if (!s.flushTimer) s.flushTimer = setTimeout(() => { const chunk = s.pending; s.pending = ''; s.flushTimer = null; s.seq++; termBus.emit('data', { id, seq: s.seq, data: chunk }); }, 8);
  });
  proc.onExit(({ exitCode }) => {
    s.exited = true; s.exitCode = exitCode;
    setTimeout(() => termBus.emit('exit', { id, exitCode, kind, provider }), 20);
  });
  sessions.set(id, s);
  return { id, title: s.title, cwd: s.cwd, kind, provider };
}

/** Everything printed so far, plus the sequence number of the last chunk (to stitch in live events). */
export function sessionSnapshot(id) {
  const s = sessions.get(id);
  return s ? { id, title: s.title, buffer: s.buffer, seq: s.seq, exited: s.exited, exitCode: s.exitCode } : null;
}

export function writeSession(id, data) {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  s.pty.write(String(data));
  return true;
}

export function resizeSession(id, cols, rows) {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  try { s.pty.resize(Math.max(20, cols | 0), Math.max(5, rows | 0)); } catch {}
  return true;
}

export function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  if (!s.exited) { try { s.pty.kill(); } catch {} }
  termBus.emit('exit', { id, exitCode: s.exitCode ?? 0, closed: true });
  sessions.delete(id);
  return true;
}

export function closeAll() { for (const id of [...sessions.keys()]) closeSession(id); }
