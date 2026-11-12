import { icon } from '../lib/icons.js';
import { api, esc, mmss, fmtMin, dayKey } from '../lib/ui.js';
import { setTitle, state, timerRemaining, pageLabel, appTitle } from '../app.js';
import * as stage from '../lib/stage.js';
import { mountMini } from '../lib/player.js';

const PRESETS = [['deep', 'Deep work', 50], ['pomodoro', 'Pomodoro', 25], ['monk', 'Monk mode', 90], ['short', 'Break', 5]];
const MODE_LABEL = { focus: 'Focus', short: 'Break', long: 'Long break' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(`hq.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`hq.${k}`, JSON.stringify(v)); } catch {} },
};

export default {
  async render(root) {
    setTitle(pageLabel('focus'));
    root.classList.add('full');
    let selected = store.get('preset', 'deep');
    let customMin = store.get('customMin', 45);

    root.innerHTML = `<div class="focus force-dark">
      <div class="f-top fade">
        <div class="chips modes" role="group" aria-label="Session length" id="modes">
          ${PRESETS.map(([id, name, m]) => `<button class="chip" type="button" data-preset="${id}">${name}<span class="count">${m}</span></button>`).join('')}
          <span class="chip custom" data-preset="custom" role="button" tabindex="0">Custom <input id="custom-min" type="number" min="1" max="240" value="${customMin}" aria-label="Custom minutes"></span>
        </div>
        <span class="spacer"></span>
        <div class="bg-ctrl" id="bg-ctrl"></div>
      </div>

      <div class="f-center">
        <div class="timer-mode" id="mode-label">Ready</div>
        <div class="timer-digits" id="digits" role="timer" aria-live="off">50:00</div>
        <div class="timer-line" aria-hidden="true"><i id="line"></i></div>
        <input class="mission" id="task" type="text" maxlength="140" placeholder="What's the mission?" aria-label="What you're working on">
        <div class="focus-controls fade">
          <button class="round-btn" id="reset" type="button" title="Reset (R)" aria-label="Reset">${icon('reset')}</button>
          <button class="play-btn" id="play" type="button" aria-label="Start">${icon('play')}</button>
          <button class="round-btn" id="skip" type="button" title="Skip (S)" aria-label="Skip">${icon('skip')}</button>
        </div>
      </div>

      <div class="f-bottom fade">
        <div class="today" id="today"></div>
        <div class="now-playing" id="np"></div>
      </div>
    </div>`;

    const $ = (s) => root.querySelector(s);

    // ---------- background controls ----------
    // The bar is rebuilt only when the clip list changes; every other stage change just re-syncs
    // it, so the picker stays open while the crossfade happens behind it.
    let bgKey = null;
    let pickerOpen = false;
    const thumb = (v) => (v?.poster ? `/media/thumbs/${v.poster}` : '');
    function tiles(list) {
      const tile = (v) => `<button class="bg-tile" type="button" data-clip="${v.id}" title="${esc(v.title)}">
          <span class="bg-thumb"><img src="${thumb(v)}" alt="" width="320" height="180" loading="lazy">
            <span class="bg-now">${icon('play')}Playing</span>${v.duration ? `<span class="bg-dur">${mmss(Math.round(v.duration))}</span>` : ''}</span>
          <span class="bg-title">${esc(v.title)}</span></button>`;
      const scenes = stage.scenes();
      if (scenes.length < 2) return list.map(tile).join('');
      return scenes.map((s) => `<h3 class="bg-group">${esc(s.name)}</h3>${list.filter((v) => v.scene === s.id).map(tile).join('')}`).join('');
    }
    function drawBg() {
      const list = stage.clips();
      const key = list.map((v) => v.id).join();
      if (key === bgKey) return syncBg();
      bgKey = key;
      pickerOpen = false;
      $('#bg-ctrl').innerHTML = list.length ? `
        <button class="bg-pick" id="bg-pick" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="bg-picker" title="Choose background (B)">
          <img id="bg-pick-img" alt="" width="64" height="36"><span><small>Background</small><b id="bg-pick-name"></b></span>${icon('down', 'ico-sm')}</button>
        <button class="round-btn" id="bg-next" type="button" title="Next clip (N)" aria-label="Next background clip">${icon('shuffle')}</button>
        <button class="round-btn" id="bg-pause" type="button"></button>
        <button class="round-btn" id="zen" type="button" title="Fullscreen (F)" aria-label="Fullscreen">${icon('maximize')}</button>
        <div class="bg-picker" id="bg-picker" role="dialog" aria-label="Choose a background" tabindex="-1" hidden>
          <div class="bg-picker-head"><b>Backgrounds</b><span class="dim">${list.length} clip${list.length === 1 ? '' : 's'}</span><span class="spacer"></span>
            <button class="round-btn" id="bg-close" type="button" aria-label="Close">${icon('x')}</button></div>
          <div class="bg-list" id="bg-list">${tiles(list)}</div>
          <a class="bg-more" href="#/music?tab=backgrounds">${icon('plus', 'ico-sm')}Add more backgrounds</a>
        </div>`
        : `<a class="btn btn-ghost btn-sm" href="#/music?tab=backgrounds">${icon('video', 'ico-sm')}Add an HD background</a>`;
      $('#bg-pick')?.addEventListener('click', () => openPicker(!pickerOpen));
      $('#bg-close')?.addEventListener('click', () => { openPicker(false); $('#bg-pick').focus(); });
      $('#bg-list')?.addEventListener('click', (e) => {
        const t = e.target.closest('[data-clip]');
        if (!t) return;
        stage.playClip(t.dataset.clip);
        openPicker(false);
        $('#bg-pick').focus();
      });
      $('#bg-list')?.addEventListener('keydown', moveInGrid);
      $('#bg-next')?.addEventListener('click', () => stage.nextClip());
      $('#bg-pause')?.addEventListener('click', () => stage.togglePause());
      $('#zen')?.addEventListener('click', toggleZen);
      syncBg();
    }
    function syncBg() {
      const cur = stage.currentClip();
      if (!$('#bg-pick')) return;
      $('#bg-pick-img').src = thumb(cur);
      $('#bg-pick-name').textContent = cur?.title || 'Choose a clip';
      $('#bg-pick').setAttribute('aria-label', `Background: ${cur?.title || 'none'}. Choose another`);
      root.querySelectorAll('.bg-tile').forEach((t) => t.setAttribute('aria-current', String(t.dataset.clip === cur?.id)));
      const paused = stage.isPaused();
      $('#bg-pause').innerHTML = icon(paused ? 'play' : 'pause');
      $('#bg-pause').title = `${paused ? 'Play' : 'Pause'} background (V)`;
      $('#bg-pause').setAttribute('aria-label', `${paused ? 'Play' : 'Pause'} background`);
    }
    function openPicker(on) {
      if (!$('#bg-picker')) return;
      pickerOpen = on;
      $('#bg-picker').hidden = !on;
      $('#bg-pick').setAttribute('aria-expanded', String(on));
      if (on) {
        wake();
        const cur = root.querySelector('.bg-tile[aria-current="true"]') || root.querySelector('.bg-tile');
        cur?.focus();
        cur?.scrollIntoView({ block: 'nearest' });
      }
    }
    function moveInGrid(e) {
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 'row', ArrowUp: '-row' }[e.key];
      if (!step) return;
      e.preventDefault();
      const all = [...root.querySelectorAll('.bg-tile')];
      const i = all.indexOf(document.activeElement);
      const cols = Math.max(1, all.filter((t) => t.offsetTop === all[0].offsetTop).length);
      const d = step === 'row' ? cols : step === '-row' ? -cols : step;
      all[Math.min(all.length - 1, Math.max(0, i + d))]?.focus();
    }
    const onOutside = (e) => { if (pickerOpen && !e.target.closest('#bg-picker, #bg-pick')) openPicker(false); };
    document.addEventListener('pointerdown', onOutside);
    // tabbing out of the picker closes it too
    $('#bg-ctrl').addEventListener('focusout', (e) => { if (pickerOpen && !$('#bg-ctrl').contains(e.relatedTarget)) openPicker(false); });
    const onStage = () => drawBg();
    stage.stage.addEventListener('change', onStage);
    drawBg();

    // ---------- timer ----------
    const minutesOf = (id) => (id === 'custom' ? customMin : PRESETS.find((p) => p[0] === id)?.[2] || 50);
    function drawModes() {
      const t = state.timer;
      const lock = t?.running;
      root.querySelectorAll('[data-preset]').forEach((b) => {
        const active = t && t.mode !== 'idle' ? b.dataset.preset === t.preset || (b.dataset.preset === 'short' && t.preset === 'long') : b.dataset.preset === selected;
        b.setAttribute('aria-pressed', String(active));
        b.classList.toggle('locked', !!lock && !active);
      });
    }
    function draw() {
      const t = state.timer;
      const idle = !t || t.mode === 'idle';
      const total = idle ? minutesOf(selected) * 60 : t.total;
      const remaining = idle ? total : timerRemaining();
      $('#digits').textContent = mmss(remaining);
      $('#line').style.transform = `scaleX(${total ? remaining / total : 1})`;
      $('#mode-label').textContent = idle ? (selected === 'short' && t?.cycle ? 'Nice work. Take a break.' : 'Ready when you are') : `${MODE_LABEL[t.mode]}${t.running ? '' : ' · paused'}`;
      const running = !!t?.running;
      root.classList.toggle('running', running);
      $('#play').innerHTML = icon(running ? 'pause' : 'play');
      $('#play').setAttribute('aria-label', running ? 'Pause' : idle ? 'Start' : 'Resume');
      document.title = !idle ? `${mmss(remaining)} · ${MODE_LABEL[t.mode]}` : `${pageLabel('focus')} · ${appTitle()}`;
    }
    function syncInputs() {
      const t = state.timer;
      if (!t) return;
      if (document.activeElement !== $('#task')) $('#task').value = t.label || '';
      if (t.mode === 'idle' && t.preset && t.preset !== 'custom') {
        const p = t.preset === 'long' ? 'short' : t.preset;
        if (PRESETS.some((x) => x[0] === p)) { selected = p; store.set('preset', selected); }
      }
      drawModes();
    }
    const cmd = (body) => api('/api/timer', { method: 'POST', body }).catch(() => {});

    $('#modes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]');
      if (!b || b.classList.contains('locked')) return;
      selected = b.dataset.preset;
      store.set('preset', selected);
      if (state.timer?.mode !== 'idle' && !state.timer?.running) cmd({ action: 'reset' });
      if (selected !== 'custom') cmd({ action: 'select', preset: selected });
      drawModes(); draw();
    });
    $('#custom-min').addEventListener('input', (e) => {
      const v = Math.round(Number(e.target.value));
      if (v >= 1 && v <= 240) { customMin = v; store.set('customMin', v); selected = 'custom'; store.set('preset', selected); drawModes(); draw(); }
    });
    $('#play').addEventListener('click', async () => {
      const t = state.timer;
      if (!t || t.mode === 'idle') {
        const body = { action: 'start', label: $('#task').value.trim() };
        if (selected === 'custom') Object.assign(body, { mode: 'focus', minutes: customMin }); else body.preset = selected;
        await cmd(body);
      } else await cmd({ action: t.running ? 'pause' : 'resume' });
    });
    $('#reset').addEventListener('click', () => cmd({ action: 'reset' }));
    $('#skip').addEventListener('click', () => cmd({ action: 'skip' }));
    let labelTimer;
    $('#task').addEventListener('input', () => { clearTimeout(labelTimer); labelTimer = setTimeout(() => cmd({ action: 'label', label: $('#task').value.trim() }), 500); });
    $('#task').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); if (!state.timer?.running) $('#play').click(); } });

    // ---------- today ----------
    async function drawToday() {
      const s = await api('/api/focus/stats').catch(() => null);
      if (!s || !root.isConnected) return;
      const sessions = (s.recent || []).filter((x) => dayKey(x.start) === dayKey(Date.now())).length;
      const pct = Math.min(100, Math.round((s.todayMin / (s.goalMin || 240)) * 100));
      $('#today').innerHTML = `<div class="today-ring" style="--p:${pct}"><span>${pct}%</span></div>
        <div><b>${fmtMin(s.todayMin)}</b> of ${fmtMin(s.goalMin)} today<br><span class="dim">${sessions} session${sessions === 1 ? '' : 's'} · ${s.streak}-day streak</span></div>`;
    }
    drawToday();
    const stopMini = mountMini($('#np'));

    // ---------- calm mode: controls fade away while the timer runs ----------
    let idleTimer;
    const wake = () => {
      root.classList.remove('calm');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (state.timer?.running && !pickerOpen && document.activeElement?.id !== 'task') root.classList.add('calm'); }, 3500);
    };
    root.addEventListener('mousemove', wake);
    root.addEventListener('pointerdown', wake);
    wake();

    // ---------- fullscreen + keys ----------
    async function toggleZen() {
      const on = !document.body.classList.contains('zen');
      document.body.classList.toggle('zen', on);
      try { if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen(); else if (!on && document.fullscreenElement) await document.exitFullscreen(); } catch {}
    }
    const onFs = () => { if (!document.fullscreenElement) document.body.classList.remove('zen'); };
    document.addEventListener('fullscreenchange', onFs);
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey || !document.getElementById('palette').hidden) return;
      if (pickerOpen && e.key === 'Escape') { openPicker(false); $('#bg-pick').focus(); return; }
      if (e.target.closest('#bg-picker')) return; // Space/Enter pick the focused clip there
      const k = e.key.toLowerCase();
      if (k === 'b') openPicker(!pickerOpen);
      else if (k === ' ') { e.preventDefault(); $('#play').click(); }
      else if (k === 'r') $('#reset').click();
      else if (k === 's') $('#skip').click();
      else if (k === 'f') toggleZen();
      else if (k === 'n') stage.nextClip();
      else if (k === 'v') stage.togglePause();
      wake();
    };
    document.addEventListener('keydown', onKey);

    const onTimer = () => { syncInputs(); draw(); wake(); };
    const onSession = () => drawToday();
    state.events.addEventListener('timer', onTimer);
    state.events.addEventListener('session', onSession);
    const tick = setInterval(draw, 500);
    syncInputs();
    draw();

    return () => {
      clearInterval(tick); clearTimeout(labelTimer); clearTimeout(idleTimer);
      stopMini();
      stage.stage.removeEventListener('change', onStage);
      document.removeEventListener('pointerdown', onOutside);
      state.events.removeEventListener('timer', onTimer);
      state.events.removeEventListener('session', onSession);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      document.body.classList.remove('zen');
      document.title = appTitle();
    };
  },
};
