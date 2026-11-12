import { promises as fs } from 'node:fs';
import path from 'node:path';
import { run, exists, safeJoin } from './util.mjs';

const SEP = '\x1f';
const REC = '\x1e';

export function isRepo(dir) {
  return exists(dir) && exists(path.join(dir, '.git'));
}

// At most 4 git processes at once: refreshing 45 repos must not freeze the PC.
let running = 0;
const waiting = [];
async function git(dir, args, opts) {
  if (running >= 4) await new Promise((r) => waiting.push(r));
  running++;
  try { return await run('git', ['-c', 'core.quotepath=off', '-C', dir, ...args], opts); }
  finally { running--; waiting.shift()?.(); }
}

/** Quick facts used by cards: commit count, first/last commit, branch, dirty files, remote. */
export async function gitSummary(dir) {
  if (!isRepo(dir)) return null;
  const [count, last, first, branch, status, remote] = await Promise.all([
    git(dir, ['rev-list', '--count', 'HEAD']),
    git(dir, ['log', '-1', `--format=%H${SEP}%cI${SEP}%s`]),
    git(dir, ['log', '--reverse', '--format=%cI', '--max-parents=0']),
    git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(dir, ['status', '--porcelain=v1', '--untracked-files=normal'], { timeout: 15000 }),
    git(dir, ['remote', 'get-url', 'origin']),
  ]);
  const [hash, date, subject] = last.ok ? last.stdout.trim().split(SEP) : [];
  const dirty = status.ok ? status.stdout.split('\n').filter(Boolean).length : 0;
  let ahead = null;
  if (remote.ok && branch.ok) {
    const ab = await git(dir, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch.stdout.trim()}`]);
    if (ab.ok) {
      const [a, b] = ab.stdout.trim().split(/\s+/).map(Number);
      ahead = { ahead: a, behind: b };
    }
  }
  return {
    commits: count.ok ? Number(count.stdout.trim()) || 0 : 0,
    lastCommit: hash ? { hash, date, subject } : null,
    firstCommit: first.ok ? first.stdout.trim().split('\n')[0] || null : null,
    branch: branch.ok ? branch.stdout.trim() : null,
    dirty,
    remote: remote.ok ? remote.stdout.trim().replace(/\.git$/, '') : null,
    sync: ahead,
  };
}

/** Commit history with per-commit file stats. */
export async function gitLog(dir, { limit = 200, since } = {}) {
  if (!isRepo(dir)) return [];
  const args = ['log', `-n${limit}`, '--date=iso-strict', `--format=${REC}%H${SEP}%h${SEP}%an${SEP}%cI${SEP}%s${SEP}%b`, '--shortstat'];
  if (since) args.push(`--since=${since}`);
  const r = await git(dir, args, { timeout: 30000 });
  if (!r.ok) return [];
  return r.stdout.split(REC).filter((s) => s.trim()).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [hash, short, author, date, subject, body0] = head.split(SEP);
    // body may span lines: everything until the shortstat line
    const lines = [body0 || '', ...rest];
    const statIdx = lines.findIndex((l) => /\d+ files? changed/.test(l));
    const body = lines.slice(0, statIdx === -1 ? undefined : statIdx).join('\n').trim();
    const stat = statIdx === -1 ? '' : lines[statIdx];
    const num = (re) => Number((stat.match(re) || [])[1] || 0);
    return {
      hash, short, author, date, subject, body,
      files: num(/(\d+) files? changed/), insertions: num(/(\d+) insertions?/), deletions: num(/(\d+) deletions?/),
    };
  });
}

/** Dates of every commit (for the activity heatmap). */
export async function gitCommitDates(dir, since = '1 year ago') {
  if (!isRepo(dir)) return [];
  const r = await git(dir, ['log', '--all', `--since=${since}`, '--format=%cI'], { timeout: 30000 });
  return r.ok ? r.stdout.split('\n').filter(Boolean) : [];
}

const MAX_DIFF = 400 * 1024;

export async function gitShow(dir, hash) {
  if (!isRepo(dir) || !/^[0-9a-f]{4,40}$/i.test(hash)) return null;
  const meta = await git(dir, ['show', '-s', `--format=%H${SEP}%an${SEP}%cI${SEP}%s${SEP}%b`, hash]);
  if (!meta.ok) return null;
  const [full, author, date, subject, body] = meta.stdout.split(SEP);
  const files = await git(dir, ['show', '--numstat', '--format=', hash]);
  const diff = await git(dir, ['show', '--format=', '--patch', '--find-renames', '--no-color', hash], { timeout: 30000 });
  return {
    hash: full, author, date, subject, body: (body || '').trim(),
    files: files.ok ? parseNumstat(files.stdout) : [],
    diff: truncate(diff.stdout, MAX_DIFF),
  };
}

/** Uncommitted work: status + diff against HEAD (incl. untracked file names). */
export async function gitWorking(dir) {
  if (!isRepo(dir)) return null;
  const [status, diff, numstat] = await Promise.all([
    git(dir, ['status', '--porcelain=v1', '--untracked-files=normal']),
    git(dir, ['diff', 'HEAD', '--no-color', '--find-renames'], { timeout: 30000 }),
    git(dir, ['diff', 'HEAD', '--numstat']),
  ]);
  const files = status.ok ? status.stdout.split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2).trim() || '?', path: l.slice(3) })) : [];
  return { files, stats: numstat.ok ? parseNumstat(numstat.stdout) : [], diff: truncate(diff.stdout, MAX_DIFF) };
}

function parseNumstat(text) {
  return text.split('\n').filter(Boolean).map((l) => {
    const [a, d, ...p] = l.split('\t');
    return { path: p.join('\t'), add: a === '-' ? null : Number(a), del: d === '-' ? null : Number(d) };
  });
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + `\n\n… diff truncated (${Math.round(s.length / 1024)} KB total)` : s;
}

const IGNORE_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'bin', 'obj', '.vs', 'dist', 'build', '.next', '.cache', '.gradle', 'run', 'packages']);

/** One directory level of the file tree (lazy browsing). */
export async function listDir(root, rel = '') {
  const dir = safeJoin(root, rel);
  if (!dir) throw new Error('Path outside project');
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    const relPath = path.relative(root, p).split(path.sep).join('/');
    if (e.isDirectory()) out.push({ name: e.name, path: relPath, dir: true, heavy: IGNORE_DIRS.has(e.name) });
    else {
      let size = 0, mtime = null;
      try { const st = await fs.stat(p); size = st.size; mtime = st.mtime.toISOString(); } catch {}
      out.push({ name: e.name, path: relPath, dir: false, size, mtime });
    }
  }
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out;
}

const TEXT_EXT = /\.(md|markdown|txt|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|scss|html?|xml|xaml|svg|cs|csproj|sln|props|py|ino|c|h|cpp|hpp|java|kt|gradle|toml|ya?ml|ini|cfg|conf|bat|cmd|ps1|sh|gcode|nc|tap|csv|tsv|env\.example|gitignore|gitattributes|editorconfig|lua|rs|go|php|rb|sql|vue|svelte|astro|mcfunction|lang|properties|log)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i;

export function fileKind(name) {
  if (IMG_EXT.test(name)) return 'image';
  if (TEXT_EXT.test(name) || !/\.[a-z0-9]+$/i.test(name)) return 'text';
  return 'binary';
}

export async function readProjectFile(root, rel) {
  const file = safeJoin(root, rel);
  if (!file) throw new Error('Path outside project');
  const st = await fs.stat(file);
  if (st.isDirectory()) throw new Error('Is a directory');
  const kind = fileKind(file);
  const base = { path: rel, size: st.size, mtime: st.mtime.toISOString(), kind };
  if (kind !== 'text') return { ...base, file };
  const limit = 512 * 1024;
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, limit));
    await fh.read(buf, 0, buf.length, 0);
    if (buf.includes(0)) return { ...base, kind: 'binary', file };
    return { ...base, content: buf.toString('utf8'), truncated: st.size > limit };
  } finally {
    await fh.close();
  }
}

/** Short history of one file. */
export async function fileHistory(dir, rel) {
  if (!isRepo(dir)) return [];
  const r = await git(dir, ['log', '-n30', '--follow', `--format=%h${SEP}%cI${SEP}%s`, '--', rel]);
  return r.ok ? r.stdout.split('\n').filter(Boolean).map((l) => { const [short, date, subject] = l.split(SEP); return { short, date, subject }; }) : [];
}
