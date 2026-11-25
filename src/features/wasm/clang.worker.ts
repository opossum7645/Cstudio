/// <reference lib="webworker" />
/**
 * Compiler worker: real Clang/LLD built for WebAssembly (YoWASP), running entirely in the browser.
 * Every .c file is compiled to an object file, then everything is linked into a WASI program.
 * The toolchain (~100 MB) is downloaded on first use and then cached by the service worker.
 */
import type { BuildConfig, CompileResult, Diagnostic, StepLog } from '../../types';
import { parseDiagnostics } from './diagnostics';

type Tree = { [name: string]: Tree | string | Uint8Array };
type RunClang = (args: string[], files: Tree, opts: Record<string, unknown>) => Promise<Tree>;

interface CompileRequest {
  id: number;
  files: { path: string; content: string }[];
  config: BuildConfig;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let runClang: RunClang | null = null;
const VERSION = 'clang 22 (WebAssembly · wasm32-wasi)';

/** Makes stdout/stderr unbuffered so prompts appear before the program blocks on input. */
const RUNTIME_SHIM = `#include <stdio.h>
__attribute__((constructor)) static void cstudio_rt_init(void) {
  setvbuf(stdout, NULL, _IONBF, 0);
  setvbuf(stderr, NULL, _IONBF, 0);
}
`;

async function loadToolchain(): Promise<RunClang> {
  if (runClang) return runClang;
  const mod = (await import('@yowasp/clang')) as unknown as { runClang: RunClang };
  runClang = mod.runClang;
  return runClang;
}

function toTree(files: { path: string; content: string | Uint8Array }[]): Tree {
  const root: Tree = { build: { obj: {} } };
  for (const f of files) {
    const parts = f.path.split('/');
    let dir = root;
    for (const p of parts.slice(0, -1)) dir = (dir[p] ??= {}) as Tree;
    dir[parts[parts.length - 1]!] = f.content;
  }
  return root;
}

function pick(tree: Tree, path: string): Uint8Array | null {
  let node: Tree | string | Uint8Array | undefined = tree;
  for (const p of path.split('/')) {
    if (!node || typeof node === 'string' || node instanceof Uint8Array) return null;
    node = node[p];
  }
  return node instanceof Uint8Array ? node : typeof node === 'string' ? new TextEncoder().encode(node) : null;
}

function stdFlag(std: BuildConfig['std']): string {
  return `-std=${std === 'c23' ? 'c23' : std}`;
}

function flagsFor(cfg: BuildConfig, notes: string[]): string[] {
  const f = [stdFlag(cfg.std), `-${cfg.optimization}`, '-fno-color-diagnostics'];
  if (cfg.warnings.all) f.push('-Wall');
  if (cfg.warnings.extra) f.push('-Wextra');
  if (cfg.warnings.pedantic) f.push('-pedantic');
  if (cfg.warnings.asErrors) f.push('-Werror');
  if (cfg.debugInfo) f.push('-g');
  if (cfg.mode === 'release') f.push('-DNDEBUG');
  for (const d of cfg.defines) f.push(`-D${d}`);
  if (cfg.sanitizeUndefined) notes.push('UndefinedBehaviorSanitizer non è disponibile nel compilatore del browser: opzione ignorata.');
  f.push(...cfg.extraFlags);
  return f;
}

async function compile(req: CompileRequest): Promise<{ result: CompileResult; wasm: Uint8Array | null }> {
  const start = performance.now();
  const steps: StepLog[] = [];
  const diagnostics: Diagnostic[] = [];
  const known = new Set(req.files.map((f) => f.path));
  const notes: string[] = [];
  const cfg = req.config;

  const fail = (message: string) => ({
    result: { success: false, diagnostics: [{ file: null, line: 0, column: 0, severity: 'error' as const, message, source: 'compiler' as const }], steps, durationMs: performance.now() - start, compilerVersion: VERSION },
    wasm: null,
  });

  const sources = req.files.filter((f) => f.path.endsWith('.c'));
  if (!sources.length) return fail('Il progetto non contiene file .c da compilare');
  if (cfg.libraries.includes('pthread')) return fail('I thread POSIX (-lpthread) non sono supportati dal compilatore nel browser: usa il server C-Studio.');

  let clang: RunClang;
  try {
    clang = await loadToolchain();
  } catch (e) {
    return fail(`Impossibile caricare il compilatore WebAssembly: ${(e as Error).message}`);
  }

  const includeDirs = new Set<string>(['.']);
  for (const f of req.files) if (f.path.endsWith('.h')) includeDirs.add(f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.');
  const flags = [...flagsFor(cfg, notes), ...[...includeDirs].map((d) => `-I${d}`)];
  let tree = toTree([...req.files, { path: 'build/cstudio_rt.c', content: RUNTIME_SHIM }]);

  const step = async (args: string[], quiet = false): Promise<boolean> => {
    const t0 = performance.now();
    let stderr = '';
    const dec = new TextDecoder();
    const opts = {
      stdout: null,
      stderr: (b: Uint8Array | null) => {
        if (b) stderr += dec.decode(b, { stream: true });
      },
      fetchProgress: (ev: { totalLength: number; doneLength: number }) => ctx.postMessage({ type: 'progress', done: ev.doneLength, total: ev.totalLength }),
    };
    let ok = true;
    let code = 0;
    try {
      tree = await clang(args, tree, opts);
    } catch (e) {
      const ex = e as { code?: number; files?: Tree; message?: string };
      ok = false;
      code = typeof ex.code === 'number' ? ex.code : 1;
      if (ex.files) tree = ex.files;
      if (typeof ex.code !== 'number') stderr += `\n${ex.message ?? String(e)}`;
    }
    if (!quiet) {
      steps.push({ command: `${args.join(' ')}`, exitCode: code, stdout: '', stderr, durationMs: performance.now() - t0 });
      diagnostics.push(...parseDiagnostics(stderr, known));
    }
    return ok;
  };

  let failed = false;
  const objects: string[] = [];
  for (const src of sources) {
    const obj = 'build/obj/' + src.path.replace(/\.c$/, '').replace(/[^A-Za-z0-9_]/g, '_') + '.o';
    if (!(await step(['clang', ...flags, '-c', src.path, '-o', obj]))) failed = true;
    objects.push(obj);
  }
  if (!failed) {
    await step(['clang', '-std=gnu11', '-w', '-O2', '-c', 'build/cstudio_rt.c', '-o', 'build/obj/__cstudio_rt.o'], true);
    const libs = cfg.libraries.filter((l) => l !== 'pthread').map((l) => `-l${l}`);
    if (!(await step(['clang', ...objects, 'build/obj/__cstudio_rt.o', '-o', 'build/app.wasm', ...libs]))) failed = true;
  }
  const wasm = failed ? null : pick(tree, 'build/app.wasm');
  if (!failed && !wasm) return fail('Il linker non ha prodotto alcun eseguibile');
  for (const n of notes) diagnostics.push({ file: null, line: 0, column: 0, severity: 'warning', message: n, source: 'compiler' });
  return {
    result: { success: !failed, diagnostics, steps, durationMs: performance.now() - start, compilerVersion: VERSION, binarySize: wasm?.length },
    wasm,
  };
}

ctx.onmessage = async (ev: MessageEvent<CompileRequest | { type: 'preload' }>) => {
  const msg = ev.data;
  if ('type' in msg) {
    try {
      await loadToolchain();
      // a trivial compile forces the download/instantiation of every resource
      await compile({ id: -1, files: [{ path: 'warmup.c', content: 'int main(void){return 0;}' }], config: { compiler: 'clang', std: 'c17', optimization: 'O0', mode: 'debug', warnings: { all: false, extra: false, pedantic: false, asErrors: false }, debugInfo: false, defines: [], libraries: [], extraFlags: [], sanitizeUndefined: false } });
      ctx.postMessage({ type: 'ready' });
    } catch (e) {
      ctx.postMessage({ type: 'load-error', message: (e as Error).message });
    }
    return;
  }
  try {
    const out = await compile(msg);
    ctx.postMessage({ type: 'result', id: msg.id, result: out.result, wasm: out.wasm }, out.wasm ? [out.wasm.buffer] : []);
  } catch (e) {
    ctx.postMessage({ type: 'result', id: msg.id, result: { success: false, diagnostics: [{ file: null, line: 0, column: 0, severity: 'error', message: `Errore interno del compilatore: ${(e as Error).message}`, source: 'compiler' }], steps: [], durationMs: 0, compilerVersion: VERSION }, wasm: null });
  }
};
