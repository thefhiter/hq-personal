// Personal settings (name, look, pages, AI, YouTube, folders) and secrets (API keys).
// Settings are plain JSON the owner fully controls: they can be exported, imported or reset.
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import { DATA, readJson, writeJson, expandHome } from './util.mjs';

export const configBus = new EventEmitter();
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const SECRETS_FILE = path.join(DATA, 'secrets.json');

export const PAGES = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'focus', label: 'Focus', icon: 'flame' },
  { id: 'music', label: 'Music', icon: 'music' },
  { id: 'ai', label: 'AI', icon: 'terminal' },
  { id: 'projects', label: 'Projects', icon: 'grid' },
  { id: 'notes', label: 'Notes', icon: 'memory' },
  { id: 'timeline', label: 'Timeline', icon: 'clock' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

/** Every AI the owner can pick. kind: how HQ's own chat talks to it (needs an API key);
 *  web: the provider's site, opened in its own window with the owner's account;
 *  cli: the provider's official terminal app, run inside HQ. */
export const PROVIDERS = {
  claude: { name: 'Claude', company: 'Anthropic', color: '#D97757', kind: 'anthropic', web: 'https://claude.ai/new', cli: 'claude', cliPkg: '@anthropic-ai/claude-code', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…', prefer: [/^claude-opus-5-5$/, /^claude-sonnet-5-5$/, /^claude-opus/, /^claude-sonnet/] },
  chatgpt: { name: 'ChatGPT', company: 'OpenAI', color: '#10A37F', kind: 'openai', base: 'https://api.openai.com/v1', web: 'https://chatgpt.com/', cli: 'codex', cliPkg: '@openai/codex', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5(\.\d+)?-mini$/, /^gpt-4\.1$/, /^gpt-4o$/], filter: /^(gpt-|o\d|chatgpt)/ },
  gemini: { name: 'Gemini', company: 'Google', color: '#4C8DF6', kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', web: 'https://gemini.google.com/app', cli: 'gemini', cliPkg: '@google/gemini-cli', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', prefer: [/gemini-[\d.]+-pro$/, /gemini-[\d.]+-flash$/], filter: /gemini/ },
  deepseek: { name: 'DeepSeek', company: 'DeepSeek', color: '#4D6BFE', kind: 'openai', base: 'https://api.deepseek.com/v1', web: 'https://chat.deepseek.com/', keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-…', prefer: [/^deepseek-chat$/] },
  mistral: { name: 'Mistral', company: 'Mistral AI', color: '#FA520F', kind: 'openai', base: 'https://api.mistral.ai/v1', web: 'https://chat.mistral.ai/chat', keyUrl: 'https://console.mistral.ai/api-keys', prefer: [/^mistral-large-latest$/, /^mistral-medium-latest$/] },
  grok: { name: 'Grok', company: 'xAI', color: '#E7E7E7', kind: 'openai', base: 'https://api.x.ai/v1', web: 'https://grok.com/', keyUrl: 'https://console.x.ai/', keyHint: 'xai-…', prefer: [/^grok-\d+$/, /^grok/] },
  perplexity: { name: 'Perplexity', company: 'Perplexity', color: '#20B8CD', kind: 'openai', base: 'https://api.perplexity.ai', web: 'https://www.perplexity.ai/', keyUrl: 'https://www.perplexity.ai/account/api/keys', keyHint: 'pplx-…', models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'], prefer: [/^sonar-pro$/, /^sonar$/] },
  copilot: { name: 'Copilot', company: 'Microsoft', color: '#2F8CF0', web: 'https://copilot.microsoft.com/' },
  openrouter: { name: 'OpenRouter', company: 'OpenRouter', color: '#7C7FF2', kind: 'openai', base: 'https://openrouter.ai/api/v1', web: 'https://openrouter.ai/chat', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…', prefer: [/^openrouter\/auto$/] },
  groq: { name: 'Groq', company: 'Groq', color: '#F55036', kind: 'openai', base: 'https://api.groq.com/openai/v1', web: 'https://console.groq.com/playground', keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_…', prefer: [/llama-3\.3-70b/, /llama/] },
  ollama: { name: 'Ollama', company: 'on this PC', color: '#F2F2F2', kind: 'openai', base: 'http://127.0.0.1:11434/v1', noKey: true, keyUrl: 'https://ollama.com/download' },
  custom: { name: 'Custom AI', company: 'any OpenAI-compatible server', color: '#9AA4B2', kind: 'openai', base: '', web: '', custom: true },
};

const THEMES = ['ember', 'ocean', 'emerald', 'violet', 'gold', 'crimson', 'sakura', 'mono', 'custom'];
const LOGOS = ['flame', 'bolt', 'crown', 'mountain', 'star', 'diamond', 'rocket', 'hexagon', 'initial', 'custom'];
const SCENES = /^[a-z0-9-]{1,40}$/;

export function defaults() {
  return {
    version: 1,
    setupDone: false,
    profile: { name: '', title: 'HQ' },
    theme: { preset: 'ember', mode: 'dark', accent: '#FF7A1A', logo: 'flame', logoFile: null, effects: true },
    nav: PAGES.map((p) => ({ id: p.id, on: true, label: '' })),
    links: [],
    ai: {
      primary: 'claude',
      enabled: ['claude'],
      providers: {},
      system: '',
      browser: 'auto',
    },
    youtube: { playlists: [] },
    folders: { projects: [], notes: [], claudeMemory: false },
    focus: { dailyGoalMin: 240, chime: true, scene: '' },
    github: { user: '' },
  };
}

let current = null;
let secrets = null;

const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const url = (v) => {
  const s = str(v, 400);
  if (s === undefined) return undefined;
  if (!s) return '';
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : undefined; } catch { return undefined; }
};
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined);
const set = (obj, key, v) => { if (v !== undefined) obj[key] = v; };

/** Merge an untrusted patch into the settings, keeping only known, valid fields. */
function apply(s, b = {}) {
  if (b.profile) {
    set(s.profile, 'name', str(b.profile.name, 40));
    const t = str(b.profile.title, 14);
    if (t !== undefined) s.profile.title = t || 'HQ';
  }
  if (b.theme) {
    if (THEMES.includes(b.theme.preset)) s.theme.preset = b.theme.preset;
    if (['dark', 'light', 'system'].includes(b.theme.mode)) s.theme.mode = b.theme.mode;
    set(s.theme, 'accent', hex(b.theme.accent));
    if (LOGOS.includes(b.theme.logo)) s.theme.logo = b.theme.logo;
    set(s.theme, 'effects', bool(b.theme.effects));
  }
  if (Array.isArray(b.nav)) {
    const seen = new Set();
    const nav = [];
    for (const n of b.nav) {
      if (!n || !PAGES.some((p) => p.id === n.id) || seen.has(n.id)) continue;
      seen.add(n.id);
      nav.push({ id: n.id, on: n.id === 'settings' ? true : n.on !== false, label: str(n.label, 24) || '' });
    }
    for (const p of PAGES) if (!seen.has(p.id)) nav.push({ id: p.id, on: p.id === 'settings', label: '' });
    s.nav = nav;
  }
  if (Array.isArray(b.links)) {
    s.links = b.links.slice(0, 12).map((l, i) => ({ id: str(l?.id, 20) || `l${Date.now().toString(36)}${i}`, name: str(l?.name, 24) || '', url: url(l?.url) || '' })).filter((l) => l.name && l.url);
  }
  if (b.ai) {
    if (Array.isArray(b.ai.enabled)) s.ai.enabled = [...new Set(b.ai.enabled.filter((id) => PROVIDERS[id]))];
    if (PROVIDERS[b.ai.primary]) s.ai.primary = b.ai.primary;
    if (!s.ai.enabled.includes(s.ai.primary)) s.ai.enabled.unshift(s.ai.primary);
    set(s.ai, 'system', str(b.ai.system, 4000));
    if (['auto', 'chrome', 'edge', 'default'].includes(b.ai.browser)) s.ai.browser = b.ai.browser;
    if (b.ai.providers && typeof b.ai.providers === 'object') {
      for (const [id, p] of Object.entries(b.ai.providers)) {
        if (!PROVIDERS[id] || !p || typeof p !== 'object') continue;
        const cur = s.ai.providers[id] || {};
        set(cur, 'model', str(p.model, 120));
        if (['chat', 'cli', 'web'].includes(p.mode)) cur.mode = p.mode;
        if (PROVIDERS[id].custom || id === 'ollama') {
          set(cur, 'name', str(p.name, 24));
          set(cur, 'base', url(p.base));
          if (PROVIDERS[id].custom) set(cur, 'web', url(p.web));
        }
        s.ai.providers[id] = cur;
      }
    }
  }
  if (b.youtube && Array.isArray(b.youtube.playlists)) {
    s.youtube.playlists = b.youtube.playlists.slice(0, 30).map((p) => ({ name: str(p?.name, 60) || 'Playlist', url: url(p?.url) || '' })).filter((p) => /youtu\.?be/.test(p.url));
  }
  if (b.folders) {
    const dirs = (list) => [...new Set(list.map((d) => str(d, 400)).filter(Boolean).map((d) => expandHome(d)))].slice(0, 20);
    if (Array.isArray(b.folders.projects)) s.folders.projects = dirs(b.folders.projects);
    if (Array.isArray(b.folders.notes)) s.folders.notes = dirs(b.folders.notes);
    set(s.folders, 'claudeMemory', bool(b.folders.claudeMemory));
  }
  if (b.focus) {
    if (Number(b.focus.dailyGoalMin) > 0) s.focus.dailyGoalMin = Math.min(960, Math.round(Number(b.focus.dailyGoalMin)));
    set(s.focus, 'chime', bool(b.focus.chime));
    if (typeof b.focus.scene === 'string' && (b.focus.scene === '' || SCENES.test(b.focus.scene))) s.focus.scene = b.focus.scene;
  }
  if (b.github) set(s.github, 'user', str(b.github.user, 40)?.replace(/[^\w-]/g, ''));
  if (typeof b.setupDone === 'boolean') s.setupDone = b.setupDone;
  return s;
}

export async function loadSettings() {
  if (current) return current;
  const saved = await readJson(SETTINGS_FILE, null);
  const base = defaults();
  current = saved ? apply(base, saved) : base;
  if (saved?.theme?.logoFile) current.theme.logoFile = saved.theme.logoFile;
  return current;
}

export async function getSettings() { return structuredClone(await loadSettings()); }

export async function updateSettings(patch) {
  const s = await loadSettings();
  apply(s, patch);
  await writeJson(SETTINGS_FILE, s);
  configBus.emit('change', s);
  return structuredClone(s);
}

export async function setLogoFile(name) {
  const s = await loadSettings();
  s.theme.logoFile = name;
  if (name) s.theme.logo = 'custom';
  else if (s.theme.logo === 'custom') s.theme.logo = 'flame';
  await writeJson(SETTINGS_FILE, s);
  return structuredClone(s);
}

export async function replaceSettings(next) {
  current = apply(defaults(), next || {});
  await writeJson(SETTINGS_FILE, current);
  configBus.emit('change', current);
  return structuredClone(current);
}

export async function resetSettings() {
  current = defaults();
  await fs.rm(SETTINGS_FILE, { force: true });
  configBus.emit('change', current);
  return structuredClone(current);
}

// ---------- secrets (API keys) — never sent back to the browser ----------
async function loadSecrets() {
  if (!secrets) secrets = await readJson(SECRETS_FILE, { keys: {} });
  secrets.keys ||= {};
  return secrets;
}
export async function getKey(provider) { return (await loadSecrets()).keys[provider] || ''; }
export async function setKey(provider, key) {
  if (!PROVIDERS[provider]) throw Object.assign(new Error('Unknown AI provider'), { status: 400 });
  const s = await loadSecrets();
  const k = String(key || '').trim().slice(0, 400);
  if (k) s.keys[provider] = k; else delete s.keys[provider];
  await writeJson(SECRETS_FILE, s);
}
/** Which providers have a key, with only the last 4 characters shown. */
export async function keyStatus() {
  const s = await loadSecrets();
  return Object.fromEntries(Object.entries(s.keys).filter(([, v]) => v).map(([k, v]) => [k, `…${v.slice(-4)}`]));
}
export async function clearSecrets() { secrets = { keys: {} }; await fs.rm(SECRETS_FILE, { force: true }); }
