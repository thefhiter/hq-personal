// Starts HQ: runs the HQ server in the background (if it isn't running yet) and opens HQ in its own app
// window (Chrome or Edge), or in the default browser. The Start-menu / Desktop shortcuts and
// "Start HQ.cmd" run this with the Node.js that comes with HQ.
//
//   node launcher.mjs              start HQ (or just open its window when it is already running)
//   node launcher.mjs --stop       stop HQ (the setup program uses it before updating)
//   node launcher.mjs --no-window  start HQ without opening a window
//
// It never fails silently: when HQ can't start, the reason is written to a text file that opens in Notepad.
import { spawn, execFile } from 'node:child_process';
import { openSync, closeSync, mkdirSync, existsSync, readFileSync, writeFileSync, statSync, renameSync, readSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HQ_PORT || 9120);
const URL = `http://127.0.0.1:${PORT}`;
const DATA = path.resolve(process.env.HQ_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'HQ'));
const VERSION = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
const ERR_LOG = path.join(DATA, 'server.err.log');
const OUT_LOG = path.join(DATA, 'server.log');
const args = new Set(process.argv.slice(2));

process.title = 'HQ';
const say = (s = '') => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HQ's health answer, or null when nothing (or something else) answers on the port. */
async function health() {
  try {
    const r = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    const h = await r.json();
    return h && h.name === 'hq-personal' ? h : null;
  } catch { return null; }
}

/** Something that isn't HQ is listening on HQ's port. */
async function portTaken() {
  try { await fetch(`${URL}/`, { signal: AbortSignal.timeout(2000) }); return !(await health()); } catch { return false; }
}

/** Process id listening on HQ's port (netstat's columns are the same in every Windows language). */
function listenerPid() {
  if (process.platform !== 'win32') return Promise.resolve(0);
  const netstat = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'netstat.exe');
  return new Promise((resolve) => execFile(netstat, ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 10_000 }, (e, out) => {
    for (const line of String(out || '').split(/\r?\n/)) {
      const c = line.trim().split(/\s+/);
      if (c.length >= 5 && c[1] === `127.0.0.1:${PORT}` && c[2] === '0.0.0.0:0') return resolve(Number(c[c.length - 1]) || 0);
    }
    resolve(0);
  }));
}

async function stop() {
  try { await fetch(`${URL}/api/app/quit`, { method: 'POST', headers: { 'X-HQ': '1' }, signal: AbortSignal.timeout(3000) }); } catch {}
  for (let i = 0; i < 16; i++) { if (!(await health())) return true; await sleep(250); }
  // HQ 1.0.x has no quit route: close the process that answers as HQ on HQ's port
  if (await health()) {
    const pid = await listenerPid();
    if (pid && pid !== process.pid) { try { process.kill(pid); } catch {} }
  }
  for (let i = 0; i < 24; i++) { if (!(await health())) return true; await sleep(250); }
  return false;
}

function detached(cmd, argv) {
  const child = spawn(cmd, argv, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

/** Keep the logs small: start a new file once one passes 2 MB. */
function rotate(file) {
  try { if (statSync(file).size > 2 * 1024 * 1024) renameSync(file, `${file}.old`); } catch {}
}

function tail(file, from = 0, max = 4000) {
  try {
    const size = statSync(file).size;
    const start = Math.max(from, size - max);
    const buf = Buffer.alloc(size - start);
    const fd = openSync(file, 'r');
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    return buf.toString('utf8').trim();
  } catch { return ''; }
}

/** Explain the problem in plain words, in a file that opens in Notepad, then stop. */
async function giveUp(reason, details = '') {
  const file = path.join(DATA, 'HQ could not start.txt');
  const text = [
    'HQ could not start',
    '==================',
    '',
    reason,
    '',
    'What you can try:',
    '  1. Open HQ again (Start menu > HQ).',
    '  2. Restart the PC, then open HQ again.',
    '  3. If your antivirus asked about "node.exe" or "Node.js JavaScript Runtime", allow it:',
    '     it is the engine HQ runs on (official build, signed by the OpenJS Foundation).',
    '  4. Install HQ again with the latest HQ-Personal-Setup file.',
    '',
    'If it still does not start, send this file to the person who gave you HQ.',
    '',
    'Details',
    '-------',
    `HQ ${VERSION} | Node.js ${process.version} | Windows ${os.release()} | ${new Date().toISOString()}`,
    `App folder:  ${ROOT}`,
    `Data folder: ${DATA}`,
    '',
    details || '(no log output)',
    '',
  ].join('\r\n');
  say('');
  say(`  HQ could not start: ${reason}`);
  try {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(file, text);
    say(`  Details: ${file}`);
    if (process.platform === 'win32') detached(path.join(process.env.SystemRoot || 'C:\\Windows', 'notepad.exe'), [file]);
  } catch {}
  process.exitCode = 1;
}

function openWindow() {
  if (args.has('--no-window') || process.env.HQ_NO_WINDOW === '1') return;
  if (process.platform !== 'win32') return detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [URL]);
  const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', local = process.env.LOCALAPPDATA || '';
  const browser = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].find((f) => existsSync(f));
  // Maximized: a fixed size can be bigger than a laptop screen and open half off-screen. The /hq path gives
  // HQ its own app identity in Chrome/Edge (they key app windows by host + path, not port), so it keeps
  // its own window size and taskbar group instead of sharing them with other apps on 127.0.0.1.
  if (browser) detached(browser, [`--app=${URL}/hq`, '--start-maximized', '--no-first-run', '--no-default-browser-check']);
  else detached(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [URL]);
}

async function startServer() {
  const entry = path.join(ROOT, 'server', 'main.mjs');
  if (!existsSync(entry)) return giveUp('Some of HQ\'s files are missing.', `Not found: ${entry}\r\nInstall HQ again.`);
  mkdirSync(DATA, { recursive: true });
  rotate(ERR_LOG); rotate(OUT_LOG);
  const errFrom = existsSync(ERR_LOG) ? statSync(ERR_LOG).size : 0;
  const out = openSync(OUT_LOG, 'a');
  const err = openSync(ERR_LOG, 'a');
  let exited = null;
  const child = spawn(process.execPath, [entry], { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', out, err], env: { ...process.env, HQ_PORT: String(PORT) } });
  child.on('error', (e) => { exited = e.message; });
  child.on('exit', (code) => { exited = code ?? -1; });
  child.unref();
  closeSync(out); closeSync(err);

  const t0 = Date.now();
  let told = false;
  while (Date.now() - t0 < 120_000) {
    await sleep(300);
    if (await health()) return true;
    if (exited !== null) {
      if (exited === 3) {
        // the port is busy: either another HQ is starting right now, or another program uses it
        for (let i = 0; i < 40; i++) { if (await health()) return true; await sleep(250); }
        return giveUp(`Another program is using port ${PORT}, which HQ needs.`, 'Close the other program (or restart the PC), then open HQ again.');
      }
      return giveUp('HQ stopped while it was starting.', tail(ERR_LOG, errFrom));
    }
    if (!told && Date.now() - t0 > 4000) { told = true; say('  Still starting. The first start after installing can take up to a minute…'); }
  }
  return giveUp('HQ took more than 2 minutes to start.', tail(ERR_LOG, errFrom));
}

async function main() {
  say(`  HQ ${VERSION}`);
  if (args.has('--stop')) return say(await stop() ? '  HQ is stopped.' : '  HQ did not stop.');

  let h = await health();
  if (h && (h.version !== VERSION || h.error)) {
    say(h.error ? '  Restarting HQ…' : `  Updating the running HQ (${h.version}) to ${VERSION}…`);
    if (!(await stop())) return giveUp(`An older HQ (${h.version}) is still running and did not close.`, 'Restart the PC, then open HQ again.');
    h = null;
  }
  if (h) return openWindow();
  if (await portTaken()) return giveUp(`Another program is using port ${PORT}, which HQ needs.`, 'Close the other program (or restart the PC), then open HQ again.');
  say('  Starting HQ…');
  if (await startServer() === true) { say('  HQ is open.'); openWindow(); }
}

await main();
// let the browser / Notepad start before this window closes
setTimeout(() => process.exit(), 600);
