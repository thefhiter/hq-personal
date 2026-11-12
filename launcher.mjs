// Starts HQ: runs the server in the background (if it isn't running yet) and opens HQ in its own
// app window (Chrome or Edge), or in the default browser. Used by "Start HQ.cmd" and the shortcuts.
import { spawn } from 'node:child_process';
import { openSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HQ_PORT || 9120);
const URL = `http://127.0.0.1:${PORT}`;
const DATA = path.resolve(process.env.HQ_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'HQ'));

async function running() {
  try { const r = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(1500) }); return (await r.json()).name === 'hq-personal'; } catch { return false; }
}

function detached(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
  child.on('error', () => {});
  child.unref();
}

if (!(await running())) {
  mkdirSync(DATA, { recursive: true });
  const out = openSync(path.join(DATA, 'server.log'), 'a');
  const err = openSync(path.join(DATA, 'server.err.log'), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', out, err], env: { ...process.env, HQ_PORT: String(PORT) } });
  child.unref();
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await running(); }
  if (!up) {
    console.error(`HQ did not start. Details: ${path.join(DATA, 'server.err.log')}`);
    await new Promise((r) => setTimeout(r, 8000));
    process.exit(1);
  }
}

if (process.env.HQ_NO_WINDOW !== '1') {
  const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', local = process.env.LOCALAPPDATA || '';
  const browser = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].find((f) => existsSync(f));
  if (browser) detached(browser, [`--app=${URL}`, '--window-size=1500,940']);
  else detached('explorer.exe', [URL]);
}
process.exit(0);
