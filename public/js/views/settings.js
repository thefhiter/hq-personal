// Settings: the owner controls everything here. Changes save as they're made.
import { icon } from '../lib/icons.js';
import { api, esc, toast } from '../lib/ui.js';
import { setTitle, state, saveSettings, applySettings, loadProviders, appTitle, pageLabel } from '../app.js';
import { mountProfile, mountTheme, mountLogo, mountPages, mountLinks, mountAiChoice, mountAiSetup, mountSystemPrompt, mountYouTube, mountFolders, mountTools } from '../lib/personalize.js';

const SECTIONS = [
  ['you', 'You', 'flame'], ['look', 'Look', 'sparkles'], ['pages', 'Sidebar', 'list'], ['ai', 'AI', 'bot'], ['youtube', 'Music & YouTube', 'youtube'],
  ['folders', 'Projects & notes', 'folder'], ['focus', 'Focus', 'target'], ['tools', 'Helper programs', 'wrench'], ['data', 'Your data', 'save'], ['about', 'Shortcuts & about', 'zap'],
];

export default {
  async render(root, params) {
    setTitle(pageLabel('settings'));
    const s = state.settings;
    const card = (id, title, ic, inner) => `<section class="card" id="sec-${id}" data-sec="${id}"><h3 class="card-title">${icon(ic)}${title}</h3>${inner}</section>`;
    root.innerHTML = `<div class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">${SECTIONS.map(([id, n, ic]) => `<a href="#/settings/${id}" data-go="${id}">${icon(ic, 'ico-sm')}${n}</a>`).join('')}</nav>
      <div class="settings-body">
        ${card('you', 'You', 'flame', '<div id="m-profile"></div>')}
        ${card('look', 'Look', 'sparkles', '<div id="m-theme"></div><hr class="hr"><div class="label" style="margin-bottom:10px">Logo</div><div id="m-logo"></div>')}
        ${card('pages', 'Sidebar pages', 'list', '<div id="m-pages"></div><hr class="hr"><div class="label" style="margin-bottom:10px">Extra links in the sidebar</div><div id="m-links"></div>')}
        ${card('ai', 'AI assistants', 'bot', '<div id="m-ai-choice"></div><div class="stack" id="m-ai-setup" style="margin-top:14px"></div><hr class="hr"><div id="m-sys"></div>')}
        ${card('youtube', 'Music & YouTube', 'youtube', '<div id="m-yt"></div>')}
        ${card('folders', 'Projects & notes', 'folder', `<div class="label" style="margin-bottom:10px">Projects folders</div><div id="m-pf"></div><hr class="hr">
          <div class="label" style="margin-bottom:10px">Notes folders</div><div id="m-nf"></div>
          <label class="row" style="justify-content:space-between;margin-top:14px"><span>Also show Claude Code's memory files in Notes</span><span class="switch"><input type="checkbox" id="mem" ${s.folders.claudeMemory ? 'checked' : ''}><span></span></span></label>
          <div class="field" style="margin-top:14px"><label for="gh">GitHub account to match projects with (optional)</label><input class="input" id="gh" style="max-width:280px" value="${esc(s.github.user)}" placeholder="the GitHub CLI's signed-in account"><span class="help">Needs the GitHub CLI (<span class="mono">gh auth login</span>). Shows which projects are backed up.</span></div>`)}
        ${card('focus', 'Focus', 'target', `<div class="stack">
          <div class="field"><label for="goal">Daily deep-work goal (minutes)</label><input class="input" id="goal" type="number" min="15" max="960" step="15" value="${s.focus.dailyGoalMin}" style="max-width:200px"></div>
          <label class="row" style="justify-content:space-between"><span>Chime when a session ends</span><span class="switch"><input type="checkbox" id="chime" ${s.focus.chime ? 'checked' : ''}><span></span></span></label>
          <p class="help" style="margin:0">Backgrounds for the Focus Room come from Music → Backgrounds: search YouTube and press <b>Background</b>.</p></div>`)}
        ${card('tools', 'Helper programs', 'wrench', '<p class="muted">HQ checks these on this PC. The two it needs for music and backgrounds install with one click (no admin rights needed).</p><div id="m-tools"></div>')}
        ${card('data', 'Your data', 'save', `<p class="muted">Everything personal is stored on this PC in <span class="mono">${esc(s.dataDir)}</span> — settings, API keys, chats, music and backgrounds. Updating HQ never touches it.</p>
          <div class="row"><button class="btn btn-ghost btn-sm" type="button" id="open-data">${icon('folder', 'ico-sm')}Open the folder</button>
          <a class="btn btn-ghost btn-sm" href="/api/settings/export" download>${icon('download', 'ico-sm')}Export my setup</a>
          <label class="btn btn-ghost btn-sm">${icon('upload', 'ico-sm')}Import a setup<input type="file" id="import" accept="application/json,.json" hidden></label>
          <a class="btn btn-ghost btn-sm" href="#/welcome">${icon('refresh', 'ico-sm')}Run the setup again</a></div>
          <p class="help">Export saves your choices (not your API keys or music) to a file you can import on another PC.</p>
          <div id="sc" class="stack" style="margin-top:12px"></div>
          <div class="card danger-zone" style="margin-top:12px;box-shadow:none"><b>Start over</b><p class="muted" style="margin:6px 0 12px">Resets name, look, pages and AI choices to the defaults. Your music, backgrounds, notes and chats stay.</p>
            <div class="row"><label class="row" style="gap:8px"><input type="checkbox" id="rm-keys"> Also forget my API keys</label><span class="spacer"></span><button class="btn btn-danger btn-sm" type="button" id="reset">Reset settings</button></div></div>`)}
        ${card('about', 'Shortcuts & about', 'zap', `<dl class="kv">
          <dt><kbd>Ctrl</kbd> <kbd>K</kbd></dt><dd>Search everything</dd>
          <dt><kbd>Space</kbd></dt><dd>Focus: start / pause</dd>
          <dt><kbd>R</kbd> · <kbd>S</kbd></dt><dd>Reset · skip</dd>
          <dt><kbd>F</kbd> · <kbd>B</kbd></dt><dd>Fullscreen · choose background</dd>
          <dt><kbd>N</kbd> · <kbd>V</kbd></dt><dd>Next clip · pause background</dd>
          <dt>Media keys</dt><dd>Play, pause and skip your music</dd>
          <dt>Version</dt><dd>${esc(appTitle())} · Personal Edition ${esc(s.version)}</dd>
        </dl>`)}
      </div>
    </div>`;
    const $ = (q) => root.querySelector(q);

    mountProfile($('#m-profile'));
    mountTheme($('#m-theme'));
    mountLogo($('#m-logo'));
    mountPages($('#m-pages'));
    mountLinks($('#m-links'));
    const setup = mountAiSetup($('#m-ai-setup'));
    mountAiChoice($('#m-ai-choice'), { onChange: () => setup.redraw() });
    $('#m-ai-setup').addEventListener('ai-change', () => mountAiChoice($('#m-ai-choice'), { onChange: () => setup.redraw() }));
    mountSystemPrompt($('#m-sys'));
    mountYouTube($('#m-yt'));
    mountFolders($('#m-pf'), { kind: 'projects' });
    mountFolders($('#m-nf'), { kind: 'notes' });
    const stopTools = mountTools($('#m-tools'));

    (async () => {
      const box = $('#sc');
      const st = await api('/api/shortcuts').catch(() => ({ supported: false }));
      if (!st.supported || !box) return;
      box.innerHTML = `<div class="label">Shortcuts</div>
        <label class="row" style="justify-content:space-between"><span>${esc(appTitle())} on the Desktop</span><span class="switch"><input type="checkbox" id="sc-d" ${st.desktop ? 'checked' : ''}><span></span></span></label>
        <label class="row" style="justify-content:space-between"><span>${esc(appTitle())} in the Start menu</span><span class="switch"><input type="checkbox" id="sc-s" ${st.startMenu ? 'checked' : ''}><span></span></span></label>
        <p class="help" style="margin:0">${st.installed
          ? 'To remove HQ: Windows Settings → Apps → Installed apps → HQ Personal Edition → Uninstall. It asks whether to keep your data.'
          : 'To remove HQ: turn both off, close HQ, then delete the HQ folder you unzipped (and, if you want, your data folder above).'}</p>`;
      const set = () => api('/api/shortcuts', { method: 'POST', body: { desktop: $('#sc-d').checked, startMenu: $('#sc-s').checked } }).then(() => toast('Saved', 'ok', 1200)).catch((e) => toast(e.message, 'err'));
      $('#sc-d').addEventListener('change', set);
      $('#sc-s').addEventListener('change', set);
    })();
    const save = async (patch) => { try { await saveSettings(patch); toast('Saved', 'ok', 1200); } catch (e) { toast(e.message, 'err'); } };
    $('#mem').addEventListener('change', (e) => save({ folders: { claudeMemory: e.target.checked } }));
    $('#gh').addEventListener('change', (e) => save({ github: { user: e.target.value.trim() } }));
    $('#goal').addEventListener('change', (e) => save({ focus: { dailyGoalMin: Number(e.target.value) } }));
    $('#chime').addEventListener('change', (e) => save({ focus: { chime: e.target.checked } }));
    $('#open-data').addEventListener('click', () => api('/api/open', { method: 'POST', body: { data: true } }).catch((e) => toast(e.message, 'err')));
    $('#import').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const json = JSON.parse(await f.text());
        const next = await api('/api/settings/import', { method: 'POST', body: json });
        await loadProviders(true);
        applySettings(next);
        toast('Setup imported', 'ok');
        this.render(root, params);
      } catch (err) { toast(err.message || 'That file could not be read', 'err'); }
    });
    $('#reset').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Click again to reset'; setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.textContent = 'Reset settings'; } }, 4000); return; }
      const next = await api('/api/settings/reset', { method: 'POST', body: { keys: $('#rm-keys').checked } });
      await loadProviders(true);
      applySettings(next);
      location.hash = '#/welcome';
    });

    // highlight the section in view; deep links (#/settings/ai) scroll to it
    const links = [...root.querySelectorAll('[data-go]')];
    const mark = (id) => links.forEach((a) => a.setAttribute('aria-current', String(a.dataset.go === id)));
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) mark(vis.target.dataset.sec);
    }, { root: document.getElementById('main'), rootMargin: '0px 0px -70% 0px' });
    root.querySelectorAll('[data-sec]').forEach((x) => io.observe(x));
    const go = (id, smooth) => { const el = $(`#sec-${id}`); if (el) { el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }); mark(id); } };
    root.querySelector('.settings-nav').addEventListener('click', (e) => { const a = e.target.closest('[data-go]'); if (!a) return; e.preventDefault(); go(a.dataset.go, true); history.replaceState(null, '', `#/settings/${a.dataset.go}`); });
    if (params?.section) requestAnimationFrame(() => go(params.section, false)); else mark('you');

    return {
      update: (p) => { if (p.section) go(p.section, true); },
      cleanup: () => { io.disconnect(); stopTools?.(); },
    };
  },
};

