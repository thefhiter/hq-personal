import { cached } from './util.mjs';
import { enrichedProjects } from './catalog.mjs';
import { gitLog, isRepo } from './git.mjs';
import { claudeSessions } from './activity.mjs';
import { focusStats } from './timer.mjs';

const day = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** One merged, day-grouped story: project births, commits, Claude Code sessions, focus. */
export const timeline = cached(15 * 60_000, async () => {
  const { projects } = await enrichedProjects();
  const days = new Map();
  const bucket = (k) => {
    if (!days.has(k)) days.set(k, { date: k, milestones: [], starts: [], commits: [], sessions: [], focusMin: 0 });
    return days.get(k);
  };

  await Promise.all(projects.map(async (p) => {
    if (p.started) bucket(p.started).starts.push({ id: p.id, name: p.name, category: p.category, tagline: p.tagline });
    if (!p.absPath || !isRepo(p.absPath)) return;
    const log = await gitLog(p.absPath, { limit: 800 });
    const perDay = new Map();
    for (const c of log) {
      const k = day(c.date);
      if (!perDay.has(k)) perDay.set(k, []);
      perDay.get(k).push({ short: c.short, subject: c.subject, hash: c.hash });
    }
    for (const [k, list] of perDay) bucket(k).commits.push({ projectId: p.id, name: p.name, category: p.category, count: list.length, items: list.slice(0, 6) });
  }));

  try {
    const { sessions } = await claudeSessions();
    for (const s of sessions) bucket(day(s.first)).sessions.push({ id: s.id, title: s.title || (s.firstPrompt || '').slice(0, 80), prompts: s.prompts, files: s.files });
  } catch {}

  for (const [k, min] of Object.entries(focusStats().byDay)) bucket(k).focusMin += min;

  const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  for (const d of list) d.commits.sort((a, b) => b.count - a.count);
  return { days: list, first: list.at(-1)?.date || null, projects: projects.length };
});
