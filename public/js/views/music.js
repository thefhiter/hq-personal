import { icon } from '../lib/icons.js';
import { api, esc, toast, bytes } from '../lib/ui.js';
import { setTitle, state, pageLabel } from '../app.js';
import { mountTools } from '../lib/personalize.js';
import * as player from '../lib/player.js';
import { SCENE_NAMES, sceneName } from '../lib/stage.js';

const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const isLink = (q) => /(youtube\.com|youtu\.be)\//i.test(q);
const store = {
  get(k, d) { try { const v = localStorage.getItem(`hq.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`hq.${k}`, JSON.stringify(v)); } catch {} },
};

export default {
  async render(root, params, query) {
    setTitle(pageLabel('music'));
    let tab = query.get('tab') || 'songs';
    let lib = await api('/api/library');
    const jobs = new Map(lib.jobs.map((j) => [j.key, j]));
    let bgScene = store.get('bgTarget', 'mine');
    if (!SCENE_NAMES[bgScene]) bgScene = 'mine';
    let lastResults = [];

    const lists = state.settings.youtube.playlists || [];
    root.innerHTML = `<div class="music-page">
      <section class="card" id="tools-card" hidden><h3 class="card-title">${icon('download')}One-time setup</h3><p class="muted" style="margin-top:0">Saving songs and backgrounds needs two free helper programs. Install them here (about 1 minute):</p><div id="tools"></div></section>
      <section class="card find">
        <form class="find-row" id="find">
          <span class="ico" data-icon="search"></span>
          <input class="input" id="q" type="text" autocomplete="off" placeholder="Search YouTube, or paste any video or playlist link" aria-label="Search YouTube or paste a link">
          <button class="btn btn-primary" type="submit">Search</button>
        </form>
        <div class="find-hint">Songs are saved as MP3 on this PC: instant, full quality, even offline. Backgrounds are saved in HD for the Focus Room, in
          <select class="input inline-select" id="bg-target" aria-label="Background group">${Object.entries(SCENE_NAMES).map(([id, n]) => `<option value="${id}" ${id === bgScene ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        ${lists.length || lib.account ? `<div class="chips my-lists" style="margin-top:12px">${lib.account ? `<button class="chip" type="button" data-list="https://www.youtube.com/playlist?list=LL">${icon('check', 'ico-sm')}Liked videos</button><button class="chip" type="button" data-list="https://www.youtube.com/playlist?list=WL">${icon('clock', 'ico-sm')}Watch later</button>` : ''}${lists.map((l) => `<button class="chip" type="button" data-list="${esc(l.url)}">${icon('list', 'ico-sm')}${esc(l.name)}</button>`).join('')}<a class="chip" href="#/settings/youtube">${icon('plus', 'ico-sm')}Playlists</a></div>` : ''}
        <div class="results" id="results"></div>
      </section>

      <section id="jobs" class="jobs"></section>

      <nav class="tabs" aria-label="Library">
        <a href="#/music?tab=songs" data-tab="songs">${icon('music', 'ico-sm')}Songs <span class="count" id="n-songs"></span></a>
        <a href="#/music?tab=backgrounds" data-tab="backgrounds">${icon('video', 'ico-sm')}Backgrounds <span class="count" id="n-bg"></span></a>
        <a href="#/music?tab=account" data-tab="account">${icon('youtube', 'ico-sm')}My YouTube</a>
        <span class="spacer"></span><span class="dim disk" id="disk"></span>
      </nav>
      <div id="tab-body"></div>
    </div>`;
    const $ = (s) => root.querySelector(s);
    let stopTools = null;
    api('/api/tools').then((t) => {
      if (!root.isConnected) return;
      const missing = t.tools.filter((x) => ['yt-dlp', 'ffmpeg'].includes(x.id) && !x.installed);
      if (missing.length && t.canInstall) { $('#tools-card').hidden = false; stopTools = mountTools($('#tools'), { onlyRequired: true }); }
    }).catch(() => {});
    $('#bg-target').addEventListener('change', (e) => { bgScene = e.target.value; store.set('bgTarget', bgScene); });

    // ---------- search / paste ----------
    const resultRow = (r) => {
      const hasSong = lib.tracks.some((t) => t.id === r.id);
      const hasBg = lib.videos.some((v) => v.id === r.id);
      return `<li class="result">
        <img src="${esc(r.thumb)}" alt="" loading="lazy" width="120" height="68">
        <div class="r-meta"><b>${esc(r.title)}</b><span>${esc(r.channel || '')}${r.duration ? ` · ${fmtDur(r.duration)}` : r.live ? ' · live' : ''}${r.views ? ` · ${esc(r.views)}` : ''}</span></div>
        <div class="r-act">
          <button class="btn btn-sm ${hasSong ? 'btn-ghost' : 'btn-primary'}" type="button" data-dl="audio" data-id="${r.id}" data-title="${esc(r.title)}" ${hasSong || r.live ? 'disabled' : ''}>${icon(hasSong ? 'check' : 'download', 'ico-sm')}${hasSong ? 'In songs' : 'MP3'}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-dl="video" data-id="${r.id}" data-title="${esc(r.title)}" ${hasBg || r.live ? 'disabled' : ''}>${icon(hasBg ? 'check' : 'video', 'ico-sm')}${hasBg ? 'Background' : 'Background'}</button>
        </div></li>`;
    };
    function drawResults(items, title) {
      lastResults = items;
      const el = $('#results');
      if (!items) { el.innerHTML = ''; return; }
      el.innerHTML = `${title ? `<div class="row results-head"><b>${esc(title)}</b><span class="dim">${items.length} videos</span><span class="spacer"></span>${items.length > 1 ? `<button class="btn btn-sm btn-primary" type="button" id="all-mp3">${icon('download', 'ico-sm')}Add all as MP3</button>` : ''}</div>` : ''}
        <ul class="result-list">${items.map(resultRow).join('') || '<li class="dim">Nothing found.</li>'}</ul>`;
      $('#all-mp3')?.addEventListener('click', () => download('audio', items.filter((i) => !lib.tracks.some((t) => t.id === i.id))));
    }
    async function find(q) {
      const el = $('#results');
      el.innerHTML = `<div class="loading">${icon('refresh', 'ico-sm spin')} ${isLink(q) ? 'Reading the link…' : 'Searching YouTube…'}</div>`;
      try {
        if (isLink(q)) {
          const r = await api('/api/yt/resolve', { method: 'POST', body: { url: q } });
          drawResults(r.items, r.items.length > 1 ? r.title : null);
        } else drawResults(await api(`/api/yt/search?q=${encodeURIComponent(q)}`));
      } catch (e) { el.innerHTML = `<div class="err-line">${icon('alert', 'ico-sm')} ${esc(e.message)}</div>`; }
    }
    $('#find').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) find(q); });

    async function download(kind, items) {
      if (!items.length) return;
      try {
        const res = await api('/api/library/download', { method: 'POST', body: { kind, scene: kind === 'video' ? bgScene : undefined, items: items.map((i) => ({ id: i.id, title: i.title })) } });
        const errs = res.filter((r) => r.error);
        if (errs.length) toast(errs[0].error, 'err');
        for (const j of res) if (j.key && j.status !== 'done') jobs.set(j.key, j);
        drawJobs();
      } catch (e) { toast(e.message, 'err'); }
    }
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]');
      if (!b) return;
      b.disabled = true;
      b.innerHTML = `${icon('refresh', 'ico-sm spin')}Queued`;
      download(b.dataset.dl, [{ id: b.dataset.id, title: b.dataset.title }]);
    });

    // ---------- downloads in progress ----------
    function drawJobs() {
      const all = [...jobs.values()].filter((j) => j.status !== 'done' || Date.now() - (j.finished || 0) < 8000);
      const failed = all.filter((j) => j.status === 'error').length;
      const busy = all.filter((j) => ['queued', 'downloading', 'converting'].includes(j.status)).length;
      // working ones first, then failures; keep the list short
      const list = [...all.filter((j) => j.status !== 'error'), ...all.filter((j) => j.status === 'error')].slice(0, 14);
      const head = failed || busy > 1 ? `<div class="jobs-head">${busy ? `<span>${busy} downloading or waiting</span>` : ''}${failed ? `<span class="err-count">${failed} failed</span><button class="btn btn-primary btn-sm" type="button" id="retry">${icon('refresh', 'ico-sm')}Retry failed</button><button class="btn btn-ghost btn-sm" type="button" id="clear-failed">Clear</button>` : ''}</div>` : '';
      $('#jobs').innerHTML = head + (list.length ? list.map((j) => `<div class="job ${j.status}">
        ${icon(j.kind === 'audio' ? 'music' : 'video', 'ico-sm')}
        <span class="j-title">${esc(j.title || j.id)}</span>
        <span class="j-state">${j.status === 'error' ? esc(j.error || 'failed') : j.status === 'done' ? 'Ready' : j.status === 'converting' ? (j.kind === 'audio' ? 'Making MP3…' : 'Finishing…') : j.status === 'queued' ? 'Waiting…' : `${Math.round(j.progress)}%`}</span>
        <span class="j-bar"><i style="transform:scaleX(${(j.status === 'done' ? 100 : j.progress) / 100})"></i></span></div>`).join('') : '');
      $('#retry')?.addEventListener('click', async () => {
        for (const [k, j] of jobs) if (j.status === 'error') jobs.delete(k);
        try { for (const j of await api('/api/library/retry', { method: 'POST' })) if (j.key) jobs.set(j.key, j); } catch (e) { toast(e.message, 'err'); }
        drawJobs();
      });
      $('#clear-failed')?.addEventListener('click', async () => {
        for (const [k, j] of jobs) if (j.status === 'error') jobs.delete(k);
        await api('/api/library/clear-failed', { method: 'POST' }).catch(() => {});
        drawJobs();
      });
    }
    const onJob = (e) => { jobs.set(e.detail.key, e.detail); drawJobs(); };
    const onLib = async () => { lib = await api('/api/library'); drawTab(); counts(); if (lastResults.length) drawResults(lastResults, $('.results-head b')?.textContent || null); };
    state.events.addEventListener('media:job', onJob);
    state.events.addEventListener('media:library', onLib);
    drawJobs();

    // ---------- library tabs ----------
    function counts() {
      $('#n-songs').textContent = lib.tracks.length;
      $('#n-bg').textContent = lib.videos.length;
      if (lib.disk) $('#disk').textContent = `Library ${bytes(lib.disk.used)} · ${(lib.disk.free / 1e9).toFixed(1)} GB free`;
      root.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    }
    function songs() {
      const cur = player.current()?.id;
      return lib.tracks.length ? `<div class="row lib-head"><button class="btn btn-primary btn-sm" type="button" id="play-all">${icon('shuffle', 'ico-sm')}Shuffle all</button><span class="dim">${lib.tracks.length} songs on this PC</span></div>
        <ul class="song-list">${lib.tracks.map((t) => `<li class="${t.id === cur ? 'playing' : ''}">
          <button class="song" type="button" data-play="${t.id}"><img src="${esc(t.thumb)}" alt="" loading="lazy" width="64" height="36"><span class="s-meta"><b>${esc(t.title)}</b><span>${esc(t.channel || '')}</span></span><span class="dim num">${fmtDur(t.duration)}</span></button>
          <button class="btn btn-ghost btn-sm btn-icon del" type="button" data-del="audio:${t.id}" aria-label="Remove ${esc(t.title)}">${icon('trash', 'ico-sm')}</button></li>`).join('')}</ul>`
        : `<div class="empty">${icon('music')}<div>No songs yet. Search above and press <b>MP3</b>.</div></div>`;
    }
    function backgrounds() {
      return lib.videos.length ? `<p class="muted lib-head">These play behind the timer in the Focus Room, one after another with a soft crossfade.</p>
        <div class="bg-grid">${lib.videos.map((v) => `<figure class="bg-card">
          ${v.poster ? `<img src="/media/thumbs/${v.poster}" alt="" loading="lazy">` : '<div class="poster-empty"></div>'}
          <figcaption><b>${esc(v.title)}</b><span>${v.height ? `${v.height}p · ` : ''}${fmtDur(v.duration)} · ${bytes(v.size || 0)}</span>
          <div class="row"><select class="input inline-select" data-scene="${v.id}" aria-label="Group">${Object.entries(SCENE_NAMES).map(([id, n]) => `<option value="${id}" ${id === v.scene ? 'selected' : ''}>${esc(n)}</option>`).join('')}${SCENE_NAMES[v.scene] ? '' : `<option selected value="${esc(v.scene)}">${esc(sceneName(v.scene))}</option>`}</select>
          <button class="btn btn-ghost btn-sm btn-icon del" type="button" data-del="video:${v.id}" aria-label="Remove ${esc(v.title)}">${icon('trash', 'ico-sm')}</button></div></figcaption></figure>`).join('')}</div>`
        : `<div class="empty">${icon('video')}<div>No backgrounds yet. Search above and press <b>Background</b>.</div></div>`;
    }
    function account() {
      return `<div class="account card">
        ${lib.account ? `<div class="row"><span class="big-dot on"></span><b>Your YouTube account is connected</b><span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="disconnect">Disconnect</button></div>
          <p class="muted">Open your own lists, then add anything as MP3 or background:</p>
          <div class="row"><button class="btn btn-primary btn-sm" type="button" data-list="https://www.youtube.com/playlist?list=LL">${icon('check', 'ico-sm')}Liked videos</button>
          <button class="btn btn-ghost btn-sm" type="button" data-list="https://www.youtube.com/playlist?list=WL">${icon('clock', 'ico-sm')}Watch later</button>
          <button class="btn btn-ghost btn-sm" type="button" data-list="https://www.youtube.com/feed/history">${icon('reset', 'ico-sm')}History</button></div>
          <p class="help">Your own playlists: paste their link in the search box above.</p>`
        : `<h3 class="card-title">${icon('youtube')}Connect your YouTube account</h3>
          <p class="muted">Public videos and playlists already work without this. Connect your account to also open your <b>liked videos</b>, <b>watch later</b> and <b>private playlists</b>.</p>
          <ol class="steps">
            <li>In Chrome, add the free extension <a href="https://chromewebstore.google.com/search/Get%20cookies.txt%20LOCALLY" target="_blank" rel="noopener">Get cookies.txt LOCALLY</a>.</li>
            <li>Open <a href="https://www.youtube.com" target="_blank" rel="noopener">youtube.com</a> (logged in), click the extension, and press <b>Export</b>.</li>
            <li>Drop the downloaded <span class="mono">cookies.txt</span> file here.</li>
          </ol>
          <label class="drop" id="drop">${icon('upload')}<span>Drop cookies.txt here, or click to choose it</span><input type="file" id="cookie-file" accept=".txt,text/plain" hidden></label>
          <p class="help">The file stays on this PC and is only used to download from YouTube. Disconnect any time. Save your own playlists in <a href="#/settings/youtube">Settings</a>.</p>`}
      </div>`;
    }
    function drawTab() {
      const body = $('#tab-body');
      body.innerHTML = tab === 'backgrounds' ? backgrounds() : tab === 'account' ? account() : songs();
      $('#play-all')?.addEventListener('click', () => player.playAll());
      $('#disconnect')?.addEventListener('click', async () => { lib = await api('/api/youtube/account', { method: 'DELETE' }); drawTab(); });
      const fileInput = $('#cookie-file');
      if (fileInput) {
        const upload = async (file) => {
          if (!file) return;
          try { lib = await api('/api/youtube/account', { method: 'POST', body: { cookies: await file.text() } }); drawTab(); }
          catch (e) { toast(e.message, 'err'); }
        };
        fileInput.addEventListener('change', () => upload(fileInput.files[0]));
        const drop = $('#drop');
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); });
      }
    }
    root.addEventListener('click', async (e) => {
      const play = e.target.closest('[data-play]');
      if (play) { player.playTrack(play.dataset.play); return; }
      const list = e.target.closest('[data-list]');
      if (list) { $('#q').value = list.dataset.list; find(list.dataset.list); window.scrollTo(0, 0); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!del.classList.contains('confirm')) { del.classList.add('confirm'); del.innerHTML = 'Remove?'; setTimeout(() => { if (del.isConnected) { del.classList.remove('confirm'); del.innerHTML = icon('trash', 'ico-sm'); } }, 3000); return; }
        const [kind, id] = del.dataset.del.split(':');
        await api(`/api/library/${kind}/${id}`, { method: 'DELETE' }).catch((err) => toast(err.message, 'err'));
      }
    });
    root.addEventListener('change', async (e) => {
      const s = e.target.closest('[data-scene]');
      if (s) await api(`/api/library/video/${s.dataset.scene}/scene`, { method: 'POST', body: { scene: s.value } }).catch((err) => toast(err.message, 'err'));
    });
    const onPlayer = () => { if (tab === 'songs') { const cur = player.current()?.id; root.querySelectorAll('.song-list li').forEach((li) => li.classList.toggle('playing', li.querySelector('[data-play]')?.dataset.play === cur)); } };
    player.player.addEventListener('change', onPlayer);

    counts();
    drawTab();
    $('#q').focus();
    return {
      update: (p, q) => { tab = q.get('tab') || 'songs'; counts(); drawTab(); },
      cleanup: () => {
        stopTools?.();
        state.events.removeEventListener('media:job', onJob);
        state.events.removeEventListener('media:library', onLib);
        player.player.removeEventListener('change', onPlayer);
      },
    };
  },
};
