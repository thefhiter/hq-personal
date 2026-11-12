import { esc } from './md.js';
import { icon } from './icons.js';
export { esc };

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method, signal,
    headers: { ...(method !== 'GET' ? { 'X-HQ': '1' } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export function toast(message, kind = 'info', ms = 3800) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'flame')}<span>${esc(message)}</span>`;
  box.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}

export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function ago(date) {
  if (!date) return '—';
  const s = (new Date(date).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let u = units[0];
  for (const x of units) if (abs >= x[1]) u = x;
  return RTF.format(Math.round(s / u[1]), u[0]);
}
export const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString('en-GB', opts) : '—');
export const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
export const mmss = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
export const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

export function statusPill(status) {
  const label = { live: 'Live', shipped: 'Done', active: 'Active', paused: 'Paused', prototype: 'Prototype', reference: 'Reference' }[status] || status;
  return `<span class="pill st-${esc(status)}"><span class="dot"></span>${esc(label)}</span>`;
}

// ---------- heatmap ----------
// Heat levels follow the theme: empty cell, then four steps of the accent, then the highlight color.
const LEVELS = ['var(--surface-3)', 'color-mix(in oklab, var(--ember) 28%, var(--surface-2))', 'color-mix(in oklab, var(--ember) 52%, var(--surface-2))', 'color-mix(in oklab, var(--ember) 78%, var(--surface-2))', 'var(--ember)', 'var(--gold-bright)'];
export const heatLegend = () => `<div class="heat-legend">Less ${LEVELS.map((c) => `<i style="background:${c}"></i>`).join('')} More</div>`;

/** GitHub-style calendar heatmap as SVG; `values` = {YYYY-MM-DD: n}. */
export function heatmap(values, { weeks = 53, unit = 'commits', fmt = (v) => `${v} ${unit}` } = {}) {
  const cell = 13, gap = 3, top = 18, left = 28;
  const end = new Date(); end.setHours(12, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - (weeks - 1) * 7 - end.getDay());
  const vals = Object.values(values).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] || 1;
  const th = [q(0.2), q(0.45), q(0.7), q(0.9)];
  const level = (v) => (!v ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : v <= th[3] ? 4 : 5);
  let rects = '', months = '', lastMonth = -1, total = 0, active = 0;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + d);
      if (date > end) continue;
      const k = dayKey(date);
      const v = values[k] || 0;
      total += v; if (v) active++;
      const label = `${fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}: ${v ? fmt(v) : 'nothing'}`;
      rects += `<rect x="${left + w * (cell + gap)}" y="${top + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" style="fill:${LEVELS[level(v)]}" data-tip="${esc(label)}"><title>${esc(label)}</title></rect>`;
      if (d === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        months += `<text x="${left + w * (cell + gap)}" y="11" style="fill:var(--dim)" font-size="11" font-family="Barlow">${date.toLocaleString('en', { month: 'short' })}</text>`;
      }
    }
  }
  const dl = ['Mon', 'Wed', 'Fri'].map((n, i) => `<text x="0" y="${top + (i * 2 + 1) * (cell + gap) + 10}" style="fill:var(--dim)" font-size="10" font-family="Barlow">${n}</text>`).join('');
  const width = left + weeks * (cell + gap);
  const height = top + 7 * (cell + gap);
  return `<svg class="heat" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${fmt(total)} across ${active} active days in the last ${weeks} weeks`)}">${months}${dl}${rects}</svg>`;
}

/** Floating tooltip for any [data-tip] descendant. */
export function attachTips(root) {
  let tip = document.querySelector('.heat-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'heat-tip'; tip.hidden = true; document.body.append(tip); }
  root.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    tip.textContent = t.dataset.tip; tip.hidden = false;
    const r = t.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2)}px`;
    tip.style.top = `${r.top - tip.offsetHeight - 8}px`;
  });
  root.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });
}

// ---------- diffs ----------
export function renderDiff(diff, { open = 3 } = {}) {
  if (!diff || !diff.trim()) return `<div class="empty">${icon('check')}<div>No changes.</div></div>`;
  const files = [];
  let cur = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(line);
      cur = { path: m ? m[1] : line.slice(11), lines: [], add: 0, del: 0, binary: false };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^(index |new file|deleted file|similarity|rename |old mode|new mode|--- |\+\+\+ )/.test(line)) continue;
    if (line.startsWith('Binary files')) { cur.binary = true; continue; }
    cur.lines.push(line);
    if (line.startsWith('+')) cur.add++; else if (line.startsWith('-')) cur.del++;
  }
  return files.map((f, idx) => {
    let o = 0, n = 0;
    const rows = [];
    for (const line of f.lines.slice(0, 3000)) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (h) { o = Number(h[1]); n = Number(h[2]); rows.push(`<tr class="hunk"><td colspan="3">${esc(line)}</td></tr>`); continue; }
      if (line.startsWith('+')) rows.push(`<tr class="add"><td class="ln"></td><td class="ln">${n++}</td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith('-')) rows.push(`<tr class="del"><td class="ln">${o++}</td><td class="ln"></td><td>${esc(line)}</td></tr>`);
      else if (line.startsWith('\\')) rows.push(`<tr><td class="ln"></td><td class="ln"></td><td class="dim">${esc(line)}</td></tr>`);
      else if (line || o) rows.push(`<tr><td class="ln">${o++}</td><td class="ln">${n++}</td><td>${esc(line)}</td></tr>`);
    }
    if (f.lines.length > 3000) rows.push(`<tr class="hunk"><td colspan="3">… ${f.lines.length - 3000} more lines</td></tr>`);
    const body = f.binary ? '<div class="dim" style="padding:12px">Binary file changed</div>' : `<table>${rows.join('')}</table>`;
    return `<details class="diff-file" ${idx < open ? 'open' : ''}><summary>${icon('file', 'ico-sm')}<span>${esc(f.path)}</span><span class="stat"><span class="plus" style="color:var(--ok)">+${f.add}</span> <span style="color:var(--err)">−${f.del}</span></span></summary><div class="diff-body">${body}</div></details>`;
  }).join('');
}

// ---------- catalog cache shared by views ----------
let catalogPromise = null;
export function catalog(force = false) {
  if (force || !catalogPromise) catalogPromise = api('/api/catalog').catch((e) => { catalogPromise = null; throw e; });
  return catalogPromise;
}
export const catColor = (cats, id) => cats.find((c) => c.id === id)?.color || 'var(--ember)';
export const catName = (cats, id) => cats.find((c) => c.id === id)?.name || id;
