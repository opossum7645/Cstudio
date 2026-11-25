import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Trash2, Square } from 'lucide-react';
import { Shell, ShellHost } from '../../features/terminal/shell';
import { useApp, setBuffer, saveFile, createFile, createFolder, deletePath, renamePath, openFile, activeBuildConfig } from '../../stores/appStore';
import { api, BackendError, SourceFile } from '../../services/api';
import { startRunSession, describeExit } from '../../features/execution/runStore';
import { formatCode } from '../../editor/monaco';
import { useBackend } from '../../services/backendStatus';
import type { BuildConfig, CStandard, OptLevel } from '../../types';

interface Line {
  kind: 'out' | 'err' | 'info' | 'cmd' | 'in';
  text: string;
}

interface TermState {
  lines: Line[];
  running: boolean;
  busy: boolean;
}
const useTerm = create<TermState>(() => ({ lines: [{ kind: 'info', text: 'Terminale C-Studio — digita "help" per i comandi disponibili.\n' }], running: false, busy: false }));

const print = (text: string, kind: Line['kind'] = 'out') =>
  useTerm.setState((s) => {
    const lines = s.lines.slice(-2000);
    const last = lines[lines.length - 1];
    if (last && last.kind === kind && kind !== 'cmd') lines[lines.length - 1] = { kind, text: last.text + text };
    else lines.push({ kind, text });
    return { lines };
  });

let termBuild: { files: SourceFile[]; config: BuildConfig } | null = null;
let runCtl: { send(d: string): void; eof(): void; stop(): void } | null = null;

function configFromFlags(flags: string[]): BuildConfig {
  const base = activeBuildConfig();
  const c: BuildConfig = { ...base, warnings: { all: false, extra: false, pedantic: false, asErrors: false }, debugInfo: false, optimization: 'O0', defines: [], libraries: [], extraFlags: [], sanitizeUndefined: false };
  for (const f of flags) {
    if (f === '--clang') c.compiler = 'clang';
    else if (f.startsWith('-std=')) c.std = (f.slice(5) === 'c2x' ? 'c23' : f.slice(5)) as CStandard;
    else if (/^-O[0-3sg]$/.test(f)) c.optimization = f.slice(1) as OptLevel;
    else if (f === '-Wall') c.warnings.all = true;
    else if (f === '-Wextra') c.warnings.extra = true;
    else if (f === '-pedantic') c.warnings.pedantic = true;
    else if (f === '-Werror') c.warnings.asErrors = true;
    else if (f === '-g') c.debugInfo = true;
    else if (f.startsWith('-D')) c.defines.push(f.slice(2));
    else if (f.startsWith('-l')) c.libraries.push(f.slice(2));
    else if (f === '-fsanitize=undefined') c.sanitizeUndefined = true;
    else c.extraFlags.push(f);
  }
  return c;
}

const currentFiles = () => {
  const s = useApp.getState();
  return { ...(s.project?.files ?? {}), ...s.buffers };
};

const host: ShellHost = {
  fs: {
    files: currentFiles,
    folders: () => useApp.getState().project?.folders ?? [],
    async write(path, content) {
      if (path in (useApp.getState().project?.files ?? {})) {
        setBuffer(path, content);
        return saveFile(path);
      }
      return createFile(path, content, false);
    },
    mkdir: (p) => createFolder(p),
    remove: (p) => deletePath(p, false),
    move: (a, b) => renamePath(a, b),
  },
  print: (t, k) => print(t, k === 'err' ? 'err' : k === 'info' ? 'info' : 'out'),
  clear: () => useTerm.setState({ lines: [] }),
  open: (p) => openFile(p),
  async compile(sources, flags) {
    if (!useBackend.getState().available) {
      print(`${useBackend.getState().message}\n`, 'err');
      return false;
    }
    const all = currentFiles();
    const files: SourceFile[] = Object.entries(all)
      .filter(([p]) => !p.endsWith('.c') || sources.includes(p))
      .filter(([p]) => !p.startsWith('build/'))
      .map(([path, content]) => ({ path, content }));
    const config = configFromFlags(flags);
    try {
      const r = await api.compile(files, config);
      for (const st of r.steps) {
        if (st.stderr.trim()) print(st.stderr.endsWith('\n') ? st.stderr : st.stderr + '\n', st.exitCode === 0 ? 'out' : 'err');
      }
      if (r.success) {
        termBuild = { files, config };
        print(`Compilazione riuscita (${r.durationMs} ms). Esegui con ./app\n`, 'info');
      } else print(`Compilazione non riuscita (${r.diagnostics.filter((d) => d.severity === 'error').length} errori)\n`, 'err');
      return r.success;
    } catch (e) {
      print(`${e instanceof BackendError ? e.message : 'Errore di compilazione'}\n`, 'err');
      return false;
    }
  },
  run(args) {
    return new Promise((resolve) => {
      if (!termBuild) {
        print('Nessun programma compilato\n', 'err');
        return resolve();
      }
      useTerm.setState({ running: true });
      runCtl = startRunSession(termBuild.files, termBuild.config, args, useApp.getState().settings.runTimeoutSec * 1000, {
        onOutput: (stream, text) => print(text, stream === 'stderr' ? 'err' : 'out'),
        onError: (m) => print(`${m}\n`, 'err'),
        onExit: (e) => {
          print(`\n[${describeExit(e)}]\n`, e.reason === 'exited' && e.exitCode === 0 ? 'info' : 'err');
          useTerm.setState({ running: false });
          runCtl = null;
          resolve();
        },
      });
    });
  },
  async format(path) {
    try {
      const out = await formatCode(currentFiles()[path] ?? '');
      if (out !== null) {
        setBuffer(path, out);
        await saveFile(path);
      }
      return true;
    } catch (e) {
      print(`${(e as Error).message}\n`, 'err');
      return false;
    }
  },
};

const shell = new Shell(host);
let shellProject: string | null = null;

export function TerminalPanel() {
  const { lines, running, busy } = useTerm();
  const projectId = useApp((s) => s.project?.id ?? null);
  const [input, setInput] = useState('');
  const [hist, setHist] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (projectId !== shellProject) {
      shellProject = projectId;
      shell.cwd = '';
    }
  }, [projectId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [lines]);

  const submit = async () => {
    const line = input;
    setInput('');
    setHist(-1);
    if (running) {
      print(line + '\n', 'in');
      runCtl?.send(line + '\n');
      return;
    }
    print(`${shell.prompt}${line}\n`, 'cmd');
    useTerm.setState({ busy: true });
    try {
      await shell.execute(line);
    } finally {
      useTerm.setState({ busy: false });
      inputRef.current?.focus();
    }
  };

  return (
    <div className="panel-body" onClick={() => inputRef.current?.focus()}>
      <div className="toolbar">
        <span className="muted mono" style={{ fontSize: 12 }}>{running ? 'programma in esecuzione — l’input va a stdin' : `cwd: /${shell.cwd}`}</span>
        <span className="grow" />
        {running && <button className="btn danger sm" onClick={() => runCtl?.stop()}><Square size={13} /> Stop</button>}
        {running && <button className="btn sm" onClick={() => { runCtl?.eof(); print('^D\n', 'info'); }}>EOF</button>}
        <button className="icon-btn sm" title="Pulisci" aria-label="Pulisci terminale" onClick={() => useTerm.setState({ lines: [] })}><Trash2 size={14} /></button>
      </div>
      <div className="console scroll" role="log" aria-live="polite">
        {lines.map((l, i) => (
          <span key={i} className={l.kind === 'err' ? 'stderr' : l.kind === 'cmd' ? 'command' : l.kind === 'in' ? 'stdin' : l.kind === 'info' ? 'info' : ''}>{l.text}</span>
        ))}
        <div ref={end} />
      </div>
      <form className="console-input" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <span className="mono muted" style={{ fontSize: 12.5 }}>{running ? 'stdin>' : shell.prompt}</span>
        <input
          ref={inputRef}
          className="input"
          value={input}
          disabled={busy && !running}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Comando del terminale"
          placeholder={running ? 'Input del programma' : 'help, ls, gcc src/main.c, ./app…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (running) return;
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              const h = Math.min(shell.history.length - 1, hist + 1);
              if (h >= 0) (setHist(h), setInput(shell.history[shell.history.length - 1 - h]!));
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const h = hist - 1;
              setHist(Math.max(-1, h));
              setInput(h >= 0 ? shell.history[shell.history.length - 1 - h]! : '');
            } else if (e.key === 'Tab') {
              e.preventDefault();
              const opts = shell.complete(input);
              if (opts.length === 1) setInput(input.replace(/\S*$/, opts[0]!));
              else if (opts.length > 1) print(opts.join('  ') + '\n', 'info');
            } else if (e.key === 'l' && e.ctrlKey) {
              e.preventDefault();
              useTerm.setState({ lines: [] });
            }
          }}
        />
        <button className="btn sm" type="submit">Invio</button>
      </form>
    </div>
  );
}
