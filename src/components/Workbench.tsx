import { useCallback, useRef } from 'react';
import { Files, Search, GitBranch, ListTree, Puzzle, FolderKanban, Settings, Code2, AlertCircle, TerminalSquare, Play, BookOpen } from 'lucide-react';
import { useApp, ui, SidebarView, activeFile } from '../stores/appStore';
import { useBuild } from '../features/compiler/buildStore';
import { useRun } from '../features/execution/runStore';
import { ExplorerView } from './sidebar/Explorer';
import { SearchView, ScmView, OutlineView, ExtensionsView, ProjectsView } from './sidebar/SideViews';
import { EditorArea } from './editor/EditorArea';
import { TabletKeybar } from './editor/TabletKeybar';
import { BottomPanel } from './panels/Panels';
import { TopBar } from './toolbar/TopBar';
import { StatusBar } from './statusbar/StatusBar';
import { useDrag, LayoutMode, useVirtualKeyboard } from '../hooks/useLayout';
import { modKey } from '../utils/misc';

const VIEWS: { id: SidebarView; icon: typeof Files; label: string; keys?: string }[] = [
  { id: 'explorer', icon: Files, label: 'Explorer', keys: 'Ctrl+Shift+E' },
  { id: 'search', icon: Search, label: 'Cerca', keys: 'Ctrl+Shift+F' },
  { id: 'scm', icon: GitBranch, label: 'Controllo versione', keys: 'Ctrl+Shift+G' },
  { id: 'outline', icon: ListTree, label: 'Outline e simboli', keys: 'Ctrl+Shift+O' },
  { id: 'extensions', icon: Puzzle, label: 'Estensioni' },
  { id: 'projects', icon: FolderKanban, label: 'Progetti' },
];

function SidebarContent({ view }: { view: SidebarView }) {
  switch (view) {
    case 'explorer':
      return <ExplorerView />;
    case 'search':
      return <SearchView />;
    case 'scm':
      return <ScmView />;
    case 'outline':
      return <OutlineView />;
    case 'extensions':
      return <ExtensionsView />;
    case 'projects':
      return <ProjectsView />;
  }
}

function ActivityBar({ inDrawer }: { inDrawer?: boolean }) {
  const view = useApp((s) => s.sidebarView);
  const open = useApp((s) => s.sidebarOpen);
  return (
    <nav className="activitybar" aria-label="Viste">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={`icon-btn ${view === v.id && (open || inDrawer) ? 'active' : ''}`}
          title={`${v.label}${v.keys ? ` (${v.keys.replace('Ctrl', modKey)})` : ''}`}
          aria-label={v.label}
          aria-pressed={view === v.id}
          onClick={() => (inDrawer ? useApp.setState({ sidebarView: v.id }) : ui.setSidebar(v.id))}
        >
          <v.icon size={22} strokeWidth={1.7} />
        </button>
      ))}
      <span className="grow" />
      <button className="icon-btn" title="Documentazione" aria-label="Documentazione" onClick={() => ui.openDialog({ kind: 'docs' })}><BookOpen size={21} strokeWidth={1.7} /></button>
      <button className="icon-btn" title="Impostazioni" aria-label="Impostazioni" onClick={() => ui.openDialog({ kind: 'settings' })}><Settings size={21} strokeWidth={1.7} /></button>
    </nav>
  );
}

function MobileNav() {
  const panelOpen = useApp((s) => s.panelOpen);
  const tab = useApp((s) => s.panelTab);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const errors = useBuild((s) => s.diagnostics.filter((d) => d.severity === 'error').length);
  const running = useRun((s) => s.status === 'running');
  const go = (what: 'files' | 'editor' | 'problems' | 'terminal' | 'run') => {
    if (what === 'files') useApp.setState({ sidebarOpen: true, sidebarView: 'explorer', panelOpen: false });
    else if (what === 'editor') useApp.setState({ sidebarOpen: false, panelOpen: false });
    else useApp.setState({ sidebarOpen: false, panelOpen: true, panelTab: what });
  };
  const is = (w: string) => (w === 'files' ? sidebarOpen : w === 'editor' ? !sidebarOpen && !panelOpen : !sidebarOpen && panelOpen && tab === w);
  return (
    <nav className="mobile-nav" aria-label="Navigazione">
      <button className={is('files') ? 'active' : ''} onClick={() => go('files')}><Files size={20} />File</button>
      <button className={is('editor') ? 'active' : ''} onClick={() => go('editor')}><Code2 size={20} />Editor</button>
      <button className={is('problems') ? 'active' : ''} onClick={() => go('problems')}><AlertCircle size={20} />Problemi{errors > 0 && <span className="badge">{errors}</span>}</button>
      <button className={is('terminal') ? 'active' : ''} onClick={() => go('terminal')}><TerminalSquare size={20} />Terminale</button>
      <button className={is('run') ? 'active' : ''} onClick={() => go('run')}><Play size={20} />Run{running && <span className="badge" style={{ background: 'var(--success)' }}>●</span>}</button>
    </nav>
  );
}

export function Workbench({ mode, coarse }: { mode: LayoutMode; coarse: boolean }) {
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const sidebarView = useApp((s) => s.sidebarView);
  const sidebarWidth = useApp((s) => s.sidebarWidth);
  const panelOpen = useApp((s) => s.panelOpen);
  const panelHeight = useApp((s) => s.panelHeight);
  const hasFile = useApp((s) => !!activeFile(s));
  const keysSetting = useApp((s) => s.settings.tabletKeys);
  const keysExt = useApp((s) => s.settings.extensions.tabletKeys !== false);
  const kb = useVirtualKeyboard();
  const centerRef = useRef<HTMLDivElement>(null);
  const drawer = mode === 'phone' || mode === 'tablet-portrait';

  const startW = useRef(sidebarWidth);
  const startH = useRef(panelHeight);
  const sideDrag = useDrag(useCallback((dx: number) => ui.setSidebarWidth(startW.current + dx), []), useCallback(() => (startW.current = useApp.getState().sidebarWidth), []));
  const panelDrag = useDrag(
    useCallback((_dx: number, dy: number) => {
      const max = (centerRef.current?.clientHeight ?? 600) - 80;
      ui.setPanelHeight(Math.min(max, startH.current - dy));
    }, []),
    useCallback(() => (startH.current = useApp.getState().panelHeight), []),
  );

  const showKeys = keysExt && hasFile && (keysSetting === 'always' || (keysSetting === 'auto' && coarse));
  const panelVisible = panelOpen;
  const panelH = mode === 'tablet-portrait' ? Math.min(panelHeight, 320) : panelHeight;

  return (
    <div className={`app mode-${mode} ${coarse ? 'coarse' : ''}`} style={kb ? { height: `calc(100dvh - ${kb}px)` } : undefined}>
      <TopBar mode={mode} />
      <div className="workbench">
        {!drawer && <ActivityBar />}
        {!drawer && sidebarOpen && (
          <>
            <aside className="sidebar" style={{ width: sidebarWidth }} aria-label="Barra laterale">
              <SidebarContent view={sidebarView} />
            </aside>
            <div className={`resizer v ${sideDrag.dragging ? 'dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Ridimensiona barra laterale" {...sideDrag.handlers} onPointerDown={(e) => { startW.current = useApp.getState().sidebarWidth; sideDrag.handlers.onPointerDown(e); }} />
          </>
        )}
        <div className="center" ref={centerRef}>
          {!(mode === 'phone' && panelVisible) && <EditorArea touch={coarse} mode={mode} />}
          {panelVisible && mode !== 'phone' && (
            <div className={`resizer h ${panelDrag.dragging ? 'dragging' : ''}`} role="separator" aria-orientation="horizontal" aria-label="Ridimensiona pannello" {...panelDrag.handlers} onPointerDown={(e) => { startH.current = useApp.getState().panelHeight; panelDrag.handlers.onPointerDown(e); }} />
          )}
          {panelVisible && <BottomPanel mode={mode} height={panelH} />}
          {showKeys && !(mode === 'phone' && panelVisible) && <TabletKeybar />}
        </div>
        {drawer && sidebarOpen && (
          <>
            <div className="drawer-backdrop" onClick={() => useApp.setState({ sidebarOpen: false })} />
            <div className="drawer" role="dialog" aria-label="Pannello laterale">
              <ActivityBar inDrawer />
              <aside className="sidebar" onClickCapture={(e) => {
                // close the drawer after opening a file on phones
                const row = (e.target as HTMLElement).closest('.tree-row, .list-item');
                if (row && mode === 'phone' && !(e.target as HTMLElement).closest('.more')) setTimeout(() => {
                  const s = useApp.getState();
                  if (s.sidebarView === 'explorer' && row.getAttribute('aria-expanded') === null) useApp.setState({ sidebarOpen: false });
                }, 50);
              }}>
                <SidebarContent view={sidebarView} />
              </aside>
            </div>
          </>
        )}
      </div>
      {mode !== 'phone' && <StatusBar />}
      {mode === 'phone' && <MobileNav />}
    </div>
  );
}
