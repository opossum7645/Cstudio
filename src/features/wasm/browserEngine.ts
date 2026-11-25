/**
 * In-browser compiler engine (main-thread side): talks to the compiler worker and runs programs
 * in a disposable worker with streaming output, interactive stdin, stop and timeout.
 */
import { create } from 'zustand';
import type { BuildConfig, CompileResult, ExitInfo } from '../../types';
import type { SourceFile } from '../../services/api';
import { uid } from '../../utils/misc';

interface WasmState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  loaded: number;
  total: number;
  error: string | null;
}
export const useWasm = create<WasmState>(() => ({ status: 'idle', loaded: 0, total: 0, error: null }));

export const browserEngineSupported = typeof WebAssembly === 'object' && typeof Worker === 'function';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: { result: CompileResult; wasm: Uint8Array | null }) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./clang.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { type: string; id?: number; result?: CompileResult; wasm?: Uint8Array | null; done?: number; total?: number; message?: string };
    if (m.type === 'progress') {
      if (m.total && m.done !== undefined && m.done < m.total) useWasm.setState({ status: 'loading', loaded: m.done, total: m.total });
    } else if (m.type === 'ready') useWasm.setState({ status: 'ready', error: null });
    else if (m.type === 'load-error') useWasm.setState({ status: 'error', error: m.message ?? 'errore' });
    else if (m.type === 'result' && m.id !== undefined) {
      if (m.id >= 0 && m.result?.steps.length) useWasm.setState({ status: 'ready', error: null });
      else if (m.id >= 0 && /caricare il compilatore/.test(m.result?.diagnostics[0]?.message ?? '')) useWasm.setState({ status: 'error', error: m.result!.diagnostics[0]!.message });
      pending.get(m.id)?.({ result: m.result!, wasm: m.wasm ?? null });
      pending.delete(m.id);
    }
  };
  worker.onerror = (e) => {
    useWasm.setState({ status: 'error', error: e.message || 'Errore nel worker del compilatore' });
    for (const [, r] of pending) r({ result: { success: false, diagnostics: [{ file: null, line: 0, column: 0, severity: 'error', message: 'Il compilatore nel browser si è interrotto', source: 'compiler' }], steps: [], durationMs: 0, compilerVersion: '' }, wasm: null });
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Downloads and initialises the toolchain in the background. */
export function preloadBrowserCompiler(): void {
  if (useWasm.getState().status !== 'idle') return;
  useWasm.setState({ status: 'loading' });
  getWorker().postMessage({ type: 'preload' });
}

export function compileInBrowser(files: SourceFile[], config: BuildConfig): Promise<{ result: CompileResult; wasm: Uint8Array | null }> {
  if (useWasm.getState().status === 'idle') useWasm.setState({ status: 'loading' });
  const id = seq++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ id, files, config });
  });
}

/* ───────────── stdin bridge through the service worker ───────────── */
function swController(): ServiceWorker | null {
  return typeof navigator !== 'undefined' && navigator.serviceWorker?.controller ? navigator.serviceWorker.controller : null;
}

export interface BrowserRunHandlers {
  onPhase?(phase: string): void;
  onCompile?(r: CompileResult): void;
  onOutput(stream: 'stdout' | 'stderr', text: string): void;
  onExit(e: ExitInfo): void;
  onError(msg: string): void;
}

const MAX_OUTPUT = 1024 * 1024;

/** Compiles (in the browser) and runs; same controller shape as the server run session. */
export function startBrowserRunSession(files: SourceFile[], config: BuildConfig, args: string[], wallTimeoutMs: number, h: BrowserRunHandlers) {
  const sid = uid('run');
  const sw = swController();
  let runner: Worker | null = null;
  let finished = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bytes = 0;

  const finish = (e: ExitInfo) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    runner?.terminate();
    swController()?.postMessage({ type: 'cstudio-stdin-end', s: sid });
    h.onExit(e);
  };

  void (async () => {
    h.onPhase?.('compiling');
    const { result, wasm } = await compileInBrowser(files, config);
    h.onCompile?.(result);
    if (stopped) return finish({ exitCode: null, signal: null, reason: 'stopped' });
    if (!result.success || !wasm) return finish({ exitCode: null, signal: null, reason: 'compile-failed' });
    h.onPhase?.('running');
    const t0 = performance.now();
    runner = new Worker(new URL('./run.worker.ts', import.meta.url), { type: 'module' });
    runner.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string; data?: string; exitCode?: number | null; signal?: string | null; signalDescription?: string; error?: string; durationMs?: number };
      if (m.type === 'stdout' || m.type === 'stderr') {
        bytes += m.data!.length;
        if (bytes > MAX_OUTPUT) {
          h.onOutput('stderr', `\n[C-Studio] Limite di output (${MAX_OUTPUT} byte) raggiunto — programma interrotto.\n`);
          return finish({ exitCode: null, signal: null, reason: 'output-limit', durationMs: performance.now() - t0 });
        }
        h.onOutput(m.type, m.data!);
      } else if (m.type === 'stdin-unavailable') {
        h.onOutput('stderr', '\n[C-Studio] Input interattivo non disponibile: il service worker non è attivo. Ricarica la pagina e riprova. (stdin chiuso: EOF)\n');
      } else if (m.type === 'exit') {
        if (m.error) h.onError(`Errore durante l’esecuzione: ${m.error}`);
        finish({ exitCode: m.exitCode ?? null, signal: m.signal ?? null, signalDescription: m.signalDescription ?? null, reason: m.signal ? 'signal' : m.error ? 'error' : 'exited', durationMs: m.durationMs });
      }
    };
    runner.onerror = (e) => {
      h.onError(e.message || 'Errore del worker di esecuzione');
      finish({ exitCode: null, signal: null, reason: 'error' });
    };
    timer = setTimeout(() => finish({ exitCode: null, signal: null, reason: 'timeout', timedOut: true, durationMs: wallTimeoutMs }), wallTimeoutMs);
    const stdinUrl = new URL('__cstudio_stdin__', document.baseURI).href;
    const data = files.filter((f) => !f.path.endsWith('.c') && !f.path.endsWith('.h'));
    runner.postMessage({ wasm: wasm.buffer, files: data, args, sid, stdinUrl, stdinAvailable: !!sw }, [wasm.buffer]);
  })();

  return {
    send(text: string) {
      swController()?.postMessage({ type: 'cstudio-stdin', s: sid, data: text });
    },
    eof() {
      swController()?.postMessage({ type: 'cstudio-stdin-eof', s: sid });
    },
    stop() {
      stopped = true;
      if (runner) finish({ exitCode: null, signal: null, reason: 'stopped' });
    },
  };
}
