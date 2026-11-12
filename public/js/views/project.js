import { icon, CATEGORY_ICON } from '../lib/icons.js';
import { api, esc, ago, fmtDate, bytes, statusPill, renderDiff, catalog, catColor, catName, toast } from '../lib/ui.js';
import { markdown } from '../lib/md.js';
import { highlight, langOf } from '../lib/hl.js';
import { setTitle, state, pageLabel } from '../app.js';

const TABS = [
  ['overview', 'Overview', 'eye'],
  ['history', 'History', 'commit'],
  ['changes', 'Changes', 'file'],
  ['files', 'Files', 'folder'],
  ['sessions', 'Claude Code', 'sparkles'],
];

const wikiTarget = (name) => `#/notes?find=${encodeURIComponent(name)}`;

function bindWikilinks(el) {
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a.wikilink');
    if (!a) return;
    e.preventDefault();
    location.hash = wikiTarget(a.dataset.wikilink);
  });
}

async function overview(el, p) {
  const notes = p.notes || [];
  const imgs = p.images || [];
  el.innerHTML = `<div class="two-col">
    <div class="stack">
      ${notes.length ? notes.map((n) => `<article class="card"><div class="note-src">${icon(n.source === 'memory' ? 'memory' : 'book')}<span class="label">${n.source === 'memory' ? 'Claude memory' : 'Obsidian'}</span><span class="mono dim">${esc(n.name)}</span></div><div class="md">${markdown(n.content.replace(/^---[\s\S]*?---\s*/, ''))}</div></article>`).join('') : ''}
      ${p.readme ? `<article class="card"><div class="note-src">${icon('file')}<span class="label">${esc(p.readme.name)}</span></div><div class="md">${markdown(p.readme.content, { resolveImage: (src) => (/^https?:/.test(src) ? src : `/api/projects/${encodeURIComponent(p.id)}/raw?path=${encodeURIComponent(src.replace(/^\.\//, ''))}`) })}</div></article>` : ''}
      ${!notes.length && !p.readme ? `<div class="card empty">${icon('book')}<div>No notes or README yet for this project.</div></div>` : ''}
    </div>
    <aside class="stack">
      <section class="card"><h3 class="card-title">${icon('pin')}Facts</h3><dl class="kv">
        <dt>Category</dt><dd>${esc(catName(p.categories, p.category))}</dd>
        <dt>Started</dt><dd>${fmtDate(p.started)}</dd>
        <dt>Last activity</dt><dd>${ago(p.lastActivity)}</dd>
        ${p.git ? `<dt>Branch</dt><dd class="mono">${esc(p.git.branch || '—')}</dd><dt>Commits</dt><dd>${p.git.commits}</dd><dt>Uncommitted</dt><dd>${p.git.dirty}</dd>` : '<dt>Git</dt><dd>not a repository</dd>'}
        ${p.git?.sync ? `<dt>Sync</dt><dd>${p.git.sync.ahead} ahead · ${p.git.sync.behind} behind</dd>` : ''}
        ${p.port ? `<dt>Dev port</dt><dd class="mono">${p.port}</dd>` : ''}
        <dt>Folder</dt><dd class="mono">${esc((p.absPath || '—').replace(/^C:\\Users\\[^\\]+/i, '~'))}</dd>
        ${p.tags?.length ? `<dt>Tags</dt><dd>${p.tags.map((t) => `<span class="pill" style="margin:0 4px 4px 0">${esc(t)}</span>`).join('')}</dd>` : ''}
      </dl></section>
      ${imgs.length ? `<section class="card"><h3 class="card-title">${icon('image')}Screens</h3><div class="stack">${imgs.map((src) => `<a href="/api/projects/${encodeURIComponent(p.id)}/raw?path=${encodeURIComponent(src)}" target="_blank" rel="noopener"><img src="/api/projects/${encodeURIComponent(p.id)}/raw?path=${encodeURIComponent(src)}" alt="${esc(src.split('/').pop())}" loading="lazy" style="border-radius:10px;width:100%;aspect-ratio:16/10;object-fit:cover"></a>`).join('')}</div></section>` : ''}
    </aside>
  </div>`;
  bindWikilinks(el);
}

async function history(el, p) {
  el.innerHTML = '<div class="card"><div class="skeleton" style="height:300px"></div></div>';
  const { repo, commits } = await api(`/api/projects/${encodeURIComponent(p.id)}/log`);
  if (!repo) { el.innerHTML = `<div class="card empty">${icon('branch')}<div>This folder isn't a git repository, so there's no history to show.</div></div>`; return; }
  let lastDay = '';
  el.innerHTML = `<div class="card"><h3 class="card-title">${icon('commit')}${commits.length} commits<span class="spacer"></span><span class="dim" style="text-transform:none;letter-spacing:0">click a commit to see exactly what changed</span></h3><ul class="commits">${commits.map((c) => {
    const d = fmtDate(c.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const head = d !== lastDay ? `<li class="label" style="padding:16px 6px 4px">${d}</li>` : '';
    lastDay = d;
    return `${head}<li class="commit"><button type="button" data-hash="${c.hash}" aria-expanded="false"><span class="node"></span><span><span class="subj">${esc(c.subject)}</span><span class="sub"><span class="mono">${c.short}</span><span>${new Date(c.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span><span>${c.files} file${c.files === 1 ? '' : 's'}</span><span class="plus">+${c.insertions}</span><span class="minus">−${c.deletions}</span></span></span>${icon('down', 'ico-sm')}</button><div class="detail" hidden></div></li>`;
  }).join('')}</ul></div>`;
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-hash]');
    if (!b) return;
    const detail = b.nextElementSibling;
    const open = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', String(!open));
    detail.hidden = open;
    if (open || detail.dataset.loaded) return;
    detail.innerHTML = '<div class="skeleton" style="height:120px"></div>';
    try {
      const c = await api(`/api/projects/${encodeURIComponent(p.id)}/commit/${b.dataset.hash}`);
      detail.dataset.loaded = '1';
      detail.innerHTML = `${c.body ? `<div class="md" style="margin-bottom:12px">${markdown(c.body)}</div>` : ''}${renderDiff(c.diff, { open: 4 })}`;
    } catch (err) { detail.innerHTML = `<div class="dim">${esc(err.message)}</div>`; }
  });
}

async function changes(el, p) {
  el.innerHTML = '<div class="card"><div class="skeleton" style="height:220px"></div></div>';
  const w = await api(`/api/projects/${encodeURIComponent(p.id)}/working`);
  if (w.notRepo) { el.innerHTML = `<div class="card empty">${icon('branch')}<div>Not a git repository.</div></div>`; return; }
  const codes = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '??': 'new', '?': 'new' };
  el.innerHTML = `<div class="stack">
    <div class="card"><h3 class="card-title">${icon('file')}${w.files.length} uncommitted file${w.files.length === 1 ? '' : 's'}<span class="spacer"></span><button class="link" id="refresh" type="button">Refresh</button></h3>
      ${w.files.length ? `<ul class="feed">${w.files.slice(0, 200).map((f) => `<li><span class="mark" style="background:${f.code.includes('D') ? 'var(--err)' : f.code.includes('?') || f.code.includes('A') ? 'var(--ok)' : 'var(--warn)'}"></span><div class="t mono">${esc(f.path)}</div><span class="when">${codes[f.code] || codes[f.code[0]] || f.code}</span></li>`).join('')}</ul>` : `<div class="empty">${icon('check')}<div>Working tree is clean — everything is committed.</div></div>`}
    </div>
    ${w.diff ? `<div>${renderDiff(w.diff, { open: 6 })}</div>` : ''}
  </div>`;
  el.querySelector('#refresh')?.addEventListener('click', () => changes(el, p));
}

async function files(el, p, initial) {
  el.innerHTML = `<div class="files"><nav class="card tree" aria-label="Files"><ul id="root"></ul></nav><section class="card" id="viewer"><div class="empty">${icon('file')}<div>Pick a file to read it.</div></div></section></div>`;
  const rootUl = el.querySelector('#root');
  const viewer = el.querySelector('#viewer');
  const base = `/api/projects/${encodeURIComponent(p.id)}`;

  async function fill(ul, rel) {
    ul.innerHTML = '<li class="dim" style="padding:6px 8px">…</li>';
    try {
      const items = await api(`${base}/tree?path=${encodeURIComponent(rel)}`);
      ul.innerHTML = items.map((it) => `<li class="${it.dir ? 'dir' : 'file'}"><button type="button" data-path="${esc(it.path)}" data-dir="${it.dir ? 1 : 0}"${it.dir ? ' aria-expanded="false"' : ''}>${icon(it.dir ? 'folder' : 'file')}<span>${esc(it.name)}</span>${it.dir ? (it.heavy ? '<span class="size">heavy</span>' : '') : `<span class="size">${bytes(it.size)}</span>`}</button>${it.dir ? '<ul hidden></ul>' : ''}</li>`).join('') || '<li class="dim" style="padding:6px 8px">empty</li>';
    } catch (e) { ul.innerHTML = `<li class="dim">${esc(e.message)}</li>`; }
  }

  async function open(path) {
    el.querySelectorAll('.tree button[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
    el.querySelector(`.tree button[data-path="${CSS.escape(path)}"]`)?.setAttribute('aria-current', 'true');
    viewer.innerHTML = '<div class="skeleton" style="height:300px"></div>';
    try {
      const f = await api(`${base}/file?path=${encodeURIComponent(path)}`);
      const crumbs = `<div class="crumbs">${path.split('/').map(esc).join(' <span>/</span> ')}<span class="spacer"></span>${bytes(f.size)} · ${ago(f.mtime)}</div>`;
      const hist = f.history?.length ? `<details style="margin-top:14px"><summary class="label" style="cursor:pointer">File history (${f.history.length})</summary><ul class="feed">${f.history.map((h) => `<li><span class="mark" style="background:var(--ember)"></span><div class="t">${esc(h.subject)}</div><span class="when mono">${h.short} · ${ago(h.date)}</span></li>`).join('')}</ul></details>` : '';
      let bodyHtml;
      if (f.kind === 'image') bodyHtml = `<img src="${base}/raw?path=${encodeURIComponent(path)}" alt="${esc(path)}" style="max-height:70vh;border-radius:12px">`;
      else if (f.kind === 'binary') bodyHtml = `<div class="empty">${icon('box')}<div>Binary file — open it in its own app.</div></div>`;
      else if (/\.md$/i.test(path)) bodyHtml = `<div class="md">${markdown(f.content, { resolveImage: (src) => (/^https?:/.test(src) ? src : `${base}/raw?path=${encodeURIComponent(path.split('/').slice(0, -1).concat(src.replace(/^\.\//, '')).join('/'))}`) })}</div>`;
      else {
        const lines = highlight(f.content, langOf(path)).split('\n');
        bodyHtml = `<pre class="code"><code>${lines.map((l, i) => `<span class="ln">${i + 1}</span>${l}`).join('\n')}</code></pre>${f.truncated ? '<p class="dim">Showing the first 512 KB.</p>' : ''}`;
      }
      viewer.innerHTML = crumbs + bodyHtml + hist;
      if (/\.md$/i.test(path)) bindWikilinks(viewer);
      window.history.replaceState(null, '', `#/projects/${encodeURIComponent(p.id)}/files?path=${encodeURIComponent(path)}`);
    } catch (e) { viewer.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`; }
  }

  el.querySelector('.tree').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-path]');
    if (!b) return;
    if (b.dataset.dir === '1') {
      const ul = b.nextElementSibling;
      const expanded = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!expanded));
      ul.hidden = expanded;
      if (!expanded && !ul.dataset.loaded) { ul.dataset.loaded = '1'; await fill(ul, b.dataset.path); }
    } else open(b.dataset.path);
  });
  await fill(rootUl, '');
  const start = initial || ['README.md', 'readme.md', 'HANDOFF.md'].find((n) => el.querySelector(`.tree button[data-path="${n}"]`));
  if (start) open(start);
}

async function sessions(el, p) {
  el.innerHTML = '<div class="card"><div class="skeleton" style="height:200px"></div></div>';
  const list = await api(`/api/projects/${encodeURIComponent(p.id)}/sessions`);
  el.innerHTML = `<div class="card"><h3 class="card-title">${icon('sparkles')}${list.length} Claude Code session${list.length === 1 ? '' : 's'} touched this project</h3>
    ${list.length ? `<ul class="feed">${list.map((s) => `<li><span class="mark" style="background:var(--ember)"></span><div><div class="t">${esc(s.title || (s.firstPrompt || 'Session').slice(0, 90))}</div>
      <div class="m">${fmtDate(s.first, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${s.prompts} prompts · ${s.files.length} files edited</div>
      ${s.files.length ? `<details><summary class="dim" style="cursor:pointer;font-size:13px">Files changed in this session</summary><div class="stack" style="gap:2px;margin-top:6px">${s.files.slice(0, 40).map((f) => `<span class="mono dim">${esc(f.path)} <span style="color:var(--ember-2)">×${f.edits}</span></span>`).join('')}</div></details>` : ''}
      ${s.firstPrompt ? `<div class="m" style="margin-top:6px;font-style:italic">“${esc(s.firstPrompt.slice(0, 220))}”</div>` : ''}</div><span class="when">${ago(s.last)}</span></li>`).join('')}</ul>` : `<div class="empty">${icon('sparkles')}<div>No indexed sessions edited files in this folder yet.</div></div>`}</div>`;
}

/** Rename, describe, recategorize or hide a project (saved as HQ overrides; the folder is not touched). */
export function editDialog(p, done) {
  const d = document.createElement('div');
  d.className = 'dialog';
  d.innerHTML = `<form class="dialog-box" role="dialog" aria-modal="true" aria-labelledby="ed-h">
    <h3 id="ed-h">Edit project</h3>
    <div class="field"><label for="ep-name">Name</label><input class="input" id="ep-name" maxlength="60" value="${esc(p.name)}"></div>
    <div class="field"><label for="ep-tag">Description</label><textarea class="input" id="ep-tag" rows="2" maxlength="240">${esc(p.tagline || '')}</textarea></div>
    <div class="row"><div class="field" style="flex:1"><label for="ep-cat">Category</label><select class="input" id="ep-cat">${(p.categories || []).map((c) => `<option value="${c.id}" ${c.id === p.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field" style="flex:1"><label for="ep-st">Status</label><select class="input" id="ep-st">${(p.statuses || ['active', 'paused', 'shipped', 'live', 'prototype', 'reference']).map((x) => `<option value="${x}" ${x === p.status ? 'selected' : ''}>${x === 'shipped' ? 'Done' : x.replace(/^\w/, (c) => c.toUpperCase())}</option>`).join('')}</select></div></div>
    <div class="field"><label for="ep-live">Website (optional)</label><input class="input" id="ep-live" type="url" value="${esc(p.live || '')}" placeholder="https://…"></div>
    <label class="row" style="gap:8px"><input type="checkbox" id="ep-hide" ${p.hidden ? 'checked' : ''}> Hide this project</label>
    <div class="row"><button class="btn btn-primary" type="submit">${icon('save')}Save</button><button class="btn btn-ghost" type="button" id="ep-x">Cancel</button><span class="help">The folder itself is never changed.</span></div>
  </form>`;
  document.body.append(d);
  const close = () => { d.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  d.querySelector('#ep-x').addEventListener('click', close);
  d.querySelector('#ep-name').focus();
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/projects/${encodeURIComponent(p.id)}`, { method: 'POST', body: { name: d.querySelector('#ep-name').value, tagline: d.querySelector('#ep-tag').value, category: d.querySelector('#ep-cat').value, status: d.querySelector('#ep-st').value, live: d.querySelector('#ep-live').value, hidden: d.querySelector('#ep-hide').checked } });
      catalog(true);
      close();
      toast('Saved', 'ok', 1200);
      done?.();
    } catch (err) { toast(err.message, 'err'); }
  });
}

export default {
  async render(root, params, query) {
    root.innerHTML = '<div><div class="card p-head"><div class="skeleton" style="height:180px"></div></div></div>';
    let p;
    try {
      const [detail, cat] = await Promise.all([api(`/api/projects/${encodeURIComponent(params.id)}`), catalog()]);
      p = { ...detail, categories: cat.categories };
    } catch (e) {
      root.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div><a class="btn btn-ghost" href="#/projects">Back to projects</a></div>`;
      return;
    }
    if (!root.isConnected) return;
    setTitle(p.name);
    const color = catColor(p.categories, p.category);
    const tab = TABS.find((t) => t[0] === params.tab) ? params.tab : 'overview';
    root.innerHTML = `<div>
      <header class="card p-head">
        <div class="glow" style="background:${color}"></div>
        <div class="row"><a href="#/projects" class="dim" style="text-decoration:none">${icon('chevron', 'ico-sm')}</a><span class="eyebrow" style="color:${color}">${icon(CATEGORY_ICON[p.category] || 'sparkles', 'ico-sm')} ${esc(catName(p.categories, p.category))}</span>${statusPill(p.status)}${!p.backedUp ? '<span class="pill err-pill">local only</span>' : ''}</div>
        <h2>${esc(p.name)}</h2>
        <p class="tag">${esc(p.tagline || '')}</p>
        <div class="row">
          ${p.exists ? `<button class="btn btn-primary btn-sm" data-open="code" type="button">${icon('code')}Open in VS Code</button><button class="btn btn-ghost btn-sm" data-open="explorer" type="button">${icon('folder')}Folder</button>` : ''}
          ${state.providers?.[state.settings.ai.primary]?.cli ? `<a class="btn btn-ghost btn-sm" href="#/ai?provider=${state.settings.ai.primary}&tab=cli&project=${encodeURIComponent(p.id)}">${icon('terminal')}${esc(state.providers[state.settings.ai.primary].name)} in this folder</a>` : ''}
          <button class="btn btn-ghost btn-sm" id="edit-p" type="button">${icon('sliders')}Edit</button>
          <button class="btn btn-ghost btn-sm" id="focus-on" type="button">${icon('flame')}Focus on it</button>
          ${p.repo || p.git?.remote ? `<a class="btn btn-ghost btn-sm" href="${esc(p.repo || p.git.remote)}" target="_blank" rel="noopener">${icon('github')}GitHub</a>` : ''}
          ${p.live ? `<a class="btn btn-ghost btn-sm" href="${esc(p.live)}" target="_blank" rel="noopener">${icon('globe')}Live site</a>` : ''}
          ${p.port ? `<a class="btn btn-ghost btn-sm" href="http://localhost:${p.port}" target="_blank" rel="noopener">${icon('external')}localhost:${p.port}</a>` : ''}
        </div>
        <div class="p-facts">
          <div><b>${p.git?.commits ?? '—'}</b><span>commits</span></div>
          <div><b>${p.git?.dirty ?? '—'}</b><span>uncommitted</span></div>
          <div><b>${fmtDate(p.started, { month: 'short', year: 'numeric' })}</b><span>started</span></div>
          <div><b>${ago(p.lastActivity)}</b><span>last activity</span></div>
        </div>
      </header>
      <nav class="tabs" aria-label="Project sections">${TABS.map(([id, label, ic]) => `<a href="#/projects/${encodeURIComponent(p.id)}/${id}" ${id === tab ? 'aria-current="page"' : ''}>${icon(ic, 'ico-sm')}${label}${id === 'changes' && p.git?.dirty ? `<span class="count">${p.git.dirty}</span>` : ''}${id === 'history' && p.git ? `<span class="count">${p.git.commits}</span>` : ''}</a>`).join('')}</nav>
      <div id="tab"></div>
    </div>`;
    root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/api/open', { method: 'POST', body: { id: p.id, target: b.dataset.open } }); toast(b.dataset.open === 'code' ? `Opening ${p.name} in VS Code` : 'Opening the folder', 'ok'); } catch (e) { toast(e.message, 'err'); }
    }));
    root.querySelector('#focus-on').addEventListener('click', async () => {
      await api('/api/timer', { method: 'POST', body: { action: 'label', label: p.name, projectId: p.id } });
      location.hash = '#/focus';
    });
    root.querySelector('#edit-p').addEventListener('click', () => editDialog(p, () => this.render(root, params, query)));
    const el = root.querySelector('#tab');
    try {
      if (tab === 'overview') await overview(el, p);
      else if (tab === 'history') await history(el, p);
      else if (tab === 'changes') await changes(el, p);
      else if (tab === 'files') await files(el, p, query.get('path'));
      else await sessions(el, p);
    } catch (e) {
      el.innerHTML = `<div class="card empty">${icon('alert')}<div>${esc(e.message)}</div></div>`;
    }
  },
};
