/**
 * Lightweight C symbol indexer (no external parser): finds functions (definitions and
 * prototypes), macros, typedefs, struct/union/enum tags, enum constants, global and local
 * variables. Used for IntelliSense, go-to-definition, outline and hovers.
 */
export type SymbolKind = 'function' | 'prototype' | 'macro' | 'typedef' | 'struct' | 'union' | 'enum' | 'enumerator' | 'variable' | 'local' | 'parameter';

export interface CSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number; // 1-based
  column: number; // 1-based
  detail: string;
  /** for functions: last line of the body */
  endLine?: number;
  /** for locals/params: the enclosing function */
  scope?: string;
}

/** Replaces comments and string/char literals with spaces, keeping offsets and newlines. */
export function stripCode(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      const e = end < 0 ? src.length : end;
      blank(i, e);
      i = e;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const e = end < 0 ? src.length : end + 2;
      blank(i, e);
      i = e;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, Math.min(j, src.length));
      i = j + 1;
    } else i++;
  }
  return out.join('');
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'else', 'do', 'case', 'goto', 'typedef', 'struct', 'union', 'enum', 'static', 'extern', 'const', 'volatile', 'inline', 'register', 'auto', 'restrict', 'break', 'continue', 'default']);
const BASE_TYPES = 'void|char|short|int|long|float|double|signed|unsigned|_Bool|bool|size_t|ssize_t|ptrdiff_t|FILE|time_t|clock_t|u?int(?:8|16|32|64|ptr)_t|struct\\s+\\w+|union\\s+\\w+|enum\\s+\\w+';

function lineCol(lineStarts: number[], offset: number): [number, number] {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return [lo + 1, offset - lineStarts[lo]! + 1];
}

export function indexFile(file: string, src: string, extraTypes: string[] = []): CSymbol[] {
  const stripped = stripCode(src);
  // preprocessor lines (with continuations) are blanked for declaration scanning
  const code = stripped.replace(/^[ \t]*#(?:[^\n]*\\\n)*[^\n]*/gm, (m) => m.replace(/[^\n]/g, ' '));
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  const syms: CSymbol[] = [];
  const at = (off: number) => lineCol(lineStarts, off);
  const lineText = (line: number) => src.slice(lineStarts[line - 1], lineStarts[line] ?? src.length).trim();

  // depth map: brace depth at every offset
  const depth = new Int32Array(code.length + 1);
  let d = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') d++;
    depth[i] = d;
    if (code[i] === '}') d = Math.max(0, d - 1);
  }

  // macros
  for (const m of stripped.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(\([^)]*\))?(.*)$/gm)) {
    const off = m.index! + m[0].indexOf(m[1]!);
    const [l, c] = at(off);
    syms.push({ name: m[1]!, kind: 'macro', file, line: l, column: c, detail: `#define ${m[1]}${m[2] ?? ''}${src.slice(off + m[1]!.length + (m[2]?.length ?? 0), lineStarts[l] ?? src.length).trimEnd()}` });
  }

  // struct / union / enum tags with bodies
  for (const m of code.matchAll(/\b(struct|union|enum)\s+([A-Za-z_]\w*)\s*\{/g)) {
    const off = m.index! + m[0].indexOf(m[2]!, m[1]!.length);
    const [l, c] = at(off);
    syms.push({ name: m[2]!, kind: m[1] as 'struct', file, line: l, column: c, detail: `${m[1]} ${m[2]}` });
  }

  // enumerators
  for (const m of code.matchAll(/\benum\b[^{;]*\{([^}]*)\}/g)) {
    const bodyStart = m.index! + m[0].indexOf('{') + 1;
    for (const e of m[1]!.matchAll(/([A-Za-z_]\w*)\s*(=\s*[^,]+)?\s*(,|$)/g)) {
      const [l, c] = at(bodyStart + e.index!);
      syms.push({ name: e[1]!, kind: 'enumerator', file, line: l, column: c, detail: `enum constant ${e[1]}${e[2] ? ' ' + e[2].trim() : ''}` });
    }
  }

  // typedefs: "typedef ... Name;" and "typedef struct {...} Name;"
  for (const m of code.matchAll(/\btypedef\b/g)) {
    let i = m.index! + 7;
    let braces = 0;
    while (i < code.length) {
      const ch = code[i];
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === ';' && braces === 0) break;
      i++;
    }
    const stmt = code.slice(m.index!, i);
    const fp = /\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\(/.exec(stmt); // function pointer typedef
    const nm = fp ? fp[1]! : /([A-Za-z_]\w*)\s*(\[[^\]]*\]\s*)*$/.exec(stmt)?.[1];
    if (nm) {
      const off = m.index! + stmt.lastIndexOf(nm);
      const [l, c] = at(off);
      const head = stmt.replace(/\{[\s\S]*\}/, '{…}').replace(/\s+/g, ' ').trim();
      syms.push({ name: nm, kind: 'typedef', file, line: l, column: c, detail: head });
    }
  }
  const typeNames = [...extraTypes, ...syms.filter((s) => s.kind === 'typedef').map((s) => s.name)].map((t) => t.replace(/\W/g, ''));
  const TYPE = `(?:(?:const|volatile|static|extern|register|unsigned|signed|inline)\\s+)*(?:${BASE_TYPES}${typeNames.length ? '|' + typeNames.join('|') : ''})(?:\\s+(?:const|long|int|short|double|char))*`;

  // functions (definitions and prototypes) at depth 0
  const fnRe = /([A-Za-z_][\w\s\*]*?[\s\*])([A-Za-z_]\w*)\s*\(([^;{}()]*(?:\([^)]*\)[^;{}()]*)*)\)\s*(\{|;)/g;
  for (const m of code.matchAll(fnRe)) {
    const name = m[2]!;
    const off = m.index! + m[1]!.length;
    if (depth[off]! > 0 || KEYWORDS.has(name)) continue;
    const ret = m[1]!.replace(/\s+/g, ' ').trim();
    if (!ret || /^(return|else|typedef)\b/.test(ret) || ret.endsWith('=')) continue;
    const [l, c] = at(off);
    const signature = `${ret} ${name}(${m[3]!.replace(/\s+/g, ' ').trim()})`.replace(/\s+\*/g, ' *').replace(/\*\s+(?=\w)/g, '*');
    const isDef = m[4] === '{';
    let endLine: number | undefined;
    if (isDef) {
      const open = m.index! + m[0].length - 1;
      let k = open + 1;
      let dd = 1;
      while (k < code.length && dd > 0) {
        if (code[k] === '{') dd++;
        else if (code[k] === '}') dd--;
        k++;
      }
      endLine = at(k - 1)[0];
      // parameters
      const pStart = m.index! + m[0].indexOf('(') + 1;
      for (const p of m[3]!.matchAll(/([A-Za-z_][\w\s\*]*?[\s\*])([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:,|$)/g)) {
        if (p[2] === 'void') continue;
        const [pl, pc] = at(pStart + p.index! + p[1]!.length);
        syms.push({ name: p[2]!, kind: 'parameter', file, line: pl, column: pc, detail: `${p[1]!.trim()} ${p[2]}${p[3] ?? ''}`.replace(/\s+/g, ' '), scope: name });
      }
    }
    syms.push({ name, kind: isDef ? 'function' : 'prototype', file, line: l, column: c, detail: signature, endLine });
  }

  // variables: "<type> [*]name [= …|[…]|;|,]"
  const varRe = new RegExp(`\\b(${TYPE})((?:\\s*\\*)*\\s*)([A-Za-z_]\\w*)\\s*(\\[[^\\]]*\\]\\s*)*(?=[=;,)])`, 'g');
  const funcs = syms.filter((s) => s.kind === 'function');
  for (const m of code.matchAll(varRe)) {
    const name = m[3]!;
    if (KEYWORDS.has(name)) continue;
    const off = m.index! + m[1]!.length + m[2]!.length;
    if (code[off + name.length] === '(') continue;
    const [l, c] = at(off);
    if (syms.some((s) => s.line === l && s.name === name)) continue; // already a parameter/function
    const dep = depth[off]!;
    if (dep === 0 && /^\s*typedef/.test(lineText(l))) continue;
    // skip struct members (inside a struct/union body)
    const before = code.slice(0, off);
    const lastOpen = before.lastIndexOf('{');
    if (dep > 0 && /\b(struct|union)\b[^;{}()]*$/.test(code.slice(Math.max(0, lastOpen - 80), lastOpen))) continue;
    const fn = funcs.find((f) => f.line <= l && (f.endLine ?? f.line) >= l);
    const detail = `${m[1]!.replace(/\s+/g, ' ').trim()} ${m[2]!.replace(/\s+/g, '')}${name}${m[4] ? m[4].trim() : ''}`;
    syms.push({ name, kind: dep === 0 ? 'variable' : 'local', file, line: l, column: c, detail, scope: dep === 0 ? undefined : fn?.name });
  }
  return syms;
}

export class SymbolIndex {
  private byFile = new Map<string, CSymbol[]>();
  private sources = new Map<string, string>();

  update(file: string, src: string): void {
    if (this.sources.get(file) === src) return;
    this.sources.set(file, src);
    if (!/\.(c|h)$/.test(file)) {
      this.byFile.set(file, []);
      return;
    }
    // typedef names declared in headers are visible to everyone
    const headerTypes = [...this.byFile.entries()].filter(([f]) => f !== file).flatMap(([, s]) => s.filter((x) => x.kind === 'typedef').map((x) => x.name));
    try {
      this.byFile.set(file, indexFile(file, src, headerTypes));
    } catch {
      this.byFile.set(file, []);
    }
  }

  remove(file: string): void {
    this.byFile.delete(file);
    this.sources.delete(file);
  }

  clear(): void {
    this.byFile.clear();
    this.sources.clear();
  }

  fileSymbols(file: string): CSymbol[] {
    return this.byFile.get(file) ?? [];
  }

  /** Project-wide symbols (no locals/params). */
  globals(): CSymbol[] {
    return [...this.byFile.values()].flat().filter((s) => s.kind !== 'local' && s.kind !== 'parameter');
  }

  /** Symbols visible at a position: globals + locals of the enclosing function. */
  visibleAt(file: string, line: number): CSymbol[] {
    const own = this.fileSymbols(file);
    const fn = own.find((s) => s.kind === 'function' && s.line <= line && (s.endLine ?? s.line) >= line);
    const locals = fn ? own.filter((s) => (s.kind === 'local' || s.kind === 'parameter') && s.scope === fn.name && s.line <= line) : [];
    return [...locals, ...this.globals()];
  }

  /** Best definition for a name: function body > typedef/struct > variable > prototype/macro. */
  definition(name: string, file?: string, line?: number): CSymbol | null {
    if (file && line) {
      const local = this.visibleAt(file, line).find((s) => s.name === name && (s.kind === 'local' || s.kind === 'parameter'));
      if (local) return local;
    }
    const all = this.globals().filter((s) => s.name === name);
    const rank: Record<SymbolKind, number> = { function: 0, struct: 1, union: 1, enum: 1, typedef: 1, enumerator: 2, variable: 2, macro: 3, prototype: 4, local: 5, parameter: 5 };
    all.sort((a, b) => rank[a.kind] - rank[b.kind]);
    return all[0] ?? null;
  }
}
