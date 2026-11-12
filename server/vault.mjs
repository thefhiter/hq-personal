// Notes: Markdown folders the owner picks (an Obsidian vault, a notes folder…) and, optionally,
// the memory files Claude Code keeps. Wikilinks, backlinks, search and a link graph.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CLAUDE_PROJECTS_DIR, DATA, safeJoin, cached, exists, hash } from './util.mjs';

const MY_NOTES = path.join(DATA, 'notes');
import { getSettings } from './config.mjs';

/** Parse the small YAML front matter used by Obsidian and Claude memory notes. */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MAX_NOTES = 4000;

async function walk(dir, base, out, depth = 0) {
  if (depth > 8 || out.length >= MAX_NOTES) return;
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, out, depth + 1);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
}

/** The note sources: each chosen folder, plus Claude Code memory folders when enabled. */
export async function sources() {
  const s = await getSettings();
  await fs.mkdir(MY_NOTES, { recursive: true });
  // "My notes" always exists, so the page works before any folder is connected.
  const out = [{ id: 'mine', kind: 'folder', name: 'My notes', dir: MY_NOTES }];
  for (const dir of s.folders.notes.filter(exists)) out.push({ id: `f${hash(dir)}`, kind: 'folder', name: path.basename(dir) || dir, dir });
  if (s.folders.claudeMemory && exists(CLAUDE_PROJECTS_DIR)) {
    try {
      for (const d of await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })) {
        const dir = path.join(CLAUDE_PROJECTS_DIR, d.name, 'memory');
        if (d.isDirectory() && exists(dir)) out.push({ id: `m${hash(dir)}`, kind: 'memory', name: 'Claude memory', dir });
      }
    } catch {}
  }
  return out;
}

async function noteInfo(src, rel) {
  const file = path.join(src.dir, rel);
  const [text, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
  const { meta, body } = frontMatter(text);
  const links = [...body.matchAll(WIKILINK)].map((m) => m[1].trim());
  const title = src.kind === 'memory' ? (meta.name || rel.replace(/\.md$/, '')) : rel.split('/').pop().replace(/\.md$/, '');
  return {
    id: `${src.id}:${rel}`, source: src.kind, sourceName: src.name, path: rel, title,
    description: meta.description || (body.match(/^(?!#|>|\s*$|```|\||-{3}).{20,}$/m) || [''])[0].slice(0, 220),
    type: meta.type || (text.match(/^\s+type:\s*(\w+)/m) || [])[1] || null,
    folder: rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '',
    modified: st.mtime.toISOString(), size: st.size, links,
  };
}

export const vaultIndex = cached(20_000, async () => {
  const notes = [];
  const srcs = await sources();
  for (const src of srcs) {
    const rels = [];
    await walk(src.dir, src.dir, rels);
    for (const rel of rels) { try { notes.push(await noteInfo(src, rel)); } catch {} }
  }
  // Resolve wikilinks: memory links use the `name:` slug, Obsidian links use the file title.
  const byKey = new Map();
  for (const n of notes) {
    byKey.set(n.title.toLowerCase(), n.id);
    byKey.set(n.path.replace(/\.md$/, '').toLowerCase(), n.id);
    byKey.set(n.path.split('/').pop().replace(/\.md$/, '').toLowerCase(), n.id);
  }
  const edges = [];
  for (const n of notes) {
    n.resolved = [];
    for (const l of n.links) {
      const target = byKey.get(l.toLowerCase()) || byKey.get(l.toLowerCase().replace(/\.canvas$/, ''));
      if (target && target !== n.id) { edges.push([n.id, target]); n.resolved.push(target); }
    }
  }
  notes.sort((a, b) => b.modified.localeCompare(a.modified));
  return { notes, edges, sources: srcs.map(({ id, kind, name }) => ({ id, kind, name })) };
});

async function resolve(id) {
  const [srcId, ...rest] = String(id).split(':');
  const rel = rest.join(':');
  const src = (await sources()).find((s) => s.id === srcId);
  if (!src) throw Object.assign(new Error('That notes folder is no longer connected'), { status: 404 });
  const file = safeJoin(src.dir, rel);
  if (!file || !file.toLowerCase().endsWith('.md')) throw Object.assign(new Error('Bad note path'), { status: 400 });
  return { src, rel, file };
}

export async function readNote(id) {
  const { src, rel, file } = await resolve(id);
  const text = await fs.readFile(file, 'utf8');
  const { meta, body } = frontMatter(text);
  const idx = await vaultIndex();
  const backlinks = idx.notes.filter((n) => n.resolved?.includes(id)).map((n) => ({ id: n.id, title: n.title }));
  return { id, source: src.kind, sourceName: src.name, path: rel, meta, body, raw: text, backlinks };
}

/** Write a note (create or edit) inside one of the owner's notes folders. */
export async function saveNote({ id, folderId, title, text }) {
  let file;
  if (id) ({ file } = await resolve(id));
  else {
    const src = (await sources()).find((s) => s.id === folderId && s.kind === 'folder') || (await sources()).find((s) => s.kind === 'folder');
    if (!src) throw Object.assign(new Error('Pick a notes folder in Settings first'), { status: 400 });
    const name = String(title || 'Untitled').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'Untitled';
    let rel = `${name}.md`;
    for (let i = 2; exists(path.join(src.dir, rel)); i++) rel = `${name} ${i}.md`;
    file = path.join(src.dir, rel);
    id = `${src.id}:${rel}`;
  }
  await fs.writeFile(file, String(text ?? ''), 'utf8');
  vaultIndex.clear();
  return { id };
}

export async function searchVault(q) {
  const needle = String(q || '').toLowerCase().trim();
  if (needle.length < 2) return [];
  const idx = await vaultIndex();
  const srcs = await sources();
  const hits = [];
  for (const n of idx.notes) {
    const src = srcs.find((s) => n.id.startsWith(`${s.id}:`));
    if (!src) continue;
    let text = '';
    try { text = await fs.readFile(path.join(src.dir, n.path), 'utf8'); } catch { continue; }
    const lower = text.toLowerCase();
    const at = lower.indexOf(needle);
    const inTitle = n.title.toLowerCase().includes(needle);
    if (at === -1 && !inTitle) continue;
    const from = Math.max(0, at - 70);
    hits.push({ id: n.id, title: n.title, source: n.source, snippet: at === -1 ? n.description : text.slice(from, at + needle.length + 110).replace(/\s+/g, ' '), score: (inTitle ? 10 : 0) + (lower.split(needle).length - 1) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 40);
}
