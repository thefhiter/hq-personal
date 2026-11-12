// Helper programs: HQ checks what is installed and can fetch the two it needs for music and
// backgrounds (yt-dlp and ffmpeg) into its own runtime folder, without admin rights or PATH edits.
import path from 'node:path';
import os from 'node:os';
import { promises as fs, createWriteStream, existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RUNTIME, IS_WIN, run, which } from './util.mjs';

export const toolsBus = new EventEmitter();
const BIN = path.join(RUNTIME, 'bin');
const FFDIR = path.join(RUNTIME, 'ffmpeg');
const jobs = {};

const SOURCES = {
  'yt-dlp': { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', size: 24e6 },
  ffmpeg: { url: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip', size: 92e6 },
};

async function version(bin, args = ['--version'], pick = (s) => s.trim().split(/\r?\n/)[0]) {
  if (!bin) return null;
  const r = /\.cmd$/i.test(bin) ? await run(process.env.ComSpec || 'cmd.exe', ['/c', bin, ...args], { timeout: 20000 }) : await run(bin, args, { timeout: 20000 });
  return r.ok ? pick(r.stdout) || 'installed' : null;
}

export async function toolStatus() {
  const [ytdlp, ffmpeg, ffprobe, git, gh, code, node] = await Promise.all(['yt-dlp', 'ffmpeg', 'ffprobe', 'git', 'gh', 'code', 'node'].map(which));
  const [vY, vF, vG, vGh, vN] = await Promise.all([
    version(ytdlp),
    version(ffmpeg, ['-version'], (s) => (/ffmpeg version (\S+)/.exec(s) || [])[1] || 'installed'),
    version(git, ['--version'], (s) => s.replace(/^git version /, '').trim()),
    version(gh, ['--version'], (s) => (/gh version (\S+)/.exec(s) || [])[1] || 'installed'),
    Promise.resolve(process.version.slice(1)),
  ]);
  const own = (p) => !!p && p.toLowerCase().startsWith(RUNTIME.toLowerCase());
  return {
    canInstall: IS_WIN,
    tools: [
      { id: 'yt-dlp', name: 'yt-dlp', why: 'Downloads songs and background clips from YouTube', required: true, installed: !!vY, version: vY, managed: own(ytdlp), job: jobs['yt-dlp'] || null },
      { id: 'ffmpeg', name: 'FFmpeg', why: 'Turns downloads into MP3 and HD video', required: true, installed: !!(vF && ffprobe), version: vF, managed: own(ffmpeg), job: jobs.ffmpeg || null },
      { id: 'node', name: 'Node.js', why: 'Runs HQ itself', required: true, installed: true, version: vN, managed: own(node) },
      { id: 'git', name: 'Git', why: 'Shows the history of your projects (optional)', installed: !!vG, version: vG, url: 'https://git-scm.com/download/win' },
      { id: 'gh', name: 'GitHub CLI', why: 'Shows which projects are on GitHub (optional)', installed: !!vGh, version: vGh, url: 'https://cli.github.com/' },
      { id: 'code', name: 'VS Code', why: 'Opens your projects in an editor (optional)', installed: !!code, version: code ? 'installed' : null, url: 'https://code.visualstudio.com/' },
    ],
  };
}

const emit = (id) => toolsBus.emit('job', { id, ...jobs[id] });

async function download(url, file, id, expected) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'HQ-Personal' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || expected;
  let got = 0, last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    got += c.length;
    const pct = Math.min(99, Math.round((got / total) * 100));
    if (pct - last >= 2) { last = pct; jobs[id].progress = pct; emit(id); }
  });
  await pipeline(body, createWriteStream(file));
}

/** Install or update yt-dlp / ffmpeg into HQ's runtime folder. */
export async function installTool(id) {
  if (!IS_WIN) throw Object.assign(new Error('Automatic install is available on Windows. Install it with your package manager.'), { status: 400 });
  if (!SOURCES[id]) throw Object.assign(new Error('Unknown tool'), { status: 400 });
  if (jobs[id]?.status === 'working') return jobs[id];
  jobs[id] = { status: 'working', progress: 0, error: null };
  emit(id);
  (async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-tool-'));
    try {
      if (id === 'yt-dlp') {
        await fs.mkdir(BIN, { recursive: true });
        const f = path.join(tmp, 'yt-dlp.exe');
        await download(SOURCES[id].url, f, id, SOURCES[id].size);
        await fs.copyFile(f, path.join(BIN, 'yt-dlp.exe'));
      } else {
        const zip = path.join(tmp, 'ffmpeg.zip');
        await download(SOURCES[id].url, zip, id, SOURCES[id].size);
        jobs[id].progress = 99; jobs[id].phase = 'unpacking'; emit(id);
        const out = path.join(tmp, 'x');
        await fs.mkdir(out, { recursive: true });
        // Windows' own tar (bsdtar) reads zip files; a Git-for-Windows tar on PATH would not, so name it exactly.
        const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        let r = existsSync(sysTar) ? await run(sysTar, ['-xf', zip, '-C', out], { timeout: 300000 }) : { ok: false, stderr: 'no tar.exe' };
        if (!r.ok) r = await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`], { timeout: 600000 });
        if (!r.ok) throw new Error(`Could not unpack FFmpeg: ${r.stderr.slice(0, 200)}`);
        const top = (await fs.readdir(out))[0];
        const bin = path.join(out, top, 'bin');
        if (!existsSync(path.join(bin, 'ffmpeg.exe'))) throw new Error('FFmpeg archive had an unexpected layout');
        await fs.rm(FFDIR, { recursive: true, force: true });
        await fs.mkdir(FFDIR, { recursive: true });
        for (const f of await fs.readdir(bin)) if (f !== 'ffplay.exe') await fs.copyFile(path.join(bin, f), path.join(FFDIR, f));
      }
      jobs[id] = { status: 'done', progress: 100, error: null };
    } catch (e) {
      jobs[id] = { status: 'error', progress: 0, error: e.message };
    } finally {
      emit(id);
      fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  })();
  return jobs[id];
}

/** True when both media helpers are available. */
export async function mediaReady() {
  const [y, f] = await Promise.all([which('yt-dlp'), which('ffmpeg')]);
  return !!(y && f);
}
