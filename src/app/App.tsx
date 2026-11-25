import { Component, ReactNode, useEffect, lazy, Suspense } from 'react';
import { useApp, initApp } from '../stores/appStore';
import { applyUiTheme } from '../features/settings/themes';
import { installKeyboardShortcuts } from '../features/commands/commands';
import { startBackendMonitor } from '../services/backendStatus';
import { installPersistence } from './persistence';
import { useLayoutMode } from '../hooks/useLayout';
import { Splash, Welcome } from '../components/screens/Screens';
import { ConfirmHost, PromptHost, Toasts, ContextMenuHost } from '../components/common';
import { NewProjectDialog, OpenProjectDialog } from '../components/dialogs/ProjectDialogs';
import { ImportDialog, ExportDialog } from '../components/dialogs/ImportExport';
import { TopBar } from '../components/toolbar/TopBar';

// The IDE (Monaco) and heavy dialogs are code-split so the splash/welcome load instantly.
const Workbench = lazy(async () => {
  const [{ Workbench }, { initMonaco }] = await Promise.all([import('../components/Workbench'), import('../editor/monaco')]);
  initMonaco();
  return { default: Workbench };
});
const SettingsDialog = lazy(() => import('../components/dialogs/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));
const Other = () => import('../components/dialogs/OtherDialogs');
const SnippetsDialog = lazy(() => Other().then((m) => ({ default: m.SnippetsDialog })));
const DocsDialog = lazy(() => Other().then((m) => ({ default: m.DocsDialog })));
const DiffDialog = lazy(() => Other().then((m) => ({ default: m.DiffDialog })));
const AboutDialog = lazy(() => Other().then((m) => ({ default: m.AboutDialog })));
const CommandPalette = lazy(() => Other().then((m) => ({ default: m.CommandPalette })));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error) {
    console.error('C-Studio crashed', error);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="splash" role="alert">
        <h1>Si è verificato un errore</h1>
        <p className="muted" style={{ maxWidth: 520, textAlign: 'center' }}>
          L’interfaccia ha incontrato un errore imprevisto. I tuoi file sono al sicuro: le modifiche non salvate vengono conservate come bozza e recuperate al riavvio.
        </p>
        <pre className="mono muted" style={{ maxWidth: '90vw', whiteSpace: 'pre-wrap', fontSize: 12 }}>{this.state.error.message}</pre>
        <div className="row">
          <button className="btn" onClick={() => this.setState({ error: null })}>Riprova</button>
          <button className="btn primary" onClick={() => location.reload()}>Ricarica C-Studio</button>
        </div>
      </div>
    );
  }
}

function Dialogs() {
  const d = useApp((s) => s.dialog);
  const palette = useApp((s) => s.palette);
  return (
    <Suspense fallback={null}>
      {d?.kind === 'newProject' && <NewProjectDialog />}
      {d?.kind === 'openProject' && <OpenProjectDialog />}
      {d?.kind === 'import' && <ImportDialog />}
      {d?.kind === 'export' && <ExportDialog />}
      {d?.kind === 'settings' && <SettingsDialog category={d.category} />}
      {d?.kind === 'snippets' && <SnippetsDialog />}
      {d?.kind === 'docs' && <DocsDialog query={d.query} />}
      {d?.kind === 'diff' && <DiffDialog {...d} />}
      {d?.kind === 'about' && <AboutDialog />}
      {palette && <CommandPalette />}
    </Suspense>
  );
}

export function App() {
  const screen = useApp((s) => s.screen);
  const settings = useApp((s) => s.settings);
  const { mode, coarse } = useLayoutMode();

  useEffect(() => {
    void initApp();
    startBackendMonitor();
    const offKeys = installKeyboardShortcuts();
    const offPersist = installPersistence();
    return () => {
      offKeys();
      offPersist();
    };
  }, []);

  useEffect(() => {
    const density = settings.density === 'auto' ? (coarse ? 'touch' : 'comfortable') : settings.density;
    applyUiTheme(settings, density);
  }, [settings, coarse]);

  // phones/portrait tablets start with the drawer closed and a compact panel
  useEffect(() => {
    if (mode === 'phone' || mode === 'tablet-portrait') useApp.setState({ sidebarOpen: false });
    if (mode === 'phone') useApp.setState({ panelOpen: false });
  }, [mode]);

  return (
    <ErrorBoundary>
      {screen === 'splash' && <Splash />}
      {screen === 'welcome' && (
        <div className={`app mode-${mode} ${coarse ? 'coarse' : ''}`}>
          <TopBar mode={mode} />
          <Welcome />
        </div>
      )}
      {screen === 'ide' && (
        <Suspense fallback={<Splash />}>
          <Workbench mode={mode} coarse={coarse} />
        </Suspense>
      )}
      <Dialogs />
      <ConfirmHost />
      <PromptHost />
      <ContextMenuHost />
      <Toasts />
    </ErrorBoundary>
  );
}
