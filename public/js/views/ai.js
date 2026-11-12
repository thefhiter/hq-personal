// The AI page: the assistants the owner chose, three ways each —
//  Chat: HQ's own chat with an API key (Claude, ChatGPT, Gemini, DeepSeek, …), streamed live.
//  Terminal: the provider's official app (Claude Code, Codex, Gemini CLI) in a real terminal.
//  Website: the provider's site in its own window, signed in with the owner's account.
import { icon } from '../lib/icons.js';
import { api, esc, toast, ago, catalog } from '../lib/ui.js';
import { markdown } from '../lib/md.js';
import { resolveColor as cssVar } from '../lib/theme.js';
import { setTitle, state, loadProviders } from '../app.js';
import { badge } from '../lib/personalize.js';

const store = {
  get(k, d) { try { const v = localStorage.getItem(`hq.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`hq.${k}`, JSON.stringify(v)); } catch {} },
};
const SUGGEST = ['Plan my day around 3 deep-work blocks', 'Explain this like I am 15: how does compound interest work?', 'Write a polite email to reschedule a meeting', 'Give me 10 ideas for my next project'];

export default {
  async render(root, params, query) {
    root.classList.add('full');
    const prov = await loadProviders(true);
    const enabled = state.settings.ai.enabled.filter((id) => prov[id]);
    let pid = query.get('provider') || store.get('aiProvider', state.settings.ai.primary);
    if (!enabled.includes(pid)) pid = state.settings.ai.primary;
    let threadId = params.id || null;
    let tab = null;
    let teardown = null;
    const defTab = (p) => {
      const mode = state.settings.ai.providers[p.id]?.mode;
      if (mode && (mode !== 'chat' || p.chat) && (mode !== 'cli' || p.cli)) return mode;
      return p.chat && p.hasKey ? 'chat' : p.web ? 'web' : p.chat ? 'chat' : 'cli';
    };
    tab = threadId ? 'chat' : query.get('tab') || defTab(prov[pid]);

    root.innerHTML = `<div class="ai-page">
      <div class="ai-bar">
        <div class="ai-provs" role="group" aria-label="Your AIs" id="provs"></div>
        <span class="spacer"></span>
        <div class="ai-tabs" role="tablist" aria-label="How to use it" id="tabs"></div>
        <a class="btn btn-ghost btn-sm btn-icon" href="#/settings/ai" title="AI settings" aria-label="AI settings">${icon('sliders', 'ico-sm')}</a>
      </div>
      <div class="ai-body" id="body"></div>
    </div>`;
    const $ = (s) => root.querySelector(s);

    function drawBar() {
      const p = prov[pid];
      setTitle(p.name);
      $('#provs').innerHTML = enabled.length > 1 ? enabled.map((id) => `<button type="button" class="ai-prov" data-p="${id}" aria-pressed="${id === pid}">${badge(prov[id])}${esc(prov[id].name)}</button>`).join('') : `<span class="prov-head">${badge(p)}<span><b>${esc(p.name)}</b><small class="dim">${esc(p.company || '')}</small></span></span>`;
      const tabs = [['chat', 'Chat', 'message', p.chat], ['cli', 'Terminal', 'terminal', !!p.cli], ['web', 'Website', 'globe', !!p.web]].filter((t) => t[3]);
      $('#tabs').innerHTML = tabs.map(([id, n, ic]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${tab === id}">${icon(ic, 'ico-sm')}${n}</button>`).join('');
      $('#tabs').hidden = tabs.length < 2;
    }
    $('#provs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b || b.dataset.p === pid) return;
      pid = b.dataset.p; store.set('aiProvider', pid);
      threadId = null; tab = defTab(prov[pid]);
      history.replaceState(null, '', `#/ai?provider=${pid}`);
      show();
    });
    $('#tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b || b.dataset.tab === tab) return;
      tab = b.dataset.tab;
      history.replaceState(null, '', `#/ai?provider=${pid}&tab=${tab}`);
      show();
    });

    async function show() {
      teardown?.(); teardown = null;
      drawBar();
      const body = $('#body');
      body.innerHTML = '';
      const p = prov[pid];
      if (tab === 'web' || (!p.chat && !p.cli)) teardown = webView(body, p);
      else if (tab === 'cli') teardown = await terminalView(body, p, { install: query.get('install') === '1' });
      else teardown = await chatView(body, p);
    }

    // ---------------- Website ----------------
    function webView(body, p) {
      const others = enabled.filter((id) => id !== p.id && prov[id].web);
      body.innerHTML = `<div class="ai-center"><div class="card">
        <div class="row">${badge(p)}<h2>${esc(p.name)}</h2></div>
        <p class="muted" style="margin:0">Opens ${esc(p.name)}'s own website in a separate window, signed in with <b>your account</b>, so your plan, history and settings are all there.</p>
        <div class="row"><button class="btn btn-primary" type="button" id="open-web" ${p.web ? '' : 'disabled'}>${icon('external')}Open ${esc(p.name)}</button>
          ${p.chat ? `<button class="btn btn-ghost" type="button" data-tab-go="chat">${icon('message')}Chat inside ${esc(state.settings.profile.title || 'HQ')} instead</button>` : ''}</div>
        ${p.web ? `<p class="help" style="margin:0">${esc(p.web)}</p>` : '<p class="help" style="margin:0">Add its website in Settings → AI.</p>'}
        ${others.length ? `<hr class="hr" style="margin:4px 0"><div class="label">Your other AIs</div><div class="row">${others.map((id) => `<button class="btn btn-ghost btn-sm" type="button" data-web="${id}">${badge(prov[id])}${esc(prov[id].name)}</button>`).join('')}</div>` : ''}
      </div></div>`;
      const open = (id) => api('/api/ai/open-web', { method: 'POST', body: { provider: id } }).then(() => toast(`${prov[id].name} opened in its own window`, 'ok', 2000)).catch((e) => toast(e.message, 'err'));
      body.querySelector('#open-web')?.addEventListener('click', () => open(p.id));
      body.querySelectorAll('[data-web]').forEach((b) => b.addEventListener('click', () => open(b.dataset.web)));
      body.querySelector('[data-tab-go]')?.addEventListener('click', () => { tab = 'chat'; show(); });
      return null;
    }

    // ---------------- Chat ----------------
    async function chatView(body, p) {
      if (!p.hasKey) {
        body.innerHTML = `<div class="ai-center"><div class="card">
          <div class="row">${badge(p)}<h2>Chat with ${esc(p.name)}</h2></div>
          <p class="muted" style="margin:0">To chat inside HQ, paste a ${esc(p.name)} API key${p.keyUrl ? ` (<a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">get one here</a>)` : ''}. It stays on this PC. API use is billed by ${esc(p.company)}, separately from a ${esc(p.name)} subscription.</p>
          <form class="key-row" id="key-form"><input class="input" type="password" id="key" autocomplete="off" spellcheck="false" placeholder="${esc(p.keyHint || 'API key')}" aria-label="${esc(p.name)} API key"><button class="btn btn-primary btn-sm" type="submit">Connect</button></form>
          <div class="state-line" id="key-state"></div>
          ${p.web ? `<hr class="hr" style="margin:4px 0"><p class="muted" style="margin:0">No API key? Use your normal ${esc(p.name)} account instead:</p><div class="row"><button class="btn btn-ghost" type="button" id="use-web">${icon('external')}Open ${esc(p.name)} with my account</button></div>` : ''}
        </div></div>`;
        body.querySelector('#key-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const key = body.querySelector('#key').value.trim();
          if (!key) return;
          const st = body.querySelector('#key-state');
          st.className = 'state-line'; st.innerHTML = '<span class="dot"></span>Checking…';
          const r = await api('/api/ai/key', { method: 'POST', body: { provider: p.id, key } }).catch((err) => ({ ok: false, error: err.message }));
          if (!r.ok) { st.className = 'state-line err'; st.innerHTML = `<span class="dot"></span>${esc(r.error)}`; return; }
          Object.assign(prov, await loadProviders(true));
          toast(`${p.name} connected`, 'ok');
          show();
        });
        body.querySelector('#use-web')?.addEventListener('click', () => { tab = 'web'; show(); });
        return null;
      }

      body.innerHTML = `<div class="chat">
        <aside class="threads">
          <div class="threads-head"><button class="btn btn-primary" type="button" id="new">${icon('plus')}New chat</button></div>
          <ul class="thread-list" id="threads"></ul>
        </aside>
        <section class="convo" id="convo"></section>
      </div>`;
      const threadsEl = body.querySelector('#threads');
      const convo = body.querySelector('#convo');
      let current = null;
      let reader = null;
      let disposed = false;
      let models = null;

      const chatProviders = () => enabled.filter((id) => prov[id].chat && prov[id].hasKey);
      async function loadThreads() {
        const list = await api('/api/ai/threads').catch(() => []);
        if (disposed) return;
        threadsEl.innerHTML = list.map((t) => `<li><a href="#/ai/${t.id}" ${current?.id === t.id ? 'aria-current="page"' : ''} style="--c:${esc(prov[t.provider]?.color || 'var(--ember)')}"><span class="tt">${esc(t.title)}</span><span class="tm"><i></i><span>${esc(prov[t.provider]?.name || t.provider)}</span><span>${ago(t.updated)}</span>${t.busy ? '<span style="color:var(--ember)">answering…</span>' : ''}</span></a></li>`).join('') || '<li class="help" style="padding:10px 12px">No chats yet.</li>';
      }

      const msgHtml = (m, i) => {
        if (m.role === 'user') return `<div class="msg user"><div class="av">${esc((state.settings.profile.name || 'Y').charAt(0).toUpperCase())}</div><div><div class="who">${esc(state.settings.profile.name || 'You')}</div><div class="body">${esc(m.text)}</div></div></div>`;
        const pp = prov[m.provider] || p;
        const meta = [m.model, m.ms ? `${(m.ms / 1000).toFixed(1)}s` : null, m.stopped ? 'stopped' : null].filter(Boolean).join(' · ');
        return `<div class="msg assistant" data-i="${i}" style="--c:${esc(pp.color)}"><div class="av">${esc(pp.name.charAt(0))}</div><div style="min-width:0">
          <div class="who">${esc(pp.name)}${meta ? `<span class="meta dim">${esc(meta)}</span>` : ''}</div>
          <div class="md body">${m.text ? markdown(m.text) : m.error ? '' : '<span class="typing"><i></i><i></i><i></i></span>'}</div>
          ${m.error ? `<div class="pill err-pill" style="margin-top:8px;height:auto;padding:6px 10px;white-space:normal">${icon('alert', 'ico-sm')} ${esc(m.error)}</div>` : ''}
          ${m.text ? `<button class="btn btn-ghost btn-sm copy" type="button" data-copy="${i}">${icon('file', 'ico-sm')}Copy</button>` : ''}
        </div></div>`;
      };

      async function modelOptions(providerId, cur) {
        try { models = await api(`/api/ai/models?provider=${providerId}`); } catch { models = { models: cur ? [cur] : [], default: cur }; }
        const list = [...new Set([...(cur ? [cur] : []), ...models.models])];
        return list.map((m) => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
      }

      async function draw() {
        const t = current;
        const tp = t ? t.provider : p.id;
        const mdl = t ? t.model : (state.settings.ai.providers[tp]?.model || '');
        setTitle(t ? t.title : prov[tp].name);
        convo.innerHTML = `<div class="convo-head">
            <h2 title="${esc(t?.title || 'New chat')}">${esc(t?.title || 'New chat')}</h2>
            <select class="input" id="c-prov" aria-label="AI">${chatProviders().map((id) => `<option value="${id}" ${id === tp ? 'selected' : ''}>${esc(prov[id].name)}</option>`).join('')}</select>
            <select class="input" id="c-model" aria-label="Model"><option value="${esc(mdl)}">${esc(mdl || 'loading models…')}</option></select>
            ${t ? `<button class="btn btn-ghost btn-sm btn-icon" id="c-del" type="button" title="Delete chat" aria-label="Delete chat">${icon('trash')}</button>` : ''}
          </div>
          <div class="messages" id="msgs">${t?.messages.length ? t.messages.map(msgHtml).join('') : `<div class="chat-empty">${badge(prov[tp])}<h2>${esc(prov[tp].name)}</h2>
              <p class="muted" style="margin:0">Ask anything. Chats are saved on this PC.</p>
              <div class="suggest">${SUGGEST.map((x) => `<button type="button" data-suggest="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`}</div>
          <div class="composer">
            <div class="composer-box">
              <textarea id="c-input" rows="1" placeholder="Message ${esc(prov[tp].name)}…" aria-label="Message"></textarea>
              <button class="btn btn-primary btn-icon" id="c-send" type="button" aria-label="Send">${icon(t?.busy ? 'stop' : 'send')}</button>
            </div>
            <div class="hint"><span><kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span><span>${esc(prov[tp].company)} API · your key</span></div>
          </div>`;
        const msgs = convo.querySelector('#msgs');
        msgs.scrollTop = msgs.scrollHeight;
        const input = convo.querySelector('#c-input');
        const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(220, input.scrollHeight)}px`; };
        input.addEventListener('input', grow);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); convo.querySelector('#c-send').click(); } });
        convo.querySelector('#c-send').addEventListener('click', () => {
          if (current?.busy) { api(`/api/ai/threads/${current.id}/stop`, { method: 'POST' }).catch(() => {}); return; }
          const text = input.value.trim();
          if (!text) return;
          input.value = ''; grow();
          send(text);
        });
        convo.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.suggest; grow(); input.focus(); }));
        convo.querySelector('#c-prov').addEventListener('change', async (e) => {
          const np = e.target.value;
          if (current) { current = { ...current, ...(await api(`/api/ai/threads/${current.id}`, { method: 'PATCH', body: { provider: np, model: state.settings.ai.providers[np]?.model || '' } })) }; }
          else { pid = np; store.set('aiProvider', pid); drawBar(); }
          draw();
        });
        convo.querySelector('#c-model').innerHTML = await modelOptions(tp, mdl || '');
        if (!mdl && models?.default) convo.querySelector('#c-model').value = models.default;
        convo.querySelector('#c-model').addEventListener('change', async (e) => {
          if (current) current = { ...current, ...(await api(`/api/ai/threads/${current.id}`, { method: 'PATCH', body: { model: e.target.value } })) };
        });
        convo.querySelector('#c-del')?.addEventListener('click', async (e) => {
          const b = e.currentTarget;
          if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.innerHTML = 'Delete?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('confirm'); b.innerHTML = icon('trash'); } }, 3000); return; }
          await api(`/api/ai/threads/${current.id}`, { method: 'DELETE' });
          current = null; threadId = null;
          history.replaceState(null, '', `#/ai?provider=${pid}&tab=chat`);
          loadThreads(); draw();
        });
        msgs.addEventListener('click', (e) => {
          const c = e.target.closest('[data-copy]');
          if (!c) return;
          navigator.clipboard.writeText(current.messages[Number(c.dataset.copy)].text).then(() => toast('Copied', 'ok', 1200)).catch(() => {});
        });
        if (!t?.busy) input.focus();
      }

      async function open(id) {
        try { current = await api(`/api/ai/threads/${id}`); }
        catch { current = null; }
        if (current && prov[current.provider]) { pid = current.provider; drawBar(); }
        loadThreads(); draw();
      }

      async function send(text) {
        if (!current) {
          const sel = convo.querySelector('#c-model')?.value || '';
          current = await api('/api/ai/threads', { method: 'POST', body: { provider: convo.querySelector('#c-prov')?.value || p.id, model: sel } });
          threadId = current.id;
          history.replaceState(null, '', `#/ai/${current.id}`);
        }
        current.messages.push({ role: 'user', text }, { role: 'assistant', text: '', provider: current.provider, model: current.model });
        current.busy = true;
        await draw();
        loadThreads();
        const msgs = convo.querySelector('#msgs');
        const last = () => msgs.querySelector('.msg.assistant:last-of-type .body');
        const msg = current.messages[current.messages.length - 1];
        let pending = false;
        const paint = () => { pending = false; const el = last(); if (el) { const stick = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80; el.innerHTML = markdown(msg.text); if (stick) msgs.scrollTop = msgs.scrollHeight; } };
        try {
          const res = await fetch(`/api/ai/threads/${current.id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ': '1' }, body: JSON.stringify({ text }) });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
          reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let cut;
            while ((cut = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, cut); buf = buf.slice(cut + 2);
              const ev = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (!ev || !data) continue;
              const d = JSON.parse(data);
              if (ev === 'delta') { msg.text += d.text; if (!pending) { pending = true; requestAnimationFrame(paint); } }
              else if (ev === 'done') Object.assign(msg, d);
              else if (ev === 'error') msg.error = d.error;
            }
          }
        } catch (e) { if (!disposed) msg.error = e.message; }
        reader = null;
        if (disposed) return;
        current.busy = false;
        if (current.messages.length <= 2) { try { current = await api(`/api/ai/threads/${current.id}`); } catch {} }
        draw(); loadThreads();
      }

      body.querySelector('#new').addEventListener('click', () => { current = null; threadId = null; history.replaceState(null, '', `#/ai?provider=${pid}&tab=chat`); loadThreads(); draw(); });
      threadsEl.addEventListener('click', (e) => { const a = e.target.closest('a[href^="#/ai/"]'); if (!a) return; e.preventDefault(); threadId = a.getAttribute('href').split('/').pop(); history.replaceState(null, '', a.getAttribute('href')); open(threadId); });
      if (threadId) await open(threadId); else { await loadThreads(); await draw(); }
      if (query.get('new') === '1') convo.querySelector('#c-input')?.focus();
      return () => { disposed = true; reader?.cancel().catch(() => {}); };
    }

    // ---------------- Terminal ----------------
    async function terminalView(body, p, { install } = {}) {
      const st = await api('/api/ai/cli').catch(() => ({ clis: {} }));
      const ci = st.clis?.[p.id];
      if (!st.pty) { body.innerHTML = `<div class="ai-center"><div class="card">${icon('alert')}<b>Terminal support is missing from this install.</b><p class="muted">Reinstall HQ to get it back.</p></div></div>`; return null; }
      if (!ci?.installed && !install) {
        body.innerHTML = `<div class="ai-center"><div class="card">
          <div class="row">${badge(p)}<h2>${esc(p.name)} in a terminal</h2></div>
          <p class="muted" style="margin:0"><span class="mono">${esc(p.cli)}</span> is ${esc(p.company)}'s official terminal app: it can read and edit files in your projects, run commands and answer questions. You sign in inside it with your ${esc(p.name)} account.</p>
          <div class="row"><button class="btn btn-primary" type="button" id="inst" ${st.npm ? '' : 'disabled'}>${icon('download')}Install ${esc(p.cli)}</button><span class="help">Runs <span class="mono">npm install -g ${esc(p.cliPkg)}</span> (about a minute).</span></div>
          ${st.npm ? '' : '<p class="help" style="color:var(--err)">npm (part of Node.js) was not found. Run the HQ installer again.</p>'}
        </div></div>`;
        body.querySelector('#inst')?.addEventListener('click', () => { body.innerHTML = ''; terminalView(body, p, { install: true }).then((t) => { teardown = t; }); });
        return null;
      }
      return mountTerminal(body, p, { install: !ci?.installed });
    }

    async function mountTerminal(body, p, { install }) {
      body.innerHTML = `<div class="term-page">
        <div class="term-bar">
          <div class="term-tabs" id="ttabs" role="tablist" aria-label="Terminals"></div>
          <div class="new-wrap">
            <button class="btn btn-ghost btn-sm" type="button" id="tnew" aria-haspopup="true" aria-expanded="false">${icon('plus', 'ico-sm')}New</button>
            <div class="menu" id="tmenu" hidden>
              <button type="button" data-new="home">${icon('terminal', 'ico-sm')}${esc(p.name)} · home folder</button>
              <label class="menu-proj">${icon('folder', 'ico-sm')}<select id="tproj" aria-label="${esc(p.name)} in a project"><option value="">${esc(p.name)} in a project…</option></select></label>
              <button type="button" data-new="shell">${icon('code', 'ico-sm')}PowerShell</button>
            </div>
          </div>
          <span class="spacer"></span>
          <span class="dim ver" id="tver"></span>
          <button class="btn btn-ghost btn-sm" type="button" id="tupd" title="Update ${esc(p.cli)}">${icon('refresh', 'ico-sm')}Update</button>
        </div>
        <div class="term-host" id="thost"></div>
      </div>`;
      const host = body.querySelector('#thost');
      const views = new Map();
      let active = null;
      let disposed = false;
      let mod;
      try { mod = await loadXterm(); } catch (e) { host.innerHTML = `<div class="empty">${icon('alert')}<div>The terminal could not load: ${esc(e.message)}</div></div>`; return null; }
      const refreshVer = () => api('/api/ai/cli').then((c) => { const x = c.clis?.[p.id]; body.querySelector('#tver').textContent = x?.installed ? `${p.cli} ${x.version || ''}` : `${p.cli} not installed`; }).catch(() => {});
      refreshVer();
      if (state.settings.nav.some((n) => n.id === 'projects' && n.on)) {
        catalog().then((cat) => { body.querySelector('#tproj')?.insertAdjacentHTML('beforeend', cat.projects.filter((x) => x.exists).sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')); }).catch(() => {});
      } else body.querySelector('.menu-proj').hidden = true;

      const THEME = {
        background: cssVar('--bg') || '#0A0A0A', foreground: cssVar('--fg') || '#F2F2F2', cursor: cssVar('--ember') || '#FF7A1A', cursorAccent: cssVar('--bg') || '#0A0A0A', selectionBackground: `${cssVar('--ember')}66`,
        black: '#1A1A1A', red: '#E8261C', green: '#3DDC97', yellow: '#FFD27A', blue: '#5AB8FF', magenta: '#FF6A9A', cyan: '#5FD4D0', white: '#E4E4E4',
        brightBlack: '#6E6E6E', brightRed: '#FF5A4D', brightGreen: '#6BE8B2', brightYellow: '#FFE2A3', brightBlue: '#8CCBFF', brightMagenta: '#FF93B5', brightCyan: '#8BE6E2', brightWhite: '#FFFFFF',
      };
      if (document.documentElement.dataset.mode === 'light') Object.assign(THEME, { black: '#2A2A2A', white: '#5A5A5A', brightWhite: '#1A1A1A', yellow: '#8A5A00', brightYellow: '#A66300', green: '#138A57', cyan: '#0F7C79' });

      function sendInput(v, data) {
        v.queue += data;
        if (v.sending) return;
        v.sending = true;
        (async () => {
          while (v.queue) { const chunk = v.queue; v.queue = ''; try { await api(`/api/term/${v.id}/input`, { method: 'POST', body: { data: chunk } }); } catch {} }
          v.sending = false;
        })();
      }
      function attach(s) {
        const el = document.createElement('div');
        el.className = 'term';
        host.append(el);
        const term = new mod.Terminal({ theme: THEME, fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, monospace', fontSize: 14, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, allowProposedApi: true });
        const fit = new mod.FitAddon();
        term.loadAddon(fit);
        term.open(el);
        const v = { id: s.id, title: s.title, kind: s.kind, term, fit, el, queue: '', sending: false, exited: false, seq: 0, ready: false, early: [] };
        views.set(s.id, v);
        term.attachCustomKeyEventHandler((e) => {
          if (e.type !== 'keydown') return true;
          if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c' && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); term.clearSelection(); return false; }
          if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') { navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {}); return false; }
          return true;
        });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); term.clearSelection(); } else navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {}); });
        term.onData((d) => { if (!v.exited) sendInput(v, d); });
        api(`/api/term/${s.id}`).then((snap) => {
          if (snap.buffer) term.write(snap.buffer);
          v.seq = snap.seq; v.ready = true;
          for (const d of v.early) if (d.seq > v.seq) { term.write(d.data); v.seq = d.seq; }
          v.early = [];
          if (snap.exited) ended(v, snap.exitCode);
        }).catch(() => ended(v, null));
        return v;
      }
      function ended(v, code) {
        if (v.exited) return;
        v.exited = true;
        const fin = v.kind === 'install' || v.kind === 'update';
        v.term.write(`\r\n\x1b[38;2;150;150;150m— ${fin ? (code ? `failed (code ${code})` : 'finished') : `session ended${code ? ` (code ${code})` : ''}`}. Press Enter to ${fin ? `start ${p.name}` : 'start a new one'}. —\x1b[0m\r\n`);
        if (fin) refreshVer();
        const once = v.term.onData((d) => { if (d === '\r') { once.dispose(); restart(v); } });
        drawTabs();
      }
      async function restart(v) {
        const kind = v.kind === 'shell' ? 'shell' : 'ai';
        await close(v.id, true);
        await create({ kind });
      }
      function fitActive() {
        const v = views.get(active);
        if (!v || v.el.hidden || !host.clientWidth) return;
        try { v.fit.fit(); } catch { return; }
        const { cols, rows } = v.term;
        if (v.cols !== cols || v.rows !== rows) { v.cols = cols; v.rows = rows; if (!v.exited) api(`/api/term/${v.id}/resize`, { method: 'POST', body: { cols, rows } }).catch(() => {}); }
      }
      let fitT;
      const ro = new ResizeObserver(() => { clearTimeout(fitT); fitT = setTimeout(fitActive, 60); });
      ro.observe(host);
      function select(id) {
        active = id;
        for (const [vid, v] of views) v.el.hidden = vid !== id;
        drawTabs();
        requestAnimationFrame(() => { fitActive(); views.get(id)?.term.focus(); });
      }
      function drawTabs() {
        body.querySelector('#ttabs').innerHTML = [...views.values()].map((v) => `<div class="term-tab ${v.id === active ? 'on' : ''} ${v.exited ? 'ended' : ''}" role="tab" aria-selected="${v.id === active}">
          <button type="button" data-tab="${v.id}">${icon(v.kind === 'shell' ? 'code' : 'terminal', 'ico-sm')}<span>${esc(v.title)}</span></button>
          <button type="button" class="x" data-close="${v.id}" aria-label="Close ${esc(v.title)}">${icon('x', 'ico-sm')}</button></div>`).join('');
      }
      async function create(b = {}) {
        try {
          const s = await api('/api/term', { method: 'POST', body: { provider: p.id, kind: 'ai', ...b, cols: 120, rows: 32 } });
          if (disposed) return;
          attach(s); select(s.id);
        } catch (e) { toast(e.message, 'err'); }
      }
      async function close(id, quiet) {
        const v = views.get(id);
        if (!v) return;
        v.term.dispose(); v.el.remove(); views.delete(id);
        await api(`/api/term/${id}`, { method: 'DELETE' }).catch(() => {});
        if (active === id) { const next = [...views.keys()].pop(); if (next) select(next); else if (!quiet) await create(); }
        drawTabs();
      }
      body.querySelector('#ttabs').addEventListener('click', (e) => {
        const c = e.target.closest('[data-close]');
        if (c) { close(c.dataset.close); return; }
        const t = e.target.closest('[data-tab]');
        if (t) select(t.dataset.tab);
      });
      const menu = body.querySelector('#tmenu');
      const toggleMenu = (on) => { menu.hidden = !on; body.querySelector('#tnew').setAttribute('aria-expanded', String(on)); };
      body.querySelector('#tnew').addEventListener('click', () => toggleMenu(menu.hidden));
      menu.addEventListener('click', (e) => { const b = e.target.closest('[data-new]'); if (!b) return; toggleMenu(false); create(b.dataset.new === 'shell' ? { kind: 'shell' } : {}); });
      body.querySelector('#tproj').addEventListener('change', (e) => { if (!e.target.value) return; toggleMenu(false); create({ projectId: e.target.value }); e.target.value = ''; });
      const onDoc = (e) => { if (!e.target.closest('.new-wrap')) toggleMenu(false); };
      document.addEventListener('mousedown', onDoc);
      body.querySelector('#tupd').addEventListener('click', () => create({ kind: 'update' }));

      const onTerm = (e) => { const d = e.detail; const v = views.get(d.id); if (!v) return; if (!v.ready) { v.early.push(d); return; } if (d.seq > v.seq) { v.term.write(d.data); v.seq = d.seq; } };
      const onTermExit = (e) => { const v = views.get(e.detail.id); if (v && !e.detail.closed) ended(v, e.detail.exitCode); };
      state.events.addEventListener('term', onTerm);
      state.events.addEventListener('term:exit', onTermExit);

      // Reattach to this AI's sessions that kept running while on other pages.
      const existing = (await api('/api/term').catch(() => [])).filter((s) => s.provider === p.id || s.kind === 'shell');
      for (const s of existing) { attach(s); select(s.id); }
      const want = new URLSearchParams(location.hash.split('?')[1] || '').get('project');
      if (install) await create({ kind: 'install' });
      else if (want) await create({ projectId: want });
      else if (existing.length) select(existing.at(-1).id);
      else await create();

      return () => {
        disposed = true; ro.disconnect();
        document.removeEventListener('mousedown', onDoc);
        state.events.removeEventListener('term', onTerm);
        state.events.removeEventListener('term:exit', onTermExit);
        for (const v of views.values()) v.term.dispose();
        views.clear();
      };
    }

    await show();
    return {
      update: (prm, q) => {
        if (prm.id && prm.id !== threadId) { threadId = prm.id; tab = 'chat'; show(); }
        else if (!prm.id && (q.get('provider') || q.get('tab') || q.get('new'))) {
          const np = q.get('provider');
          if (np && enabled.includes(np)) pid = np;
          tab = q.get('tab') || defTab(prov[pid]);
          threadId = null; show();
        }
      },
      cleanup: () => { teardown?.(); },
    };
  },
};

let xtermMod = null;
async function loadXterm() {
  if (xtermMod) return xtermMod;
  if (!document.querySelector('link[data-xterm]')) {
    await new Promise((resolve) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = '/vendor/xterm.css'; l.dataset.xterm = '1';
      l.onload = l.onerror = resolve;
      document.head.append(l);
    });
  }
  await document.fonts?.ready;
  const [{ Terminal }, { FitAddon }] = await Promise.all([import('/vendor/xterm.mjs'), import('/vendor/addon-fit.mjs')]);
  xtermMod = { Terminal, FitAddon };
  return xtermMod;
}
