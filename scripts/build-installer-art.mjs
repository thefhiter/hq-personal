// Renders the setup wizard's images (installer/art/*.html → installer/art/*.png) with headless Chrome or
// Edge, at the sizes Inno Setup picks from for 100 %, 150 % and 200 % display scaling.
//   node scripts/build-installer-art.mjs
// Headless windows can't be narrower than ~500 px, so each page draws its design in a fixed box at the
// top-left (size passed as ?w=&h=) and the screenshot is cropped to that box here.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ART = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'installer', 'art');
const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const browser = [
  path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
].find((f) => existsSync(f));
if (!browser) throw new Error('Chrome or Edge is needed to render the installer images');

/** Decode an 8-bit, non-interlaced RGB/RGBA PNG (what Chrome writes) into RGBA pixels. */
function decodePng(buf) {
  let p = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (type !== 2 && type !== 6)) throw new Error('unsupported PNG');
    } else if (kind === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      px[o] = line[x * bpp]; px[o + 1] = line[x * bpp + 1]; px[o + 2] = line[x * bpp + 2]; px[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const v of b) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(kind, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(kind, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, tail]);
}

/** Crop the top-left w×h of a decoded image and encode it as an RGBA (or RGB when opaque) PNG. */
function cropPng(img, w, h) {
  let opaque = true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (img.px[(y * img.width + x) * 4 + 3] !== 255) opaque = false;
  const bpp = opaque ? 3 : 4, rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * bpp);
    for (let x = 0; x < w; x++) {
      const o = (y * img.width + x) * 4;
      img.px.copy(row, 1 + x * bpp, o, o + bpp);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const jobs = [
  ['side', 164, 314], ['side', 246, 471], ['side', 328, 628],
  ['small', 55, 55], ['small', 83, 83], ['small', 110, 110],
];
const profile = mkdtempSync(path.join(os.tmpdir(), 'hq-art-'));
try {
  for (const [name, w, h] of jobs) {
    const out = path.join(ART, `${name}-${w}x${h}.png`);
    const shot = path.join(profile, 'shot.png');
    const url = `${pathToFileURL(path.join(ART, `${name}.html`)).href}?w=${w}&h=${h}`;
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`,
      '--force-device-scale-factor=1', `--window-size=${Math.max(w, 640)},${Math.max(h, 640)}`, '--default-background-color=00000000',
      '--virtual-time-budget=2000', `--screenshot=${shot}`, url,
    ], { stdio: 'ignore', timeout: 60_000 });
    const img = decodePng(readFileSync(shot));
    if (img.width < w || img.height < h) throw new Error(`screenshot too small for ${name} ${w}x${h}: ${img.width}x${img.height}`);
    writeFileSync(out, cropPng(img, w, h));
    rmSync(shot, { force: true });
    console.log(`wrote installer/art/${path.basename(out)}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
