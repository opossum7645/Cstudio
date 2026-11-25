import { AlertCircle, AlertTriangle, GitBranch, Check, Loader2, CircleDot, Bug, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp, ui, activeFile, setActiveConfig } from '../../stores/appStore';
import { useBuild } from '../../features/compiler/buildStore';
import { useBackend } from '../../services/backendStatus';
import { useDebug } from '../../features/debugger/debugStore';
import { useRun } from '../../features/execution/runStore';
import { vcsStore } from '../../features/vcs/vcs';
import { languageFor } from '../../utils/path';

export function StatusBar() {
  const project = useApp((s) => s.project);
  const cursor = useApp((s) => s.cursor);
  const file = useApp((s) => activeFile(s));
  const saveState = useApp((s) => s.saveState);
  const settings = useApp((s) => s.settings);
  const diags = useBuild((s) => s.diagnostics);
  const building = useBuild((s) => s.building);
  const backend = useBackend();
  const dbg = useDebug((s) => s.status);
  const run = useRun((s) => s.status);
  const [branch, setBranch] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => (window.removeEventListener('online', on), window.removeEventListener('offline', on));
  }, []);
  useEffect(() => {
    if (!project) return setBranch(null);
    void vcsStore.load(project.id).then((r) => setBranch(r?.current ?? null)).catch(() => setBranch(null));
  }, [project?.id, project?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity === 'warning').length;
  const debugging = dbg === 'running' || dbg === 'stopped' || dbg === 'starting';
  const cfg = project?.buildConfigs[project.activeConfig];
  return (
    <footer className={`statusbar ${debugging ? 'debugging' : ''}`} role="status">
      <button className="sb-item" title={backend.message} onClick={() => void backend.refresh()}>
        <span className={`status-dot ${backend.status}`} />
        <span className="sb-optional">{backend.status === 'online' ? 'Compilatore' : backend.status === 'checking' ? 'Verifica…' : 'Compilatore non disponibile'}</span>
      </button>
      {!online && <span className="sb-item" title="Nessuna connessione: editor e progetti funzionano offline"><WifiOff size={13} /> Offline</span>}
      {online && backend.status !== 'online' && <span className="sb-item sb-optional"><Wifi size={13} /></span>}
      {branch && <button className="sb-item sb-optional" onClick={() => ui.setSidebar('scm')} title="Controllo versione locale"><GitBranch size={13} /> {branch}</button>}
      {project && (
        <button className="sb-item" onClick={() => ui.openPanel('problems')} title="Problems">
          {building ? <Loader2 size={13} className="spin" /> : <AlertCircle size={13} color={errors ? 'var(--error)' : undefined} />} {errors}
          <AlertTriangle size={13} color={warnings ? 'var(--warning)' : undefined} /> {warnings}
        </button>
      )}
      {debugging && <span className="sb-item"><Bug size={13} /> {dbg === 'stopped' ? 'In pausa' : 'Debug'}</span>}
      {run === 'running' && <button className="sb-item" onClick={() => ui.openPanel('run')}><CircleDot size={13} color="var(--success)" /> In esecuzione</button>}
      <span className="grow" />
      {file && (
        <>
          <span className="sb-item">Ln {cursor.line}, Col {cursor.column}{cursor.selection ? ` (${cursor.selection} sel.)` : ''}</span>
          <button className="sb-item sb-optional sb-optional-portrait" onClick={() => ui.openDialog({ kind: 'settings', category: 'editor' })}>{settings.insertSpaces ? `Spazi: ${settings.tabSize}` : `Tab: ${settings.tabSize}`}</button>
          <span className="sb-item sb-optional sb-optional-portrait">UTF-8</span>
          <span className="sb-item sb-optional">{languageFor(file) === 'c' ? 'C' : languageFor(file)}</span>
        </>
      )}
      {cfg && <button className="sb-item sb-optional" onClick={() => ui.openDialog({ kind: 'settings', category: 'compiler' })} title="Opzioni del compilatore">{cfg.compiler.toUpperCase()} {cfg.std.toUpperCase()}</button>}
      {project && <button className="sb-item" onClick={() => setActiveConfig(project.activeConfig === 'debug' ? 'release' : 'debug')} title="Cambia configurazione">{project.activeConfig === 'debug' ? 'Debug' : 'Release'}</button>}
      {project && (
        <span className="sb-item" title="Stato salvataggio">
          {saveState === 'saving' ? <><Loader2 size={13} className="spin" /> Salvataggio…</> : saveState === 'dirty' ? <><CircleDot size={13} color="var(--warning)" /> <span className="sb-optional">Non salvato</span></> : saveState === 'error' ? <span className="err">Errore salvataggio</span> : <><Check size={13} /> <span className="sb-optional">Salvato</span></>}
        </span>
      )}
    </footer>
  );
}
