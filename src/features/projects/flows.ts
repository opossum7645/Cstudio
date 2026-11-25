/** Small interactive flows shared by menus, explorer and commands. */
import { promptDialog } from '../../stores/uiFeedback';
import { createFile, createFolder, renamePath, useApp } from '../../stores/appStore';
import { basename, dirname, join, validateName, normalize } from '../../utils/path';

const HEADER_TEMPLATE = (name: string) => {
  const guard = name.replace(/\W/g, '_').toUpperCase();
  return `#ifndef ${guard}\n#define ${guard}\n\n\n\n#endif /* ${guard} */\n`;
};

const validatePathInput = (v: string) => {
  const parts = normalize(v).split('/');
  if (!v.trim()) return 'Il nome non può essere vuoto';
  for (const p of parts) {
    const e = validateName(p);
    if (e) return e;
  }
  return null;
};

export async function newFileFlow(dir: string): Promise<void> {
  const name = await promptDialog({
    title: 'Nuovo file',
    label: dir ? `Nome del file in ${dir}/` : 'Nome del file (puoi indicare un percorso, es. src/utils.c)',
    placeholder: 'main.c',
    initial: '',
    confirmLabel: 'Crea',
    validate: validatePathInput,
  });
  if (!name) return;
  const path = join(dir, normalize(name));
  const content = path.endsWith('.h') ? HEADER_TEMPLATE(basename(path)) : path.endsWith('.c') ? '' : '';
  await createFile(path, content);
}

export async function newFolderFlow(dir: string): Promise<void> {
  const name = await promptDialog({ title: 'Nuova cartella', label: dir ? `Nome della cartella in ${dir}/` : 'Nome della cartella', placeholder: 'src', confirmLabel: 'Crea', validate: validatePathInput });
  if (!name) return;
  await createFolder(join(dir, normalize(name)));
}

export async function renameFlow(path: string): Promise<void> {
  const name = await promptDialog({ title: 'Rinomina', label: `Nuovo nome per "${basename(path)}"`, initial: basename(path), confirmLabel: 'Rinomina', selectStem: true, validate: (v) => validateName(v) });
  if (!name || name === basename(path)) return;
  await renamePath(path, join(dirname(path), name.trim()));
}

export async function moveFlow(path: string): Promise<void> {
  const p = useApp.getState().project;
  if (!p) return;
  const dest = await promptDialog({
    title: 'Sposta',
    label: `Cartella di destinazione per "${basename(path)}" (vuoto = radice). Cartelle: ${['/', ...p.folders].join(', ')}`,
    initial: dirname(path),
    confirmLabel: 'Sposta',
    validate: (v) => (v.trim() === '' || v.trim() === '/' || p.folders.includes(normalize(v)) ? null : 'Cartella inesistente'),
  });
  if (dest === null) return;
  await renamePath(path, join(normalize(dest), basename(path)));
}
