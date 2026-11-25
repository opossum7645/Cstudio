/**
 * Multi-file build: every translation unit is compiled separately to an object file
 * (so all diagnostics are collected), then the objects are linked. All steps run in the sandbox.
 */
import { writeFile, stat, chown } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { BuildConfig, CompileResult, Diagnostic, ProjectFile, StepLog } from '../types.js';
import { runSandboxed } from '../security/sandbox.js';
import { Job } from '../security/workspace.js';
import { config } from '../config.js';
import { parseDiagnostics } from './diagnostics.js';
import { compilerBinary, getToolchain } from '../services/toolchain.js';

export const BINARY_PATH = 'build/app';

/**
 * Tiny runtime linked into every program: makes stdout/stderr unbuffered so prompts written
 * without a trailing newline (e.g. printf("Number: ")) appear before scanf blocks on a pipe.
 */
const RUNTIME_SHIM = `#include <stdio.h>
__attribute__((constructor)) static void cstudio_rt_init(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  setvbuf(stderr, NULL, _IONBF, 0);
}
`;

export function stdFlag(cfg: BuildConfig): string {
  // GCC < 14 only knows "c2x"; Clang >= 18 and GCC >= 14 accept it as an alias of c23.
  if (cfg.std === 'c23') return '-std=c2x';
  return `-std=${cfg.std}`;
}

export function compileFlags(cfg: BuildConfig): string[] {
  const f: string[] = [stdFlag(cfg), `-${cfg.optimization}`];
  if (cfg.warnings.all) f.push('-Wall');
  if (cfg.warnings.extra) f.push('-Wextra');
  if (cfg.warnings.pedantic) f.push('-pedantic');
  if (cfg.warnings.asErrors) f.push('-Werror');
  if (cfg.debugInfo) f.push('-g');
  if (cfg.mode === 'release') f.push('-DNDEBUG');
  for (const d of cfg.defines) f.push(`-D${d}`);
  if (cfg.sanitizeUndefined) f.push('-fsanitize=undefined');
  f.push(...cfg.extraFlags);
  return f;
}

function diagnosticFlags(cfg: BuildConfig): string[] {
  return cfg.compiler === 'clang'
    ? ['-fno-color-diagnostics', '-fdiagnostics-show-option']
    : ['-fno-diagnostics-color', '-fdiagnostics-plain-output', '-fmessage-length=0'];
}

function objectName(path: string): string {
  return 'build/obj/' + path.replace(/\.c$/, '').replace(/[^A-Za-z0-9_]/g, '_') + '.o';
}

function includeDirs(files: ProjectFile[]): string[] {
  const dirs = new Set<string>(['.']);
  for (const f of files) {
    if (f.path.endsWith('.h')) dirs.add(posix.dirname(f.path));
  }
  return [...dirs].map((d) => `-I${d}`);
}

export async function compileProject(job: Job, files: ProjectFile[], cfg: BuildConfig): Promise<CompileResult> {
  const start = Date.now();
  const tc = getToolchain();
  const cc = compilerBinary(cfg.compiler);
  const info = cfg.compiler === 'clang' ? tc.clang : tc.gcc;
  const steps: StepLog[] = [];
  const diagnostics: Diagnostic[] = [];
  const known = new Set(files.map((f) => f.path));

  if (!info.available) {
    return {
      success: false,
      diagnostics: [{ file: null, line: 0, column: 0, severity: 'error', message: `Compiler "${cc}" is not installed on the server`, source: 'compiler' }],
      steps,
      durationMs: 0,
      compilerVersion: '',
    };
  }

  const sources = files.filter((f) => f.path.endsWith('.c'));
  if (sources.length === 0) {
    return {
      success: false,
      diagnostics: [{ file: null, line: 0, column: 0, severity: 'error', message: 'The project has no .c source files to compile', source: 'compiler' }],
      steps,
      durationMs: Date.now() - start,
      compilerVersion: info.version,
    };
  }

  const flags = [...compileFlags(cfg), ...diagnosticFlags(cfg), ...includeDirs(files)];
  const objects: string[] = [];
  let failed = false;

  const runStep = async (argv: string[]): Promise<boolean> => {
    const r = await runSandboxed({ jobDir: job.dir, uid: job.uid, kind: 'compile', argv, timeoutMs: config.limits.compileTimeoutMs });
    let stderr = r.stderr;
    if (r.timedOut) stderr += `\n[C-Studio] Compilation step exceeded ${config.limits.compileTimeoutMs / 1000}s and was stopped.`;
    steps.push({ command: argv.join(' '), exitCode: r.exitCode ?? -1, stdout: r.stdout, stderr, durationMs: r.durationMs });
    diagnostics.push(...parseDiagnostics(r.stderr, known));
    if (r.timedOut) {
      diagnostics.push({ file: null, line: 0, column: 0, severity: 'error', message: 'Compilation timed out', source: 'compiler' });
    }
    return r.exitCode === 0 && !r.timedOut;
  };

  for (const src of sources) {
    const obj = objectName(src.path);
    const ok = await runStep([cc, ...flags, '-c', src.path, '-o', obj]);
    if (!ok) failed = true;
    objects.push(obj);
  }

  if (!failed) {
    // runtime shim (not shown in diagnostics; compiled with warnings disabled)
    const shimSrc = join(job.dir, 'build', 'cstudio_rt.c');
    await writeFile(shimSrc, RUNTIME_SHIM);
    if (process.getuid?.() === 0) await chown(shimSrc, job.uid, job.uid);
    const shim = await runSandboxed({
      jobDir: job.dir, uid: job.uid, kind: 'compile', timeoutMs: config.limits.compileTimeoutMs,
      argv: [cc, '-std=gnu11', '-w', '-O2', '-c', 'build/cstudio_rt.c', '-o', 'build/obj/__cstudio_rt.o'],
    });
    if (shim.exitCode !== 0) {
      steps.push({ command: 'runtime shim', exitCode: shim.exitCode ?? -1, stdout: shim.stdout, stderr: shim.stderr, durationMs: shim.durationMs });
      failed = true;
    } else {
      const linkFlags = cfg.sanitizeUndefined ? ['-fsanitize=undefined'] : [];
      const libs = cfg.libraries.map((l) => `-l${l}`);
      const ok = await runStep([cc, ...linkFlags, ...diagnosticFlags(cfg), ...objects, 'build/obj/__cstudio_rt.o', '-o', BINARY_PATH, ...libs]);
      if (!ok) failed = true;
    }
  }

  let binarySize: number | undefined;
  if (!failed) {
    binarySize = (await stat(join(job.dir, BINARY_PATH))).size;
  }
  return {
    success: !failed,
    diagnostics,
    steps,
    durationMs: Date.now() - start,
    compilerVersion: info.version,
    binarySize,
  };
}
