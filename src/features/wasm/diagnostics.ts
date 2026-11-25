/** Shared with backend/src/compiler/diagnostics.ts (keep in sync).
 * Parses GCC / Clang / ld textual diagnostics into structured records.
 * Formats handled:
 *   file:line:col: error|warning|note|fatal error: message
 *   file:line: error: message                       (no column)
 *   file.c:(.text+0x1a): undefined reference to `f'  (linker, with object location)
 *   /usr/bin/ld: ...: undefined reference to `f'     (linker)
 *   collect2: error: ld returned 1 exit status
 */
import type { Diagnostic, Severity } from '../../types';

const WITH_COL = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;
const NO_COL = /^(.+?):(\d+): (fatal error|error|warning|note): (.*)$/;
const LD_LOC = /^(?:.*\/)?(?:ld(?:\.\w+)?|.+?\.o): ?(?:in function [^:]+:)?/;
const LD_REF = /^(.+?\.[ch]):(\d+):? ?(?:\(\.\w+[^)]*\))?:? ?(undefined reference to .*|multiple definition of .*)$/;
const LD_OBJ = /^(.+?\.[ch]):\(\.\w+[^)]*\): (.*)$/;
const LD_GENERIC = /^(?:\/\S*\/)?(?:ld(?:\.\w+)?|collect2|clang|gcc|cc): (?:error: )?(.*)$/;

function sev(s: string): Severity {
  if (s === 'fatal error' || s === 'error') return 'error';
  if (s === 'warning') return 'warning';
  return 'note';
}

export function parseDiagnostics(stderr: string, knownFiles: Set<string>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const norm = (f: string): string | null => {
    const clean = f.replace(/^\.\//, '').replace(/^\/(?:mnt\/)?work\//, '');
    return knownFiles.has(clean) ? clean : clean.includes('/') || clean.endsWith('.c') || clean.endsWith('.h') ? clean : null;
  };
  for (const raw of stderr.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    let m = WITH_COL.exec(line);
    if (m) {
      out.push({ file: norm(m[1]!), line: Number(m[2]), column: Number(m[3]), severity: sev(m[4]!), message: m[5]!, source: 'compiler' });
      continue;
    }
    m = NO_COL.exec(line);
    if (m) {
      out.push({ file: norm(m[1]!), line: Number(m[2]), column: 1, severity: sev(m[3]!), message: m[4]!, source: 'compiler' });
      continue;
    }
    m = LD_REF.exec(line);
    if (m) {
      out.push({ file: norm(m[1]!), line: Number(m[2]), column: 1, severity: 'error', message: m[3]!, source: 'linker' });
      continue;
    }
    m = LD_OBJ.exec(line);
    if (m) {
      out.push({ file: norm(m[1]!), line: 1, column: 1, severity: 'error', message: m[2]!, source: 'linker' });
      continue;
    }
    if (/undefined reference|multiple definition|cannot find -l|ld returned|linker command failed/.test(line)) {
      const g = LD_GENERIC.exec(line);
      const msg = (g ? g[1]! : line).replace(LD_LOC, '').trim() || line;
      if (/ld returned \d+ exit status|linker command failed/.test(msg)) continue; // summary line, already reported
      out.push({ file: null, line: 0, column: 0, severity: 'error', message: msg, source: 'linker' });
    }
  }
  // collapse exact duplicates (gcc repeats some linker messages)
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = `${d.file}:${d.line}:${d.column}:${d.severity}:${d.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
