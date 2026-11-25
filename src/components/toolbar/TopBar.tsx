import { Menu, Save, Undo2, Redo2, Hammer, Play, PlayCircle, Square, Bug, Search, Settings, MoreVertical, PanelBottom, Loader2, StepForward, ArrowDownToLine, ArrowUpFromLine, Pause, FolderOpen, Download, BookOpen, Braces, Home, X } from 'lucide-react';
import { create } from 'zustand';
import { useApp, ui, activeFile, isDirty, setActiveConfig, saveFile } from '../../stores/appStore';
import { useBuild } from '../../features/compiler/buildStore';
import { useRun, runActions } from '../../features/execution/runStore';
import { useDebug, debugActions } from '../../features/debugger/debugStore';
import { useBackend } from '../../services/backendStatus';
import { runCommand, commandById } from '../../features/commands/commands';
import { Logo, openMenu, MenuItem } from '../common';
import { modKey } from '../../utils/misc';
import type { LayoutMode } from '../../hooks/useLayout';
import { basename } from '../../utils/path';

export const useLaunch = create<{ mode: 'run' | 'debug' }>(() => ({ mode: 'run' }));

const reason = (id: string) => commandById.get(id)?.disabledReason?.() ?? null;

function Btn({ id, icon, label, className = '', showLabel }: { id: string; icon: React.ReactNode; label: string; className?: string; showLabel?: boolean }) {
  const r = reason(id);
  const k = commandById.get(id)?.keys;
  const title = `${label}${k ? ` (${k.replace('Ctrl', modKey)})` : ''}${r ? ` — ${r}` : ''}`;
  if (showLabel) {
    return (
      <button className={`btn ${className}`} disabled={!!r} title={title} aria-label={label} onClick={() => runCommand(id)}>
        {icon}
        <span>{label}</span>
      </button>
    );
  }
  return (
    <button className={`icon-btn ${className}`} disabled={!!r} title={title} aria-label={label} onClick={() => runCommand(id)}>
      {icon}
    </button>
  );
}

export function TopBar({ mode }: { mode: LayoutMode }) {
  const project = useApp((s) => s.project);
  const file = useApp((s) => activeFile(s));
  const dirty = useApp((s) => (file ? isDirty(file, s) : false));
  useApp((s) => s.buffers); // re-render on edits for enable/disable state
  const building = useBuild((s) => s.building);
  useBuild((s) => s.lastBuild);
  const runStatus = useRun((s) => s.status);
  const dbg = useDebug((s) => s.status);
  useBackend((s) => s.available);
  const launch = useLaunch((s) => s.mode);
  const compact = mode === 'phone';
  const portrait = mode === 'tablet-portrait';
  const running = runStatus === 'running' || runStatus === 'compiling';
  const debugging = dbg === 'starting' || dbg === 'running' || dbg === 'stopped';

  const overflow = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = [];
    const add = (id: string, icon?: React.ReactNode) => {
      const c = commandById.get(id)!;
      items.push({ label: c.label, icon, keys: c.keys?.replace('Ctrl', modKey), disabled: !!c.disabledReason?.(), run: () => runCommand(id) });
    };
    if (compact || portrait) {
      add('edit.undo', <Undo2 size={15} />);
      add('edit.redo', <Redo2 size={15} />);
      add('file.saveAll', <Save size={15} />);
      items.push({ separator: true });
      add('build.compile', <Hammer size={15} />);
      add('run.run', <Play size={15} />);
      add('debug.start', <Bug size={15} />);
      if (project) items.push({ label: `Configurazione: ${project.activeConfig === 'debug' ? 'Debug → Release' : 'Release → Debug'}`, run: () => setActiveConfig(project.activeConfig === 'debug' ? 'release' : 'debug') });
      items.push({ separator: true });
    }
    add('view.palette', <Search size={15} />);
    add('view.commands');
    add('edit.format', <Braces size={15} />);
    add('view.togglePanel', <PanelBottom size={15} />);
    items.push({ separator: true });
    add('project.open', <FolderOpen size={15} />);
    add('project.export', <Download size={15} />);
    add('project.close', <X size={15} />);
    add('snippets.manage', <Braces size={15} />);
    add('docs.open', <BookOpen size={15} />);
    add('settings.open', <Settings size={15} />);
    openMenu(r.right - 240, r.bottom + 4, items);
  };

  const mainRun = () => {
    if (launch === 'debug') runCommand('debug.start');
    else runCommand('run.compileRun');
  };
  const mainDisabled = launch === 'debug' ? reason('debug.start') : reason('run.compileRun');

  return (
    <header className="topbar" role="toolbar" aria-label="Barra principale">
      {(compact || portrait) && project && (
        <button className="icon-btn" aria-label="Apri pannello laterale" title="Explorer e strumenti" onClick={() => ui.toggleSidebar()}>
          <Menu size={20} />
        </button>
      )}
      <button className="brand" onClick={() => useApp.setState({ screen: 'welcome' })} title="Schermata iniziale" aria-label="C-Studio — schermata iniziale">
        <Logo />
        {!compact && !project && <span className="brand-name">C-Studio</span>}
      </button>
      {project && (
        <div className="crumbs grow" style={{ flex: compact ? 1 : '0 1 auto' }}>
          {!compact && <><span className="ellipsis" style={{ maxWidth: 180 }}>{project.name}</span><span>›</span></>}
          <strong className="ellipsis">{file ? basename(file) : compact ? project.name : 'Nessun file'}</strong>
          {dirty && <span title="Modifiche non salvate" style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--warning)', flex: 'none' }} />}
        </div>
      )}
      {!compact && (
        <button className="tb-search" onClick={() => ui.openPalette('files')} aria-label="Ricerca globale">
          <Search size={15} />
          <span className="ellipsis grow" style={{ textAlign: 'left' }}>Cerca file e comandi</span>
          {mode === 'desktop' && <span className="kbd">{modKey}+P</span>}
        </button>
      )}
      {!project && <span className="grow" />}
      {project && (
        <>
          <div className="tb-group">
            <button className="icon-btn" disabled={!file || !dirty} title={`Salva (${modKey}+S)`} aria-label="Salva" onClick={() => file && void saveFile(file)}><Save size={18} /></button>
            <span className="tb-hide-phone tb-hide-portrait" style={{ display: 'contents' }}>
              <Btn id="edit.undo" icon={<Undo2 size={18} />} label="Annulla" />
              <Btn id="edit.redo" icon={<Redo2 size={18} />} label="Ripristina" />
            </span>
          </div>
          <span className="tb-sep tb-hide-phone" />
          <div className="tb-group tb-hide-phone tb-hide-portrait">
            <select className="select" value={project.activeConfig} onChange={(e) => setActiveConfig(e.target.value as 'debug' | 'release')} title="Configurazione di compilazione" aria-label="Configurazione di compilazione" style={{ height: 'calc(var(--btn-h) - 2px)' }}>
              <option value="debug">Debug</option>
              <option value="release">Release</option>
            </select>
            <select className="select" value={launch} onChange={(e) => useLaunch.setState({ mode: e.target.value as 'run' | 'debug' })} title="Modalità di avvio" aria-label="Modalità di avvio" style={{ height: 'calc(var(--btn-h) - 2px)', marginLeft: 4 }}>
              <option value="run">Esegui</option>
              <option value="debug">Debug (GDB)</option>
            </select>
          </div>
          {!debugging ? (
            <div className="tb-group">
              <span className="tb-hide-phone" style={{ display: 'contents' }}>
                <button className="icon-btn" disabled={!!reason('build.compile')} title={`Compila (F7)${reason('build.compile') ? ' — ' + reason('build.compile') : ''}`} aria-label="Compila" onClick={() => runCommand('build.compile')}>
                  {building ? <Loader2 size={18} className="spin" /> : <Hammer size={18} />}
                </button>
                <Btn id="run.run" icon={<Play size={18} />} label="Esegui ultima build" />
              </span>
              {running ? (
                <button className="btn danger" onClick={() => runActions.stop()} title="Interrompi (Shift+F5)"><Square size={15} /> {compact ? '' : 'Stop'}</button>
              ) : (
                <div className="run-split">
                  <button className="btn" disabled={!!mainDisabled} onClick={mainRun} title={`${launch === 'debug' ? 'Avvia debug (F5)' : `Compila ed esegui (${modKey}+F5)`}${mainDisabled ? ' — ' + mainDisabled : ''}`}>
                    {launch === 'debug' ? <Bug size={16} /> : <PlayCircle size={16} />}
                    {mode === 'desktop' || mode === 'tablet' ? <span>{launch === 'debug' ? 'Debug' : 'Compila ed esegui'}</span> : null}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="tb-group" aria-label="Controlli debug">
              {dbg === 'running' ? <Btn id="debug.pause" icon={<Pause size={18} />} label="Pausa" /> : <button className="icon-btn run" disabled={dbg !== 'stopped'} title="Continua (F5)" aria-label="Continua" onClick={() => debugActions.command('continue')}><Play size={18} /></button>}
              <Btn id="debug.next" icon={<StepForward size={18} />} label="Step Over" />
              <Btn id="debug.step" icon={<ArrowDownToLine size={18} />} label="Step Into" />
              <Btn id="debug.finish" icon={<ArrowUpFromLine size={18} />} label="Step Out" />
              <button className="icon-btn stop" title="Stop (Shift+F5)" aria-label="Stop debug" onClick={() => debugActions.command('stop')}><Square size={17} /></button>
            </div>
          )}
          <span className="tb-sep tb-hide-phone" />
          <div className="tb-group">
            <span className="tb-hide-phone" style={{ display: 'contents' }}>
              <Btn id="view.togglePanel" icon={<PanelBottom size={18} />} label="Pannello inferiore" />
            </span>
            {compact && <button className="icon-btn" aria-label="Cerca" onClick={() => ui.openPalette('files')}><Search size={18} /></button>}
          </div>
        </>
      )}
      {!project && (
        <button className="icon-btn" title="Home" aria-label="Home" onClick={() => useApp.setState({ screen: 'welcome' })}><Home size={18} /></button>
      )}
      <button className="icon-btn tb-hide-phone" title={`Impostazioni (${modKey}+,)`} aria-label="Impostazioni" onClick={() => ui.openDialog({ kind: 'settings' })}><Settings size={18} /></button>
      <button className="icon-btn" title="Altri comandi" aria-label="Altri comandi" onClick={overflow}><MoreVertical size={18} /></button>
    </header>
  );
}
