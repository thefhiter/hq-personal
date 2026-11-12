// Renders the default HQ icon (Ember flame) with the app's own drawing code in headless Chrome and
// writes public/assets/hq.ico + icon-256.png. Needs a running HQ (npm start) and Playwright:
//   npx -y playwright --version   (once), then: node scripts/make-icon.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HQ_URL || 'http://127.0.0.1:9120';
const require = createRequire(process.env.PLAYWRIGHT_DIR || import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(BASE + '/');
const pngs = await page.evaluate(async () => {
  const m = await import('/js/lib/theme.js');
  const out = [];
  for (const size of [256, 64, 48, 32, 16]) out.push({ size, data: await m.renderIcon({ preset: 'ember', mode: 'dark', logo: 'flame' }, '', size) });
  return out;
});
await browser.close();

const bufs = pngs.map((p) => ({ size: p.size, data: Buffer.from(p.data.split(',')[1], 'base64') }));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(bufs.length, 4);
const dir = Buffer.alloc(16 * bufs.length);
let offset = 6 + dir.length;
bufs.forEach((p, i) => {
  const o = i * 16;
  dir.writeUInt8(p.size >= 256 ? 0 : p.size, o); dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1);
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(p.data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += p.data.length;
});
await fs.mkdir(path.join(ROOT, 'public/assets'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'public/assets/hq.ico'), Buffer.concat([header, dir, ...bufs.map((p) => p.data)]));
await fs.writeFile(path.join(ROOT, 'public/assets/icon-256.png'), bufs[0].data);
console.log('wrote public/assets/hq.ico and icon-256.png');
