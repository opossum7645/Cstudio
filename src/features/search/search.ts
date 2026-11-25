/** Project-wide text search and replace (pure functions). */
import { globToRegExp } from '../../utils/path';

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** comma separated globs, e.g. "*.c, *.h". Empty = all files */
  include: string;
  exclude: string;
}

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  preview: string;
  previewStart: number;
}

export interface FileResult {
  path: string;
  matches: SearchMatch[];
}

export function buildRegExp(o: SearchOptions): RegExp | string {
  if (!o.query) return 'Inserisci un testo da cercare';
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `\\b(?:${src})\\b`;
  try {
    return new RegExp(src, o.caseSensitive ? 'gm' : 'gim');
  } catch (e) {
    return `Espressione regolare non valida: ${(e as Error).message}`;
  }
}

function globs(list: string): RegExp[] {
  return list.split(',').map((g) => g.trim()).filter(Boolean).map(globToRegExp);
}

export function fileMatchesFilters(path: string, o: Pick<SearchOptions, 'include' | 'exclude'>): boolean {
  const inc = globs(o.include);
  const exc = globs(o.exclude);
  if (inc.length && !inc.some((r) => r.test(path))) return false;
  return !exc.some((r) => r.test(path));
}

export function searchFiles(files: Record<string, string>, o: SearchOptions, maxResults = 2000): { results: FileResult[]; total: number; error?: string } {
  const re = buildRegExp(o);
  if (typeof re === 'string') return { results: [], total: 0, error: o.query ? re : undefined };
  const results: FileResult[] = [];
  let total = 0;
  for (const path of Object.keys(files).sort()) {
    if (!fileMatchesFilters(path, o)) continue;
    const text = files[path]!;
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
    const matches: SearchMatch[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let li = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      while (li + 1 < lineStarts.length && lineStarts[li + 1]! <= m.index) li++;
      const ls = lineStarts[li]!;
      const le = text.indexOf('\n', ls);
      const lineText = text.slice(ls, le < 0 ? text.length : le);
      const col = m.index - ls;
      const pStart = Math.max(0, col - 30);
      matches.push({ line: li + 1, column: col + 1, length: m[0].length, preview: lineText.slice(pStart, pStart + 160), previewStart: col - pStart });
      total++;
      if (total >= maxResults) break;
    }
    if (matches.length) results.push({ path, matches });
    if (total >= maxResults) break;
  }
  return { results, total };
}

/** Replaces all matches in a text. With regex on, "$1" style groups are honoured. */
export function replaceInText(text: string, o: SearchOptions, replacement: string): { text: string; count: number } {
  const re = buildRegExp(o);
  if (typeof re === 'string') return { text, count: 0 };
  let count = 0;
  const out = text.replace(re, (...args) => {
    count++;
    if (!o.regex) return replacement;
    const groups = args.slice(1, -2) as string[];
    return replacement.replace(/\$(\d)/g, (_, d: string) => groups[Number(d) - 1] ?? '');
  });
  return { text: out, count };
}

/** Replace only the match at a given line/column. */
export function replaceOne(text: string, match: SearchMatch, replacement: string): string {
  const lines = text.split('\n');
  const line = lines[match.line - 1];
  if (line === undefined) return text;
  lines[match.line - 1] = line.slice(0, match.column - 1) + replacement + line.slice(match.column - 1 + match.length);
  return lines.join('\n');
}
