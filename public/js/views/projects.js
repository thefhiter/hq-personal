import { icon, CATEGORY_ICON } from '../lib/icons.js';
import { esc, ago, catalog, catColor, statusPill, debounce } from '../lib/ui.js';
import { setTitle, state, pageLabel } from '../app.js';
import { api } from '../lib/ui.js';

const SORTS = {
  recent: (a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''),
  name: (a, b) => a.name.localeCompare(b.name),
  commits: (a, b) => (b.git?.commits || 0) - (a.git?.commits || 0),
  started: (a, b) => (a.started || '9').localeCompare(b.started || '9'),
};

function card(p, cats) {
  const color = catColor(cats, p.category);
  const flags = [];
  if (p.git?.dirty) flags.push(`<span class="pill warn-pill" title="Uncommitted changes">${p.git.dirty} changed</span>`);
  if (p.git?.sync?.ahead) flags.push(`<span class="pill warn-pill" title="Commits not pushed">${p.git.sync.ahead} unpushed</span>`);
  if (p.git && !p.backedUp) flags.push('<span class="pill" title="This Git repository has no remote backup">local only</span>');
  if (!p.exists) flags.push('<span class="pill">folder missing</span>');
  return `<a class="card proj-card" href="#/projects/${esc(p.id)}">
    <span class="accent" style="background:linear-gradient(90deg, ${color}, transparent)"></span>
    <div class="row"><span class="cat" style="color:${color}">${icon(CATEGORY_ICON[p.category] || 'sparkles', 'ico-sm')}</span>${statusPill(p.status)}${flags.join('')}</div>
    <h3>${esc(p.name)}</h3>
    <p>${esc(p.tagline || '')}</p>
    <div class="meta">
      ${p.git ? `<span title="Commits">${icon('commit')}${p.git.commits}</span>` : ''}
      <span title="Last activity">${icon('clock')}${ago(p.lastActivity)}</span>
      ${p.port ? `<span title="Dev server port" class="mono">:${p.port}</span>` : ''}
      ${p.github ? `<span title="GitHub (${esc(p.github.visibility.toLowerCase())})">${icon('github')}${p.github.visibility === 'PRIVATE' ? 'private' : 'public'}</span>` : ''}
      ${p.live ? `<span title="Live site">${icon('globe')}live</span>` : ''}
    </div>
  </a>`;
}

export default {
  async render(root, params, query) {
    setTitle(pageLabel('projects'));
    if (!state.settings.folders.projects.length) {
      root.innerHTML = `<div class="ai-center" style="height:auto;padding-top:6vh"><div class="card">
        <h2 style="margin:0;font:800 34px/1 var(--font-display);text-transform:uppercase">Your <span class="grad-text">projects</span></h2>
        <p class="muted" style="margin:0">Choose the folder where you keep your work. Every folder inside it becomes a project card with its files, and its full history if it uses Git.</p>
        <div class="row"><button class="btn btn-primary" type="button" id="pick">${icon('folder')}Choose my projects folder…</button><a class="btn btn-ghost" href="#/settings/folders">Type a path instead</a></div>
        <div class="state-line" id="pick-msg"></div></div></div>`;
      root.querySelector('#pick').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        root.querySelector('#pick-msg').innerHTML = '<span class="dot"></span>A folder window opened (it may be behind this one)…';
        const r = await api('/api/pick-folder', { method: 'POST', body: {} }).catch(() => ({}));
        if (r.path) { const { saveSettings } = await import('../app.js'); await saveSettings({ folders: { projects: [r.path] } }); catalog(true); this.render(root, params, query); }
        else { root.querySelector('#pick').disabled = false; root.querySelector('#pick-msg').innerHTML = ''; }
      });
      return;
    }
    root.innerHTML = `<div>
      <div class="toolbar">
        <input class="input" id="q" type="search" placeholder="Filter by name, tag or description…" aria-label="Filter projects" value="${esc(query.get('q') || '')}">
        <select class="input" id="sort" aria-label="Sort" style="max-width:200px">
          <option value="recent">Recently active</option><option value="started">First started</option><option value="commits">Most commits</option><option value="name">Name</option>
        </select>
        <button class="chip" id="attn" type="button" aria-pressed="false">${icon('alert', 'ico-sm')}Needs attention</button>
        <span class="spacer"></span><span class="dim" id="count"></span>
      </div>
      <div class="chips" id="cats" role="group" aria-label="Categories" style="margin-bottom:6px"></div>
      <div id="list"><div class="proj-grid">${'<div class="card skeleton" style="height:196px"></div>'.repeat(9)}</div></div>
    </div>`;
    const { projects, categories } = await catalog();
    if (!root.isConnected) return;
    let cat = query.get('cat') || 'all';
    let attn = false;
    const catsEl = root.querySelector('#cats');
    catsEl.innerHTML = [{ id: 'all', name: 'All', color: 'var(--ember)' }, ...categories.filter((c) => projects.some((p) => p.category === c.id))].map((c) => {
      const n = c.id === 'all' ? projects.length : projects.filter((p) => p.category === c.id).length;
      return `<button class="chip" type="button" data-cat="${c.id}" aria-pressed="${c.id === cat}">${c.id !== 'all' ? `<span class="swatch" style="background:${c.color}"></span>` : ''}${esc(c.name)}<span class="count">${n}</span></button>`;
    }).join('');

    const draw = () => {
      const q = root.querySelector('#q').value.trim().toLowerCase();
      const sort = root.querySelector('#sort').value;
      let list = projects.filter((p) => (cat === 'all' || p.category === cat)
        && (!q || [p.name, p.tagline, p.id, ...(p.tags || [])].join(' ').toLowerCase().includes(q))
        && (!attn || p.git?.dirty || p.git?.sync?.ahead || !p.backedUp));
      list = list.sort(SORTS[sort]);
      root.querySelector('#count').textContent = `${list.length} of ${projects.length}`;
      const el = root.querySelector('#list');
      if (!list.length) { el.innerHTML = `<div class="empty">${icon('search')}<div>No project matches.</div></div>`; return; }
      if (cat === 'all' && !q && sort === 'recent' && !attn) {
        el.innerHTML = categories.map((c) => {
          const items = list.filter((p) => p.category === c.id);
          if (!items.length) return '';
          return `<div class="cat-section"><span style="color:${c.color}">${icon(CATEGORY_ICON[c.id] || 'sparkles')}</span><h2>${esc(c.name)}</h2><span class="dim">${items.length}</span><span class="line"></span></div><div class="proj-grid stagger">${items.map((p) => card(p, categories)).join('')}</div>`;
        }).join('');
      } else {
        el.innerHTML = `<div class="proj-grid stagger">${list.map((p) => card(p, categories)).join('')}</div>`;
      }
    };
    catsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      cat = b.dataset.cat;
      catsEl.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.cat === cat));
      draw();
    });
    root.querySelector('#attn').addEventListener('click', (e) => { attn = !attn; e.currentTarget.setAttribute('aria-pressed', attn); draw(); });
    root.querySelector('#q').addEventListener('input', debounce(draw, 120));
    root.querySelector('#sort').addEventListener('change', draw);
    draw();
  },
};
