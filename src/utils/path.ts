/** POSIX-style helpers for project-relative paths ("src/main.c"). The project root is "". */

export function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export const join = (...parts: string[]) => normalize(parts.filter(Boolean).join('/'));
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i).toLowerCase() : '';
};

/** Is `p` equal to `dir` or inside it? */
export const isWithin = (p: string, dir: string) => dir === '' || p === dir || p.startsWith(dir + '/');

const VALID_NAME = /^[A-Za-z0-9_.+\- ]+$/;
export function validateName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Il nome non può essere vuoto';
  if (n === '.' || n === '..') return 'Nome non valido';
  if (n.startsWith('-')) return 'Il nome non può iniziare con "-"';
  if (!VALID_NAME.test(n)) return 'Usa solo lettere, numeri, spazi e . _ - +';
  if (n.length > 120) return 'Nome troppo lungo';
  return null;
}

/** "main.c" → "main copy.c", then "main copy 2.c", … until unused. */
export function uniqueName(path: string, exists: (p: string) => boolean, suffix = ' copia'): string {
  if (!exists(path)) return path;
  const dir = dirname(path);
  const ext = extname(path);
  const stem = basename(path).slice(0, basename(path).length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = join(dir, `${stem}${suffix}${i > 1 ? ' ' + i : ''}${ext}`);
    if (!exists(candidate)) return candidate;
  }
}

export type FileKind = 'c' | 'h' | 'md' | 'json' | 'txt' | 'make' | 'other';
export function fileKind(p: string): FileKind {
  const e = extname(p);
  if (e === '.c') return 'c';
  if (e === '.h') return 'h';
  if (e === '.md') return 'md';
  if (e === '.json') return 'json';
  if (e === '.txt' || e === '.in' || e === '.dat' || e === '.csv') return 'txt';
  if (basename(p).toLowerCase() === 'makefile') return 'make';
  return 'other';
}

export function languageFor(p: string): string {
  const k = fileKind(p);
  if (k === 'c' || k === 'h') return 'c';
  if (k === 'md') return 'markdown';
  if (k === 'json') return 'json';
  return 'plaintext';
}

export function globToRegExp(glob: string): RegExp {
  const esc = glob.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`(^|/)${esc}$`, 'i');
}
