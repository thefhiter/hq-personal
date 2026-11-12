import { icon } from '../lib/icons.js';
import { api, esc, ago, fmtMin, heatmap, heatLegend, attachTips, catalog, catColor } from '../lib/ui.js';
import { setTitle, state, pageLabel } from '../app.js';
import * as player from '../lib/player.js';
import { posterOf } from '../lib/stage.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default {
  async render(root) {
    setTitle(pageLabel('home'));
    const s = state.settings;
    const on = new Set(s.nav.filter((n) => n.on).map((n) => n.id));
    const poster = posterOf();
    const withProjects = on.has('projects') && s.folders.projects.length > 0;
    root.innerHTML = `<div class="home-grid">
      <section class="hero span-12" ${poster ? `style="--hero:url('${poster}')"` : ''}>
        <div class="hero-copy">
          <div class="eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h2>${greeting()}${s.profile.name ? `, <span class="grad-text">${esc(s.profile.name)}</span>` : ''}.</h2>
          <p class="hero-sub" id="h-sub">Pick one thing and go deep.</p>
          <div class="row hero-actions">
            ${on.has('focus') ? `<a class="btn btn-primary btn-lg" href="#/focus">${icon('flame')}Start focusing</a>` : ''}
            ${on.has('ai') ? `<a class="btn btn-ghost btn-lg" href="#/ai">${icon('sparkles')}Open ${esc(pageLabel('ai'))}</a>` : ''}
            ${on.has('music') ? `<button class="btn btn-ghost btn-lg" type="button" id="h-music">${icon('music')}Play my music</button>` : ''}
          </div>
          <a class="continue" id="h-continue" href="#/projects" hidden></a>
        </div>
      </section>
      ${['a', 'b', 'c', 'd'].map((k) => `<section class="card stat" id="st-${k}"><div class="skeleton" style="height:96px"></div></section>`).join('')}
      <section class="card span-12" id="start-card" hidden></section>
      <section class="card span-12">
        <h3 class="card-title">${icon('calendar')}Your year<span class="spacer"></span>
          <span class="seg" role="group" aria-label="Show" id="seg"></span>
        </h3>
        <div class="heat-wrap" id="heat"><div class="skeleton" style="height:130px"></div></div>
        <div class="row"><div id="heat-legend"></div><span class="spacer"></span><span class="dim" id="heat-sum"></span></div>
      </section>
      ${withProjects ? `<section class="card span-7"><h3 class="card-title">${icon('commit')}Latest work<span class="spacer"></span>${on.has('timeline') ? '<a href="#/timeline">Everything</a>' : ''}</h3><ul class="feed" id="feed"><li><div class="skeleton" style="height:200px;grid-column:1/-1"></div></li></ul></section>
      <section class="card span-5"><h3 class="card-title">${icon('alert')}Loose ends</h3><ul class="feed" id="attention"></ul></section>` : ''}
    </div>`;

    root.querySelector('#h-music')?.addEventListener('click', () => player.playAll());

    const [cat, act, lib, prov] = await Promise.all([
      withProjects ? catalog().catch(() => ({ projects: [], categories: [] })) : { projects: [], categories: [] },
      api('/api/activity').catch(() => null),
      api('/api/library').catch(() => ({ tracks: [], videos: [] })),
      Promise.resolve(state.providers || {}),
    ]);
    if (!root.isConnected) return;

    const projects = cat.projects;
    const f = act?.focus || { todayMin: 0, goalMin: 240, streak: 0, longest: 0, weekMin: 0, sessions: 0, byDay: {} };
    const pct = Math.min(100, Math.round((f.todayMin / (f.goalMin || 240)) * 100));
    root.querySelector('#h-sub').textContent = f.todayMin
      ? `${fmtMin(f.todayMin)} of deep work so far today. ${pct >= 100 ? 'Goal smashed.' : `${fmtMin(Math.max(0, f.goalMin - f.todayMin))} to go.`}`
      : f.streak ? `You're on a ${f.streak}-day streak. Keep it alive today.` : 'Nothing logged yet today. One focus block is all it takes to start.';

    const lastProject = projects.filter((p) => p.git?.lastCommit).sort((a, b) => b.git.lastCommit.date.localeCompare(a.git.lastCommit.date))[0];
    if (lastProject) {
      const c = root.querySelector('#h-continue');
      c.hidden = false;
      c.href = `#/projects/${lastProject.id}`;
      c.innerHTML = `${icon('chevron', 'ico-sm')} Continue where you left off: <b>${esc(lastProject.name)}</b> · ${ago(lastProject.git.lastCommit.date)}`;
    }

    const stat = (id, k, ic, v, sub, bar) => { root.querySelector(`#st-${id}`).innerHTML = `<div class="k">${icon(ic)}${k}</div><div class="v">${v}</div><div class="s">${sub}</div>${bar !== undefined ? `<div class="bar"><i style="width:${bar}%"></i></div>` : ''}`; };
    stat('a', 'Today', 'target', fmtMin(f.todayMin), `${pct}% of your ${fmtMin(f.goalMin)} goal`, pct);
    stat('b', 'Streak', 'flame', `${f.streak}<small>days</small>`, f.longest ? `Best: ${f.longest} days` : 'Your first session starts it');
    if (withProjects) {
      const month = act ? Object.entries(act.commits.byDay).filter(([k]) => new Date(k) > Date.now() - 30 * 86400000).reduce((a, [, v]) => a + v, 0) : 0;
      stat('c', 'Projects', 'grid', projects.length, `${projects.filter((p) => p.status === 'active').length} active right now`);
      stat('d', 'Commits', 'commit', month, 'in the last 30 days');
    } else {
      stat('c', 'This week', 'calendar', fmtMin(f.weekMin || 0), `${f.sessions || 0} focus sessions in total`);
      stat('d', 'Library', 'music', lib.tracks.length, `songs · ${lib.videos.length} backgrounds`);
    }

    // Quick start: what's left to make HQ fully yours (disappears once done)
    const todo = [];
    const p = prov[s.ai.primary];
    if (on.has('ai') && p && !(p.chat && p.hasKey) && !s.ai.providers[s.ai.primary]?.mode) todo.push([`#/ai`, 'sparkles', `Try ${esc(p.name)}`, 'Open it with your account, or add an API key to chat here']);
    if (on.has('music') && !lib.tracks.length) todo.push(['#/music', 'music', 'Add your first songs', 'Search YouTube and press MP3']);
    if (on.has('focus') && !lib.videos.length) todo.push(['#/music?tab=backgrounds', 'video', 'Pick a Focus background', 'Any YouTube video becomes an HD loop']);
    if (on.has('projects') && !s.folders.projects.length) todo.push(['#/settings/folders', 'folder', 'Connect your projects folder', 'Every folder inside becomes a project']);
    const sc = root.querySelector('#start-card');
    if (todo.length) {
      sc.hidden = false;
      sc.innerHTML = `<h3 class="card-title">${icon('zap')}Quick start</h3><div class="choice-grid">${todo.map(([href, ic, t, d]) => `<a class="choice" href="${href}" style="text-decoration:none">${icon(ic)}<b>${t}</b><small>${d}</small></a>`).join('')}</div>`;
    }

    // year heatmap: deep work always; code + Claude Code sessions when there is data
    const kinds = [['focus', 'Deep work']];
    if (act && Object.keys(act.commits.byDay).length) kinds.unshift(['commits', 'Code']);
    if (act && Object.keys(act.claude || {}).length) kinds.push(['claude', 'Claude Code']);
    root.querySelector('#seg').innerHTML = kinds.map(([k, n], i) => `<button type="button" data-heat="${k}" aria-pressed="${i === 0}">${n}</button>`).join('');
    const heatEl = root.querySelector('#heat');
    const draw = (kind) => {
      const data = kind === 'commits' ? act?.commits.byDay : kind === 'claude' ? act?.claude : f.byDay;
      const unit = kind === 'commits' ? 'commits' : kind === 'claude' ? 'Claude Code sessions' : 'min of deep work';
      heatEl.innerHTML = heatmap(data || {}, { unit, fmt: (v) => (kind === 'focus' ? `${fmtMin(v)} of deep work` : `${v} ${unit}`) });
      root.querySelector('#heat-legend').innerHTML = heatLegend();
      const total = Object.values(data || {}).reduce((a, b) => a + b, 0);
      root.querySelector('#heat-sum').textContent = kind === 'focus' ? `${fmtMin(total)} total` : `${total} ${unit} on ${Object.keys(data || {}).length} days`;
      root.querySelectorAll('[data-heat]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.heat === kind));
    };
    root.querySelectorAll('[data-heat]').forEach((b) => b.addEventListener('click', () => draw(b.dataset.heat)));
    draw(kinds[0][0]);
    attachTips(heatEl);

    if (withProjects) {
      const feed = act?.commits.feed || [];
      root.querySelector('#feed').innerHTML = feed.slice(0, 8).map((c) => `<li>
          <span class="mark" style="background:${catColor(cat.categories, c.category)}"></span>
          <div><div class="t"><a href="#/projects/${esc(c.projectId)}/history">${esc(c.subject)}</a></div><div class="m">${esc(c.projectName)}</div></div>
          <span class="when">${ago(c.date)}</span></li>`).join('') || '<li class="dim">No commits yet. Projects that use Git show their history here.</li>';
      const att = [];
      for (const pr of projects) {
        if (pr.git?.dirty) att.push({ p: pr, w: pr.git.dirty * 2, t: `${pr.git.dirty} change${pr.git.dirty > 1 ? 's' : ''} not saved to git` });
        if (pr.git?.sync?.ahead) att.push({ p: pr, w: pr.git.sync.ahead * 3, t: `${pr.git.sync.ahead} commit${pr.git.sync.ahead > 1 ? 's' : ''} not on GitHub yet` });
      }
      att.sort((a, b) => b.w - a.w);
      root.querySelector('#attention').innerHTML = att.slice(0, 8).map(({ p: pr, t }) => `<li>
          <span class="mark" style="background:${catColor(cat.categories, pr.category)}"></span>
          <div><div class="t"><a href="#/projects/${esc(pr.id)}/changes">${esc(pr.name)}</a></div><div class="m">${esc(t)}</div></div>
          <span class="when">${ago(pr.lastActivity)}</span></li>`).join('') || '<li class="dim">All clean. Everything is saved.</li>';
    }

    const onSession = () => api('/api/focus/stats').then((fs) => { if (root.isConnected) stat('b', 'Streak', 'flame', `${fs.streak}<small>days</small>`, `Best: ${fs.longest} days`); }).catch(() => {});
    state.events.addEventListener('session', onSession);
    return () => state.events.removeEventListener('session', onSession);
  },
};
