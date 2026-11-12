import { icon } from '../lib/icons.js';
import { api, esc, ago, debounce, toast } from '../lib/ui.js';
import { markdown } from '../lib/md.js';
import { setTitle, pageLabel } from '../app.js';
import { resolveColor } from '../lib/theme.js';

const TYPE_NAME = { feedback: 'Rules & feedback', project: 'Projects', user: 'About you', reference: 'Reference', null: 'Other' };
// One color per notes folder (first = the theme accent), so the graph shows where notes live.
const SRC_COLORS = ['--ember', '#5AB8FF', '#3DDC97', '#C49BFF', '#FFB547', '#F06AAE', '#5FD4D0', '#A9B1BB'];
let palette = new Map();
function buildPalette(sources) {
  palette = new Map(sources.map((s, i) => { const c = SRC_COLORS[i % SRC_COLORS.length]; return [s.id, c.startsWith('--') ? resolveColor(c) : c]; }));
}
const colorOf = (n) => palette.get(n.id.split(':')[0]) || '#A9B1BB';

function graph(canvas, idx, onOpen) {
  const ctx = canvas.getContext('2d');
  const theme = { accent: resolveColor('--ember'), fg: resolveColor('--fg'), muted: resolveColor('--muted') };
  const nodes = idx.notes.map((n) => ({ ...n, x: Math.random() * 600 - 300, y: Math.random() * 400 - 200, vx: 0, vy: 0, deg: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = idx.edges.map(([a, b]) => [byId.get(a), byId.get(b)]).filter(([a, b]) => a && b);
  for (const [a, b] of edges) { a.deg++; b.deg++; }
  let w, h, dpr, view = { x: 0, y: 0, k: 1 }, alpha = 1, hover = null, drag = null, raf = 0;
  const resize = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    draw();
  };
  const r = (n) => 4 + Math.sqrt(n.deg) * 2.4;
  function step() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const f = (1600 / d2) * alpha;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 70) * 0.012 * alpha;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
      if (n === drag?.node) continue;
      n.x += (n.vx *= 0.82); n.y += (n.vy *= 0.82);
    }
    alpha = Math.max(0.02, alpha * 0.985);
  }
  const toScreen = (n) => [(n.x * view.k + view.x) + w / 2, (n.y * view.k + view.y) + h / 2];
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const linked = hover ? new Set(edges.filter(([a, b]) => a === hover || b === hover).flatMap(([a, b]) => [a.id, b.id])) : null;
    ctx.lineWidth = 1;
    for (const [a, b] of edges) {
      const on = hover && (a === hover || b === hover);
      ctx.strokeStyle = on ? `${theme.accent}C0` : hover ? `${theme.accent}10` : `${theme.accent}2A`;
      const [x1, y1] = toScreen(a); const [x2, y2] = toScreen(b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (const n of nodes) {
      const [x, y] = toScreen(n);
      const rad = r(n) * Math.sqrt(view.k);
      const dim = linked && !linked.has(n.id);
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.shadowColor = colorOf(n); ctx.shadowBlur = n === hover ? 18 : 8;
      ctx.fillStyle = colorOf(n);
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (n === hover || n.deg >= 8 || (linked && linked.has(n.id)) || view.k > 1.6) {
        ctx.font = `${n === hover ? 600 : 500} ${n === hover ? 14 : 12}px Barlow, sans-serif`;
        ctx.fillStyle = n === hover ? theme.fg : theme.muted;
        ctx.fillText(n.title.length > 34 ? n.title.slice(0, 33) + '…' : n.title, x + rad + 5, y + 4);
      }
      ctx.globalAlpha = 1;
    }
  }
  function loop() { step(); draw(); raf = alpha > 0.03 || drag ? requestAnimationFrame(loop) : 0; }
  const kick = (a = 0.3) => { alpha = Math.max(alpha, a); if (!raf) raf = requestAnimationFrame(loop); };
  const pick = (mx, my) => {
    let best = null, bd = Infinity;
    for (const n of nodes) { const [x, y] = toScreen(n); const d = Math.hypot(x - mx, y - my); if (d < r(n) * Math.sqrt(view.k) + 6 && d < bd) { bd = d; best = n; } }
    return best;
  };
  const pos = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    const [mx, my] = pos(e);
    const n = pick(mx, my);
    drag = { node: n, sx: mx, sy: my, vx: view.x, vy: view.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const [mx, my] = pos(e);
    if (drag) {
      if (Math.hypot(mx - drag.sx, my - drag.sy) > 4) drag.moved = true;
      if (drag.node) { drag.node.x = (mx - w / 2 - view.x) / view.k; drag.node.y = (my - h / 2 - view.y) / view.k; kick(0.15); }
      else { view.x = drag.vx + mx - drag.sx; view.y = drag.vy + my - drag.sy; draw(); }
      return;
    }
    const n = pick(mx, my);
    if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; draw(); }
  });
  canvas.addEventListener('pointerup', () => {
    if (drag && !drag.moved && drag.node) onOpen(drag.node.id);
    drag = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [mx, my] = pos(e);
    const k = Math.min(4, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    const cx = mx - w / 2, cy = my - h / 2;
    view.x = cx - ((cx - view.x) * k) / view.k; view.y = cy - ((cy - view.y) * k) / view.k; view.k = k;
    draw();
  }, { passive: false });
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  for (let i = 0; i < 160; i++) step();
  kick(0.5);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

export default {
  async render(root, params, query) {
    setTitle(pageLabel('notes'));
    root.innerHTML = `<div class="vault">
      <aside class="vault-side card" style="padding:14px">
        <div class="row"><input class="input" id="vq" type="search" placeholder="Search your notes…" aria-label="Search notes" style="flex:1"><button class="btn btn-primary btn-sm" id="new-note" type="button">${icon('plus', 'ico-sm')}New</button></div>
        <div class="row">
          <span class="seg" role="group" aria-label="Source" id="srcs"></span>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="graph-btn" type="button" aria-pressed="false">${icon('graph', 'ico-sm')}Graph</button>
        </div>
        <ul class="note-list" id="notes"><li><div class="skeleton" style="height:300px"></div></li></ul>
      </aside>
      <section id="reader"></section>
    </div>`;
    let idx = await api('/api/vault');
    if (!root.isConnected) return;
    buildPalette(idx.sources);
    let src = 'all', currentId = null, stopGraph = null, hits = null;
    const list = root.querySelector('#notes');
    const reader = root.querySelector('#reader');

    function drawSources() {
      const shown = idx.sources.filter((s) => idx.notes.some((n) => n.id.startsWith(`${s.id}:`)) || s.id === 'mine');
      root.querySelector('#srcs').innerHTML = shown.length > 1 ? [['all', 'All'], ...shown.map((s) => [s.id, s.name])].map(([id, n]) => `<button type="button" data-src="${esc(id)}" aria-pressed="${src === id}">${esc(n)}</button>`).join('') : '';
    }

    function drawList() {
      if (hits) {
        list.innerHTML = hits.length ? hits.map((h) => `<li><button type="button" data-id="${esc(h.id)}" ${h.id === currentId ? 'aria-current="true"' : ''}><span class="nt">${esc(h.title)}</span><span class="nd">${esc(h.snippet)}</span></button></li>`).join('') : '<li class="help" style="padding:10px">No match.</li>';
        return;
      }
      const notes = idx.notes.filter((n) => src === 'all' || n.id.startsWith(`${src}:`));
      if (!notes.length) { list.innerHTML = `<li class="help" style="padding:10px">No notes yet. Press <b>New</b> to write one${idx.sources.length < 2 ? ', or connect an Obsidian vault in <a href="#/settings/folders">Settings</a>' : ''}.</li>`; return; }
      const groups = new Map();
      for (const n of notes) {
        const g = n.source === 'memory' ? `Claude memory · ${TYPE_NAME[n.type] || 'Other'}` : `${n.sourceName}${n.folder ? ` · ${n.folder}` : ''}`;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(n);
      }
      list.innerHTML = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([g, ns]) => `<li class="note-group">${esc(g)} · ${ns.length}</li>${ns.map((n) => `<li><button type="button" data-id="${esc(n.id)}" ${n.id === currentId ? 'aria-current="true"' : ''}><span class="nt"><span style="width:8px;height:8px;border-radius:50%;flex:none;background:${colorOf(n)}"></span>${esc(n.title)}</span><span class="nd">${esc(n.description || '')}</span></button></li>`).join('')}`).join('');
    }

    function showGraph() {
      stopGraph?.();
      currentId = null;
      setTitle(pageLabel('notes'));
      drawList();
      root.querySelector('#graph-btn').setAttribute('aria-pressed', 'true');
      if (!idx.notes.length) {
        reader.innerHTML = `<div class="card empty">${icon('book')}<div><b>Your notes live here.</b><br>Write ideas, plans and lists. Links like <span class="mono">[[Another note]]</span> connect them into a graph.</div><button class="btn btn-primary" type="button" id="first-note">${icon('plus')}Write your first note</button></div>`;
        reader.querySelector('#first-note').addEventListener('click', () => editor());
        return;
      }
      reader.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><canvas class="graph" id="graph" aria-label="Graph of ${idx.notes.length} notes and ${idx.edges.length} links. Click a node to open it."></canvas></div>
        <div class="row" style="margin-top:10px;font-size:13px;color:var(--dim)">${idx.sources.filter((s) => idx.notes.some((n) => n.id.startsWith(`${s.id}:`))).map((s) => `<span class="row" style="gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${palette.get(s.id)}"></i>${esc(s.name)}</span>`).join('')}<span class="spacer"></span><span>${idx.notes.length} notes · ${idx.edges.length} links · drag, scroll to zoom</span></div>`;
      stopGraph = graph(reader.querySelector('#graph'), idx, (id) => { location.hash = `#/notes/${encodeURIComponent(id)}`; });
    }

    function editor(note) {
      stopGraph?.(); stopGraph = null;
      const folders = idx.sources.filter((s) => s.kind === 'folder');
      reader.innerHTML = `<form class="card stack" id="ed" style="padding:24px">
        ${note ? `<div class="note-src">${icon('book')}<span class="label">Editing</span><span class="mono dim">${esc(note.path)}</span></div>` : `<div class="row"><div class="field" style="flex:2"><label for="ed-title">Title</label><input class="input" id="ed-title" maxlength="80" placeholder="My idea" required></div>
          ${folders.length > 1 ? `<div class="field" style="flex:1"><label for="ed-folder">Save in</label><select class="input" id="ed-folder">${folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></div>` : ''}</div>`}
        <div class="field"><label for="ed-text">Note (Markdown)</label><textarea class="input note-editor" id="ed-text" placeholder="# Heading&#10;&#10;Write anything. **bold**, - lists, [[links to other notes]]">${esc(note?.raw || '')}</textarea></div>
        <div class="row"><button class="btn btn-primary" type="submit">${icon('save')}Save</button><button class="btn btn-ghost" type="button" id="ed-cancel">Cancel</button><span class="help"><kbd>Ctrl</kbd>+<kbd>S</kbd> saves</span></div>
      </form>`;
      const form = reader.querySelector('#ed');
      (reader.querySelector('#ed-title') || reader.querySelector('#ed-text')).focus();
      const saveIt = async () => {
        try {
          const r = await api('/api/vault/note', { method: 'POST', body: note ? { id: note.id, text: form.querySelector('#ed-text').value } : { title: form.querySelector('#ed-title').value, folderId: form.querySelector('#ed-folder')?.value, text: form.querySelector('#ed-text').value } });
          idx = await api('/api/vault');
          buildPalette(idx.sources); drawSources();
          toast('Saved', 'ok', 1200);
          if (location.hash === `#/notes/${encodeURIComponent(r.id)}`) openNote(r.id); else location.hash = `#/notes/${encodeURIComponent(r.id)}`;
        } catch (e) { toast(e.message, 'err'); }
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); saveIt(); });
      form.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveIt(); } });
      form.querySelector('#ed-cancel').addEventListener('click', () => (note ? openNote(note.id) : showGraph()));
    }

    async function openNote(id) {
      stopGraph?.(); stopGraph = null;
      root.querySelector('#graph-btn').setAttribute('aria-pressed', 'false');
      currentId = id;
      drawList();
      reader.innerHTML = '<div class="card"><div class="skeleton" style="height:320px"></div></div>';
      try {
        const n = await api(`/api/vault/note?id=${encodeURIComponent(id)}`);
        const info = idx.notes.find((x) => x.id === id);
        setTitle(info?.title || pageLabel('notes'));
        reader.innerHTML = `<article class="card" style="padding:28px 32px">
          <div class="note-src">${icon(n.source === 'memory' ? 'memory' : 'book')}<span class="label">${n.source === 'memory' ? `Claude memory${n.meta.type ? ' · ' + esc(n.meta.type) : ''}` : esc(n.sourceName)}</span><span class="spacer"></span><span class="dim" style="font-size:13px">updated ${ago(info?.modified)}</span>
            ${n.source !== 'memory' ? `<button class="btn btn-ghost btn-sm" type="button" id="edit">${icon('file', 'ico-sm')}Edit</button>` : ''}</div>
          <h2 style="margin:0 0 6px;font:800 40px/1 var(--font-display);text-transform:uppercase;overflow-wrap:anywhere">${esc(info?.title || n.path)}</h2>
          ${n.meta.description ? `<p class="muted" style="margin:0 0 18px;font-size:17px">${esc(n.meta.description)}</p>` : ''}
          <div class="md">${markdown(n.body)}</div>
          ${n.backlinks.length ? `<hr class="hr"><div class="label" style="margin-bottom:10px">Linked from</div><div class="backlinks">${n.backlinks.map((b) => `<a class="chip" href="#/notes/${encodeURIComponent(b.id)}">${esc(b.title)}</a>`).join('')}</div>` : ''}
        </article>`;
        reader.querySelector('#edit')?.addEventListener('click', () => editor(n));
        reader.querySelector('.md').addEventListener('click', (e) => {
          const a = e.target.closest('a.wikilink');
          if (!a) return;
          e.preventDefault();
          resolve(a.dataset.wikilink);
        });
      } catch (e) {
        reader.innerHTML = `<div class="card empty">${icon('alert')}<div>${esc(e.message)}</div></div>`;
      }
    }

    function resolve(name) {
      const key = name.toLowerCase().replace(/\.(md|canvas)$/, '');
      const n = idx.notes.find((x) => x.title.toLowerCase() === key || x.path.toLowerCase().replace(/\.md$/, '') === key || x.path.split('/').pop().toLowerCase().replace(/\.md$/, '') === key);
      if (n) location.hash = `#/notes/${encodeURIComponent(n.id)}`;
      else reader.insertAdjacentHTML('afterbegin', `<div class="pill warn-pill" style="margin-bottom:10px">No note called “${esc(name)}” yet</div>`);
    }

    list.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) location.hash = `#/notes/${encodeURIComponent(b.dataset.id)}`; });
    root.querySelector('#srcs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-src]');
      if (!b) return;
      src = b.dataset.src;
      root.querySelectorAll('[data-src]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.src === src));
      drawList();
    });
    root.querySelector('#vq').addEventListener('input', debounce(async (e) => {
      const q = e.target.value.trim();
      hits = q.length >= 2 ? await api(`/api/vault/search?q=${encodeURIComponent(q)}`) : null;
      drawList();
    }, 220));
    root.querySelector('#graph-btn').addEventListener('click', () => { if (location.hash === '#/notes') showGraph(); else location.hash = '#/notes'; });
    root.querySelector('#new-note').addEventListener('click', () => editor());

    const route = (p, q) => {
      if (q?.get('new') === '1') return editor();
      if (q?.get('find')) return resolve(q.get('find'));
      if (p.id) return openNote(p.id);
      showGraph();
    };
    drawSources();
    drawList();
    route(params, query);
    return { update: route, cleanup: () => stopGraph?.() };
  },
};
