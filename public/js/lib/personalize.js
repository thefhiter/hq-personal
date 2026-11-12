// Building blocks shared by the first-run wizard and Settings. Each one edits the owner's settings
// and saves immediately, so the whole app (colors, logo, sidebar) updates while they choose.
import { icon } from './icons.js';
import { api, esc, toast, debounce } from './ui.js';
import { PRESETS, MARKS, logoHtml, themeColors } from './theme.js';
import { state, saveSettings, pageLabel, loadProviders } from '../app.js';

const PAGE_ICON = { home: 'home', focus: 'flame', music: 'music', ai: 'sparkles', projects: 'grid', notes: 'memory', timeline: 'clock', settings: 'sliders' };
const PAGE_WHY = {
  home: 'Your day at a glance', focus: 'Deep-work timer over HD backgrounds', music: 'YouTube songs saved as MP3',
  ai: 'Chat with the AI you choose', projects: 'Your project folders and their history', notes: 'Notes and ideas',
  timeline: 'Everything you did, day by day', settings: 'Always available',
};
const S = () => state.settings;
const tick = () => `<span class="tick">${icon('check')}</span>`;
export const badge = (p) => `<span class="prov-badge" style="--c:${esc(p?.color || 'var(--ember)')}" aria-hidden="true">${esc((p?.name || '?').charAt(0))}</span>`;

async function save(patch, quiet = true) {
  try { const s = await saveSettings(patch); if (!quiet) toast('Saved', 'ok', 1400); return s; }
  catch (e) { toast(e.message, 'err'); throw e; }
}

// ---------- name ----------
export function mountProfile(el, { big = false } = {}) {
  const s = S();
  el.innerHTML = `<div class="stack">
    <div class="field"><label for="pf-name">Your name</label><input class="input ${big ? 'big-input' : ''}" id="pf-name" maxlength="40" autocomplete="given-name" placeholder="e.g. Sarah" value="${esc(s.profile.name)}"></div>
    <div class="field"><label for="pf-title">App name</label><input class="input" id="pf-title" maxlength="14" placeholder="HQ" value="${esc(s.profile.title)}"><span class="help">Shown big in the sidebar, the window title and the desktop shortcut. Keep it short: HQ, BASE, STUDIO, LAB…</span></div>
  </div>`;
  const push = debounce(() => save({ profile: { name: el.querySelector('#pf-name').value, title: el.querySelector('#pf-title').value } }), 350);
  el.querySelector('#pf-name').addEventListener('input', push);
  el.querySelector('#pf-title').addEventListener('input', push);
  return { focus: () => el.querySelector('#pf-name').focus() };
}

// ---------- theme ----------
export function mountTheme(el) {
  const draw = () => {
    const t = S().theme;
    const custom = t.preset === 'custom';
    el.innerHTML = `<div class="stack">
      <div class="label">Color theme</div>
      <div class="choice-grid" role="radiogroup" aria-label="Color theme">
        ${Object.entries(PRESETS).map(([id, p]) => `<button type="button" class="choice" role="radio" aria-checked="${t.preset === id}" data-preset="${id}">${tick()}
          <span class="swatch-bar" style="background:linear-gradient(135deg, ${p.light}, ${p.accent} 48%, ${p.deep})"></span><b>${p.name}</b></button>`).join('')}
        <button type="button" class="choice" role="radio" aria-checked="${custom}" data-preset="custom">${tick()}
          <span class="swatch-bar" style="background:${custom ? `linear-gradient(135deg, ${themeColors({ ...t, mode: 'dark' }).light}, ${t.accent} 48%, ${themeColors({ ...t, mode: 'dark' }).deep})` : 'conic-gradient(from 90deg, #FF5A4D, #FFD27A, #3DDC97, #5AB8FF, #A35BFF, #FF5A4D)'}"></span><b>Your color</b></button>
      </div>
      <div class="row" ${custom ? '' : 'hidden'} id="custom-row"><input type="color" class="color-input" id="accent" value="${esc(t.accent || '#FF7A1A')}" aria-label="Pick your color"><span class="help">Pick any color: HQ builds the whole palette from it.</span></div>
      <div class="label" style="margin-top:6px">Mode</div>
      <div class="mode-row" role="radiogroup" aria-label="Light or dark">
        ${[['dark', 'Dark', 'eye'], ['light', 'Light', 'sparkles'], ['system', 'Match Windows', 'cpu']].map(([id, n, ic]) => `<button type="button" class="choice" role="radio" aria-checked="${t.mode === id}" data-mode="${id}">${icon(ic, 'ico-sm')}<b>${n}</b></button>`).join('')}
      </div>
      <label class="row" style="justify-content:space-between;margin-top:6px"><span>Floating sparks in the background (dark mode)</span><span class="switch"><input type="checkbox" id="effects" ${t.effects ? 'checked' : ''}><span></span></span></label>
    </div>`;
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', async () => { await save({ theme: { preset: b.dataset.preset } }); draw(); }));
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => { await save({ theme: { mode: b.dataset.mode } }); draw(); }));
    const acc = el.querySelector('#accent');
    acc.addEventListener('input', debounce(() => save({ theme: { preset: 'custom', accent: acc.value } }), 120));
    acc.addEventListener('change', draw);
    el.querySelector('#effects').addEventListener('change', (e) => save({ theme: { effects: e.target.checked } }));
  };
  draw();
}

// ---------- logo ----------
export function mountLogo(el) {
  const draw = () => {
    const s = S();
    const t = s.theme;
    const opts = [...Object.keys(MARKS).map((id) => [id, MARKS[id].name]), ['initial', 'Initial']];
    el.innerHTML = `<div class="stack">
      <div class="logo-grid" role="radiogroup" aria-label="Logo">
        ${opts.map(([id, n]) => `<button type="button" class="choice" role="radio" aria-checked="${t.logo === id}" data-logo="${id}">${logoHtml({ ...t, logo: id }, s.profile.name, { size: 38 })}<small>${n}</small></button>`).join('')}
        ${t.logoFile ? `<button type="button" class="choice" role="radio" aria-checked="${t.logo === 'custom'}" data-logo="custom">${logoHtml({ ...t, logo: 'custom' }, s.profile.name, { size: 38 })}<small>Yours</small></button>` : ''}
      </div>
      <div class="row">
        <label class="btn btn-ghost btn-sm">${icon('upload', 'ico-sm')}Upload your own logo<input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" hidden></label>
        ${t.logoFile ? '<button type="button" class="btn btn-ghost btn-sm" id="logo-rm">Remove uploaded logo</button>' : ''}
        <span class="help">PNG, SVG, JPG or WEBP, square works best (under 2 MB).</span>
      </div>
    </div>`;
    el.querySelectorAll('[data-logo]').forEach((b) => b.addEventListener('click', async () => { await save({ theme: { logo: b.dataset.logo } }); draw(); }));
    el.querySelector('#logo-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 2_000_000) { toast('Keep the logo under 2 MB', 'err'); return; }
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      try { const s2 = await api('/api/brand/logo', { method: 'POST', body: { dataUrl } }); await saveSettings({ theme: { logo: s2.theme.logo } }); draw(); }
      catch (err) { toast(err.message, 'err'); }
    });
    el.querySelector('#logo-rm')?.addEventListener('click', async () => { const s2 = await api('/api/brand/logo', { method: 'POST', body: {} }); await saveSettings({ theme: { logo: s2.theme.logo } }); draw(); });
  };
  draw();
}

// ---------- sidebar pages ----------
export function mountPages(el) {
  const draw = () => {
    const nav = S().nav;
    el.innerHTML = `<ul class="page-rows">${nav.map((n, i) => `<li class="page-row ${n.on ? '' : 'off'}">
        <span class="switch" title="${n.id === 'settings' ? 'Settings always stays, so you can change things later' : 'Show in the sidebar'}"><input type="checkbox" data-on="${i}" ${n.on ? 'checked' : ''} ${n.id === 'settings' ? 'disabled' : ''} aria-label="Show ${esc(pageLabel(n.id))}"><span></span></span>
        ${icon(PAGE_ICON[n.id])}
        <span class="name">${esc(S().pages.find((p) => p.id === n.id)?.label || n.id)}<br><small class="dim" style="font-weight:400">${esc(PAGE_WHY[n.id])}</small></span>
        <input class="input" data-label="${i}" maxlength="24" placeholder="${esc(n.id === 'ai' ? pageLabel('ai', { ...S(), nav: [] }) : S().pages.find((p) => p.id === n.id)?.label || '')}" value="${esc(n.label)}" aria-label="Name for ${esc(n.id)}">
        <span class="moves"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('chevron', 'ico-sm up')}</button><button type="button" class="btn btn-ghost btn-icon btn-sm" data-down="${i}" ${i === nav.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 'ico-sm')}</button></span>
      </li>`).join('')}</ul>
      <p class="help">Untick a page to hide it. Type a new name to rename it. Use the arrows to change the order.</p>`;
    el.querySelectorAll('.up').forEach((x) => { x.style.transform = 'rotate(-90deg)'; });
  };
  const nav = () => S().nav.map((n) => ({ ...n }));
  el.addEventListener('change', async (e) => {
    const on = e.target.closest('[data-on]');
    if (!on) return;
    const n = nav(); n[on.dataset.on].on = on.checked;
    await save({ nav: n }); draw();
  });
  el.addEventListener('input', debounce(async (e) => {
    const lb = e.target.closest('[data-label]');
    if (!lb) return;
    const n = nav(); n[lb.dataset.label].label = lb.value;
    await save({ nav: n });
  }, 400));
  el.addEventListener('click', async (e) => {
    const up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]');
    if (!up && !down) return;
    const i = Number((up || down).dataset.up ?? (up || down).dataset.down);
    const j = up ? i - 1 : i + 1;
    const n = nav();
    [n[i], n[j]] = [n[j], n[i]];
    await save({ nav: n }); draw();
    el.querySelector(`[data-${up ? 'up' : 'down'}="${j}"]`)?.focus();
  });
  draw();
}

// ---------- custom sidebar links ----------
export function mountLinks(el) {
  const draw = () => {
    const links = S().links;
    el.innerHTML = `<div class="stack">
      ${links.map((l, i) => `<div class="link-row"><span><b>${esc(l.name)}</b></span><span class="mono dim" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.url)}</span><button type="button" class="btn btn-ghost btn-sm btn-icon" data-rm="${i}" aria-label="Remove ${esc(l.name)}">${icon('trash', 'ico-sm')}</button></div>`).join('') || '<p class="help" style="margin:0">No links yet.</p>'}
      <form class="link-row" id="link-add"><input class="input" id="ln-name" maxlength="24" placeholder="Name (e.g. Gmail)" aria-label="Link name"><input class="input" id="ln-url" type="url" placeholder="https://…" aria-label="Link address"><button class="btn btn-ghost btn-sm" type="submit">${icon('plus', 'ico-sm')}Add</button></form>
    </div>`;
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { await save({ links: S().links.filter((_, i) => i !== Number(b.dataset.rm)) }); draw(); }));
    el.querySelector('#link-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = el.querySelector('#ln-name').value.trim();
      let url = el.querySelector('#ln-url').value.trim();
      if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
      if (!name || !url) { toast('Give the link a name and an address', 'err'); return; }
      await save({ links: [...S().links, { name, url }] }); draw();
    });
  };
  draw();
}

// ---------- AI ----------
/** Grid to choose which AIs to use (and which one is the main one). */
export function mountAiChoice(el, { onChange } = {}) {
  const draw = async () => {
    const prov = await loadProviders();
    const ai = S().ai;
    el.innerHTML = `<div class="prov-grid" role="group" aria-label="Your AIs">${Object.values(prov).map((p) => `<button type="button" class="choice" aria-pressed="${ai.enabled.includes(p.id)}" data-prov="${p.id}">${tick()}
        <span class="prov-head">${badge(p)}<span><b>${esc(p.name)}</b><small>${esc(p.company || '')}</small></span></span>
        <small>${[p.web ? 'Account' : null, p.chat ? (p.noKey ? 'Free, offline' : 'API key') : null, p.cli ? 'Terminal app' : null].filter(Boolean).join(' · ')}</small>
        ${ai.primary === p.id ? '<span class="pill st-active" style="align-self:flex-start">Main</span>' : ''}</button>`).join('')}</div>
      <p class="help">Pick one or more. The first one you pick is your main AI: it gets its own page in the sidebar. Change it any time.</p>`;
    el.querySelectorAll('[data-prov]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.prov;
      let enabled = [...ai.enabled];
      let primary = ai.primary;
      if (enabled.includes(id)) {
        enabled = enabled.filter((x) => x !== id);
        if (!enabled.length) { toast('Keep at least one AI', 'err'); return; }
        if (primary === id) primary = enabled[0];
      } else {
        enabled.push(id);
        if (enabled.length === 1) primary = id;
      }
      await save({ ai: { enabled, primary } });
      draw(); onChange?.();
    }));
  };
  draw();
  return { redraw: draw };
}

/** One card per chosen AI: account (web), API key, terminal app, and which one the page opens. */
export function mountAiSetup(el, { compact = false } = {}) {
  let cli = null;
  const draw = async () => {
    const [prov, c] = await Promise.all([loadProviders(true), cli ? Promise.resolve(cli) : api('/api/ai/cli').catch(() => ({ clis: {} }))]);
    cli = c;
    const ai = S().ai;
    el.innerHTML = ai.enabled.map((id) => card(prov[id], ai, cli)).join('');
    for (const id of ai.enabled) bindCard(id, prov[id]);
  };
  function card(p, ai, c) {
    if (!p) return '';
    const own = ai.providers[p.id] || {};
    const ci = c.clis?.[p.id];
    const modes = [p.chat ? ['chat', 'Chat in HQ'] : null, p.cli ? ['cli', 'Terminal app'] : null, p.web || p.custom ? ['web', 'Its website'] : null].filter(Boolean);
    const mode = own.mode || (p.chat && p.hasKey ? 'chat' : p.web ? 'web' : 'chat');
    return `<section class="prov-card ${ai.primary === p.id ? 'primary' : ''}" data-card="${p.id}">
      <div class="row"><span class="prov-head">${badge(p)}<span><b>${esc(p.name)}</b><small class="dim">${esc(p.company || '')}</small></span></span><span class="spacer"></span>
        ${ai.primary === p.id ? '<span class="pill st-active">Main AI</span>' : `<button type="button" class="btn btn-ghost btn-sm" data-primary>${icon('star', 'ico-sm')}Make it my main AI</button>`}</div>
      ${p.custom ? `<div class="row"><div class="field" style="flex:1"><label>Name</label><input class="input" data-f="name" maxlength="24" value="${esc(own.name || '')}" placeholder="My AI"></div>
        <div class="field" style="flex:2"><label>API address (OpenAI-compatible)</label><input class="input" data-f="base" value="${esc(p.base || '')}" placeholder="https://…/v1"></div></div>
        <div class="field"><label>Website (optional)</label><input class="input" data-f="web" value="${esc(own.web || '')}" placeholder="https://…"></div>` : ''}
      ${p.id === 'ollama' ? `<div class="field"><label>Ollama address</label><input class="input" data-f="base" value="${esc(p.base || '')}" placeholder="http://127.0.0.1:11434/v1"><span class="help">Ollama runs AI models on this PC, free and offline. <a href="https://ollama.com/download" target="_blank" rel="noopener">Get Ollama</a></span></div>` : ''}
      <div class="prov-ways">
        ${p.web || p.custom ? `<div class="way"><h4>${icon('globe')}Your account</h4><p>Opens ${esc(p.name)}'s website in its own window, signed in with <b>your</b> account (free or paid plan).</p>
          <div class="row"><button type="button" class="btn btn-primary btn-sm" data-web ${p.web ? '' : 'disabled'}>${icon('external', 'ico-sm')}Open ${esc(p.name)}</button></div></div>` : ''}
        ${p.chat ? `<div class="way"><h4>${icon('message')}Chat in HQ</h4><p>${p.noKey ? 'Uses the models on this PC.' : `Paste an API key${p.keyUrl ? ` (<a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">get one</a>)` : ''}. Pay-as-you-go, billed by ${esc(p.company)}.`}</p>
          ${p.noKey ? '' : `<form class="key-row" data-keyform><input class="input" type="password" autocomplete="off" spellcheck="false" data-key placeholder="${p.hasKey ? `Saved ${esc(S().keys?.[p.id] || '')} — paste to replace` : esc(p.keyHint || 'API key')}" aria-label="${esc(p.name)} API key"><button class="btn btn-ghost btn-sm" type="submit">${p.hasKey ? 'Replace' : 'Save'}</button></form>`}
          <div class="state-line" data-state>${p.hasKey ? '<span class="dot"></span>Key saved' : '<span class="dot"></span>No key yet'}</div>
          <div class="field" data-model-wrap ${p.hasKey ? '' : 'hidden'}><label>Model</label><select class="input" data-model><option value="${esc(own.model || '')}">${esc(own.model || 'Best available (automatic)')}</option></select></div>
          <div class="row">${p.hasKey ? `<button type="button" class="btn btn-ghost btn-sm" data-test>${icon('check', 'ico-sm')}Test</button>` : ''}${p.hasKey && !p.noKey ? '<button type="button" class="btn btn-ghost btn-sm" data-forget>Remove key</button>' : ''}</div></div>` : ''}
        ${p.cli ? `<div class="way"><h4>${icon('terminal')}Terminal app</h4><p>${esc(ci?.cli || p.cli)}: ${esc(p.company)}'s official app. Sign in inside it with your account.</p>
          <div class="state-line ${ci?.installed ? 'ok' : ''}"><span class="dot"></span>${ci?.installed ? `Installed ${esc(ci.version || '')}` : 'Not installed'}</div>
          <div class="row">${ci?.installed ? `<a class="btn btn-ghost btn-sm" href="#/ai?provider=${p.id}&tab=cli">${icon('terminal', 'ico-sm')}Open</a>` : `<button type="button" class="btn btn-ghost btn-sm" data-install ${c.npm ? '' : 'disabled title="Node.js npm not found"'}>${icon('download', 'ico-sm')}Install</button>`}</div></div>` : ''}
      </div>
      ${modes.length > 1 && !compact ? `<div class="row"><span class="label">The ${esc(p.name)} page opens on</span>${modes.map(([m, n]) => `<button type="button" class="chip" data-mode="${m}" aria-pressed="${mode === m}">${n}</button>`).join('')}</div>` : ''}
    </section>`;
  }
  function bindCard(id, p) {
    const root = el.querySelector(`[data-card="${id}"]`);
    if (!root) return;
    const stateLine = root.querySelector('[data-state]');
    const setState = (cls, text) => { if (stateLine) { stateLine.className = `state-line ${cls}`; stateLine.innerHTML = `<span class="dot"></span>${esc(text)}`; } };
    const fillModels = (r) => {
      const sel = root.querySelector('[data-model]');
      if (!sel || !r?.models) return;
      const cur = S().ai.providers[id]?.model || '';
      sel.innerHTML = `<option value="">Best available (${esc(r.default || 'automatic')})</option>${r.models.map((m) => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('')}`;
      root.querySelector('[data-model-wrap]').hidden = false;
    };
    if (p.hasKey && p.chat) api(`/api/ai/models?provider=${id}`).then((r) => { fillModels(r); setState('ok', `Connected · ${r.models.length} models`); }).catch((e) => setState('err', e.message));
    root.querySelector('[data-primary]')?.addEventListener('click', async () => { await save({ ai: { primary: id } }); draw(); el.dispatchEvent(new Event('ai-change')); });
    root.querySelector('[data-web]')?.addEventListener('click', () => api('/api/ai/open-web', { method: 'POST', body: { provider: id } }).catch((e) => toast(e.message, 'err')));
    root.querySelector('[data-keyform]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = root.querySelector('[data-key]').value.trim();
      if (!key) return;
      setState('', 'Checking the key…');
      const r = await api('/api/ai/key', { method: 'POST', body: { provider: id, key } }).catch((err) => ({ ok: false, error: err.message }));
      await loadProviders(true);
      state.settings = await api('/api/settings');
      if (r.ok) { toast(`${p.name} connected`, 'ok'); if (!S().ai.providers[id]?.mode) await save({ ai: { providers: { [id]: { mode: 'chat' } } } }); draw(); }
      else setState('err', r.error || 'That key did not work');
    });
    root.querySelector('[data-test]')?.addEventListener('click', async () => {
      setState('', 'Testing…');
      const r = await api('/api/ai/test', { method: 'POST', body: { provider: id } }).catch((err) => ({ ok: false, error: err.message }));
      if (r.ok) { setState('ok', `Works · ${r.models.length} models`); fillModels(r); } else setState('err', r.error);
    });
    root.querySelector('[data-forget]')?.addEventListener('click', async () => { await api('/api/ai/key', { method: 'POST', body: { provider: id, key: '' } }); await loadProviders(true); state.settings = await api('/api/settings'); draw(); });
    root.querySelector('[data-model]')?.addEventListener('change', (e) => save({ ai: { providers: { [id]: { model: e.target.value } } } }, false));
    root.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('change', async () => { await save({ ai: { providers: { [id]: { [inp.dataset.f]: inp.value.trim() } } } }); await loadProviders(true); draw(); }));
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => { await save({ ai: { providers: { [id]: { mode: b.dataset.mode } } } }, false); draw(); }));
    root.querySelector('[data-install]')?.addEventListener('click', () => { location.hash = `#/ai?provider=${id}&tab=cli&install=1`; });
  }
  draw();
  return { redraw: () => { cli = null; return draw(); } };
}

export function mountSystemPrompt(el) {
  const s = S();
  el.innerHTML = `<div class="field"><label for="sys">About you (sent to your AI at the start of every chat)</label>
    <textarea class="input" id="sys" rows="4" maxlength="4000" placeholder="e.g. I'm a design student in Tunis. Answer in French unless I write in English. Keep answers short.">${esc(s.ai.system)}</textarea>
    <span class="help">Optional. Applies to chats inside HQ, not to the websites or terminal apps.</span></div>
    <div class="field" style="margin-top:12px"><label for="browser">Open AI websites in</label><select class="input" id="browser" style="max-width:280px">
      ${[['auto', 'Chrome, or Edge if Chrome is missing'], ['chrome', 'Google Chrome'], ['edge', 'Microsoft Edge'], ['default', 'My default browser (normal tab)']].map(([v, n]) => `<option value="${v}" ${s.ai.browser === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`;
  el.querySelector('#sys').addEventListener('input', debounce((e) => save({ ai: { system: e.target.value } }), 500));
  el.querySelector('#browser').addEventListener('change', (e) => save({ ai: { browser: e.target.value } }, false));
}

// ---------- YouTube ----------
export function mountYouTube(el) {
  const draw = async () => {
    const lib = await api('/api/library').catch(() => ({ account: false }));
    const lists = S().youtube.playlists;
    el.innerHTML = `<div class="stack">
      ${lib.account ? `<div class="row"><span class="big-dot on"></span><b>Your YouTube account is connected</b><span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="yt-off">Disconnect</button></div>
        <p class="muted" style="margin:0">Your liked videos, watch later and private playlists can now be opened in Music.</p>`
      : `<p class="muted" style="margin:0">Public videos and playlists already work without this. Connect your account to also open your <b>liked videos</b>, <b>watch later</b> and <b>private playlists</b>.</p>
        <ol class="steps">
          <li>In Chrome or Edge, add the free extension <a href="https://chromewebstore.google.com/search/Get%20cookies.txt%20LOCALLY" target="_blank" rel="noopener">Get cookies.txt LOCALLY</a>.</li>
          <li>Open <a href="https://www.youtube.com" target="_blank" rel="noopener">youtube.com</a> signed in, click the extension, and press <b>Export</b>.</li>
          <li>Drop the downloaded <span class="mono">cookies.txt</span> file here.</li>
        </ol>
        <label class="drop" id="yt-drop">${icon('upload')}<span>Drop cookies.txt here, or click to choose it</span><input type="file" id="yt-file" accept=".txt,text/plain" hidden></label>
        <p class="help" style="margin:0">The file stays on this PC and is only used to download from YouTube. Disconnect any time.</p>`}
      <div class="label" style="margin-top:8px">Your playlists (one click in Music)</div>
      ${lists.map((l, i) => `<div class="link-row"><b>${esc(l.name)}</b><span class="mono dim" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.url)}</span><button type="button" class="btn btn-ghost btn-sm btn-icon" data-rm="${i}" aria-label="Remove ${esc(l.name)}">${icon('trash', 'ico-sm')}</button></div>`).join('')}
      <form class="link-row" id="pl-add"><input class="input" id="pl-name" maxlength="60" placeholder="Name (e.g. Workout)" aria-label="Playlist name"><input class="input" id="pl-url" placeholder="https://www.youtube.com/playlist?list=…" aria-label="Playlist link"><button class="btn btn-ghost btn-sm" type="submit">${icon('plus', 'ico-sm')}Add</button></form>
    </div>`;
    el.querySelector('#yt-off')?.addEventListener('click', async () => { await api('/api/youtube/account', { method: 'DELETE' }); draw(); });
    const input = el.querySelector('#yt-file');
    if (input) {
      const upload = async (file) => {
        if (!file) return;
        try { await api('/api/youtube/account', { method: 'POST', body: { cookies: await file.text() } }); toast('YouTube connected', 'ok'); draw(); }
        catch (e) { toast(e.message, 'err'); }
      };
      input.addEventListener('change', () => upload(input.files[0]));
      const drop = el.querySelector('#yt-drop');
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); });
    }
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { await save({ youtube: { playlists: lists.filter((_, i) => i !== Number(b.dataset.rm)) } }); draw(); }));
    el.querySelector('#pl-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = el.querySelector('#pl-name').value.trim() || 'Playlist';
      const url = el.querySelector('#pl-url').value.trim();
      if (!/youtu\.?be/.test(url)) { toast('Paste a YouTube playlist or video link', 'err'); return; }
      await save({ youtube: { playlists: [...lists, { name, url }] } }); draw();
    });
  };
  draw();
}

// ---------- folders ----------
export function mountFolders(el, { kind }) {
  const key = kind === 'projects' ? 'projects' : 'notes';
  const draw = () => {
    const list = S().folders[key];
    el.innerHTML = `<div class="stack">
      ${list.length ? `<ul class="folder-list">${list.map((d, i) => `<li>${icon('folder', 'ico-sm')}<span class="path" title="${esc(d)}">${esc(d)}</span><button type="button" class="btn btn-ghost btn-sm btn-icon" data-rm="${i}" aria-label="Remove folder">${icon('x', 'ico-sm')}</button></li>`).join('')}</ul>` : `<p class="help" style="margin:0">${kind === 'projects' ? 'No folder yet. Every folder inside the one you pick becomes a project.' : 'No folder yet. “My notes” (built in) is always there; add an Obsidian vault or any folder of .md notes.'}</p>`}
      <form class="folder-add"><button type="button" class="btn btn-primary btn-sm" data-browse>${icon('folder', 'ico-sm')}Choose a folder…</button><input class="input" data-path placeholder="or type a path, e.g. ~/Documents/Projects" aria-label="Folder path"><button class="btn btn-ghost btn-sm" type="submit">Add</button></form>
      <div class="state-line" data-msg></div>
    </div>`;
    const msg = (cls, t) => { const m = el.querySelector('[data-msg]'); m.className = `state-line ${cls}`; m.innerHTML = t ? `<span class="dot"></span>${esc(t)}` : ''; };
    const add = async (p) => {
      if (!p) return;
      const r = await api('/api/check-folder', { method: 'POST', body: { path: p } }).catch(() => ({ exists: false }));
      if (!r.exists) { msg('err', 'That folder does not exist'); return; }
      await save({ folders: { [key]: [...S().folders[key], r.path] } });
      draw();
      msg('ok', kind === 'projects' ? `Added · ${r.folders} project folder${r.folders === 1 ? '' : 's'} inside` : 'Added');
    };
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { await save({ folders: { [key]: S().folders[key].filter((_, i) => i !== Number(b.dataset.rm)) } }); draw(); }));
    el.querySelector('[data-browse]').addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      msg('', 'A folder window opened (it may be behind this one)…');
      try { const r = await api('/api/pick-folder', { method: 'POST', body: {} }); if (r.path) await add(r.path); else msg('', ''); }
      catch (err) { msg('err', err.message); } finally { if (btn.isConnected) btn.disabled = false; }
    });
    el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); add(el.querySelector('[data-path]').value.trim()); });
  };
  draw();
}

// ---------- helper programs ----------
export function mountTools(el, { onlyRequired = false } = {}) {
  let data = null;
  const draw = () => {
    const tools = data.tools.filter((t) => !onlyRequired || t.required);
    el.innerHTML = `<ul class="tool-list">${tools.map((t) => {
      const busy = t.job?.status === 'working';
      const cls = t.installed ? 'ok' : t.required ? '' : 'opt';
      const action = t.id === 'node' ? '' : busy ? `<span class="dim num">${t.job.phase === 'unpacking' ? 'Unpacking…' : `${t.job.progress || 0}%`}</span>`
        : ['yt-dlp', 'ffmpeg'].includes(t.id) ? (data.canInstall ? `<button type="button" class="btn ${t.installed ? 'btn-ghost' : 'btn-primary'} btn-sm" data-install="${t.id}">${icon(t.installed ? 'refresh' : 'download', 'ico-sm')}${t.installed ? 'Update' : 'Install'}</button>` : '')
        : !t.installed && t.url ? `<a class="btn btn-ghost btn-sm" href="${esc(t.url)}" target="_blank" rel="noopener">${icon('external', 'ico-sm')}Get it</a>` : '';
      return `<li class="tool-row ${cls}"><span class="dot"></span><span><b>${esc(t.name)} ${t.installed ? `<span class="dim num" style="font-weight:400">${esc(String(t.version || '').slice(0, 30))}</span>` : `<span class="pill ${t.required ? 'warn-pill' : ''}">${t.required ? 'needed' : 'optional'}</span>`}</b><small>${esc(t.why)}${t.job?.status === 'error' ? ` — <span style="color:var(--err)">${esc(t.job.error)}</span>` : ''}</small></span>${action}
        ${busy ? `<span class="bar"><i style="transform:scaleX(${(t.job.progress || 0) / 100})"></i></span>` : ''}</li>`;
    }).join('')}</ul>`;
    el.querySelectorAll('[data-install]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const j = await api(`/api/tools/${b.dataset.install}/install`, { method: 'POST' }); data.tools.find((t) => t.id === b.dataset.install).job = j; draw(); }
      catch (e) { toast(e.message, 'err'); b.disabled = false; }
    }));
  };
  const load = async () => { data = await api('/api/tools').catch(() => ({ tools: [] })); if (el.isConnected) draw(); };
  const onJob = (e) => {
    if (!data || !el.isConnected) return;
    const t = data.tools.find((x) => x.id === e.detail.id);
    if (!t) return;
    t.job = e.detail;
    if (e.detail.status === 'done') { toast(`${t.name} is ready`, 'ok'); load(); } else draw();
  };
  state.events.addEventListener('tools:job', onJob);
  load();
  return () => state.events.removeEventListener('tools:job', onJob);
}
