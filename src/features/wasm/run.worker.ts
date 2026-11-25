/// <reference lib="webworker" />
/**
 * Runs a compiled WASI program inside a dedicated worker (killable by the page).
 * stdout/stderr are streamed to the page. stdin is read synchronously: the worker blocks on a
 * synchronous request to "__cstudio_stdin__", answered by the service worker when the user
 * types something (no SharedArrayBuffer / cross-origin isolation needed, works on GitHub Pages).
 * Project files are mounted in the working directory, so fopen("data.txt") works.
 */
import { WASI, Fd, File, PreopenDirectory, ConsoleStdout, Directory, wasi } from '@bjorn3/browser_wasi_shim';
import type { Inode } from '@bjorn3/browser_wasi_shim';

interface StartMsg {
  wasm: ArrayBuffer;
  files: { path: string; content: string }[];
  args: string[];
  sid: string;
  stdinUrl: string;
  stdinAvailable: boolean;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const enc = new TextEncoder();

class InteractiveStdin extends Fd {
  private buf = new Uint8Array(0);
  private eof = false;
  constructor(private url: string, private sid: string, private available: boolean) {
    super();
  }
  override fd_fdstat_get() {
    return { ret: 0, fdstat: new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0) };
  }
  private fill(): void {
    if (this.eof) return;
    if (!this.available) {
      ctx.postMessage({ type: 'stdin-unavailable' });
      this.eof = true;
      return;
    }
    ctx.postMessage({ type: 'stdin-wait' });
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${this.url}?s=${encodeURIComponent(this.sid)}&t=${Date.now()}`, false);
      xhr.send();
      if (xhr.status !== 200) throw new Error(String(xhr.status));
      if (xhr.getResponseHeader('X-Cstudio-Eof') === '1') this.eof = true;
      const data = enc.encode(xhr.responseText);
      const merged = new Uint8Array(this.buf.length + data.length);
      merged.set(this.buf);
      merged.set(data, this.buf.length);
      this.buf = merged;
    } catch {
      ctx.postMessage({ type: 'stdin-unavailable' });
      this.eof = true;
    }
  }
  override fd_read(size: number) {
    if (this.buf.length === 0) this.fill();
    const n = Math.min(size, this.buf.length);
    const data = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return { ret: 0, data };
  }
}

function mount(files: StartMsg['files']): Map<string, Inode> {
  const root = new Map<string, Inode>();
  for (const f of files) {
    const parts = f.path.split('/');
    let dir = root;
    for (const p of parts.slice(0, -1)) {
      let d = dir.get(p);
      if (!(d instanceof Directory)) {
        d = new Directory(new Map());
        dir.set(p, d);
      }
      dir = (d as Directory).contents;
    }
    dir.set(parts[parts.length - 1]!, new File(enc.encode(f.content)));
  }
  return root;
}

const TRAPS: [RegExp, string, string][] = [
  [/divide by zero/i, 'SIGFPE', 'Divisione intera per zero (trap WebAssembly, equivalente a SIGFPE)'],
  [/integer overflow/i, 'SIGFPE', 'Overflow aritmetico intero (es. INT_MIN / -1), equivalente a SIGFPE'],
  [/out of bounds|memory access/i, 'SIGSEGV', 'Accesso a memoria non valida (trap WebAssembly, equivalente a SIGSEGV)'],
  [/call stack|stack size|too much recursion/i, 'SIGSEGV', 'Stack esaurito: ricorsione troppo profonda (equivalente a SIGSEGV)'],
  [/unreachable/i, 'SIGABRT', 'Programma interrotto: abort(), assert fallito o comportamento indefinito (equivalente a SIGABRT)'],
  [/indirect call|signature mismatch|null function/i, 'SIGSEGV', 'Chiamata tramite puntatore a funzione non valido (equivalente a SIGSEGV)'],
];

ctx.onmessage = async (ev: MessageEvent<StartMsg>) => {
  const m = ev.data;
  const start = performance.now();
  const out = (type: 'stdout' | 'stderr') => new ConsoleStdout((b) => ctx.postMessage({ type, data: new TextDecoder().decode(b) }));
  const fds = [new InteractiveStdin(m.stdinUrl, m.sid, m.stdinAvailable), out('stdout'), out('stderr'), new PreopenDirectory('.', mount(m.files))];
  const runtime = new WASI(['app', ...m.args], ['PWD=/'], fds);
  try {
    const module = await WebAssembly.compile(m.wasm);
    const inst = (await WebAssembly.instantiate(module, { wasi_snapshot_preview1: runtime.wasiImport })) as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } };
    const code = runtime.start(inst);
    ctx.postMessage({ type: 'exit', exitCode: code, signal: null, durationMs: performance.now() - start });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const t = TRAPS.find(([re]) => re.test(msg));
    if (t) ctx.postMessage({ type: 'exit', exitCode: null, signal: t[1], signalDescription: t[2], durationMs: performance.now() - start });
    else ctx.postMessage({ type: 'exit', exitCode: null, signal: null, error: msg, durationMs: performance.now() - start });
  }
};
