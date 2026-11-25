import { FilePlus2, FolderOpen, FileArchive, FolderInput, GraduationCap, Code2, Settings as Gear, Trash2, Clock, ChevronRight, BookOpen } from 'lucide-react';
import { useApp, ui, openProject, addProject, deleteProject } from '../../stores/appStore';
import { Logo, openMenu } from '../common';
import { EXAMPLES, TEMPLATES } from '../../features/projects/templates';
import { newProjectFromTemplate } from '../../features/projects/projectRepo';
import { timeAgo } from '../../utils/misc';
import { confirmYes } from '../../stores/uiFeedback';
import { openFolderFlow } from '../dialogs/ImportExport';
import { EngineStatus } from '../EngineStatus';

export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Caricamento di C-Studio">
      <Logo className="brand-logo" />
      <h1>C-Studio</h1>
      <div className="muted">Professional C IDE</div>
      <div className="loader" />
    </div>
  );
}

export function Welcome() {
  const projects = useApp((s) => s.projects);
  const settings = useApp((s) => s.settings);

  const openExample = async (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)!;
    const tpl = { ...TEMPLATES.find((t) => t.id === 'hello')!, id: `example-${ex.id}`, files: { 'src/main.c': ex.code, 'README.md': `# ${ex.name}\n\n${ex.description}\n` }, libraries: ex.libraries };
    const p = newProjectFromTemplate({ name: `Esempio — ${ex.name}`, template: tpl, std: settings.defaultBuildConfig.std, config: 'debug', base: settings.defaultBuildConfig });
    await addProject(p);
  };

  const recent = projects.slice(0, settings.recentLimit);

  return (
    <div className="welcome scroll">
      <div className="welcome-inner">
        <div className="hero">
          <Logo size={56} className="" />
          <div className="grow">
            <h1>C-Studio</h1>
            <p>Ambiente di sviluppo professionale per il linguaggio C — progettato per tablet, desktop e smartphone.</p>
          </div>
          <button className="icon-btn" title="Impostazioni" aria-label="Impostazioni" onClick={() => ui.openDialog({ kind: 'settings' })}>
            <Gear size={20} />
          </button>
        </div>

        <div className="welcome-grid">
          <section>
            <h3>Inizia</h3>
            <div className="action-list">
              <button className="action" onClick={() => ui.openDialog({ kind: 'newProject' })}>
                <span className="ic"><FilePlus2 size={20} /></span>
                <div><b>Nuovo progetto C</b><span>Da modello o vuoto</span></div>
              </button>
              <button className="action" onClick={() => ui.openDialog({ kind: 'openProject' })}>
                <span className="ic"><FolderOpen size={20} /></span>
                <div><b>Apri progetto</b><span>{projects.length} salvati nel dispositivo</span></div>
              </button>
              <button className="action alt" onClick={() => ui.openDialog({ kind: 'import' })}>
                <span className="ic"><FileArchive size={20} /></span>
                <div><b>Importa progetto</b><span>ZIP, file o backup</span></div>
              </button>
              <button className="action alt" onClick={() => void openFolderFlow()}>
                <span className="ic"><FolderInput size={20} /></span>
                <div><b>Apri cartella</b><span>Dal file system del dispositivo</span></div>
              </button>
              <button className="action alt" onClick={() => ui.openDialog({ kind: 'docs', query: 'guida:primi-passi' })}>
                <span className="ic"><GraduationCap size={20} /></span>
                <div><b>Tutorial</b><span>Primi passi con C-Studio</span></div>
              </button>
              <button className="action alt" onClick={() => ui.openDialog({ kind: 'docs' })}>
                <span className="ic"><BookOpen size={20} /></span>
                <div><b>Documentazione C</b><span>Libreria standard e guide</span></div>
              </button>
            </div>

            <h3 style={{ marginTop: 26 }}>Esempi di codice</h3>
            <div className="card-grid">
              {EXAMPLES.map((ex) => (
                <button key={ex.id} className="card" onClick={() => void openExample(ex.id)}>
                  <div className="row"><Code2 size={16} color="var(--primary)" /><h4>{ex.name}</h4></div>
                  <p>{ex.description}</p>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Progetti recenti</h3>
            {recent.length === 0 ? (
              <div className="empty" style={{ border: '1px dashed var(--border)', borderRadius: 12 }}>
                <Clock size={28} />
                <h4>Nessun progetto</h4>
                <span>Crea il tuo primo progetto o apri un esempio.</span>
                <button className="btn primary" onClick={() => ui.openDialog({ kind: 'newProject' })}>Nuovo progetto</button>
              </div>
            ) : (
              <div className="recent">
                {recent.map((p) => (
                  <div
                    key={p.id}
                    className="recent-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => void openProject(p.id)}
                    onKeyDown={(e) => e.key === 'Enter' && void openProject(p.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(e.clientX, e.clientY, [
                        { label: 'Apri', run: () => void openProject(p.id) },
                        { label: 'Elimina progetto', danger: true, icon: <Trash2 size={14} />, run: async () => { if (await confirmYes({ title: 'Eliminare il progetto?', message: `"${p.name}" verrà eliminato definitivamente da questo dispositivo.`, confirmLabel: 'Elimina', danger: true })) await deleteProject(p.id); } },
                      ]);
                    }}
                  >
                    <span className="action" style={{ padding: 0, border: 'none', minHeight: 0, background: 'none' }}>
                      <span className="ic" style={{ width: 34, height: 34 }}><Code2 size={17} /></span>
                    </span>
                    <div className="grow">
                      <div className="ellipsis" style={{ fontWeight: 560 }}>{p.name}</div>
                      <div className="muted" style={{ fontSize: '0.88em' }}>
                        {p.fileCount} file · modificato {timeAgo(p.updatedAt)}{p.linkedFolder ? ` · 📁 ${p.linkedFolder}` : ''}
                      </div>
                    </div>
                    <ChevronRight size={16} className="muted" />
                  </div>
                ))}
              </div>
            )}

            <EngineStatus />
            <p className="muted" style={{ fontSize: '0.88em' }}>
              Editor, progetti, ricerca, controllo versione locale e terminale funzionano anche offline. Senza server il codice C viene
              compilato ed eseguito nel browser (Clang WebAssembly); il debugger GDB e clang-format richiedono il server C-Studio.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
