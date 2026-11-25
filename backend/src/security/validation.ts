/**
 * Input validation for everything that reaches the compiler.
 * Paths are confined to the job directory; compiler flags go through an allow-list
 * so a client cannot load plugins, change the linker, read arbitrary files via @file, etc.
 */
import { config } from '../config.js';
import { BuildConfig, CStandard, OptLevel, ProjectFile, defaultBuildConfig } from '../types.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9_.+\- ]+$/;

export function validatePath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 255) throw new ValidationError('Invalid file path');
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm.startsWith('/')) throw new ValidationError(`Absolute paths are not allowed: ${p}`);
  const segs = norm.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..' || !SAFE_SEGMENT.test(s) || s.startsWith('-')) {
      throw new ValidationError(`Invalid path segment in "${p}"`);
    }
  }
  if (segs[0] === 'build' || segs[0] === '.cstudio-job') throw new ValidationError(`Reserved directory: ${p}`);
  return segs.join('/');
}

export function validateFiles(input: unknown): ProjectFile[] {
  if (!Array.isArray(input)) throw new ValidationError('"files" must be an array');
  if (input.length === 0) throw new ValidationError('No files to compile');
  if (input.length > config.limits.maxFiles) throw new ValidationError('Too many files');
  let total = 0;
  const seen = new Set<string>();
  const out: ProjectFile[] = [];
  for (const f of input) {
    if (typeof f !== 'object' || f === null) throw new ValidationError('Invalid file entry');
    const rec = f as Record<string, unknown>;
    const path = validatePath(rec.path);
    if (typeof rec.content !== 'string') throw new ValidationError(`Invalid content for ${path}`);
    const size = Buffer.byteLength(rec.content, 'utf8');
    if (size > config.limits.maxFileBytes) throw new ValidationError(`File too large: ${path}`);
    total += size;
    if (seen.has(path)) throw new ValidationError(`Duplicate file: ${path}`);
    seen.add(path);
    out.push({ path, content: rec.content });
  }
  if (total > config.limits.maxProjectBytes) throw new ValidationError('Project too large');
  return out;
}

const STANDARDS: CStandard[] = ['c89', 'c99', 'c11', 'c17', 'c23', 'gnu11', 'gnu17'];
const OPTS: OptLevel[] = ['O0', 'O1', 'O2', 'O3', 'Os', 'Og'];
const LIBS = new Set(['m', 'pthread']);

/** Flags a user may add freely. Anything else is rejected with an explicit message. */
const FLAG_ALLOW: RegExp[] = [
  /^-W(no-)?[a-z0-9][a-z0-9=\-+_]*$/i,
  /^-pedantic(-errors)?$/,
  /^-w$/,
  /^-D[A-Za-z_][A-Za-z0-9_]*(=[A-Za-z0-9_."'\- ]*)?$/,
  /^-U[A-Za-z_][A-Za-z0-9_]*$/,
  /^-g(0|1|2|3|gdb)?$/,
  /^-f(no-)?(stack-protector(-strong|-all)?|omit-frame-pointer|strict-aliasing|wrapv|trapv|signed-char|unsigned-char|common|inline|builtin|diagnostics-show-option|max-errors=\d{1,3}|sanitize=undefined)$/,
  /^-ansi$/,
  /^-march=native$/,
];

export function validateFlag(flag: string): string {
  const f = flag.trim();
  if (!FLAG_ALLOW.some((r) => r.test(f))) {
    throw new ValidationError(`Flag not allowed in the sandbox: "${f}"`);
  }
  return f;
}

export function validateBuildConfig(input: unknown): BuildConfig {
  const d = defaultBuildConfig;
  if (input === undefined || input === null) return { ...d, warnings: { ...d.warnings } };
  if (typeof input !== 'object') throw new ValidationError('Invalid build config');
  const c = input as Partial<Record<keyof BuildConfig, unknown>>;
  const w = (typeof c.warnings === 'object' && c.warnings ? c.warnings : {}) as Record<string, unknown>;
  const strArr = (v: unknown, name: string): string[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ValidationError(`"${name}" must be a string array`);
    if (v.length > 40) throw new ValidationError(`Too many ${name}`);
    return (v as string[]).map((s) => s.trim()).filter(Boolean);
  };
  const std = (c.std ?? d.std) as CStandard;
  if (!STANDARDS.includes(std)) throw new ValidationError(`Unsupported C standard: ${String(c.std)}`);
  const opt = (c.optimization ?? d.optimization) as OptLevel;
  if (!OPTS.includes(opt)) throw new ValidationError(`Invalid optimization level: ${String(c.optimization)}`);
  const compiler = c.compiler === 'clang' ? 'clang' : 'gcc';
  const libraries = strArr(c.libraries, 'libraries');
  for (const l of libraries) if (!LIBS.has(l)) throw new ValidationError(`Library not allowed: ${l} (allowed: ${[...LIBS].join(', ')})`);
  const defines = strArr(c.defines, 'defines');
  for (const def of defines) validateFlag(`-D${def}`);
  const extraFlags = strArr(c.extraFlags, 'extraFlags').map(validateFlag);
  return {
    compiler,
    std,
    optimization: opt,
    mode: c.mode === 'release' ? 'release' : 'debug',
    warnings: {
      all: w.all !== false,
      extra: w.extra !== false,
      pedantic: w.pedantic === true,
      asErrors: w.asErrors === true,
    },
    debugInfo: c.debugInfo !== false,
    defines,
    libraries,
    extraFlags,
    sanitizeUndefined: c.sanitizeUndefined === true,
  };
}
