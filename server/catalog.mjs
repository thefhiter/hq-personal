// Projects: every sub-folder of the folders the owner picks becomes a project, with live git and
// GitHub facts. Names, descriptions, categories and status can be edited (saved as overrides).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA, readJson, writeJson, exists, run, cached, slug, which } from './util.mjs';
import { gitSummary, isRepo } from './git.mjs';
import { getSettings } from './config.mjs';

const OVERRIDES = path.join(DATA, 'projects.json');

export const CATEGORIES = [
  { id: 'web', name: 'Web & apps', color: '#5AB8FF' },
  { id: 'code', name: 'Code', color: '#B48CFF' },
  { id: 'hardware', name: 'Hardware', color: '#FFB547' },
  { id: '3d', name: '3D & design', color: '#FF7AB6' },
  { id: 'media', name: 'Video & media', color: '#FF6A5A' },
  { id: 'docs', name: 'Documents', color: '#3DDC97' },
  { id: 'other', name: 'Other', color: '#A9B1BB' },
];
const STATUSES = ['active', 'paused', 'shipped', 'live', 'prototype', 'reference'];
const SKIP = /^(\.|node_modules$|\$|desktop\.ini$|thumbs\.db$)/i;

async function overrides() { return readJson(OVERRIDES, { projects: {}, extra: [] }); }

/** Guess what kind of project a folder is from the files at its top level. */
async function sniff(dir) {
  let real = [];
  try { real = await fs.readdir(dir); } catch { return { category: 'other' }; }
  const names = real.map((n) => n.toLowerCase());
  const has = (re) => names.some((n) => re.test(n));
  let tagline = '';
  if (names.includes('package.json')) {
    const pkg = await readJson(path.join(dir, 'package.json'), {});
    tagline = typeof pkg.description === 'string' ? pkg.description : '';
  }
  if (!tagline) {
    const readme = real.find((n) => /^readme\.(md|txt)$/i.test(n));
    if (readme) {
      try {
        const text = await fs.readFile(path.join(dir, readme), 'utf8');
        tagline = (text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^(#|!\[|<|\[!|```|---|\||>)/.test(l)) || '').replace(/[*_`]/g, '').slice(0, 200);
      } catch {}
    }
  }
  const category = has(/\.(ino)$|^platformio\.ini$|\.(kicad_pro|sch)$/) ? 'hardware'
    : has(/\.(blend|stl|3mf|step|stp|sldprt|sldasm|fbx|obj|glb|psd|fig|ai)$/) ? '3d'
    : has(/\.(mp4|mov|mkv|prproj|aep|wav|mp3|drp)$/) ? 'media'
    : has(/^(package\.json|index\.html|vite\.config\..*|next\.config\..*)$/) ? 'web'
    : has(/\.(py|cs|csproj|sln|java|go|rs|cpp|c|kt|swift|rb|php)$/) || has(/^(requirements\.txt|pyproject\.toml|cargo\.toml|go\.mod)$/) ? 'code'
    : has(/\.(docx?|xlsx?|pptx?|pdf|md|txt|odt)$/) ? 'docs' : 'other';
  return { category, tagline };
}

/** Every project folder found under the chosen roots (plus single folders added by hand). */
export const discover = cached(60_000, async () => {
  const s = await getSettings();
  const ov = await overrides();
  const seen = new Map();
  const add = async (abs, root) => {
    const key = abs.toLowerCase();
    if (seen.has(key)) return;
    let id = slug(path.basename(abs));
    while ([...seen.values()].some((p) => p.id === id)) id += '-2';
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isDirectory()) return;
    const facts = await sniff(abs);
    seen.set(key, { id, name: path.basename(abs), path: abs, root, category: facts.category, tagline: facts.tagline, status: null, modified: st.mtime.toISOString(), created: st.birthtime?.toISOString?.() || null });
  };
  for (const root of s.folders.projects) {
    let entries = [];
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && !SKIP.test(e.name)) await add(path.join(root, e.name), root);
  }
  for (const extra of ov.extra || []) if (exists(extra)) await add(extra, null);
  const list = [...seen.values()].map((p) => {
    const o = ov.projects?.[p.path.toLowerCase()] || {};
    return { ...p, ...Object.fromEntries(Object.entries(o).filter(([k]) => ['name', 'tagline', 'category', 'status', 'hidden', 'live'].includes(k))) };
  });
  return list;
});

const summaryFor = cached(10 * 60_000, async (dir) => gitSummary(dir));

/** GitHub facts for the owner's repositories (visibility, push date) when the GitHub CLI is signed in. */
export const githubRepos = cached(30 * 60_000, async () => {
  const out = new Map();
  if (!(await which('gh'))) return out;
  const s = await getSettings();
  const args = ['repo', 'list', ...(s.github.user ? [s.github.user] : []), '--limit', '300', '--json', 'name,visibility,pushedAt,description,url,stargazerCount'];
  const r = await run('gh', args, { timeout: 30000 });
  if (r.ok) { try { for (const repo of JSON.parse(r.stdout)) out.set(repo.url.toLowerCase(), repo); } catch {} }
  return out;
});

/** Projects + live facts. `light` skips git (fast lists). */
export async function enrichedProjects({ light = false, hidden = false } = {}) {
  let all = await discover();
  if (!hidden) all = all.filter((p) => !p.hidden);
  let gh = new Map();
  if (!light) { try { gh = await githubRepos(); } catch {} }
  const day = 86400000;
  const projects = await Promise.all(all.map(async (p) => {
    const base = { ...p, absPath: p.path, exists: exists(p.path) };
    if (light) return base;
    const git = isRepo(p.path) ? await summaryFor(p.path) : null;
    const ghInfo = git?.remote ? gh.get(git.remote.toLowerCase().replace(/\.git$/, '')) : null;
    const lastActivity = git?.lastCommit?.date || p.modified || null;
    const recent = lastActivity && Date.now() - new Date(lastActivity).getTime() < 30 * day;
    return {
      ...base,
      git,
      repo: git?.remote && /github\.com/.test(git.remote) ? git.remote : null,
      github: ghInfo ? { visibility: ghInfo.visibility, pushedAt: ghInfo.pushedAt, stars: ghInfo.stargazerCount } : null,
      backedUp: !!(ghInfo || git?.remote),
      started: git?.firstCommit?.slice(0, 10) || p.created?.slice(0, 10) || null,
      lastActivity,
      status: p.status || (recent ? 'active' : 'paused'),
    };
  }));
  return { categories: CATEGORIES, statuses: STATUSES, projects };
}

export async function findProject(id) {
  const p = (await discover()).find((x) => x.id === id);
  return p ? { ...p, absPath: p.path } : null;
}

/** Save the owner's edits for one project. */
export async function editProject(id, patch = {}) {
  const p = await findProject(id);
  if (!p) return null;
  const ov = await overrides();
  ov.projects ||= {};
  const cur = ov.projects[p.path.toLowerCase()] || {};
  if (typeof patch.name === 'string') cur.name = patch.name.trim().slice(0, 60) || p.name;
  if (typeof patch.tagline === 'string') cur.tagline = patch.tagline.trim().slice(0, 240);
  if (CATEGORIES.some((c) => c.id === patch.category)) cur.category = patch.category;
  if (STATUSES.includes(patch.status)) cur.status = patch.status;
  if (typeof patch.hidden === 'boolean') cur.hidden = patch.hidden;
  if (typeof patch.live === 'string') cur.live = /^https?:\/\//.test(patch.live) ? patch.live.slice(0, 300) : '';
  ov.projects[p.path.toLowerCase()] = cur;
  await writeJson(OVERRIDES, ov);
  discover.clear();
  return (await enrichedProjects({ hidden: true })).projects.find((x) => x.path === p.path);
}

/** Add one folder as a project even when it isn't inside a projects folder. */
export async function addProjectFolder(dir) {
  if (!dir || !exists(dir)) throw Object.assign(new Error('That folder does not exist'), { status: 400 });
  const ov = await overrides();
  ov.extra = [...new Set([...(ov.extra || []), path.resolve(dir)])];
  await writeJson(OVERRIDES, ov);
  discover.clear();
}

/** README of a project (shown on its overview). */
export async function projectNotes(p) {
  let readme = null;
  if (p.absPath && exists(p.absPath)) {
    for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.txt']) {
      const f = path.join(p.absPath, name);
      if (exists(f)) { try { readme = { name, content: await fs.readFile(f, 'utf8') }; break; } catch {} }
    }
  }
  return { notes: [], readme };
}

/** Screenshots a project already ships (docs/screenshots, docs/images…) for the gallery. */
export async function projectImages(p) {
  if (!p.absPath || !exists(p.absPath)) return [];
  const dirs = ['docs/screenshots', 'docs/images', 'docs/img', 'docs', 'screenshots', 'images', 'assets/screenshots', 'media', ''];
  const out = [];
  for (const d of dirs) {
    const dir = path.join(p.absPath, d);
    if (!exists(dir)) continue;
    try {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(e.name)) out.push(d ? `${d}/${e.name}` : e.name);
        if (out.length >= 12) return out;
      }
    } catch {}
  }
  return out;
}
