/** GDB-backed debugger state and actions. Breakpoints persist in the project even when not debugging. */
import { create } from 'zustand';
import type { CompileResult, ExitInfo } from '../../types';
import { Session } from '../../services/api';
import { useApp, updateProject, activeBuildConfig, openFile } from '../../stores/appStore';
import { applyCompileResult, collectSources, log } from '../compiler/buildStore';
import { useBackend } from '../../services/backendStatus';
import { describeExit, parseArgs } from '../execution/runStore';
import { toast } from '../../stores/uiFeedback';
import { uid } from '../../utils/misc';

export interface Frame {
  level: number;
  func: string;
  file: string | null;
  line: number;
  addr: string;
}
export interface Variable {
  name: string;
  type: string;
  value: string;
  arg: boolean;
}
export interface WatchValue {
  expression: string;
  value?: string;
  error?: string;
}
export interface ConsoleLine {
  id: string;
  kind: 'program' | 'gdb' | 'input' | 'result' | 'error' | 'info';
  text: string;
}

type ServerMsg =
  | { type: 'phase'; phase: string }
  | { type: 'compile'; result: CompileResult }
  | {
      type: 'state';
      state: 'running' | 'stopped';
      reason?: string;
      signal?: string;
      signalDescription?: string;
      location?: { file: string | null; line: number; func: string } | null;
      frames?: Frame[];
      selectedFrame?: number;
      variables?: Variable[];
      watches?: WatchValue[];
    }
  | { type: 'stdout'; data: string }
  | { type: 'console'; data: string }
  | { type: 'watches'; watches: WatchValue[] }
  | { type: 'evaluate'; id: string; expression?: string; value?: string; error?: string }
  | { type: 'registers'; registers: { name: string; value: string }[]; error?: string }
  | { type: 'breakpoints'; breakpoints: { file: string; line: number; requested: number; id: string }[] }
  | ({ type: 'exit' } & ExitInfo)
  | { type: 'error'; message: string };

interface DebugState {
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'ended';
  phase: string;
  reason: string | null;
  location: { file: string | null; line: number; func: string } | null;
  frames: Frame[];
  selectedFrame: number;
  variables: Variable[];
  watches: WatchValue[];
  registers: { name: string; value: string }[];
  console: ConsoleLine[];
  exit: ExitInfo | null;
  verified: Record<string, number[]>;
}

export const useDebug = create<DebugState>(() => ({
  status: 'idle', phase: '', reason: null, location: null, frames: [], selectedFrame: 0, variables: [], watches: [], registers: [], console: [], exit: null, verified: {},
}));

let session: Session<ServerMsg> | null = null;

function con(kind: ConsoleLine['kind'], text: string) {
  useDebug.setState((s) => {
    const lines = s.console.slice(-1500);
    const last = lines[lines.length - 1];
    if (last && last.kind === kind && kind === 'program') lines[lines.length - 1] = { ...last, text: last.text + text };
    else lines.push({ id: uid('d'), kind, text });
    return { console: lines };
  });
}

const reasonText: Record<string, string> = {
  'breakpoint-hit': 'Breakpoint raggiunto',
  'end-stepping-range': 'Step completato',
  'function-finished': 'Uscito dalla funzione',
  'signal-received': 'Segnale ricevuto',
  'frame-selected': 'Frame selezionato',
  paused: 'In pausa',
  'location-reached': 'Posizione raggiunta',
};

export function isDebugging(): boolean {
  const s = useDebug.getState().status;
  return s === 'starting' || s === 'running' || s === 'stopped';
}

export const debugActions = {
  async start() {
    if (isDebugging()) return;
    const app = useApp.getState();
    if (!app.project) return;
    const backend = useBackend.getState();
    if (!backend.available) return toast('error', backend.message);
    if (backend.health && !backend.health.features.debug) return toast('error', 'GDB non è installato sul server: debug non disponibile');
    const files = collectSources();
    const config = activeBuildConfig();
    const breakpoints = Object.entries(app.project.breakpoints).flatMap(([file, lines]) => lines.map((line) => ({ file, line })));
    useDebug.setState({ status: 'starting', phase: 'compiling', reason: null, location: null, frames: [], variables: [], watches: [], registers: [], console: [], exit: null, verified: {} });
    useApp.setState({ panelOpen: true, panelTab: 'debug' });
    con('info', `Avvio debug (gdb) — ${breakpoints.length} breakpoint`);
    if (!breakpoints.length) con('info', 'Suggerimento: tocca il margine sinistro dell’editor (o F9) per inserire breakpoint.');
    session = new Session<ServerMsg>(
      '/ws/debug',
      { files, config, breakpoints, watches: app.project.watches, args: parseArgs(app.project.runArgs) },
      (m) => debugActions.handle(m, files, config),
      (err) => {
        if (err) con('error', err);
        if (isDebugging()) useDebug.setState({ status: 'ended', location: null });
        session = null;
      },
    );
  },

  handle(m: ServerMsg, files: ReturnType<typeof collectSources>, config: ReturnType<typeof activeBuildConfig>) {
    switch (m.type) {
      case 'phase':
        useDebug.setState({ phase: m.phase });
        if (m.phase === 'starting-debugger') con('info', 'Compilazione riuscita, avvio di gdb…');
        break;
      case 'compile':
        applyCompileResult(m.result, files, config, 'Build di debug');
        if (!m.result.success) useApp.setState({ panelTab: 'problems' });
        break;
      case 'state':
        if (m.state === 'running') {
          useDebug.setState({ status: 'running', location: null, reason: null });
        } else {
          useDebug.setState({
            status: 'stopped',
            reason: m.reason ?? null,
            location: m.location ?? null,
            frames: m.frames ?? [],
            selectedFrame: m.selectedFrame ?? 0,
            variables: m.variables ?? [],
            watches: m.watches ?? [],
          });
          if (m.reason !== 'frame-selected') {
            const where = m.location?.file ? `${m.location.file}:${m.location.line}` : 'codice senza sorgente';
            con(m.reason === 'signal-received' ? 'error' : 'info', `${reasonText[m.reason ?? ''] ?? m.reason}${m.signal ? `: ${m.signal} — ${m.signalDescription ?? ''}` : ''} in ${m.location?.func ?? '?'}() (${where})`);
          }
          const frame = (m.frames ?? [])[m.selectedFrame ?? 0] ?? m.location;
          if (frame && frame.file && useApp.getState().project?.files[frame.file] !== undefined) openFile(frame.file, { line: frame.line });
        }
        break;
      case 'stdout':
        con('program', m.data);
        break;
      case 'console':
        if (m.data.trim()) con('gdb', m.data.trimEnd());
        break;
      case 'watches':
        useDebug.setState({ watches: m.watches });
        break;
      case 'evaluate':
        con(m.error ? 'error' : 'result', m.error ? `${m.expression ?? ''}: ${m.error}` : `${m.expression} = ${m.value}`);
        break;
      case 'registers':
        useDebug.setState({ registers: m.registers });
        if (m.error) con('error', m.error);
        break;
      case 'breakpoints': {
        const verified: Record<string, number[]> = {};
        for (const b of m.breakpoints) (verified[b.file] ??= []).push(b.line);
        useDebug.setState({ verified });
        break;
      }
      case 'error':
        con('error', m.message);
        break;
      case 'exit':
        useDebug.setState({ status: 'ended', exit: m, location: null, frames: [], variables: [] });
        con(m.reason === 'exited' && m.exitCode === 0 ? 'info' : 'error', describeExit(m));
        log('info', `Sessione di debug terminata: ${describeExit(m)}`);
        break;
    }
  },

  command(c: 'continue' | 'next' | 'step' | 'finish' | 'pause' | 'stop') {
    session?.send({ type: 'command', command: c });
  },

  async restart() {
    if (session) {
      session.send({ type: 'command', command: 'stop' });
      await new Promise((r) => setTimeout(r, 300));
    }
    useDebug.setState({ status: 'idle' });
    await debugActions.start();
  },

  async toggleBreakpoint(file: string, line: number) {
    const p = useApp.getState().project;
    if (!p) return;
    const cur = p.breakpoints[file] ?? [];
    const lines = cur.includes(line) ? cur.filter((l) => l !== line) : [...cur, line].sort((a, b) => a - b);
    const bps = { ...p.breakpoints, [file]: lines };
    if (!lines.length) delete bps[file];
    await updateProject({ breakpoints: bps });
    session?.send({ type: 'setBreakpoints', file, lines });
  },

  async clearBreakpoints() {
    const p = useApp.getState().project;
    if (!p) return;
    for (const file of Object.keys(p.breakpoints)) session?.send({ type: 'setBreakpoints', file, lines: [] });
    await updateProject({ breakpoints: {} });
  },

  async setWatches(expressions: string[]) {
    await updateProject({ watches: expressions });
    session?.send({ type: 'setWatches', expressions });
    if (!session) useDebug.setState({ watches: expressions.map((e) => ({ expression: e })) });
  },

  evaluate(expression: string) {
    if (!expression.trim()) return;
    con('input', `> ${expression}`);
    if (!session) return con('error', 'Avvia il debug e metti in pausa il programma per valutare espressioni');
    session.send({ type: 'evaluate', id: uid('e'), expression });
  },

  selectFrame(level: number) {
    session?.send({ type: 'selectFrame', level });
  },

  fetchRegisters() {
    session?.send({ type: 'registers' });
  },

  sendInput(text: string) {
    if (!session) return;
    session.send({ type: 'stdin', data: text });
    con('input', text.replace(/\n$/, ''));
  },

  clearConsole() {
    useDebug.setState({ console: [] });
  },
};
