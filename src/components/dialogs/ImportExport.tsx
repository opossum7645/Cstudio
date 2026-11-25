import { useRef, useState } from 'react';
import { FileArchive, FolderInput, Files, DatabaseBackup, Download, Upload } from 'lucide-react';
import { Dialog } from '../common';
import { useApp, ui, addProject, refreshProjects, saveAll, dirtyFiles } from '../../stores/appStore';
import { exportBackup, exportProjectZip, importProjectZip, projectFromEntries, readBackup, ImportReport } from '../../features/projects/zip';
import { projectRepo } from '../../features/projects/projectRepo';
import { fsAccessSupported, pickDirectory, readDirectory, linkHandle } from '../../services/fsAccess';
import { downloadBlob } from '../../utils/misc';
import { toast, confirmYes } from '../../stores/uiFeedback';
import { dbAll } from '../../services/db';
import type { Project } from '../../types';

async function finishImport(r: ImportReport, link?: { handle: Parameters<typeof linkHandle>[1] }) {
  if (Object.keys(r.project.files).length === 0) throw new Error('Nessun file di testo importabile trovato');
  if (useApp.getState().projects.some((p) => p.name === r.project.name)) r.project.name = `${r.project.name} (importato)`;
  if (link) {
    await linkHandle(r.project.id, link.handle);
    r.project.linkedFolder = link.handle.name;
  }
  await addProject(r.project);
  toast('success', `Importato "${r.project.name}" (${Object.keys(r.project.files).length} file)`, r.skipped.length ? { detail: `Ignorati ${r.skipped.length}: ${r.skipped.slice(0, 4).join(', ')}${r.skipped.length > 4 ? '…' : ''}` } : {});
}

/** "Apri cartella": File System Access API when available, otherwise a directory <input>. */
export async function openFolderFlow(): Promise<void> {
  if (fsAccessSupported) {
    try {
      const dir = await pickDirectory();
      const { entries, folders } = await readDirectory(dir);
      await finishImport(projectFromEntries(dir.name, entries.map((e) => ({ path: `${dir.name}/${e.path}`, data: e.data })), folders.map((f) => `${dir.name}/${f}`)), { handle: dir });
      toast('info', 'Le modifiche salvate verranno scritte anche nella cartella del dispositivo');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('error', 'Impossibile aprire la cartella', { detail: (e as Error).message });
    }
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
  input.onchange = async () => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    try {
      const entries = await Promise.all(files.filter((f) => f.size < 512 * 1024).map(async (f) => ({ path: (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      await finishImport(projectFromEntries('cartella', entries));
      toast('info', 'Questo browser non permette di riscrivere nella cartella originale: il progetto è stato importato in C-Studio (usa Esporta ZIP per salvarlo sul dispositivo).', { duration: 8000 });
    } catch (e) {
      toast('error', 'Importazione non riuscita', { detail: (e as Error).message });
    }
  };
  input.click();
}

export function ImportDialog() {
  const zipRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      ui.closeDialog();
    } catch (e) {
      toast('error', 'Importazione non riuscita', { detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onZip = (f: File) => run(async () => finishImport(await importProjectZip(f, f.name.replace(/\.zip$/i, ''))));
  const onFiles = (list: FileList) =>
    run(async () => {
      const entries = await Promise.all([...list].map(async (f) => ({ path: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      await finishImport(projectFromEntries(list[0]?.name.replace(/\.\w+$/, '') || 'importato', entries));
    });
  const onBackup = (f: File) =>
    run(async () => {
      const projects = await readBackup(f);
      const existing = new Set((await dbAll<Project>('projects')).map((p) => p.id));
      const overwrite = projects.filter((p) => existing.has(p.id)).length;
      if (overwrite && !(await confirmYes({ title: 'Ripristinare il backup?', message: `${projects.length} progetti nel backup, ${overwrite} sovrascriveranno progetti esistenti con lo stesso identificativo.`, confirmLabel: 'Ripristina' }))) return;
      for (const p of projects) await projectRepo.save(p);
      await refreshProjects();
      toast('success', `Ripristinati ${projects.length} progetti dal backup`);
    });

  return (
    <Dialog title="Importa" icon={<Upload size={20} color="var(--primary)" />} onClose={ui.closeDialog}>
      <div className="col" style={{ gap: 10 }}>
        <button className="action" disabled={busy} onClick={() => zipRef.current?.click()}>
          <span className="ic"><FileArchive size={20} /></span>
          <div><b>Progetto da archivio ZIP</b><span>Esportato da C-Studio o qualsiasi cartella compressa con file .c/.h</span></div>
        </button>
        <button className="action" disabled={busy} onClick={() => void openFolderFlow().then(ui.closeDialog)}>
          <span className="ic"><FolderInput size={20} /></span>
          <div><b>Cartella</b><span>{fsAccessSupported ? 'Collega una cartella del dispositivo (lettura e scrittura)' : 'Importa il contenuto di una cartella'}</span></div>
        </button>
        <button className="action alt" disabled={busy} onClick={() => filesRef.current?.click()}>
          <span className="ic"><Files size={20} /></span>
          <div><b>File singoli</b><span>Uno o più file sorgente in un nuovo progetto</span></div>
        </button>
        <button className="action alt" disabled={busy} onClick={() => backupRef.current?.click()}>
          <span className="ic"><DatabaseBackup size={20} /></span>
          <div><b>Ripristina backup</b><span>File cstudio-backup.zip con tutti i progetti</span></div>
        </button>
      </div>
      <input ref={zipRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => e.target.files?.[0] && void onZip(e.target.files[0])} />
      <input ref={filesRef} type="file" multiple accept=".c,.h,.txt,.md,.json,.in,.csv,text/*" hidden onChange={(e) => e.target.files?.length && void onFiles(e.target.files)} />
      <input ref={backupRef} type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && void onBackup(e.target.files[0])} />
    </Dialog>
  );
}

export function ExportDialog() {
  const project = useApp((s) => s.project);
  const projects = useApp((s) => s.projects);
  const [busy, setBusy] = useState(false);

  const exportCurrent = async () => {
    if (!project) return;
    setBusy(true);
    try {
      if (dirtyFiles().length && (await confirmYes({ title: 'Modifiche non salvate', message: 'Salvare i file modificati prima di esportare? Altrimenti verrà esportata l’ultima versione salvata.', confirmLabel: 'Salva ed esporta' }))) await saveAll();
      const p = useApp.getState().project!;
      downloadBlob(await exportProjectZip(p), `${p.name}.zip`);
      toast('success', 'Progetto esportato');
    } finally {
      setBusy(false);
    }
  };

  const exportOne = async (id: string) => {
    const p = await projectRepo.get(id);
    if (p) downloadBlob(await exportProjectZip(p), `${p.name}.zip`);
  };

  const backupAll = async () => {
    setBusy(true);
    try {
      const all = await dbAll<Project>('projects');
      downloadBlob(await exportBackup(all), `cstudio-backup-${new Date().toISOString().slice(0, 10)}.zip`);
      toast('success', `Backup di ${all.length} progetti creato`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Esporta" icon={<Download size={20} color="var(--primary)" />} onClose={ui.closeDialog}>
      <div className="col" style={{ gap: 10 }}>
        <button className="action" disabled={!project || busy} onClick={() => void exportCurrent()}>
          <span className="ic"><FileArchive size={20} /></span>
          <div><b>Esporta progetto corrente (ZIP)</b><span>{project ? `${project.name} — sorgenti, cartelle e .cstudio/config.json` : 'Nessun progetto aperto'}</span></div>
        </button>
        <button className="action alt" disabled={busy || projects.length === 0} onClick={() => void backupAll()}>
          <span className="ic"><DatabaseBackup size={20} /></span>
          <div><b>Backup completo</b><span>Tutti i {projects.length} progetti in un unico file, ripristinabile da Importa</span></div>
        </button>
        {projects.length > 0 && (
          <>
            <div className="section-title" style={{ padding: 0, marginTop: 8 }}>Altri progetti</div>
            {projects.map((p) => (
              <div key={p.id} className="row">
                <span className="grow ellipsis">{p.name}</span>
                <button className="btn sm" onClick={() => void exportOne(p.id)}><Download size={14} /> ZIP</button>
              </div>
            ))}
          </>
        )}
      </div>
    </Dialog>
  );
}
