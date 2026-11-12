// The owner's look: accent theme, light/dark mode and logo. Everything visual reads CSS variables,
// so applying a theme is just setting a handful of colors on <html>.

export const PRESETS = {
  ember: { name: 'Ember', accent: '#FF7A1A', accent2: '#FF9B54', deep: '#E8261C', light: '#FFD27A' },
  ocean: { name: 'Ocean', accent: '#2EA8FF', accent2: '#74C7FF', deep: '#2357E8', light: '#A6EEFF' },
  emerald: { name: 'Emerald', accent: '#22C55E', accent2: '#5EE08E', deep: '#0B8F63', light: '#C5F7A8' },
  violet: { name: 'Violet', accent: '#A35BFF', accent2: '#C49BFF', deep: '#6A2BE0', light: '#FFB4F0' },
  gold: { name: 'Gold', accent: '#E3B341', accent2: '#F0CB6C', deep: '#B07A12', light: '#FFF1B8' },
  crimson: { name: 'Crimson', accent: '#F0443A', accent2: '#FF7A70', deep: '#B3122A', light: '#FFC08A' },
  sakura: { name: 'Sakura', accent: '#F06AAE', accent2: '#F79BCB', deep: '#C2286E', light: '#FFD6E8' },
  mono: { name: 'Mono', accent: '#D9D9D9', accent2: '#F2F2F2', deep: '#8C8C8C', light: '#FFFFFF', lightMode: { accent: '#2B2B2B', accent2: '#3A3A3A', deep: '#000000', light: '#6B6B6B' } },
};

// ---------- color math ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = parseInt(m ? m[1] : 'FF7A1A', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return rgbToHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function shade(hex, dl, ds = 0, dh = 0) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  return hslToHex(h + dh, clamp(s + ds), clamp(l + dl));
}
/** Darken until the color reads on a light surface (≥ 4.5:1). */
function readableOn(hex, bg) {
  let c = hex;
  for (let i = 0; i < 20 && contrast(c, bg) < 4.5; i++) c = shade(c, -0.04);
  return c;
}

/** A full palette from any single color (used by the Custom theme). */
export function paletteFrom(accent) {
  const [h, s, l] = rgbToHsl(...hexToRgb(accent));
  return {
    accent: rgbToHex(...hexToRgb(accent)),
    accent2: hslToHex(h + 4, clamp(s), clamp(l + 0.1, 0, 0.82)),
    deep: hslToHex(h - 14, clamp(s + 0.05), clamp(l - 0.16, 0.18)),
    light: hslToHex(h + 22, clamp(s * 0.95), clamp(l + 0.24, 0, 0.88)),
  };
}

export function resolveMode(mode) {
  if (mode === 'system') return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return mode === 'light' ? 'light' : 'dark';
}

/** Colors for one theme + mode. */
export function themeColors(theme = {}) {
  const mode = resolveMode(theme.mode);
  const base = theme.preset === 'custom' || !PRESETS[theme.preset] ? paletteFrom(theme.accent || '#FF7A1A') : PRESETS[theme.preset];
  const p = mode === 'light' && base.lightMode ? { ...base, ...base.lightMode } : base;
  const bgLight = '#F7F6F4';
  const textAccent = mode === 'light' ? readableOn(p.accent, '#FFFFFF') : p.accent2;
  const textHi = mode === 'light' ? readableOn(p.deep, bgLight) : p.light;
  const onAccent = contrast('#120A06', p.accent) >= contrast('#FFFFFF', p.accent) ? '#120A06' : '#FFFFFF';
  return {
    mode,
    vars: {
      '--ember': mode === 'light' && luminance(p.accent) > 0.55 ? shade(p.accent, -0.12) : p.accent,
      '--ember-2': textAccent,
      '--ember-2-bright': p.accent2,
      '--flame': p.deep,
      '--gold': textHi,
      '--gold-bright': p.light,
      '--on-accent': onAccent,
    },
    accent: p.accent, deep: p.deep, light: p.light,
  };
}

const LS = 'hq.theme';
/** Apply a theme to the page (and remember it so the next load paints in the right colors at once). */
export function applyTheme(theme) {
  const t = themeColors(theme);
  const root = document.documentElement;
  root.dataset.mode = t.mode;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.mode === 'light' ? '#F7F6F4' : '#0A0A0A');
  try { localStorage.setItem(LS, JSON.stringify({ mode: t.mode, vars: t.vars })); } catch {}
  return t;
}

/** Read a CSS variable's current value (for canvas drawing). */
export const cssVar = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();

/** A theme color as #RRGGBB, even when it is defined with color-mix() (for xterm and canvas). */
export function resolveColor(name) {
  const probe = document.createElement('i');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
  document.body.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000'; c.fillStyle = css; c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return rgbToHex(r, g, b);
}

// ---------- logos ----------
// Simple filled marks (24×24). Drawn with the theme gradient; the owner can also upload their own.
export const MARKS = {
  flame: { name: 'Flame', d: 'M12 1.5c1 3.6 4.9 5.9 4.9 10.9 0 1.1-.3 2.1-.7 2.9.5-2.6-.6-4.7-2.1-6 .2 2.1-.7 3.6-1.8 4.3.3-2.2-.6-4.6-2.6-6.1.3 2.9-3.2 4.5-3.2 8.5 0 3.5 2.6 6.5 6 6.5h.9C7.6 23.6 4 20 4 15.4 4 9.1 10.6 7 12 1.5z' },
  bolt: { name: 'Bolt', d: 'M13.6 1.5 4.3 13.6h6.2l-1.6 8.9 9.8-12.6h-6.4z' },
  crown: { name: 'Crown', d: 'M2.5 7.5 7.4 11 12 4l4.6 7 4.9-3.5-2.2 11H4.7zM4.9 20h14.2v2.2H4.9z' },
  mountain: { name: 'Peak', d: 'M1.5 20.5 9 7.5l3.3 5.6 2.3-3.6 7.9 11zM9 7.5l1.6 2.8-1.6-.9-1.6.9z' },
  star: { name: 'Star', d: 'm12 1.8 3.1 6.5 7.1.9-5.2 4.9 1.3 7-6.3-3.4-6.3 3.4 1.3-7L1.8 9.2l7.1-.9z' },
  diamond: { name: 'Diamond', d: 'M6.2 3h11.6l4.7 6.1L12 21.5 1.5 9.1zM8.1 9.1 12 18.2l3.9-9.1z' },
  rocket: { name: 'Rocket', d: 'M14.5 2.2c3.2-.7 6.6-.4 7.3.3.7.7 1 4.1.3 7.3-.9 3.8-3.8 6.4-6.6 8l-.4 3.4-3.6-2.4-4.5-4.5-2.4-3.6 3.4-.4c1.6-2.8 4.2-5.7 8-6.6zM16.8 5.3a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM5.6 15.8l2.6 2.6c-1 1.6-3.2 2.9-5.7 3.1.2-2.5 1.5-4.7 3.1-5.7z' },
  hexagon: { name: 'Hex', d: 'M12 1.5 21.1 6.8v10.4L12 22.5l-9.1-5.3V6.8zm0 5.2-4.6 2.6v5.4l4.6 2.6 4.6-2.6V9.3z' },
};

/** The owner's logo as HTML (mark drawn with the theme gradient, initial, or uploaded image). */
export function logoHtml(theme = {}, name = '', { size = 40 } = {}) {
  if (theme.logo === 'custom' && theme.logoFile) return `<img class="brand-img" src="/brand/${theme.logoFile}" alt="" width="${size}" height="${size}">`;
  if (theme.logo === 'initial') {
    const ch = (name || 'H').trim().charAt(0).toUpperCase() || 'H';
    return `<span class="brand-initial" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.62)}px">${ch.replace(/[<&>"]/g, '')}</span>`;
  }
  const m = MARKS[theme.logo] || MARKS.flame;
  const id = `g${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="brand-svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--gold-bright)"/><stop offset=".48" stop-color="var(--ember)"/><stop offset="1" stop-color="var(--flame)"/></linearGradient></defs><path d="${m.d}" fill="url(#${id})" fill-rule="evenodd"/></svg>`;
}

/** Draw the logo onto a canvas (favicon + desktop-shortcut icon). Resolves to a PNG data URL. */
export async function renderIcon(theme = {}, name = '', size = 256) {
  const t = themeColors(theme);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size * 0.22;
  // rounded dark tile so the icon reads on any wallpaper
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#1B1B1B'); bg.addColorStop(1, '#070707');
  ctx.fillStyle = bg; ctx.fill();
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, t.light); grad.addColorStop(0.48, t.vars['--ember']); grad.addColorStop(1, t.deep);
  if (theme.logo === 'custom' && theme.logoFile) {
    const img = new Image();
    img.src = `/brand/${theme.logoFile}`;
    try { await img.decode(); } catch { return c.toDataURL('image/png'); }
    const pad = size * 0.12, box = size - pad * 2, k = Math.min(box / img.naturalWidth, box / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, size, size, r); ctx.clip();
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    ctx.restore();
  } else if (theme.logo === 'initial') {
    ctx.fillStyle = grad;
    ctx.font = `800 ${Math.round(size * 0.7)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(((name || 'H').trim().charAt(0) || 'H').toUpperCase(), size / 2, size * 0.54);
  } else {
    const m = MARKS[theme.logo] || MARKS.flame;
    const k = (size * 0.7) / 24;
    ctx.save();
    ctx.translate(size * 0.15, size * 0.15);
    ctx.scale(k, k);
    ctx.fillStyle = (() => { const g = ctx.createLinearGradient(0, 0, 24, 24); g.addColorStop(0, t.light); g.addColorStop(0.48, t.vars['--ember']); g.addColorStop(1, t.deep); return g; })();
    ctx.fill(new Path2D(m.d), 'evenodd');
    ctx.restore();
  }
  return c.toDataURL('image/png');
}
