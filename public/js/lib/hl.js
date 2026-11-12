// Lightweight syntax highlighter: one tokenizer that is good enough for the
// languages in these projects (JS/TS, C#, Python, C/C++/Arduino, JSON, CSS, shell, G-code).
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const KEYWORDS = new Set(('abstract as async await base bool break byte case catch char class const continue debugger def default del delegate do double elif else enum event except explicit export extends extern false final finally fixed float for foreach from function get global goto if implements implicit import in instanceof int interface internal is lambda let long namespace new nil none None not null object of operator or and out override package params pass private protected public raise readonly ref return sbyte sealed set short signed sizeof static string struct super switch this throw true True False try typeof uint ulong unchecked unsafe unsigned ushort using var virtual void volatile while with yield void include define ifdef ifndef endif pragma template typename auto constexpr nullptr self fn pub mut impl match mod crate type undefined').split(' '));

const RULES = [
  ['c', /\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/y],
  ['c', /#(?![!\w]*\s*(include|define|ifdef|ifndef|endif|pragma|region|endregion))[^\n]*/y],
  ['c', /;[^\n]*/y],
  ['s', /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/y],
  ['n', /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)[fFdDmMuUlL]?\b/y],
  ['w', /[A-Za-z_$][\w$]*/y],
  ['p', /[{}()[\];,.<>+\-*/%=!&|^~?:@#]/y],
  ['x', /\s+|./y],
];

const CALL = /[ \t]*\(/y;

export function highlight(code, lang = '') {
  const l = lang.toLowerCase();
  const hashComments = /^(py|python|sh|bash|shell|ps1|powershell|yaml|yml|toml|ini|cfg|conf|rb|r|dockerfile|make|cmake)$/.test(l);
  const semiComments = /^(gcode|nc|tap|ini|asm|lisp)$/.test(l);
  if (/^(md|markdown|txt|text|plain|mermaid)$/.test(l) || code.length > 200_000) return esc(code);
  let out = '';
  let i = 0;
  let prevWord = '';
  while (i < code.length) {
    let matched = false;
    for (const [type, re] of RULES) {
      if (type === 'c' && re.source.startsWith('#') && !hashComments) continue;
      if (type === 'c' && re.source.startsWith(';') && !semiComments) continue;
      re.lastIndex = i;
      const m = re.exec(code);
      if (!m || !m[0]) continue;
      const tok = m[0];
      i += tok.length;
      matched = true;
      if (type === 'w') {
        CALL.lastIndex = i;
        const next = CALL.test(code);
        if (KEYWORDS.has(tok)) out += `<span class="tk-k">${tok}</span>`;
        else if (next) out += `<span class="tk-f">${tok}</span>`;
        else if (/^[A-Z][a-zA-Z0-9]+$/.test(tok) && prevWord !== '.') out += `<span class="tk-t">${tok}</span>`;
        else out += esc(tok);
        prevWord = tok;
      } else if (type === 'x') {
        out += esc(tok);
      } else {
        out += `<span class="tk-${type}">${esc(tok)}</span>`;
        prevWord = tok;
      }
      break;
    }
    if (!matched) { out += esc(code[i]); i++; }
  }
  return out;
}

export function langOf(path = '') {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ({ mjs: 'js', cjs: 'js', jsx: 'js', tsx: 'ts', ino: 'cpp', h: 'cpp', hpp: 'cpp', cc: 'cpp', yml: 'yaml', nc: 'gcode', tap: 'gcode', ps1: 'ps1', bat: 'bat', cmd: 'bat', htm: 'html', xaml: 'xml', csproj: 'xml', props: 'xml', svg: 'xml' })[ext] || ext;
}
