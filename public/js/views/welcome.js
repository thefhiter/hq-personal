// First run: a short wizard that makes HQ the owner's own. Every choice saves as it's made and the
// preview on the right (and the whole app behind it) updates live. Everything can be changed later in Settings.
import { icon } from '../lib/icons.js';
import { esc, api } from '../lib/ui.js';
import { logoHtml } from '../lib/theme.js';
import { state, setTitle, saveSettings, pageLabel, appTitle } from '../app.js';
import { mountProfile, mountTheme, mountLogo, mountPages, mountAiChoice, mountAiSetup, mountYouTube, mountFolders, mountTools } from '../lib/personalize.js';

const PAGE_ICON = { home: 'home', focus: 'flame', music: 'music', ai: 'sparkles', projects: 'grid', notes: 'memory', timeline: 'clock', settings: 'sliders' };

const STEPS = [
  { id: 'you', label: 'You' },
  { id: 'look', label: 'Look' },
  { id: 'pages', label: 'Pages' },
  { id: 'ai', label: 'AI' },
  { id: 'youtube', label: 'Music' },
  { id: 'folders', label: 'Projects' },
  { id: 'done', label: 'Ready' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default {
  async render(root, params, query) {
    setTitle('Welcome');
    root.classList.add('full');
    let step = Math.min(STEPS.length - 1, Math.max(0, Number(query.get('step')) || 0));
    let disposers = [];

    root.innerHTML = `<div class="wiz">
      <div class="wiz-main">
        <ol class="wiz-steps" id="steps" aria-label="Setup steps"></ol>
        <div class="wiz-body" id="body"></div>
        <div class="wiz-foot">
          <button class="btn btn-ghost" type="button" id="back">${icon('chevron', 'ico-sm flip')}Back</button>
          <span class="spacer"></span>
          <button class="btn btn-ghost" type="button" id="skip">Skip setup</button>
          <button class="btn btn-primary" type="button" id="next">Next${icon('chevron', 'ico-sm')}</button>
        </div>
      </div>
      <aside class="wiz-aside" aria-label="Live preview">
        <div class="label" style="position:relative">Live preview</div>
        <div class="preview" id="preview"></div>
        <p class="aside-note">Everything you choose here can be changed later in <b>Settings</b>.</p>
      </aside>
    </div>`;
    const $ = (s) => root.querySelector(s);
    root.querySelectorAll('.flip').forEach((x) => { x.style.transform = 'rotate(180deg)'; });

    function drawPreview() {
      const s = state.settings;
      const nav = s.nav.filter((n) => n.on);
      $('#preview').innerHTML = `<div class="preview-side">
          <div class="preview-brand">${logoHtml(s.theme, s.profile.name, { size: 28 })}<span><b>${esc(appTitle())}</b><small>${esc(s.profile.name || '')}</small></span></div>
          ${nav.map((n, i) => `<div class="preview-nav ${i === 0 ? 'on' : ''}">${icon(PAGE_ICON[n.id], 'ico-sm')}<span>${esc(pageLabel(n.id))}</span></div>`).join('')}
        </div>
        <div class="preview-main">
          <div class="eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h3>${greeting()},<br><span class="grad-text">${esc(s.profile.name || 'you')}</span>.</h3>
          <div class="preview-cards"><div></div><div></div><div></div></div>
          <span class="preview-btn">Start focusing</span>
        </div>`;
    }
    const onSettings = () => drawPreview();
    state.events.addEventListener('settings', onSettings);

    function drawSteps() {
      $('#steps').innerHTML = STEPS.map((s, i) => `<li ${i === step ? 'aria-current="step"' : ''} class="${i < step ? 'done' : ''}">${i + 1}. ${s.label}</li>`).join('');
      $('#back').disabled = step === 0;
      $('#next').innerHTML = step === STEPS.length - 1 ? `${icon('flame', 'ico-sm')}Open my ${esc(appTitle())}` : `Next${icon('chevron', 'ico-sm')}`;
      $('#skip').hidden = step === STEPS.length - 1;
    }

    const section = (title, help, id) => `<section class="card stack"><h3 class="card-title">${title}</h3>${help ? `<p class="muted" style="margin:0">${help}</p>` : ''}<div id="${id}"></div></section>`;

    function drawStep() {
      for (const d of disposers) d?.();
      disposers = [];
      drawSteps();
      const body = $('#body');
      const id = STEPS[step].id;
      if (id === 'you') {
        body.innerHTML = `<h2>Let's make it <span class="grad-text">yours</span></h2>
          <p class="lede">A personal command center: a deep-work focus room, your music from YouTube, the AI you like, your projects and notes. Two minutes to set it up.</p>
          <div id="profile"></div>`;
        mountProfile($('#profile'), { big: true }).focus();
      } else if (id === 'look') {
        body.innerHTML = `<h2>Pick your <span class="grad-text">look</span></h2><p class="lede">Colors, light or dark, and the logo at the top of your sidebar.</p>
          ${section(`${icon('sparkles')}Colors`, '', 'theme')}${section(`${icon('star')}Logo`, '', 'logo')}`;
        mountTheme($('#theme')); mountLogo($('#logo'));
      } else if (id === 'pages') {
        body.innerHTML = `<h2>Your <span class="grad-text">pages</span></h2><p class="lede">Keep what you'll use, hide the rest, rename and reorder them.</p>
          <section class="card" id="pages"></section>`;
        mountPages($('#pages'));
      } else if (id === 'ai') {
        body.innerHTML = `<h2>Your <span class="grad-text">AI</span></h2><p class="lede">Choose the assistants you use. Each one can open with your own account, chat right here with an API key, or run its official terminal app.</p>
          <section class="card" id="ai-choice"></section><div class="stack" id="ai-setup"></div>`;
        const setup = mountAiSetup($('#ai-setup'), { compact: true });
        mountAiChoice($('#ai-choice'), { onChange: () => setup.redraw() });
      } else if (id === 'youtube') {
        body.innerHTML = `<h2>Music & <span class="grad-text">YouTube</span></h2><p class="lede">Any YouTube song becomes an MP3 on this PC, and any video can become an HD background for the Focus Room.</p>
          ${section(`${icon('download')}Helper programs`, 'HQ needs these two free tools to save music and videos. One click installs them inside HQ.', 'tools')}
          ${section(`${icon('youtube')}Your YouTube account (optional)`, '', 'yt')}`;
        disposers.push(mountTools($('#tools'), { onlyRequired: true }));
        mountYouTube($('#yt'));
      } else if (id === 'folders') {
        body.innerHTML = `<h2>Projects & <span class="grad-text">notes</span></h2><p class="lede">Optional. Point HQ at the folder where you keep your work, and at your notes (an Obsidian vault works great).</p>
          ${section(`${icon('grid')}Projects folder`, 'Each folder inside becomes a project card, with its history if it uses Git.', 'pf')}
          ${section(`${icon('memory')}Notes folders`, '', 'nf')}`;
        mountFolders($('#pf'), { kind: 'projects' }); mountFolders($('#nf'), { kind: 'notes' });
      } else {
        const s = state.settings;
        const ai = s.ai.enabled.map((x) => state.providers?.[x]?.name || x).join(', ');
        body.innerHTML = `<h2>All set${s.profile.name ? `, <span class="grad-text">${esc(s.profile.name)}</span>` : ''}.</h2>
          <p class="lede">Your ${esc(appTitle())} is ready.</p>
          <section class="card stack" id="sc-card" hidden>
            <label class="row" style="justify-content:space-between"><span>Put ${esc(appTitle())} on my Desktop (with my logo)</span><span class="switch"><input type="checkbox" id="sc-d" checked><span></span></span></label>
            <label class="row" style="justify-content:space-between"><span>Add ${esc(appTitle())} to the Start menu</span><span class="switch"><input type="checkbox" id="sc-s" checked><span></span></span></label>
          </section>
          <section class="card"><dl class="kv">
            <dt>Pages</dt><dd>${s.nav.filter((n) => n.on).map((n) => esc(pageLabel(n.id))).join(' · ')}</dd>
            <dt>AI</dt><dd>${esc(ai)} <span class="dim">(main: ${esc(state.providers?.[s.ai.primary]?.name || s.ai.primary)})</span></dd>
            <dt>Theme</dt><dd>${esc(s.theme.preset === 'custom' ? 'Your color' : s.theme.preset.replace(/^\w/, (c) => c.toUpperCase()))} · ${esc(s.theme.mode)}</dd>
            <dt>Projects</dt><dd>${s.folders.projects.length ? esc(s.folders.projects.join(', ')) : 'none yet'}</dd>
          </dl></section>
          <section class="card"><h3 class="card-title">${icon('zap')}Good to know</h3><ul class="steps" style="margin:0">
            <li><kbd>Ctrl</kbd> <kbd>K</kbd> searches everything: pages, songs, projects, notes and actions.</li>
            <li>In Focus, <kbd>Space</kbd> starts and pauses, <kbd>F</kbd> goes fullscreen, <kbd>B</kbd> picks a background.</li>
            <li>Settings → Data lets you export your setup or start over.</li>
          </ul></section>`;
      }
      if (id === 'done') api('/api/shortcuts').then((st) => { if (st.supported && $('#sc-card')) $('#sc-card').hidden = false; }).catch(() => {});
      root.querySelector('.wiz-main').scrollTop = 0;
      history.replaceState(null, '', `#/welcome?step=${step}`);
    }

    async function finish() {
      $('#next').disabled = true;
      const d = $('#sc-d'), sm = $('#sc-s');
      if (d && !$('#sc-card').hidden && (d.checked || sm.checked)) await api('/api/shortcuts', { method: 'POST', body: { desktop: d.checked, startMenu: sm.checked } }).catch(() => {});
      await saveSettings({ setupDone: true });
      location.hash = '#/';
    }
    $('#next').addEventListener('click', () => { if (step === STEPS.length - 1) finish(); else { step++; drawStep(); } });
    $('#back').addEventListener('click', () => { if (step > 0) { step--; drawStep(); } });
    $('#skip').addEventListener('click', finish);
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'pf-name') $('#next').click(); });

    drawPreview();
    drawStep();
    return () => { state.events.removeEventListener('settings', onSettings); for (const d of disposers) d?.(); };
  },
};
