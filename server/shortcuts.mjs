// Desktop / Start-menu shortcuts, written directly in the Windows .lnk format (MS-SHLLINK) so no
// script host or PowerShell is involved. They start HQ with the Node.js that is running it now,
// and use the owner's own icon (regenerated when they change their logo or colors).
import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import { ROOT, DATA, IS_WIN, readJson, writeJson, run } from './util.mjs';
import { getSettings } from './config.mjs';

const STATE = path.join(DATA, 'shortcuts.json');
const LAUNCHER = path.join(ROOT, 'launcher.mjs');

/** Shell item ID list for a local path: My Computer → drive → one item per folder/file. */
function idList(target) {
  const items = [];
  const myComputer = Buffer.alloc(0x14);
  myComputer.writeUInt16LE(0x14, 0); myComputer[2] = 0x1f; myComputer[3] = 0x50;
  Buffer.from('e04fd020ea3a6910a2d808002b30309d', 'hex').copy(myComputer, 4); // {20D04FE0-3AEA-1069-A2D8-08002B30309D}
  items.push(myComputer);
  const parts = path.win32.normalize(target).split('\\').filter(Boolean);
  const drive = Buffer.alloc(0x19);
  drive.writeUInt16LE(0x19, 0); drive[2] = 0x2f; drive.write(`${parts[0].toUpperCase()}\\`, 3, 'latin1');
  items.push(drive);
  parts.slice(1).forEach((name, i) => {
    const isFile = i === parts.length - 2;
    const ascii = /^[\x20-\x7e]+$/.test(name);
    // simple file-entry item: type, size, date, attributes, then the name (UTF-16 when not plain ASCII)
    let nameBuf = ascii ? Buffer.from(`${name}\0`, 'latin1') : Buffer.from(`${name}\0`, 'utf16le');
    if (nameBuf.length % 2) nameBuf = Buffer.concat([nameBuf, Buffer.alloc(1)]);
    const head = Buffer.alloc(14);
    head[2] = (isFile ? 0x32 : 0x31) | (ascii ? 0 : 0x04);
    head.writeUInt16LE(isFile ? 0x20 : 0x10, 12);
    const item = Buffer.concat([head, nameBuf]);
    item.writeUInt16LE(item.length, 0);
    items.push(item);
  });
  const body = Buffer.concat([...items, Buffer.alloc(2)]);
  const size = Buffer.alloc(2); size.writeUInt16LE(body.length);
  return Buffer.concat([size, body]);
}

/** Build a .lnk file: target + arguments + working folder + icon, shown minimized. */
export function buildLnk({ target, args = '', workingDir = '', icon = '', description = '' }) {
  const u16 = (s) => Buffer.from(String(s), 'utf16le');
  const str = (s) => { const b = u16(s); const n = Buffer.alloc(2); n.writeUInt16LE(b.length / 2); return Buffer.concat([n, b]); };
  // ShellLinkHeader (76 bytes)
  const FLAGS = 0x01 /* HasLinkTargetIDList */ | 0x02 /* HasLinkInfo */ | 0x04 /* HasName */ | 0x10 /* HasWorkingDir */ | 0x20 /* HasArguments */ | 0x40 /* HasIconLocation */ | 0x80 /* IsUnicode */ | 0x200 /* HasExpString */;
  const h = Buffer.alloc(76);
  h.writeUInt32LE(0x4c, 0);
  Buffer.from('0114020000000000c000000000000046', 'hex').copy(h, 4); // CLSID 00021401-0000-0000-C000-000000000046
  h.writeUInt32LE(FLAGS, 20);
  h.writeUInt32LE(0x20, 24); // FILE_ATTRIBUTE_ARCHIVE
  h.writeUInt32LE(0, 56); // icon index
  h.writeUInt32LE(7, 60); // SW_SHOWMINNOACTIVE: the small launcher window starts minimized
  // LinkInfo with a local base path (ANSI + Unicode so any folder name works)
  const ansi = Buffer.concat([Buffer.from(target.replace(/[^\x20-\x7e]/g, '?'), 'latin1'), Buffer.from([0])]);
  const uni = Buffer.concat([u16(target), Buffer.alloc(2)]);
  const volume = Buffer.alloc(0x11);
  volume.writeUInt32LE(0x11, 0); volume.writeUInt32LE(3, 4) /* DRIVE_FIXED */; volume.writeUInt32LE(0, 8); volume.writeUInt32LE(0x10, 12);
  const HDR = 0x24;
  const volOff = HDR, baseOff = volOff + volume.length, suffixOff = baseOff + ansi.length, baseUniOff = suffixOff + 1, suffixUniOff = baseUniOff + uni.length;
  const info = Buffer.alloc(suffixUniOff + 2);
  info.writeUInt32LE(info.length, 0); info.writeUInt32LE(HDR, 4); info.writeUInt32LE(1, 8) /* VolumeIDAndLocalBasePath */;
  info.writeUInt32LE(volOff, 12); info.writeUInt32LE(baseOff, 16); info.writeUInt32LE(0, 20); info.writeUInt32LE(suffixOff, 24);
  info.writeUInt32LE(baseUniOff, 28); info.writeUInt32LE(suffixUniOff, 32);
  volume.copy(info, volOff); ansi.copy(info, baseOff); uni.copy(info, baseUniOff);
  // EnvironmentVariableDataBlock: the target path Windows reads when the link has no ID list
  const envBlock = Buffer.alloc(0x314);
  envBlock.writeUInt32LE(0x314, 0); envBlock.writeUInt32LE(0xa0000001, 4);
  ansi.subarray(0, 259).copy(envBlock, 8);
  uni.subarray(0, 518).copy(envBlock, 8 + 260);
  // StringData in spec order: name, working dir, arguments, icon; then extra data and the terminal block
  return Buffer.concat([h, idList(target), info, str(description), str(workingDir), str(args), str(icon), envBlock, Buffer.alloc(4)]);
}

/** Real Desktop / Start-menu folders (they can be redirected, e.g. by OneDrive). */
async function shellFolders() {
  if (process.env.HQ_SHORTCUT_DIR) return { desktop: path.join(process.env.HQ_SHORTCUT_DIR, 'Desktop'), programs: path.join(process.env.HQ_SHORTCUT_DIR, 'Programs') }; // tests
  const env = (s) => s.replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m);
  const out = { desktop: path.join(process.env.USERPROFILE || '', 'Desktop'), programs: path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs') };
  const r = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'], { timeout: 8000 });
  if (r.ok) {
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = /^\s+(Desktop|Programs)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
      if (m) out[m[1] === 'Desktop' ? 'desktop' : 'programs'] = env(m[2].trim());
    }
  }
  return out;
}

const safeName = (s) => (String(s || 'HQ').replace(/[\\/:*?"<>|]/g, '').trim() || 'HQ').slice(0, 40);

export async function shortcutStatus() {
  const st = await readJson(STATE, { files: [] });
  const files = (st.files || []).filter((f) => existsSync(f.path));
  return { supported: IS_WIN, desktop: files.some((f) => f.where === 'desktop'), startMenu: files.some((f) => f.where === 'programs'), files };
}

/** Create or remove the shortcuts. Names follow the app name the owner chose. */
export async function setShortcuts({ desktop, startMenu } = {}) {
  if (!IS_WIN) throw Object.assign(new Error('Shortcuts are only made on Windows'), { status: 400 });
  const prev = await shortcutStatus();
  const want = { desktop: desktop ?? prev.desktop, programs: startMenu ?? prev.startMenu };
  for (const f of prev.files) await fs.rm(f.path, { force: true });
  const dirs = await shellFolders();
  const s = await getSettings();
  const name = safeName(s.profile.title);
  const icon = await currentIcon();
  const files = [];
  for (const where of ['desktop', 'programs']) {
    if (!want[where]) continue;
    const file = path.join(dirs[where], `${name}.lnk`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buildLnk({ target: process.execPath, args: `"${LAUNCHER}"`, workingDir: ROOT, icon, description: `${name}: focus room, music, AI, projects and notes` }));
    files.push({ where, path: file });
  }
  await writeJson(STATE, { files, target: process.execPath, launcher: LAUNCHER });
  return shortcutStatus();
}

/** The newest icon file (a new name each time, so Windows doesn't keep showing a cached old icon). */
async function currentIcon() {
  const dir = path.join(DATA, 'brand');
  await fs.mkdir(dir, { recursive: true });
  const icos = (await fs.readdir(dir)).filter((f) => /^app(-\w+)?\.ico$/.test(f)).sort();
  const versioned = icos.filter((f) => f !== 'app.ico').pop();
  if (versioned) return path.join(dir, versioned);
  const base = path.join(dir, 'app.ico');
  if (!existsSync(base)) await fs.copyFile(path.join(ROOT, 'public', 'assets', 'hq.ico'), base);
  return base;
}

/** Re-point existing shortcuts after the icon, the app name or the HQ folder changed. */
export async function refreshShortcuts() {
  if (!IS_WIN) return;
  const st = await shortcutStatus();
  if (st.files.length) await setShortcuts({});
}
