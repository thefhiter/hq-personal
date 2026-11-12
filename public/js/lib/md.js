// Small, safe Markdown renderer (escapes all HTML) with Obsidian extras:
// [[wikilinks]], > [!callouts], tables, fenced code with highlighting.
import { highlight } from './hl.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeUrl(u) {
  const url = String(u).trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return '#';
}

function inline(text, opts = {}) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) => {
    const url = opts.resolveImage ? opts.resolveImage(src) : safeUrl(src);
    return `<img src="${esc(url)}" alt="${alt}" loading="lazy">`;
  });
  s = s.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, _h, label) => `<a class="wikilink" data-wikilink="${esc(target.trim())}" href="#">${label || target}</a>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const url = safeUrl(href.replace(/&amp;/g, '&'));
    const ext = /^https?:/i.test(url);
    return `<a href="${esc(url)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

function table(lines, opts) {
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const head = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return `<table><thead><tr>${head.map((h) => `<th>${inline(h, opts)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function list(lines, opts) {
  // Builds nested lists from indentation.
  const root = { children: [], indent: -1 };
  const stack = [root];
  for (const line of lines) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!m) { const last = stack.at(-1).children.at(-1); if (last) last.text += ' ' + line.trim(); continue; }
    const indent = m[1].replace(/\t/g, '  ').length;
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1);
    const node = { text: m[3], ordered: /\d/.test(m[2]), children: [], indent };
    parent.children.push(node);
    stack.push(node);
  }
  const render = (nodes) => {
    if (!nodes.length) return '';
    const tag = nodes[0].ordered ? 'ol' : 'ul';
    return `<${tag}>${nodes.map((n) => {
      let t = n.text;
      let box = '';
      const task = /^\[([ xX])\]\s+(.*)$/.exec(t);
      if (task) { box = `<input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''}> `; t = task[2]; }
      return `<li>${box}${inline(t, opts)}${render(n.children)}</li>`;
    }).join('')}</${tag}>`;
  };
  return render(root.children);
}

export function markdown(src, opts = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^(\s*)(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const close = fence[2];
      const lang = fence[3] || '';
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) body.push(lines[i++]);
      i++;
      out.push(`<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${highlight(body.join('\n'), lang)}</code></pre>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2], opts)}</h${h[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      const callout = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(body[0] || '');
      if (callout) {
        out.push(`<div class="callout callout-${esc(callout[1].toLowerCase())}"><div class="callout-title">${inline(callout[2] || callout[1], opts)}</div>${markdown(body.slice(1).join('\n'), opts)}</div>`);
      } else out.push(`<blockquote>${markdown(body.join('\n'), opts)}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(lines[i++]);
      out.push(table(body, opts));
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const body = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && body.length))) body.push(lines[i++]);
      out.push(list(body, opts));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|~~~|\s*>|\s*([-*+]|\d+[.)])\s+|\s*\|.*\|\s*$)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(`<p>${para.map((p) => inline(p, opts)).join('<br>')}</p>`);
  }
  return out.join('\n');
}
