/** Program execution (Run panel): streams output, sends interactive input, stop/timeout handling. */
import { create } from 'zustand';
import type { BuildConfig, CompileResult, ExitInfo } from '../../types';
import { Session, SourceFile } from '../../services/api';
import { useApp, activeBuildConfig } from '../../stores/appStore';
import { useBuild, applyCompileResult, collectSources, log, configSummary } from '../compiler/buildStore';
import { useBackend } from '../../services/backendStatus';
import { formatDuration } from '../../utils/misc';

export interface OutputChunk {
  stream: 'stdout' | 'stderr' | 'stdin' | 'system';
  text: string;
}

type ServerMsg =
  | { type: 'phase'; phase: 'compiling' | 'running' }
  | { type: 'compile'; result: CompileResult }
  | { type: 'stdout' | 'stderr'; data: string }
  | ({ type: 'exit' } & ExitInfo)
  | { type: 'error'; message: string };

interface RunState {
  status: 'idle' | 'compiling' | 'running' | 'finished';
  output: OutputChunk[];
  exit: ExitInfo | null;
  startedAt: number | null;
  error: string | null;
}

export const useRun = create<RunState>(() => ({ status: 'idle', output: [], exit: null, startedAt: null, error: null }));

function append(stream: OutputChunk['stream'], text: string) {
  useRun.setState((s) => {
    const out = s.output.slice();
    const last = out[out.length - 1];
    if (last && last.stream === stream && stream !== 'system') out[out.length - 1] = { stream, text: last.text + text };
    else out.push({ stream, text });
    // keep memory bounded
    let total = out.reduce((n, c) => n + c.text.length, 0);
    while (total > 400_000 && out.length > 1) total -= out.shift()!.text.length;
    return { output: out };
  });
}

export function describeExit(e: ExitInfo): string {
  const t = e.durationMs !== undefined ? ` in ${formatDuration(e.durationMs)}` : '';
  switch (e.reason) {
    case 'exited':
      return `Programma terminato con codice ${e.exitCode}${t}`;
    case 'signal':
      return `Errore a runtime: ${e.signal}${e.signalDescription ? ` — ${e.signalDescription}` : ''}${t}`;
    case 'timeout':
      return `Interrotto: superato il tempo massimo di esecuzione${t}`;
    case 'output-limit':
      return 'Interrotto: superato il limite di output';
    case 'stopped':
      return 'Esecuzione interrotta dall’utente';
    case 'compile-failed':
      return 'Compilazione non riuscita: programma non eseguito (vedi Problems)';
    case 'debugger-exited':
      return 'Il debugger è terminato';
    default:
      return 'Esecuzione terminata con errore';
  }
}

export interface RunHandlers {
  onCompile?(r: CompileResult): void;
  onOutput(stream: 'stdout' | 'stderr', text: string): void;
  onExit(e: ExitInfo): void;
  onError(msg: string): void;
  onPhase?(phase: string): void;
}

/** Low-level: start a run session (used by the Run panel and the terminal). */
export function startRunSession(files: SourceFile[], config: BuildConfig, args: string[], wallTimeoutMs: number, h: RunHandlers): { send(data: string): void; eof(): void; stop(): void } {
  let exited = false;
  const s = new Session<ServerMsg>(
    '/ws/run',
    { files, config, args, wallTimeoutMs },
    (m) => {
      if (m.type === 'phase') h.onPhase?.(m.phase);
      else if (m.type === 'compile') h.onCompile?.(m.result);
      else if (m.type === 'stdout' || m.type === 'stderr') h.onOutput(m.type, m.data);
      else if (m.type === 'error') h.onError(m.message);
      else if (m.type === 'exit') {
        exited = true;
        h.onExit(m);
      }
    },
    (err) => {
      if (!exited) {
        if (err) h.onError(err);
        h.onExit({ exitCode: null, signal: null, reason: 'error' });
      }
    },
  );
  return { send: (d) => s.send({ type: 'stdin', data: d }), eof: () => s.send({ type: 'eof' }), stop: () => s.send({ type: 'stop' }) };
}

export function parseArgs(s: string): string[] {
  return (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ''));
}

async function launch(files: SourceFile[], config: BuildConfig, compileFirst: boolean): Promise<void> {
  if (controller) return;
  const app = useApp.getState();
  if (!useBackend.getState().available) {
    useRun.setState({ status: 'finished', output: [{ stream: 'system', text: useBackend.getState().message + '\n' }], exit: null, error: useBackend.getState().message });
    useApp.setState({ panelOpen: true, panelTab: 'run' });
    return;
  }
  const args = parseArgs(app.project?.runArgs ?? '');
  useRun.setState({ status: compileFirst ? 'compiling' : 'running', output: [], exit: null, error: null, startedAt: Date.now() });
  useApp.setState({ panelOpen: true, panelTab: 'run' });
  if (compileFirst) log('info', `Compila ed esegui — ${configSummary(config)}`);
  else log('info', 'Esecuzione dell’ultima build riuscita');
  append('system', compileFirst ? 'Compilazione in corso…\n' : 'Avvio del programma…\n');
  const ctl = startRunSession(files, config, args, app.settings.runTimeoutSec * 1000, {
    onPhase: (p) => {
      if (p === 'running') {
        useRun.setState({ status: 'running', startedAt: Date.now() });
        append('system', `▶ ${args.length ? 'app ' + args.join(' ') : 'app'}\n`);
      }
    },
    onCompile: (r) => {
      if (compileFirst) applyCompileResult(r, files, config, 'Build');
      if (!r.success) useApp.setState({ panelTab: 'problems' });
    },
    onOutput: (stream, text) => append(stream, text),
    onError: (msg) => {
      append('system', `Errore: ${msg}\n`);
      useRun.setState({ error: msg });
    },
    onExit: (e) => {
      append('system', `\n${describeExit(e)}\n`);
      useRun.setState({ status: 'finished', exit: e });
      log(e.reason === 'exited' && e.exitCode === 0 ? 'success' : e.reason === 'compile-failed' ? 'error' : 'warning', describeExit(e));
      controller = null;
    },
  });
  controller = ctl;
}

let controller: { send(d: string): void; eof(): void; stop(): void } | null = null;

export const runActions = {
  compileAndRun: () => launch(collectSources(), activeBuildConfig(), true),
  /** Runs the last successfully built snapshot (no rebuild). */
  runLastBuild: async () => {
    const lb = useBuild.getState().lastBuild;
    if (!lb) return;
    await launch(lb.files, lb.config, false);
  },
  sendInput(text: string) {
    if (!controller || useRun.getState().status !== 'running') return;
    controller.send(text);
    append('stdin', text);
  },
  sendEof() {
    controller?.eof();
    append('system', '^D (EOF)\n');
  },
  stop() {
    controller?.stop();
  },
  clear() {
    if (useRun.getState().status === 'running' || useRun.getState().status === 'compiling') useRun.setState({ output: [] });
    else useRun.setState({ output: [], exit: null, status: 'idle', error: null });
  },
  get busy() {
    const s = useRun.getState().status;
    return s === 'running' || s === 'compiling';
  },
};
