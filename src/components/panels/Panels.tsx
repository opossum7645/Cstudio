import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, Trash2, Square, Play, Maximize2, Minimize2, X, CornerDownLeft, Bug, StepForward, ArrowDownToLine, ArrowUpFromLine, Pause, RotateCw, Plus, Hammer, ListX, Cpu, PlayCircle } from 'lucide-react';
import { useApp, ui, openFile, updateProject, PanelTab } from '../../stores/appStore';
import { useBuild, clearLog, compileProject } from '../../features/compiler/buildStore';
import { useRun, runActions } from '../../features/execution/runStore';
import { useDebug, debugActions } from '../../features/debugger/debugStore';
import { TerminalPanel } from './TerminalPanel';
import { Empty } from '../common';
import { formatDuration } from '../../utils/misc';
import { runCommand } from '../../features/commands/commands';
import { useBackend } from '../../services/backendStatus';
import type { LayoutMode } from '../../hooks/useLayout';

/* ───────────── Problems ───────────── */
function ProblemsPanel() {
  const diags = useBuild((s) => s.diagnostics);
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');
  const list = diags.filter((d) => d.severity !== 'note' && (filter === 'all' || d.severity === filter));
  const notesFor = (i: number) => {
    const out = [];
    const idx = diags.indexOf(list[i]!);
    for (let j = idx + 1; j < diags.length && diags[j]!.severity === 'note'; j++) out.push(diags[j]!);
    return out;
  };
  const counts = { error: diags.filter((d) => d.severity === 'error').length, warning: diags.filter((d) => d.severity === 'warning').length };
  return (
    <div className="panel-body">
      <div className="toolbar">
        <div className="seg">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Tutti</button>
          <button className={filter === 'error' ? 'on' : ''} onClick={() => setFilter('error')}>Errori {counts.error}</button>
          <button className={filter === 'warning' ? 'on' : ''} onClick={() => setFilter('warning')}>Warning {counts.warning}</button>
        </div>
        <span className="grow" />
        <button className="btn sm" onClick={() => void compileProject()} disabled={!useBackend.getState().available}><Hammer size={13} /> Ricompila</button>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {list.length === 0 && <Empty icon={<Info size={26} />} title={diags.length ? 'Nessun elemento per questo filtro' : 'Nessun problema rilevato'}><span>Compila il progetto (F7) per verificare errori e warning.</span></Empty>}
        {list.map((d, i) => (
          <div key={i} className="problem" role="button" tabIndex={0} onClick={() => d.file && openFile(d.file, { line: Math.max(1, d.line), column: Math.max(1, d.column) })} onKeyDown={(e) => e.key === 'Enter' && d.file && openFile(d.file, { line: d.line, column: d.column })}>
            {d.severity === 'error' ? <AlertCircle size={16} color="var(--error)" /> : d.severity === 'warning' ? <AlertTriangle size={16} color="var(--warning)" /> : <Info size={16} color="var(--info)" />}
            <div className="grow">
              <div>{d.message} {d.source === 'linker' && <span className="chip">linker</span>}</div>
              {notesFor(i).map((n, k) => <div key={k} className="muted" style={{ fontSize: '0.9em' }}>nota: {n.message} {n.file ? `(${n.file}:${n.line})` : ''}</div>)}
            </div>
            <span className="loc">{d.file ? `${d.file}:${d.line}:${d.column}` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Output ───────────── */
function OutputPanel() {
  const log = useBuild((s) => s.log);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [log]);
  return (
    <div className="panel-body">
      <div className="toolbar">
        <span className="muted">Output del compilatore e informazioni di esecuzione</span>
        <span className="grow" />
        <button className="icon-btn sm" title="Pulisci" aria-label="Pulisci output" onClick={clearLog}><Trash2 size={14} /></button>
      </div>
      <div className="console scroll" role="log">
        {log.length === 0 && <span className="system">Nessun output. Compila o esegui il progetto.</span>}
        {log.map((l) => (
          <div key={l.id} className={l.kind}>
            <span className="muted" style={{ fontSize: 11 }}>[{new Date(l.time).toLocaleTimeString('it-IT')}] </span>
            {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

/* ───────────── Run ───────────── */
function RunPanel() {
  const { status, output, exit, startedAt, error } = useRun();
  const lastBuild = useBuild((s) => s.lastBuild);
  const args = useApp((s) => s.project?.runArgs ?? '');
  const [input, setInput] = useState('');
  const [now, setNow] = useState(Date.now());
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const running = status === 'running';
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [output]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    inputRef.current?.focus({ preventScroll: true });
    return () => clearInterval(t);
  }, [running]);
  const statusChip =
    status === 'compiling' ? <span className="chip primary">Compilazione…</span>
    : status === 'running' ? <span className="chip ok">In esecuzione · {formatDuration(now - (startedAt ?? now))}</span>
    : exit ? exit.reason === 'exited' ? <span className={`chip ${exit.exitCode === 0 ? 'ok' : 'warn'}`}>Uscita {exit.exitCode} · {formatDuration(exit.durationMs ?? 0)}</span> : <span className="chip err">{exit.reason === 'signal' ? exit.signal : exit.reason === 'timeout' ? 'Timeout' : exit.reason === 'stopped' ? 'Interrotto' : exit.reason === 'compile-failed' ? 'Build fallita' : 'Errore'}</span>
    : error ? <span className="chip err">Errore</span> : <span className="chip">Inattivo</span>;
  return (
    <div className="panel-body">
      <div className="toolbar">
        {statusChip}
        <input className="input mono" style={{ height: 26, width: 160 }} value={args} placeholder="argomenti" aria-label="Argomenti del programma" title="Argomenti passati a main(argc, argv)" onChange={(e) => void updateProject({ runArgs: e.target.value })} disabled={running} />
        <span className="grow" />
        {running || status === 'compiling' ? (
          <button className="btn danger sm" onClick={() => runActions.stop()}><Square size={13} /> Interrompi</button>
        ) : (
          <>
            <button className="btn sm" disabled={!lastBuild} title={lastBuild ? `Build del ${new Date(lastBuild.at).toLocaleTimeString('it-IT')}` : 'Compila prima il progetto'} onClick={() => runCommand('run.run')}><Play size={13} /> Esegui</button>
            <button className="btn accent sm" onClick={() => runCommand('run.compileRun')}><PlayCircle size={13} /> Compila ed esegui</button>
          </>
        )}
        <button className="icon-btn sm" title="Pulisci" aria-label="Pulisci output" onClick={() => runActions.clear()}><Trash2 size={14} /></button>
      </div>
      <div className="console scroll" role="log" aria-live="polite" onClick={() => running && inputRef.current?.focus()}>
        {output.length === 0 && <span className="system">L’output del programma comparirà qui. Usa “Compila ed esegui” (Ctrl+F5).</span>}
        {output.map((c, i) => <span key={i} className={c.stream}>{c.text}</span>)}
        <div ref={end} />
      </div>
      <form className="console-input" onSubmit={(e) => { e.preventDefault(); runActions.sendInput(input + '\n'); setInput(''); }}>
        <span className="mono muted" style={{ fontSize: 12 }}>stdin</span>
        <input ref={inputRef} className="input" value={input} disabled={!running} placeholder={running ? 'Scrivi l’input e premi Invio' : 'Disponibile durante l’esecuzione'} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} aria-label="Input del programma" onChange={(e) => setInput(e.target.value)} />
        <button className="btn sm" type="submit" disabled={!running}><CornerDownLeft size={13} /> Invia</button>
        <button className="btn sm" type="button" disabled={!running} title="Chiude stdin (Ctrl+D)" onClick={() => runActions.sendEof()}>EOF</button>
      </form>
    </div>
  );
}

/* ───────────── Debug ───────────── */
function DebugPanel() {
  const d = useDebug();
  const watches = useApp((s) => s.project?.watches ?? []);
  const bps = useApp((s) => s.project?.breakpoints ?? {});
  const [expr, setExpr] = useState('');
  const [newWatch, setNewWatch] = useState('');
  const [showRegs, setShowRegs] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [d.console]);
  const active = d.status === 'starting' || d.status === 'running' || d.status === 'stopped';
  const stopped = d.status === 'stopped';
  const watchVals = useMemo(() => watches.map((w) => d.watches.find((x) => x.expression === w) ?? { expression: w }), [watches, d.watches]);
  const bpList = Object.entries(bps).flatMap(([f, ls]) => ls.map((l) => ({ f, l })));
  return (
    <div className="panel-body">
      <div className="toolbar" aria-label="Controlli del debugger">
        {!active ? (
          <button className="btn accent sm" onClick={() => runCommand('debug.start')}><Bug size={14} /> Avvia debug (F5)</button>
        ) : (
          <>
            {d.status === 'running' ? <button className="icon-btn sm" title="Pausa (F6)" aria-label="Pausa" onClick={() => debugActions.command('pause')}><Pause size={15} /></button> : <button className="icon-btn sm run" disabled={!stopped} title="Continua (F5)" aria-label="Continua" onClick={() => debugActions.command('continue')}><Play size={15} /></button>}
            <button className="icon-btn sm" disabled={!stopped} title="Step Over (F10)" aria-label="Step Over" onClick={() => debugActions.command('next')}><StepForward size={15} /></button>
            <button className="icon-btn sm" disabled={!stopped} title="Step Into (F11)" aria-label="Step Into" onClick={() => debugActions.command('step')}><ArrowDownToLine size={15} /></button>
            <button className="icon-btn sm" disabled={!stopped} title="Step Out (Shift+F11)" aria-label="Step Out" onClick={() => debugActions.command('finish')}><ArrowUpFromLine size={15} /></button>
            <button className="icon-btn sm" title="Riavvia" aria-label="Riavvia" onClick={() => void debugActions.restart()}><RotateCw size={15} /></button>
            <button className="icon-btn sm stop" title="Stop (Shift+F5)" aria-label="Stop" onClick={() => debugActions.command('stop')}><Square size={14} /></button>
          </>
        )}
        <span className={`chip ${stopped ? 'warn' : d.status === 'running' ? 'ok' : ''}`}>
          {d.status === 'idle' ? 'Inattivo' : d.status === 'starting' ? (d.phase === 'compiling' ? 'Compilazione…' : 'Avvio gdb…') : d.status === 'running' ? 'In esecuzione' : d.status === 'stopped' ? `In pausa${d.location ? ` — ${d.location.func}() riga ${d.location.line}` : ''}` : 'Terminato'}
        </span>
        <span className="grow" />
        <button className="icon-btn sm" title="Pulisci console" aria-label="Pulisci console" onClick={debugActions.clearConsole}><Trash2 size={14} /></button>
      </div>
      <div className="debug-grid">
        <div className="scroll">
          <div className="section-title">Variabili locali</div>
          {!stopped && <div className="var-row muted">{active ? 'Disponibili quando il programma è in pausa' : 'Avvia il debug e fermati su un breakpoint'}</div>}
          {stopped && d.variables.length === 0 && <div className="var-row muted">Nessuna variabile locale</div>}
          {stopped && d.variables.map((v) => (
            <div key={v.name} className="var-row" title={v.type}><span className="n">{v.name}</span><span className="t">{v.type}</span><span className="v">= {v.value}</span></div>
          ))}
          <div className="section-title">Watch</div>
          {watchVals.map((w) => (
            <div key={w.expression} className="var-row">
              <span className="n">{w.expression}</span>
              <span className={w.error ? 'err' : 'v'}>{w.error ?? (w.value !== undefined ? `= ${w.value}` : '—')}</span>
              <span className="grow" />
              <button className="icon-btn sm" aria-label={`Rimuovi ${w.expression}`} onClick={() => void debugActions.setWatches(watches.filter((x) => x !== w.expression))}><X size={12} /></button>
            </div>
          ))}
          <form className="row" style={{ padding: '4px 12px' }} onSubmit={(e) => { e.preventDefault(); if (newWatch.trim()) void debugActions.setWatches([...watches, newWatch.trim()]); setNewWatch(''); }}>
            <input className="input mono grow" style={{ height: 26 }} placeholder="Aggiungi espressione (es. a * 2, arr[0])" value={newWatch} onChange={(e) => setNewWatch(e.target.value)} />
            <button className="icon-btn sm" type="submit" aria-label="Aggiungi watch"><Plus size={14} /></button>
          </form>
          <div className="section-title">Call stack</div>
          {!stopped && <div className="var-row muted">—</div>}
          {stopped && d.frames.map((f) => (
            <div key={f.level} className={`list-item mono ${f.level === d.selectedFrame ? 'active' : ''}`} style={{ fontSize: 12.5 }} onClick={() => debugActions.selectFrame(f.level)}>
              <span>#{f.level} {f.func}()</span><span className="muted grow ellipsis" style={{ textAlign: 'right' }}>{f.file ? `${f.file}:${f.line}` : f.addr}</span>
            </div>
          ))}
          <div className="section-title">Breakpoint ({bpList.length}) {bpList.length > 0 && <button className="icon-btn sm" style={{ marginLeft: 'auto' }} title="Rimuovi tutti" aria-label="Rimuovi tutti i breakpoint" onClick={(e) => (e.stopPropagation(), void debugActions.clearBreakpoints())}><ListX size={14} /></button>}</div>
          {bpList.length === 0 && <div className="var-row muted">Tocca il margine sinistro dell’editor (o F9) per aggiungerne uno</div>}
          {bpList.map(({ f, l }) => (
            <div key={`${f}:${l}`} className="list-item mono" style={{ fontSize: 12.5 }} onClick={() => openFile(f, { line: l })}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: 'var(--error)' }} /> {f}:{l}
              <span className="grow" />
              <button className="icon-btn sm" aria-label="Rimuovi breakpoint" onClick={(e) => (e.stopPropagation(), void debugActions.toggleBreakpoint(f, l))}><X size={12} /></button>
            </div>
          ))}
          <div className="section-title" onClick={() => { setShowRegs(!showRegs); if (!showRegs && stopped) debugActions.fetchRegisters(); }}><Cpu size={13} /> Registri {showRegs ? '▾' : '▸'}</div>
          {showRegs && (
            <>
              {stopped && <button className="btn sm" style={{ margin: '0 12px 6px' }} onClick={() => debugActions.fetchRegisters()}>Aggiorna</button>}
              {d.registers.map((r) => <div key={r.name} className="var-row"><span className="n">{r.name}</span><span className="v">{r.value}</span></div>)}
              {!stopped && <div className="var-row muted">Disponibili con il programma in pausa</div>}
            </>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="console scroll" role="log" aria-label="Debug console">
            {d.console.length === 0 && <span className="system">Debug console: output del programma, messaggi di gdb e risultati delle espressioni.</span>}
            {d.console.map((l) => (
              <div key={l.id} className={l.kind === 'error' ? 'stderr' : l.kind === 'input' ? 'stdin' : l.kind === 'info' || l.kind === 'gdb' ? 'system' : l.kind === 'result' ? 'success' : ''} style={l.kind === 'program' ? { whiteSpace: 'pre-wrap' } : undefined}>{l.text}</div>
            ))}
            <div ref={end} />
          </div>
          <form className="console-input" onSubmit={(e) => {
            e.preventDefault();
            const v = expr;
            setExpr('');
            if (d.status === 'running' && !v.startsWith('?')) debugActions.sendInput(v + '\n');
            else debugActions.evaluate(v.replace(/^\?/, ''));
          }}>
            <span className="mono muted" style={{ fontSize: 12 }}>{d.status === 'running' ? 'stdin' : 'eval'}</span>
            <input className="input" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder={d.status === 'running' ? 'Input per il programma (Invio)' : 'Espressione da valutare, es. x + 1'} disabled={!active} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Debug console input" />
            <button className="btn sm" type="submit" disabled={!active}><CornerDownLeft size={13} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Container ───────────── */
const TABS: { id: PanelTab; label: string }[] = [
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'debug', label: 'Debug Console' },
  { id: 'run', label: 'Run' },
];

export function BottomPanel({ mode, height }: { mode: LayoutMode; height: number }) {
  const tab = useApp((s) => s.panelTab);
  const maximized = useApp((s) => s.panelMaximized);
  const diags = useBuild((s) => s.diagnostics);
  const runStatus = useRun((s) => s.status);
  const dbg = useDebug((s) => s.status);
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity === 'warning').length;
  const phone = mode === 'phone';
  return (
    <section className={`panel ${maximized ? 'maximized' : ''} ${phone ? 'phone-sheet' : ''}`} style={maximized || phone ? undefined : { height }} aria-label="Pannello inferiore">
      <div className="panel-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`panel-tab ${tab === t.id ? 'active' : ''}`} onClick={() => ui.openPanel(t.id)}>
            {t.label}
            {t.id === 'problems' && errors > 0 && <span className="chip err">{errors}</span>}
            {t.id === 'problems' && warnings > 0 && <span className="chip warn">{warnings}</span>}
            {t.id === 'run' && runStatus === 'running' && <span className="chip ok">●</span>}
            {t.id === 'debug' && (dbg === 'running' || dbg === 'stopped') && <span className="chip warn">●</span>}
          </button>
        ))}
        <span className="grow" />
        {!phone && <button className="icon-btn sm" title={maximized ? 'Ripristina' : 'Schermo intero'} aria-label={maximized ? 'Ripristina pannello' : 'Pannello a schermo intero'} onClick={ui.toggleMaximizePanel}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
        <button className="icon-btn sm" title="Chiudi pannello" aria-label="Chiudi pannello" onClick={() => useApp.setState({ panelOpen: false, panelMaximized: false })}><X size={15} /></button>
      </div>
      {tab === 'problems' && <ProblemsPanel />}
      {tab === 'output' && <OutputPanel />}
      {tab === 'terminal' && <TerminalPanel />}
      {tab === 'debug' && <DebugPanel />}
      {tab === 'run' && <RunPanel />}
    </section>
  );
}
