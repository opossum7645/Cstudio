import { useMemo, useState } from 'react';
import { FilePlus2, FolderOpen, Trash2, Copy, Pencil, Search, HardDrive, Folder } from 'lucide-react';
import { Dialog, Empty, Toggle } from '../common';
import { useApp, ui, addProject, openProject, deleteProject, renameProject, refreshProjects } from '../../stores/appStore';
import { TEMPLATES, buildCustomTemplate, CustomTemplateOptions } from '../../features/projects/templates';
import { newProjectFromTemplate, projectRepo } from '../../features/projects/projectRepo';
import { fsAccessSupported, pickDirectory, linkHandle, writeToLinkedFolder } from '../../services/fsAccess';
import { validateName } from '../../utils/path';
import { timeAgo } from '../../utils/misc';
import { confirmYes, promptDialog, toast } from '../../stores/uiFeedback';
import type { CStandard, ConfigName } from '../../types';

const STANDARDS: { id: CStandard; label: string }[] = [
  { id: 'c17', label: 'C17 (consigliato)' },
  { id: 'c11', label: 'C11' },
  { id: 'c23', label: 'C23 (sperimentale)' },
  { id: 'c99', label: 'C99' },
  { id: 'c89', label: 'C89 / ANSI' },
  { id: 'gnu17', label: 'GNU C17' },
];

export function NewProjectDialog() {
  const settings = useApp((s) => s.settings);
  const projects = useApp((s) => s.projects);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('hello');
  const [std, setStd] = useState<CStandard>(settings.defaultBuildConfig.std);
  const [config, setConfig] = useState<ConfigName>('debug');
  const [location, setLocation] = useState<'browser' | 'device'>('browser');
  const [custom, setCustom] = useState<CustomTemplateOptions>({ srcDir: true, includeDir: true, mainFile: true, readme: true });
  const [busy, setBusy] = useState(false);

  const nameError = name ? validateName(name) ?? (projects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ? 'Esiste già un progetto con questo nome' : null) : 'Inserisci un nome';

  const create = async () => {
    if (nameError) return;
    setBusy(true);
    try {
      const tpl = template === 'custom' ? buildCustomTemplate(custom, name) : TEMPLATES.find((t) => t.id === template)!;
      const p = newProjectFromTemplate({ name, template: tpl, std, config, base: settings.defaultBuildConfig });
      if (location === 'device') {
        const dir = await pickDirectory();
        const sub = await (dir as unknown as { getDirectoryHandle(n: string, o: { create: boolean }): Promise<typeof dir> }).getDirectoryHandle(p.name, { create: true });
        await linkHandle(p.id, sub);
        p.linkedFolder = `${dir.name}/${p.name}`;
        await writeToLinkedFolder(p.id, p.files, p.folders);
      }
      await addProject(p);
      toast('success', `Progetto "${p.name}" creato`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('error', 'Creazione del progetto non riuscita', { detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Nuovo progetto C"
      icon={<FilePlus2 size={20} color="var(--primary)" />}
      size="wide"
      onClose={ui.closeDialog}
      footer={
        <>
          <button className="btn" onClick={ui.closeDialog}>Annulla</button>
          <button className="btn primary" disabled={!!nameError || busy} onClick={() => void create()}>{busy ? 'Creazione…' : 'Crea progetto'}</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="np-name">Nome progetto</label>
        <input id="np-name" className={`input ${name && nameError ? 'invalid' : ''}`} autoFocus value={name} placeholder="es. esercizi-puntatori" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
        {name && nameError && <span className="error-text">{nameError}</span>}
      </div>
      <div className="field">
        <span className="field-label">Posizione</span>
        <div className="seg" role="radiogroup">
          <button className={location === 'browser' ? 'on' : ''} onClick={() => setLocation('browser')}><HardDrive size={14} /> Archivio locale di C-Studio</button>
          <button className={location === 'device' ? 'on' : ''} disabled={!fsAccessSupported} onClick={() => setLocation('device')} title={fsAccessSupported ? '' : 'Il browser non supporta l’accesso alle cartelle (es. Safari/iPad)'}>
            <Folder size={14} /> Cartella sul dispositivo
          </button>
        </div>
        <span className="hint">
          {location === 'browser' ? 'Il progetto è salvato nel browser (IndexedDB) e funziona offline. Puoi esportarlo in ZIP quando vuoi.' : 'Scegli una cartella: C-Studio creerà una sottocartella con il nome del progetto e vi salverà i file.'}
          {!fsAccessSupported && ' Il salvataggio diretto in una cartella non è supportato da questo browser.'}
        </span>
      </div>
      <div className="field">
        <span className="field-label">Modello</span>
        <div className="card-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className={`card ${template === t.id ? 'on' : ''}`} onClick={() => setTemplate(t.id)} aria-pressed={template === t.id}>
              <h4>{t.name}</h4>
              <p>{t.description}</p>
            </button>
          ))}
        </div>
      </div>
      {template === 'custom' && (
        <div className="field">
          <span className="field-label">Struttura personalizzata</span>
          {([['srcDir', 'Cartella src/'], ['includeDir', 'Cartella include/'], ['mainFile', 'File main.c iniziale'], ['readme', 'README.md']] as const).map(([k, l]) => (
            <div key={k} className="setting-row" style={{ padding: '6px 0' }}>
              <span className="lbl">{l}</span>
              <Toggle on={custom[k]} onChange={(v) => setCustom({ ...custom, [k]: v })} label={l} />
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div className="field grow">
          <label htmlFor="np-std">Standard C</label>
          <select id="np-std" className="select" value={std} onChange={(e) => setStd(e.target.value as CStandard)}>
            {STANDARDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="np-cfg">Configurazione iniziale</label>
          <select id="np-cfg" className="select" value={config} onChange={(e) => setConfig(e.target.value as ConfigName)}>
            <option value="debug">Debug (-O0 -g, warning estesi)</option>
            <option value="release">Release (-O2 -DNDEBUG)</option>
          </select>
        </div>
      </div>
    </Dialog>
  );
}

export function OpenProjectDialog() {
  const projects = useApp((s) => s.projects);
  const current = useApp((s) => s.project?.id);
  const [q, setQ] = useState('');
  const list = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())), [projects, q]);

  const rename = async (id: string, old: string) => {
    const n = await promptDialog({ title: 'Rinomina progetto', label: 'Nuovo nome', initial: old, confirmLabel: 'Rinomina', validate: validateName });
    if (n) await renameProject(id, n);
  };
  const duplicate = async (id: string, old: string) => {
    const n = await promptDialog({ title: 'Duplica progetto', label: 'Nome della copia', initial: `${old} copia`, confirmLabel: 'Duplica', validate: validateName });
    if (!n) return;
    await projectRepo.duplicate(id, n);
    await refreshProjects();
    toast('success', 'Progetto duplicato');
  };
  const remove = async (id: string, name: string) => {
    if (await confirmYes({ title: 'Eliminare il progetto?', message: `"${name}" e la sua cronologia locale verranno eliminati da questo dispositivo. L’operazione non è reversibile.`, confirmLabel: 'Elimina', danger: true })) {
      await deleteProject(id);
      toast('info', `Progetto "${name}" eliminato`);
    }
  };

  return (
    <Dialog title="Apri progetto" icon={<FolderOpen size={20} color="var(--primary)" />} size="wide" onClose={ui.closeDialog} footer={<button className="btn" onClick={() => ui.openDialog({ kind: 'newProject' })}>Nuovo progetto…</button>}>
      <div className="row" style={{ marginBottom: 12 }}>
        <Search size={16} className="muted" />
        <input className="input grow" placeholder="Filtra progetti…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      {list.length === 0 ? (
        <Empty icon={<FolderOpen size={30} />} title={projects.length ? 'Nessun risultato' : 'Nessun progetto salvato'}>
          <span>Crea un nuovo progetto o importane uno da un file ZIP.</span>
        </Empty>
      ) : (
        <div className="recent">
          {list.map((p) => (
            <div key={p.id} className="recent-item" role="button" tabIndex={0} onClick={() => void openProject(p.id)} onKeyDown={(e) => e.key === 'Enter' && void openProject(p.id)}>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <b className="ellipsis">{p.name}</b>
                  {p.id === current && <span className="chip primary">aperto</span>}
                  {p.linkedFolder && <span className="chip">📁 {p.linkedFolder}</span>}
                </div>
                <div className="muted" style={{ fontSize: '0.88em' }}>{p.fileCount} file · creato {new Date(p.createdAt).toLocaleDateString('it-IT')} · modificato {timeAgo(p.updatedAt)}</div>
              </div>
              <button className="icon-btn" title="Rinomina" aria-label="Rinomina" onClick={(e) => (e.stopPropagation(), void rename(p.id, p.name))}><Pencil size={16} /></button>
              <button className="icon-btn" title="Duplica" aria-label="Duplica" onClick={(e) => (e.stopPropagation(), void duplicate(p.id, p.name))}><Copy size={16} /></button>
              <button className="icon-btn" title="Elimina" aria-label="Elimina" onClick={(e) => (e.stopPropagation(), void remove(p.id, p.name))}><Trash2 size={16} color="var(--error)" /></button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

export { openProject };
