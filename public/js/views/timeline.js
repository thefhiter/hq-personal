import { icon, CATEGORY_ICON } from '../lib/icons.js';
import { api, esc, fmtDate, fmtMin, catalog, catColor } from '../lib/ui.js';
import { setTitle, pageLabel } from '../app.js';

const KINDS = [['starts', 'Project births', 'sparkles'], ['commits', 'Commits', 'commit'], ['sessions', 'Claude Code sessions', 'message'], ['focus', 'Deep work', 'flame']];

export default {
  async render(root) {
    setTitle(pageLabel('timeline'));
    root.innerHTML = `<div>
      <div class="toolbar" style="max-width:1000px;margin:0 auto 6px">
        <div class="chips" id="kinds" role="group" aria-label="Show">${KINDS.map(([k, l, ic]) => `<button class="chip" type="button" data-kind="${k}" aria-pressed="true">${icon(ic, 'ico-sm')}${l}</button>`).join('')}</div>
        <span class="spacer"></span><span class="dim" id="tl-sum"></span>
      </div>
      <div class="tl" id="tl"><p class="dim">Reading the history of your projects and focus blocks… (the first load after a restart takes a few seconds)</p><div class="skeleton" style="height:420px"></div></div>
    </div>`;
    const [tl, cat] = await Promise.all([api('/api/timeline'), catalog()]);
    if (!root.isConnected) return;
    const on = new Set(KINDS.map((k) => k[0]));
    const el = root.querySelector('#tl');
    root.querySelector('#tl-sum').textContent = tl.first ? `${tl.days.length} active days since ${fmtDate(tl.first, { month: 'long', year: 'numeric' })}` : '';
    if (!tl.days.length) { root.querySelector('#tl').innerHTML = `<div class="empty">${icon('clock')}<div><b>Your story starts today.</b><br>Focus sessions, project births and Git commits will appear here, day by day.</div><a class="btn btn-primary" href="#/focus">${icon('flame')}Start a focus block</a></div>`; return; }

    function draw() {
      let month = '';
      let html = '';
      let shown = 0;
      for (const d of tl.days) {
        const items = [];
        if (on.has('milestones')) for (const m of d.milestones) items.push(`<div class="tl-item milestone">${icon('trophy')}<span>${esc(m)}</span></div>`);
        if (on.has('starts')) for (const s of d.starts) items.push(`<div class="tl-item"><span style="color:${catColor(cat.categories, s.category)}">${icon(CATEGORY_ICON[s.category] || 'sparkles')}</span><div><a href="#/projects/${esc(s.id)}">${esc(s.name)}</a> is born<div class="sub">${esc(s.tagline || '')}</div></div></div>`);
        if (on.has('commits')) for (const c of d.commits) items.push(`<div class="tl-item">${icon('commit')}<div><a href="#/projects/${esc(c.projectId)}/history">${esc(c.name)}</a> · ${c.count} commit${c.count > 1 ? 's' : ''}<div class="sub">${c.items.slice(0, 3).map((x) => esc(x.subject)).join(' · ')}${c.count > 3 ? ' …' : ''}</div></div></div>`);
        if (on.has('sessions') && d.sessions.length) items.push(`<div class="tl-item">${icon('message')}<div>${d.sessions.length} session${d.sessions.length > 1 ? 's' : ''} with Claude<div class="sub">${d.sessions.slice(0, 4).map((s) => esc(s.title || 'untitled')).join(' · ')}</div></div></div>`);
        if (on.has('focus') && d.focusMin) items.push(`<div class="tl-item">${icon('flame')}<div>${fmtMin(d.focusMin)} of deep work</div></div>`);
        if (!items.length) continue;
        shown++;
        const m = fmtDate(d.date, { month: 'long', year: 'numeric' });
        if (m !== month) { month = m; html += `<h2 class="tl-month">${esc(m)}</h2>`; }
        const big = d.milestones.length || d.starts.length || d.commits.reduce((a, c) => a + c.count, 0) >= 10;
        html += `<section class="tl-day${big ? ' big' : ''}"><div class="tl-date">${fmtDate(d.date, { weekday: 'long', day: 'numeric', month: 'short' })}</div><div class="card" style="padding:14px 16px"><div class="tl-items">${items.join('')}</div></div></section>`;
      }
      el.innerHTML = html || `<div class="empty">${icon('clock')}<div>Nothing to show with these filters.</div></div>`;
      if (shown) el.insertAdjacentHTML('beforeend', `<section class="tl-day big"><div class="tl-date">The beginning</div><div class="card" style="padding:14px 16px"><div class="tl-item">${icon('flame')}<span>Every fire starts with a spark. This is where yours did.</span></div></div></section>`);
    }
    root.querySelector('#kinds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      on.has(b.dataset.kind) ? on.delete(b.dataset.kind) : on.add(b.dataset.kind);
      b.setAttribute('aria-pressed', on.has(b.dataset.kind));
      draw();
    });
    draw();
  },
};
