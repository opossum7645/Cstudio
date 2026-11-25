/** ZIP import/export of projects and full backups. */
import JSZip from 'jszip';
import type { BuildConfig, ConfigName, Project } from '../../types';
import { isProbablyText, uid } from '../../utils/misc';
import { normalize, validateName } from '../../utils/path';
import { allFolders } from './projectRepo';
import { defaultDebugConfig, releaseFrom } from './templates';

const MAX_FILE = 512 * 1024;
const MAX_FILES = 500;
const SKIP_DIRS = /(^|\/)(\.git|node_modules|build|\.vscode|\.idea|__MACOSX)(\/|$)/;

export interface ProjectConfigFile {
  cstudio: number;
  name: string;
  activeConfig: ConfigName;
  buildConfigs: Record<ConfigName, BuildConfig>;
  runArgs: string;
  breakpoints: Record<string, number[]>;
  watches: string[];
}

export function projectConfigFile(p: Project): ProjectConfigFile {
  return { cstudio: 1, name: p.name, activeConfig: p.activeConfig, buildConfigs: p.buildConfigs, runArgs: p.runArgs, breakpoints: p.breakpoints, watches: p.watches };
}

export async function exportProjectZip(p: Project): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(p.name) ?? zip;
  for (const d of p.folders) root.folder(d);
  for (const [path, content] of Object.entries(p.files)) root.file(path, content);
  root.file('.cstudio/config.json', JSON.stringify(projectConfigFile(p), null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export interface ImportReport {
  project: Project;
  skipped: string[];
}

/** Builds a project from a flat map path → bytes (from a ZIP, a folder picker or loose files). */
export function projectFromEntries(name: string, entries: { path: string; data: Uint8Array }[], folders: string[] = []): ImportReport {
  const skipped: string[] = [];
  let paths = entries.map((e) => normalize(e.path));
  // strip a single common root folder ("myproj/src/main.c" → "src/main.c")
  const roots = new Set(paths.map((p) => p.split('/')[0]));
  let rootName: string | null = null;
  if (roots.size === 1 && paths.every((p) => p.includes('/'))) {
    rootName = [...roots][0]!;
    paths = paths.map((p) => p.slice(rootName!.length + 1));
    folders = folders.map((f) => normalize(f).slice(rootName!.length + 1)).filter(Boolean);
  }
  const files: Record<string, string> = {};
  let cfg: ProjectConfigFile | null = null;
  const dec = new TextDecoder('utf-8', { fatal: false });
  entries.forEach((e, i) => {
    const path = paths[i]!;
    if (!path) return;
    if (path === '.cstudio/config.json') {
      try {
        cfg = JSON.parse(dec.decode(e.data)) as ProjectConfigFile;
      } catch {
        skipped.push(`${path} (JSON non valido)`);
      }
      return;
    }
    if (SKIP_DIRS.test(path)) return;
    if (path.split('/').some((seg) => validateName(seg) !== null)) return void skipped.push(`${path} (nome non valido)`);
    if (e.data.length > MAX_FILE) return void skipped.push(`${path} (troppo grande)`);
    if (!isProbablyText(e.data)) return void skipped.push(`${path} (file binario)`);
    if (Object.keys(files).length >= MAX_FILES) return void skipped.push(`${path} (limite file)`);
    files[path] = dec.decode(e.data);
  });
  const c = cfg as ProjectConfigFile | null;
  const debug = c?.buildConfigs?.debug ?? { ...defaultDebugConfig };
  const now = Date.now();
  const project: Project = {
    id: uid('p_'),
    name: (c?.name || rootName || name).slice(0, 80),
    template: 'imported',
    createdAt: now,
    updatedAt: now,
    files,
    folders: allFolders(files, [...folders.filter((f) => !SKIP_DIRS.test(f) || f === 'build'), 'build']),
    buildConfigs: { debug, release: c?.buildConfigs?.release ?? releaseFrom(debug) },
    activeConfig: c?.activeConfig === 'release' ? 'release' : 'debug',
    runArgs: typeof c?.runArgs === 'string' ? c.runArgs : '',
    breakpoints: c?.breakpoints ?? {},
    watches: Array.isArray(c?.watches) ? c!.watches : [],
  };
  const firstC = Object.keys(files).find((f) => /(^|\/)main\.c$/.test(f)) ?? Object.keys(files).find((f) => f.endsWith('.c'));
  project.session = { groups: [{ tabs: firstC ? [firstC] : [], active: firstC ?? null }], layout: 'single', activeGroup: 0, expanded: project.folders };
  return { project, skipped };
}

export async function importProjectZip(file: Blob, fallbackName: string): Promise<ImportReport> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('Il file non è un archivio ZIP valido');
  }
  const entries: { path: string; data: Uint8Array }[] = [];
  const folders: string[] = [];
  const all = Object.values(zip.files);
  if (all.length > 5000) throw new Error('Archivio con troppi elementi');
  for (const f of all) {
    if (f.dir) {
      folders.push(f.name);
      continue;
    }
    entries.push({ path: f.name, data: await f.async('uint8array') });
  }
  if (entries.length === 0) throw new Error('L’archivio è vuoto');
  return projectFromEntries(fallbackName, entries, folders);
}

/* ───────────── Full backup (all projects) ───────────── */
export async function exportBackup(projects: Project[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file('cstudio-backup.json', JSON.stringify({ cstudioBackup: 1, createdAt: Date.now(), projects }));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function readBackup(file: Blob): Promise<Project[]> {
  const zip = await JSZip.loadAsync(file).catch(() => {
    throw new Error('Il file non è un backup C-Studio valido');
  });
  const entry = zip.file('cstudio-backup.json');
  if (!entry) throw new Error('Il file non è un backup C-Studio (manca cstudio-backup.json)');
  const data = JSON.parse(await entry.async('string')) as { cstudioBackup?: number; projects?: Project[] };
  if (data.cstudioBackup !== 1 || !Array.isArray(data.projects)) throw new Error('Formato di backup non riconosciuto');
  return data.projects.filter((p) => p && typeof p.id === 'string' && typeof p.files === 'object');
}
