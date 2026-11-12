import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CLAUDE_PROJECTS_DIR, LOCAL, readJson, writeJson, cached } from './util.mjs';
import { gitCommitDates, gitLog, isRepo } from './git.mjs';
import { enrichedProjects } from './catalog.mjs';

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Commits per day across every repo in the catalog (heatmap) + a merged recent feed. */
export const commitActivity = cached(15 * 60_000, async () => {
  const { projects } = await enrichedProjects();
  const byDay = {};
  const feed = [];
  await Promise.all(projects.filter((p) => p.absPath && isRepo(p.absPath)).map(async (p) => {
    const [dates, log] = await Promise.all([gitCommitDates(p.absPath, '400 days ago'), gitLog(p.absPath, { limit: 15 })]);
    for (const d of dates) { const k = dayKey(d); byDay[k] = (byDay[k] || 0) + 1; }
    for (const c of log) feed.push({ ...c, projectId: p.id, projectName: p.name, category: p.category });
  }));
  feed.sort((a, b) => b.date.localeCompare(a.date));
  return { byDay, feed: feed.slice(0, 60), total: Object.values(byDay).reduce((a, b) => a + b, 0) };
});

// ---- Claude Code session index: what we worked on, when, and which files were touched ----

const INDEX_FILE = path.join(LOCAL, 'cache', 'sessions-index.json');
let index = null;
let building = null;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  return '';
}

async function scanSession(file) {
  const s = { file, id: path.basename(file, '.jsonl'), cwd: null, title: null, first: null, last: null, prompts: 0, firstPrompt: null, edits: {}, tools: 0 };
  const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.timestamp) { if (!s.first) s.first = d.timestamp; s.last = d.timestamp; }
    if (!s.cwd && d.cwd) s.cwd = d.cwd;
    if (d.type === 'ai-title' && d.aiTitle) s.title = d.aiTitle;
    if (d.type === 'user' && !d.isMeta) {
      const t = textOf(d.message?.content).trim();
      if (t && !t.startsWith('<') && !t.startsWith('[Request interrupted') && !t.startsWith('Base directory for this skill')) {
        s.prompts++;
        if (!s.firstPrompt) s.firstPrompt = t.slice(0, 300);
      }
    }
    if (d.type === 'assistant' && Array.isArray(d.message?.content)) {
      for (const b of d.message.content) {
        if (b?.type !== 'tool_use') continue;
        s.tools++;
        const fp = b.input?.file_path || b.input?.notebook_path;
        if (fp && ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(b.name)) s.edits[fp] = (s.edits[fp] || 0) + 1;
      }
    }
  }
  return s;
}

async function buildIndex() {
  const old = index || (await readJson(INDEX_FILE, { sessions: {} }));
  const next = { built: new Date().toISOString(), sessions: {} };
  let dirs = [];
  try { dirs = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true }); } catch {}
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(CLAUDE_PROJECTS_DIR, d.name);
    let files = [];
    try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch {}
    for (const f of files) {
      const file = path.join(dir, f);
      let st;
      try { st = await fs.stat(file); } catch { continue; }
      const key = file;
      const prev = old.sessions?.[key];
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) { next.sessions[key] = prev; continue; }
      try {
        const s = await scanSession(file);
        next.sessions[key] = { ...s, size: st.size, mtime: st.mtimeMs };
      } catch (e) { console.error('[sessions]', f, e.message); }
    }
  }
  index = next;
  await writeJson(INDEX_FILE, next);
  return next;
}

export function refreshSessions() {
  if (!building) building = buildIndex().finally(() => { building = null; });
  return building;
}

export async function claudeSessions() {
  if (!index) {
    index = await readJson(INDEX_FILE, null);
    if (!index) await refreshSessions();
    else refreshSessions(); // update in the background
  }
  const list = Object.values(index.sessions || {}).filter((s) => s.first && s.prompts > 0);
  list.sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  return { built: index.built, building: !!building, sessions: list.map(({ edits, ...s }) => ({ ...s, files: Object.keys(edits || {}).length, editsMap: edits })) };
}

/** Sessions that touched a project folder (by edited files or working directory). */
export async function sessionsForProject(absPath) {
  if (!absPath) return [];
  const root = absPath.toLowerCase();
  const { sessions } = await claudeSessions();
  const out = [];
  for (const s of sessions) {
    const touched = Object.entries(s.editsMap || {}).filter(([f]) => f.toLowerCase().startsWith(root));
    const inCwd = (s.cwd || '').toLowerCase().startsWith(root);
    if (!touched.length && !inCwd) continue;
    out.push({ id: s.id, title: s.title, first: s.first, last: s.last, prompts: s.prompts, firstPrompt: s.firstPrompt,
      files: touched.map(([f, n]) => ({ path: path.relative(absPath, f).split(path.sep).join('/'), edits: n })).sort((a, b) => b.edits - a.edits) });
  }
  return out;
}

/** Sessions per day (for the timeline / heatmap overlay). */
export async function sessionsByDay() {
  const { sessions } = await claudeSessions();
  const byDay = {};
  for (const s of sessions) { const k = dayKey(s.first); byDay[k] = (byDay[k] || 0) + 1; }
  return byDay;
}
