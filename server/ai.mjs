// HQ's own AI chat. The owner picks the provider (Claude, ChatGPT, Gemini, DeepSeek, …) and pastes
// an API key once; keys stay in secrets.json on this PC and every request goes straight from here
// to the provider. Claude uses Anthropic's official SDK; the others speak the OpenAI-compatible API.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { DATA, readJson, writeJson, exists } from './util.mjs';
import { PROVIDERS, getSettings, getKey } from './config.mjs';

const DIR = path.join(DATA, 'chat');
const threads = new Map();
const running = new Map(); // threadId -> AbortController
let loaded = false;

async function loadThreads() {
  if (loaded) return;
  loaded = true;
  await fs.mkdir(DIR, { recursive: true });
  for (const f of await fs.readdir(DIR)) {
    if (!f.endsWith('.json')) continue;
    const t = await readJson(path.join(DIR, f), null);
    if (t?.id) threads.set(t.id, t);
  }
}
const save = (t) => writeJson(path.join(DIR, `${t.id}.json`), t);
const summary = ({ messages, ...t }) => ({ ...t, count: messages.length, busy: running.has(t.id) });

/** Provider facts the browser may see (no regexes, no keys). */
export async function providerInfo() {
  const s = await getSettings();
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const own = s.ai.providers[id] || {};
    out[id] = {
      id, name: (p.custom && own.name) || p.name, company: p.company, color: p.color,
      chat: !!p.kind, web: (p.custom ? own.web : p.web) || null, cli: p.cli || null, cliPkg: p.cliPkg || null,
      keyUrl: p.keyUrl || null, keyHint: p.keyHint || '', noKey: !!p.noKey, custom: !!p.custom,
      base: (p.custom || id === 'ollama') ? (own.base || p.base || '') : undefined,
      hasKey: p.noKey ? true : !!(await getKey(id)),
      model: own.model || '', mode: own.mode || null,
    };
  }
  return out;
}

async function baseOf(id) {
  const p = PROVIDERS[id];
  const own = (await getSettings()).ai.providers[id] || {};
  return String(own.base || p.base || '').replace(/\/+$/, '');
}

function rank(ids, prefer = []) {
  const ver = (s) => (s.match(/\d+(\.\d+)?/g) || []).map(Number);
  for (const re of prefer) {
    const hits = ids.filter((m) => re.test(m));
    if (hits.length) return hits.sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0); } return a.length - b.length; })[0];
  }
  return ids[0] || '';
}

const modelCache = new Map();
const claudeLimits = new Map(); // model id -> max output tokens

/** Live model list from the provider (cached 10 min) plus a sensible default. */
export async function listModels(id, { fresh = false } = {}) {
  const p = PROVIDERS[id];
  if (!p?.kind) throw Object.assign(new Error(`${p?.name || id} has no API chat — open it as a web app instead`), { status: 400 });
  const key = await getKey(id);
  const cacheKey = `${id}:${key.slice(-6)}:${await baseOf(id)}`;
  const hit = modelCache.get(cacheKey);
  if (!fresh && hit && Date.now() - hit.t < 10 * 60_000) return hit.v;
  if (!key && !p.noKey) throw Object.assign(new Error(`Add your ${p.name} API key first`), { status: 400 });
  let ids = [];
  if (p.kind === 'anthropic') {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 15000 });
    for await (const m of client.models.list({ limit: 100 })) {
      ids.push(m.id);
      if (m.max_tokens) claudeLimits.set(m.id, m.max_tokens);
    }
  } else if (p.models) {
    ids = p.models.slice();
    // still verify the key with a tiny request so "Test" means something
    await openaiChat(id, ids[0], [{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 5 });
  } else {
    const base = await baseOf(id);
    if (!base) throw Object.assign(new Error('Set the server address first'), { status: 400 });
    const res = await fetch(`${base}/models`, { headers: authHeaders(id, key), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(friendly(res.status, await res.text(), p.name));
    const j = await res.json();
    ids = (j.data || j.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
    if (p.filter) ids = ids.filter((m) => p.filter.test(m) && !/(embed|tts|whisper|dall-e|image|audio|realtime|transcribe|moderation|search-preview|aqa|veo|imagen|vision-preview|-live)/i.test(m));
  }
  ids = [...new Set(ids)].sort();
  const v = { models: ids, default: rank(ids, p.prefer) };
  modelCache.set(cacheKey, { t: Date.now(), v });
  return v;
}

function authHeaders(id, key) {
  const h = {};
  if (key) h.Authorization = `Bearer ${key}`;
  if (id === 'openrouter') { h['HTTP-Referer'] = 'http://127.0.0.1'; h['X-Title'] = 'HQ'; }
  return h;
}

function friendly(status, body, name) {
  let msg = '';
  try { const j = JSON.parse(body); msg = j.error?.message || j.message || j.error || ''; if (Array.isArray(j) && j[0]?.error) msg = j[0].error.message; } catch { msg = String(body || '').slice(0, 200); }
  if (status === 401 || status === 403) return `${name} refused the API key (${status}). Check it in Settings → AI.`;
  if (status === 429) return `${name} says you're over your limit or out of credit right now. ${msg}`.trim();
  if (status === 404) return `${name} doesn't know that model (or the address is wrong). ${msg}`.trim();
  return `${name}: ${msg || `HTTP ${status}`}`;
}

/** Test a provider: returns the models or a readable error. */
export async function testProvider(id) {
  try { return { ok: true, ...(await listModels(id, { fresh: true })) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ---------- threads ----------
export async function listThreads() {
  await loadThreads();
  return [...threads.values()].sort((a, b) => b.updated.localeCompare(a.updated)).map(summary);
}
export async function getThread(id) { await loadThreads(); const t = threads.get(id); return t ? { ...t, busy: running.has(id) } : null; }

export async function createThread({ provider, model } = {}) {
  await loadThreads();
  const s = await getSettings();
  const pid = PROVIDERS[provider]?.kind ? provider : s.ai.primary;
  const now = new Date().toISOString();
  const t = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title: 'New chat', provider: pid, model: String(model || s.ai.providers[pid]?.model || ''), created: now, updated: now, messages: [] };
  threads.set(t.id, t);
  await save(t);
  return t;
}

export async function updateThread(id, patch = {}) {
  await loadThreads();
  const t = threads.get(id);
  if (!t) return null;
  if (typeof patch.title === 'string' && patch.title.trim()) t.title = patch.title.trim().slice(0, 120);
  if (PROVIDERS[patch.provider]?.kind) t.provider = patch.provider;
  if (typeof patch.model === 'string') t.model = patch.model.slice(0, 120);
  t.updated = new Date().toISOString();
  await save(t);
  return t;
}

export async function deleteThread(id) {
  running.get(id)?.abort();
  threads.delete(id);
  await fs.rm(path.join(DIR, `${id}.json`), { force: true });
}

export function stopThread(id) { const c = running.get(id); if (c) c.abort(); return !!c; }

async function systemPrompt() {
  const s = await getSettings();
  const who = s.profile.name ? `You are talking with ${s.profile.name}.` : '';
  const today = `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
  return [s.ai.system, who, today].filter(Boolean).join('\n\n');
}

/** Send a user message and stream the answer: onDelta(text) per chunk; resolves to the finished message. */
export async function send(id, text, onDelta) {
  await loadThreads();
  const t = threads.get(id);
  if (!t) throw Object.assign(new Error('Chat not found'), { status: 404 });
  if (running.has(id)) throw Object.assign(new Error('Still answering — stop it first'), { status: 409 });
  const p = PROVIDERS[t.provider];
  if (!p?.kind) throw Object.assign(new Error('This AI has no chat API'), { status: 400 });
  const clean = String(text || '').trim().slice(0, 100_000);
  if (!clean) throw Object.assign(new Error('Empty message'), { status: 400 });

  if (!t.model) t.model = (await listModels(t.provider)).default;
  const now = new Date().toISOString();
  t.messages.push({ role: 'user', text: clean, at: now });
  if (t.title === 'New chat') t.title = clean.replace(/\s+/g, ' ').slice(0, 60) + (clean.length > 60 ? '…' : '');
  const msg = { role: 'assistant', text: '', at: now, provider: t.provider, model: t.model };
  t.messages.push(msg);
  t.updated = now;
  await save(t);

  const ctl = new AbortController();
  running.set(id, ctl);
  const started = Date.now();
  const delta = (d) => { if (!d) return; msg.text += d; onDelta?.(d); };
  try {
    const history = t.messages.slice(0, -1);
    if (p.kind === 'anthropic') {
      const raw = await claudeStream(t, history, delta, ctl.signal);
      if (raw) msg.raw = raw;
    } else {
      await openaiStream(t, history, delta, ctl.signal);
    }
  } catch (e) {
    if (ctl.signal.aborted) msg.stopped = true;
    else msg.error = e.message || String(e);
  } finally {
    running.delete(id);
    msg.ms = Date.now() - started;
    t.updated = new Date().toISOString();
    await save(t);
  }
  return msg;
}

// ---------- Claude (Anthropic SDK) ----------
async function claudeStream(t, history, delta, signal) {
  const key = await getKey('claude');
  if (!key) throw new Error('Add your Claude API key in Settings → AI');
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });
  // Assistant turns written by Claude are replayed exactly (thinking blocks included);
  // turns from another provider are replayed as their text.
  const messages = [];
  for (const m of history) {
    if (m.error && !m.text) continue;
    if (m.role === 'assistant') {
      const content = m.raw && m.provider === 'claude' ? m.raw : (m.text || '…');
      messages.push({ role: 'assistant', content });
    } else messages.push({ role: 'user', content: m.text });
  }
  while (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
  if (!claudeLimits.has(t.model)) { try { await listModels('claude'); } catch {} }
  const max = Math.min(64000, claudeLimits.get(t.model) || 8192);
  const system = await systemPrompt();
  // Fallbacks: if the model declines for policy reasons, Anthropic retries on its recommended model.
  const stream = client.beta.messages.stream({
    model: t.model, max_tokens: max, system: system || undefined, messages,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
  });
  const onAbort = () => stream.abort();
  signal.addEventListener('abort', onAbort);
  try {
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') delta(ev.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      delta('\n\n_Claude declined to answer this one._');
      return null;
    }
    if (final.model && final.model !== t.model) delta(`\n\n_Answered by ${final.model}._`);
    return final.content; // kept whole (thinking and fallback blocks too) so the next turn replays it exactly
  } catch (e) {
    if (signal.aborted) throw e;
    const status = e?.status;
    throw new Error(status ? friendly(status, JSON.stringify(e.error || { message: e.message }), 'Claude') : e.message);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// ---------- OpenAI-compatible (ChatGPT, Gemini, DeepSeek, Mistral, Grok, OpenRouter, Groq, Ollama, custom) ----------
function openaiMessages(history, system) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of history) {
    if (m.error && !m.text) continue;
    out.push({ role: m.role, content: m.text || '…' });
  }
  return out;
}

async function openaiChat(id, model, messages, { maxTokens } = {}) {
  const res = await fetch(`${await baseOf(id)}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(id, await getKey(id)) },
    body: JSON.stringify({ model, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) }), signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(friendly(res.status, await res.text(), PROVIDERS[id].name));
  return res.json();
}

async function openaiStream(t, history, delta, signal) {
  const p = PROVIDERS[t.provider];
  const key = await getKey(t.provider);
  if (!key && !p.noKey) throw new Error(`Add your ${p.name} API key in Settings → AI`);
  const base = await baseOf(t.provider);
  if (!base) throw new Error('Set the server address in Settings → AI');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeaders(t.provider, key) },
    body: JSON.stringify({ model: t.model, stream: true, messages: openaiMessages(history, await systemPrompt()) }),
  });
  if (!res.ok) throw new Error(friendly(res.status, await res.text(), p.name));
  const decoder = new TextDecoder();
  let buf = '';
  let citations = null;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        if (j.error) throw new Error(j.error.message || 'The AI returned an error');
        delta(j.choices?.[0]?.delta?.content || '');
        if (Array.isArray(j.citations)) citations = j.citations;
      } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
    }
  }
  if (citations?.length) delta(`\n\n**Sources**\n${citations.slice(0, 10).map((u, i) => `${i + 1}. ${u}`).join('\n')}`);
}

export function threadsDirExists() { return exists(DIR); }
