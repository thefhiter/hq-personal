// Local media library: YouTube search, link/playlist import, MP3 + HD-video downloads (yt-dlp),
// so music and backgrounds play smoothly from this PC instead of fragile embeds.
import { spawn } from 'node:child_process';
import { promises as fs, statfsSync, existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { LOCAL, readJson, writeJson, run } from './util.mjs';

export const mediaBus = new EventEmitter();
export const LIB = path.join(LOCAL, 'library');
const DIRS = { audio: path.join(LIB, 'music'), video: path.join(LIB, 'videos'), thumb: path.join(LIB, 'thumbs') };
const INDEX = path.join(LIB, 'library.json');
export const COOKIES = path.join(LOCAL, 'youtube-cookies.txt');
const MIN_FREE = 1.5e9; // never fill the disk below 1.5 GB
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

let lib = { tracks: [], videos: [] };
const jobs = new Map();
const queue = [];
let active = 0;

export async function initMedia() {
  for (const d of Object.values(DIRS)) await fs.mkdir(d, { recursive: true });
  lib = await readJson(INDEX, { tracks: [], videos: [] });
  // drop entries whose file was deleted by hand
  lib.tracks = lib.tracks.filter((t) => existsSync(path.join(DIRS.audio, t.file)));
  lib.videos = lib.videos.filter((v) => existsSync(path.join(DIRS.video, v.file)));
  // and adopt finished files the index doesn't know yet (e.g. a download that ended during a restart)
  let changed = false;
  for (const [kind, dir, list] of [['audio', DIRS.audio, lib.tracks], ['video', DIRS.video, lib.videos]]) {
    for (const f of await fs.readdir(dir)) {
      const m = /^([\w-]{11})\.(mp3|mp4)$/.exec(f);
      if (!m || list.some((x) => x.file === f)) continue;
      const meta = await oembed(m[1]);
      const size = (await fs.stat(path.join(dir, f))).size;
      const item = { id: m[1], title: meta.title || m[1], channel: meta.author || '', duration: await probeDuration(path.join(dir, f)), file: f, size, added: new Date().toISOString() };
      if (kind === 'audio') list.push({ ...item, thumb: `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` });
      else {
        const poster = `${m[1]}.jpg`;
        if (!existsSync(path.join(DIRS.thumb, poster))) await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(1, Math.round((item.duration || 30) / 3))), '-i', path.join(dir, f), '-frames:v', '1', '-q:v', '3', path.join(DIRS.thumb, poster)], { timeout: 60000 });
        list.push({ ...item, scene: 'mine', poster: existsSync(path.join(DIRS.thumb, poster)) ? poster : null });
      }
      changed = true;
    }
  }
  if (changed) await saveLib();
}

async function oembed(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return {};
    const j = await r.json();
    return { title: j.title, author: j.author_name };
  } catch { return {}; }
}

async function probeDuration(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 20000 });
  return r.ok ? Math.round(Number(r.stdout.trim())) || null : null;
}
const saveLib = () => writeJson(INDEX, lib);

export function library() {
  return { tracks: lib.tracks, videos: lib.videos, jobs: [...jobs.values()].filter((j) => j.status !== 'done' || Date.now() - j.finished < 60_000), disk: disk(), account: existsSync(COOKIES) };
}

export function disk() {
  try {
    const s = statfsSync(LIB);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize, used: [...lib.tracks, ...lib.videos].reduce((a, x) => a + (x.size || 0), 0) };
  } catch { return null; }
}

const parseDur = (t = '') => t.split(':').reduce((a, n) => a * 60 + Number(n || 0), 0);

/** YouTube search: the public results page is fast (~1 s); YouTube occasionally answers with an
 *  empty variant, so retry once and finally fall back to yt-dlp's own (slower) search. */
export async function search(q) {
  for (let i = 0; i < 2; i++) {
    try { const r = await searchPage(q); if (r.length) return r; } catch {}
  }
  const r = await run('yt-dlp', ['--flat-playlist', '-J', '--no-warnings', `ytsearch15:${q}`], { timeout: 60000 });
  if (!r.ok && /ENOENT/.test(String(r.code))) throw new Error('YouTube search is unavailable right now (and yt-dlp is not installed)');
  if (!r.ok) throw new Error('YouTube search is unavailable right now');
  return (JSON.parse(r.stdout).entries || []).filter((e) => e?.id).map((e) => ({
    id: e.id, title: e.title || e.id, channel: e.channel || e.uploader || '', duration: e.duration || null, live: e.live_status === 'is_live', views: e.view_count ? `${Intl.NumberFormat('en', { notation: 'compact' }).format(e.view_count)} views` : '', thumb: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
  }));
}

async function searchPage(q) {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) throw new Error('YouTube search is unavailable right now');
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== 'object' || out.length >= 24) return;
    if (o.videoRenderer?.videoId) {
      const v = o.videoRenderer;
      out.push({
        id: v.videoId,
        title: (v.title?.runs || []).map((r) => r.text).join(''),
        channel: (v.ownerText?.runs || []).map((r) => r.text).join(''),
        duration: v.lengthText?.simpleText ? parseDur(v.lengthText.simpleText) : null,
        live: !v.lengthText,
        views: v.shortViewCountText?.simpleText || v.viewCountText?.simpleText || '',
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

// The account file is only used when it's really needed (private lists, login-only videos):
// when yt-dlp is logged in, YouTube serves a player whose streams need extra verification code,
// so ordinary downloads fail with "Requested format is not available".
const hasAccount = () => existsSync(COOKIES);
const accountArgs = () => ['--cookies', COOKIES, '--js-runtimes', 'node'];
const PRIVATE_LIST = /[?&]list=(LL|WL|LM)\b|youtube\.com\/feed\//i;
const NEEDS_LOGIN = /sign in|private video|members|confirm your age|age-restricted|login|cookies/i;

function friendly(msg = '') {
  if (/not installed yet/i.test(msg)) return msg;
  if (/ffmpeg|ffprobe/i.test(msg) && /not found|not installed/i.test(msg)) return 'FFmpeg is missing: open Settings → Tools and press Install';
  if (/Requested format is not available/i.test(msg)) return 'YouTube offered no downloadable stream for this one';
  if (/not a bot/i.test(msg)) return "YouTube wants to check you're not a bot. Try again in a little while";
  if (/confirm your age|age-restricted/i.test(msg)) return hasAccount() ? 'Age-restricted, and your account could not unlock it' : 'Age-restricted: connect your YouTube account (Music → My YouTube)';
  if (/private video/i.test(msg)) return 'This video is private';
  if (/members/i.test(msg)) return 'Members-only video';
  if (/Video unavailable|has been removed|terminated/i.test(msg)) return 'This video is no longer available';
  if (/max-filesize|too large/i.test(msg)) return 'Too big for a background clip (over 450 MB)';
  return msg || 'Download failed';
}
const lastError = (stderr) => stderr.split('\n').filter((l) => /ERROR/.test(l)).pop()?.replace(/^ERROR:\s*(\[\w+\]\s*\S+:\s*)?/, '') || '';

/** Expand a pasted link: a single video or a whole playlist (your own private lists use the account file). */
export async function resolveLink(url) {
  const list = (useAccount) => run('yt-dlp', [...(useAccount ? accountArgs() : []), '--flat-playlist', '-J', '--playlist-end', '200', '--no-warnings', url], { timeout: 90000 });
  const privateList = PRIVATE_LIST.test(url);
  if (privateList && !hasAccount()) throw Object.assign(new Error('Connect your YouTube account first (Music → My YouTube)'), { status: 400 });
  let r = await list(privateList);
  if (!r.ok && !privateList && hasAccount()) r = await list(true);
  if (!r.ok) throw new Error(friendly(lastError(r.stderr)) || 'Could not read that link');
  const d = JSON.parse(r.stdout);
  const entries = d.entries ? d.entries : [d];
  return {
    title: d.title || entries[0]?.title || 'Link',
    items: entries.filter((e) => e && e.id && e.id.length === 11).map((e) => ({ id: e.id, title: e.title || e.id, channel: e.channel || e.uploader || '', duration: e.duration || null, thumb: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` })),
  };
}

function emitJob(j) { mediaBus.emit('job', { ...j }); }

/** Queue a download. kind: 'audio' → MP3 for the music library, 'video' → muted HD clip for backgrounds. */
export function enqueue({ id, kind, title = '', scene = 'mine' }) {
  if (!/^[\w-]{11}$/.test(id)) throw Object.assign(new Error('Bad video id'), { status: 400 });
  if (!['audio', 'video'].includes(kind)) throw Object.assign(new Error('kind must be audio or video'), { status: 400 });
  const have = kind === 'audio' ? lib.tracks.find((t) => t.id === id) : lib.videos.find((v) => v.id === id);
  if (have) {
    if (kind === 'video' && scene && have.scene !== scene) { have.scene = scene; saveLib(); }
    return { key: `${kind}:${id}`, status: 'done', already: true };
  }
  const key = `${kind}:${id}`;
  const existing = jobs.get(key);
  if (existing && ['queued', 'downloading', 'converting'].includes(existing.status)) return existing;
  const d = disk();
  if (d && d.free < MIN_FREE) throw Object.assign(new Error(`Only ${(d.free / 1e9).toFixed(1)} GB free on this disk — free some space first`), { status: 507 });
  const job = { key, id, kind, title, scene, status: 'queued', progress: 0, error: null, started: Date.now(), finished: 0 };
  jobs.set(key, job);
  queue.push(job);
  emitJob(job);
  pump();
  return job;
}

function pump() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    active++;
    download(job).catch((e) => { job.status = 'error'; job.error = e.message; }).finally(() => {
      active--; job.finished = Date.now(); emitJob(job); pump();
    });
  }
}

async function download(job) {
  job.status = 'downloading';
  emitJob(job);
  const url = `https://www.youtube.com/watch?v=${job.id}`;
  const dir = job.kind === 'audio' ? DIRS.audio : DIRS.video;
  const fmt = job.kind === 'audio'
    ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '2', '--embed-metadata']
    // H.264 first: hardware-decoded on this laptop, so 1080p plays without stutter.
    : ['-f', 'bv*[vcodec^=avc1][height<=1080][protocol=https]/bv*[vcodec^=avc1][height<=1080]/bv*[ext=mp4][height<=1080]/bv*[height<=720]', '--remux-video', 'mp4', '--max-filesize', '450M'];
  const args = (useAccount) => [...(useAccount ? accountArgs() : []), '--no-playlist', '--newline', '--no-warnings', ...fmt,
    '-o', path.join(dir, '%(id)s.%(ext)s'),
    '--print', 'after_move:META\t%(id)s\t%(title)s\t%(uploader)s\t%(duration)s\t%(height)s\t%(filepath)s',
    '--no-simulate', '--progress', url];
  let meta;
  try {
    meta = await ytdlp(job, args(false));
  } catch (e) {
    // Only videos that really need a login get a second try with the account.
    if (!hasAccount() || !NEEDS_LOGIN.test(e.message)) throw new Error(friendly(e.message));
    job.status = 'downloading'; job.progress = 0; emitJob(job);
    try { meta = await ytdlp(job, args(true)); } catch (e2) { throw new Error(friendly(e2.message)); }
  }
  await addToLibrary(job, meta);
}

function ytdlp(job, args) {
  return new Promise((resolve, reject) => {
    const p = spawn('yt-dlp', args, { windowsHide: true });
    let info = null, err = '';
    const onLine = (line) => {
      const pr = /\[download\]\s+([\d.]+)%/.exec(line);
      if (pr) { const v = Number(pr[1]); if (v - job.progress >= 2 || v >= 100) { job.progress = v; emitJob(job); } }
      if (/\[(ExtractAudio|VideoRemuxer|Merger)\]/.test(line) && job.status !== 'converting') { job.status = 'converting'; emitJob(job); }
      if (line.startsWith('META\t')) { const [, id, title, uploader, duration, height, filepath] = line.split('\t'); info = { id, title, uploader, duration: Number(duration) || null, height: Number(height) || null, filepath }; }
    };
    // yt-dlp writes progress to stderr when --print is used, so read both streams.
    readline.createInterface({ input: p.stdout }).on('line', onLine);
    readline.createInterface({ input: p.stderr }).on('line', (line) => { err = (err + line + '\n').slice(-3000); onLine(line); });
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? 'yt-dlp is not installed yet: open Settings → Tools and press Install' : `yt-dlp could not start: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0 && info) resolve(info);
      else reject(new Error(lastError(err) || (code === 0 ? 'too large' : `yt-dlp exited ${code}`)));
    });
  });
}

async function addToLibrary(job, meta) {
  const file = path.basename(meta.filepath);
  const size = (await fs.stat(meta.filepath)).size;
  if (job.kind === 'audio') {
    lib.tracks.unshift({ id: meta.id, title: meta.title, channel: meta.uploader, duration: meta.duration, file, size, thumb: `https://i.ytimg.com/vi/${meta.id}/mqdefault.jpg`, added: new Date().toISOString() });
  } else {
    const thumb = `${meta.id}.jpg`;
    // A sharp poster frame from a third of the way in (used while loading and as the home hero).
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(1, Math.round((meta.duration || 30) / 3))), '-i', meta.filepath, '-frames:v', '1', '-q:v', '3', path.join(DIRS.thumb, thumb)], { timeout: 60000 });
    lib.videos.unshift({ id: meta.id, title: meta.title, channel: meta.uploader, duration: meta.duration, height: meta.height, file, size, scene: job.scene || 'mine', poster: existsSync(path.join(DIRS.thumb, thumb)) ? thumb : null, added: new Date().toISOString() });
  }
  await saveLib();
  job.status = 'done';
  job.progress = 100;
  job.title = meta.title;
  mediaBus.emit('library', library());
}

/** Put every failed download back in the queue. */
export function retryFailed() {
  const failed = [...jobs.values()].filter((j) => j.status === 'error');
  for (const j of failed) jobs.delete(j.key);
  return failed.map((j) => { try { return enqueue({ id: j.id, kind: j.kind, title: j.title, scene: j.scene }); } catch (e) { return { id: j.id, error: e.message }; } });
}

export function clearFailed() {
  for (const j of [...jobs.values()]) if (j.status === 'error') jobs.delete(j.key);
}

export async function removeItem(kind, id) {
  const list = kind === 'audio' ? lib.tracks : lib.videos;
  const item = list.find((x) => x.id === id);
  if (!item) return false;
  await fs.rm(path.join(kind === 'audio' ? DIRS.audio : DIRS.video, item.file), { force: true });
  if (item.poster) await fs.rm(path.join(DIRS.thumb, item.poster), { force: true });
  if (kind === 'audio') lib.tracks = lib.tracks.filter((x) => x.id !== id); else lib.videos = lib.videos.filter((x) => x.id !== id);
  await saveLib();
  mediaBus.emit('library', library());
  return true;
}

export async function setVideoScene(id, scene) {
  const v = lib.videos.find((x) => x.id === id);
  if (!v) return null;
  v.scene = String(scene).slice(0, 40);
  await saveLib();
  return v;
}

export async function saveCookies(text) {
  const t = String(text || '');
  if (!/youtube\.com/.test(t) || !/^#\s*(Netscape )?HTTP Cookie File/m.test(t) && !/\t(TRUE|FALSE)\t/.test(t)) {
    throw Object.assign(new Error('That does not look like a cookies.txt export for youtube.com'), { status: 400 });
  }
  await fs.mkdir(LOCAL, { recursive: true });
  await fs.writeFile(COOKIES, t, 'utf8');
}
export async function removeCookies() { await fs.rm(COOKIES, { force: true }); }

/** Resolve a media path safely for the static server. */
export function mediaFile(kind, name) {
  const dir = { music: DIRS.audio, videos: DIRS.video, thumbs: DIRS.thumb }[kind];
  if (!dir || !/^[\w-]{11}\.(mp3|mp4|m4a|webm|jpg)$/.test(name)) return null;
  const f = path.join(dir, name);
  return existsSync(f) ? f : null;
}
