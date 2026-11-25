/**
 * Main application store: settings, projects, open project, file buffers, editor groups and UI layout.
 * Build/run/debug state lives in their own feature stores.
 */
import { create } from 'zustand';
import type { BuildConfig, ConfigName, EditorGroupState, Project, ProjectMeta, Settings, SplitLayout } from '../types';
import { DEFAULT_SETTINGS, loadSettings, persistSettings } from '../features/settings/defaults';
import { projectRepo, allFolders, toMeta } from '../features/projects/projectRepo';
import { basename, dirname, isWithin, join, uniqueName, validateName } from '../utils/path';
import { confirmDialog, confirmYes, toast } from './uiFeedback';
import { writeToLinkedFolder, removeFromLinkedFolder } from '../services/fsAccess';
import { setBackendUrl } from '../services/api';

export type SidebarView = 'explorer' | 'search' | 'scm' | 'outline' | 'extensions' | 'projects';
export type PanelTab = 'problems' | 'output' | 'terminal' | 'debug' | 'run';
export type DialogKind =
  | { kind: 'newProject' }
  | { kind: 'openProject' }
  | { kind: 'import' }
  | { kind: 'export' }
  | { kind: 'settings'; category?: string }
  | { kind: 'snippets' }
  | { kind: 'docs'; query?: string }
  | { kind: 'diff'; title: string; original: string; modified: string; path: string }
  | { kind: 'about' };

interface AppState {
  ready: boolean;
  screen: 'splash' | 'welcome' | 'ide';
  settings: Settings;
  projects: ProjectMeta[];
  project: Project | null;
  buffers: Record<string, string>;
  expanded: string[];
  groups: EditorGroupState[];
  layout: SplitLayout;
  activeGroup: number;
  saveState: 'saved' | 'dirty' | 'saving' | 'error';
  cursor: { line: number; column: number; selection: number };
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  sidebarWidth: number;
  panelOpen: boolean;
  panelTab: PanelTab;
  panelHeight: number;
  panelMaximized: boolean;
  dialog: DialogKind | null;
  palette: null | 'files' | 'commands';
  clipboard: { mode: 'copy' | 'cut'; paths: string[] } | null;
  revealRequest: { path: string; line: number; column: number; nonce: number } | null;
}

const initialGroups = (): EditorGroupState[] => [{ id: 0, tabs: [], active: null }];

export const useApp = create<AppState>(() => ({
  ready: false,
  screen: 'splash',
  settings: DEFAULT_SETTINGS,
  projects: [],
  project: null,
  buffers: {},
  expanded: [],
  groups: initialGroups(),
  layout: 'single',
  activeGroup: 0,
  saveState: 'saved',
  cursor: { line: 1, column: 1, selection: 0 },
  sidebarView: 'explorer',
  sidebarOpen: true,
  sidebarWidth: 260,
  panelOpen: true,
  panelTab: 'output',
  panelHeight: 240,
  panelMaximized: false,
  dialog: null,
  palette: null,
  clipboard: null,
  revealRequest: null,
}));

const set = useApp.setState;
const get = useApp.getState;

/* ───────────── helpers ───────────── */
export const isDirty = (path: string, s = get()) => !!s.project && s.buffers[path] !== undefined && s.buffers[path] !== s.project.files[path];
export const dirtyFiles = (s = get()) => (s.project ? Object.keys(s.buffers).filter((p) => isDirty(p, s)) : []);
export const activeFile = (s = get()) => s.groups[s.activeGroup]?.active ?? null;
export const activeBuildConfig = (s = get()): BuildConfig => (s.project ? s.project.buildConfigs[s.project.activeConfig] : s.settings.defaultBuildConfig);
export const fileExists = (path: string, s = get()) => !!s.project && path in s.project.files;
export const folderExists = (path: string, s = get()) => !!s.project && (path === '' || s.project.folders.includes(path));

function updateSaveState() {
  const s = get();
  if (s.saveState === 'saving') return;
  set({ saveState: dirtyFiles(s).length ? 'dirty' : 'saved' });
}

async function persistProject(p: Project): Promise<void> {
  try {
    await projectRepo.save(p);
  } catch (e) {
    toast('error', 'Impossibile salvare il progetto nel browser', { detail: (e as Error).message });
    throw e;
  }
}

function mapGroups(fn: (path: string) => string | null) {
  set((s) => ({
    groups: s.groups.map((g) => {
      const tabs = g.tabs.map(fn).filter((x): x is string => !!x);
      const active = g.active ? fn(g.active) : null;
      return { ...g, tabs: [...new Set(tabs)], active: active && tabs.includes(active) ? active : tabs[0] ?? null };
    }),
  }));
}

/* ───────────── app lifecycle ───────────── */
export async function initApp(): Promise<void> {
  const started = Date.now();
  let settings = DEFAULT_SETTINGS;
  try {
    settings = await loadSettings();
  } catch {
    toast('warning', 'Archivio locale non disponibile: le modifiche non verranno salvate');
  }
  setBackendUrl(settings.backendUrl);
  set({ settings });
  await refreshProjects();
  const minSplash = 600 - (Date.now() - started);
  if (minSplash > 0) await new Promise((r) => setTimeout(r, minSplash));
  set({ ready: true, screen: 'welcome' });
  if (settings.startup === 'lastProject') {
    const last = await projectRepo.lastProject().catch(() => undefined);
    if (last && get().projects.some((p) => p.id === last)) await openProject(last);
  }
}

export async function refreshProjects(): Promise<void> {
  try {
    set({ projects: await projectRepo.list() });
  } catch {
    set({ projects: [] });
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const settings = { ...get().settings, ...patch };
  set({ settings });
  if (patch.backendUrl !== undefined) setBackendUrl(settings.backendUrl);
  await persistSettings(settings).catch(() => toast('error', 'Impostazioni non salvate'));
}

export const ui = {
  setSidebar(view: SidebarView, open = true) {
    const s = get();
    if (s.sidebarView === view && s.sidebarOpen && open) set({ sidebarOpen: false });
    else set({ sidebarView: view, sidebarOpen: open });
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openPanel: (tab: PanelTab) => set({ panelOpen: true, panelTab: tab }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  toggleMaximizePanel: () => set((s) => ({ panelMaximized: !s.panelMaximized, panelOpen: true })),
  openDialog: (d: DialogKind) => set({ dialog: d, palette: null }),
  closeDialog: () => set({ dialog: null }),
  openPalette: (mode: 'files' | 'commands') => set({ palette: mode }),
  closePalette: () => set({ palette: null }),
  setSidebarWidth: (w: number) => set({ sidebarWidth: Math.round(Math.min(560, Math.max(180, w))) }),
  setPanelHeight: (h: number) => set({ panelHeight: Math.round(Math.max(120, h)) }),
};

/* ───────────── projects ───────────── */
export async function openProject(id: string): Promise<boolean> {
  if (get().project) {
    if (get().project!.id === id) {
      set({ screen: 'ide' });
      return true;
    }
    if (!(await closeProject())) return false;
  }
  const p = await projectRepo.get(id);
  if (!p) {
    toast('error', 'Progetto non trovato');
    await refreshProjects();
    return false;
  }
  const buffers = { ...p.files };
  let recovered = 0;
  const drafts = await projectRepo.getDrafts(id).catch(() => undefined);
  if (drafts) {
    for (const [path, content] of Object.entries(drafts.buffers)) {
      if (path in p.files && p.files[path] !== content) {
        buffers[path] = content;
        recovered++;
      }
    }
  }
  const sess = p.session;
  const valid = (t: string) => t in p.files;
  const groups: EditorGroupState[] = (sess?.groups?.length ? sess.groups : [{ tabs: [], active: null }]).slice(0, 2).map((g, i) => {
    const tabs = g.tabs.filter(valid);
    return { id: i, tabs, active: g.active && tabs.includes(g.active) ? g.active : tabs[0] ?? null };
  });
  set({
    project: p,
    buffers,
    groups,
    layout: groups.length > 1 ? sess?.layout ?? 'vertical' : 'single',
    activeGroup: Math.min(sess?.activeGroup ?? 0, groups.length - 1),
    expanded: sess?.expanded ?? allFolders(p.files, p.folders),
    screen: 'ide',
    dialog: null,
    saveState: recovered ? 'dirty' : 'saved',
  });
  await projectRepo.touchRecent(id, get().settings.recentLimit).catch(() => undefined);
  if (recovered) toast('info', `Recuperate ${recovered} modifiche non salvate dalla sessione precedente`);
  return true;
}

export async function closeProject(): Promise<boolean> {
  const s = get();
  if (!s.project) return true;
  const dirty = dirtyFiles(s);
  if (dirty.length) {
    const choice = await confirmDialog({
      title: 'Modifiche non salvate',
      message: `${dirty.length} file contengono modifiche non salvate. Salvarle prima di chiudere il progetto?`,
      buttons: [
        { id: 'cancel', label: 'Annulla' },
        { id: 'discard', label: 'Non salvare', variant: 'danger' },
        { id: 'save', label: 'Salva tutto', variant: 'primary' },
      ],
    });
    if (choice === 'cancel') return false;
    if (choice === 'save') await saveAll();
    else await projectRepo.clearDrafts(s.project.id).catch(() => undefined);
  }
  await persistSession();
  set({ project: null, buffers: {}, groups: initialGroups(), layout: 'single', activeGroup: 0, screen: 'welcome', saveState: 'saved', expanded: [] });
  await refreshProjects();
  return true;
}

export async function addProject(p: Project, open = true): Promise<void> {
  await persistProject(p);
  await refreshProjects();
  if (open) await openProject(p.id);
}

export async function deleteProject(id: string): Promise<void> {
  if (get().project?.id === id) {
    set({ project: null, buffers: {}, groups: initialGroups(), screen: 'welcome', saveState: 'saved' });
  }
  await projectRepo.remove(id);
  await refreshProjects();
}

export async function renameProject(id: string, name: string): Promise<void> {
  const p = get().project?.id === id ? get().project! : await projectRepo.get(id);
  if (!p) return;
  const np = { ...p, name: name.trim(), updatedAt: Date.now() };
  await persistProject(np);
  if (get().project?.id === id) set({ project: np });
  await refreshProjects();
}

/** Patch project-level metadata (configs, breakpoints, watches, args) and persist. */
export async function updateProject(patch: Partial<Pick<Project, 'buildConfigs' | 'activeConfig' | 'runArgs' | 'breakpoints' | 'watches' | 'name'>>): Promise<void> {
  const p = get().project;
  if (!p) return;
  const np = { ...p, ...patch };
  set({ project: np });
  await persistProject(np).catch(() => undefined);
}

export function setActiveConfig(c: ConfigName): void {
  void updateProject({ activeConfig: c });
}

export async function persistSession(): Promise<void> {
  const s = get();
  if (!s.project) return;
  const session = { groups: s.groups.map((g) => ({ tabs: g.tabs, active: g.active })), layout: s.layout, activeGroup: s.activeGroup, expanded: s.expanded };
  const np = { ...s.project, session };
  set({ project: np });
  await projectRepo.save(np).catch(() => undefined);
}

/* ───────────── buffers & saving ───────────── */
export function setBuffer(path: string, content: string): void {
  const s = get();
  if (!s.project || s.buffers[path] === content) return;
  set({ buffers: { ...s.buffers, [path]: content } });
  updateSaveState();
}

/** Hook run before files are written (format-on-save is registered by the editor layer). */
let beforeSaveHook: ((path: string, content: string) => Promise<string>) | null = null;
export function setBeforeSaveHook(h: typeof beforeSaveHook) {
  beforeSaveHook = h;
}

export async function saveFiles(paths: string[]): Promise<boolean> {
  const s = get();
  if (!s.project || paths.length === 0) return true;
  set({ saveState: 'saving' });
  const files = { ...s.project.files };
  const written: Record<string, string> = {};
  for (const p of paths) {
    if (get().buffers[p] === undefined) continue;
    let content = get().buffers[p]!;
    if (beforeSaveHook) {
      try {
        const formatted = await beforeSaveHook(p, content);
        if (formatted !== content) {
          content = formatted;
          set((st) => ({ buffers: { ...st.buffers, [p]: formatted } }));
        }
      } catch {
        /* formatting failure must never block saving */
      }
    }
    files[p] = content;
    written[p] = content;
  }
  const np: Project = { ...get().project!, files, updatedAt: Date.now() };
  try {
    await projectRepo.save(np);
  } catch (e) {
    set({ saveState: 'error' });
    toast('error', 'Salvataggio non riuscito', { detail: (e as Error).message });
    return false;
  }
  set({ project: np, saveState: 'saved' });
  updateSaveState();
  if (dirtyFiles().length === 0) await projectRepo.clearDrafts(np.id).catch(() => undefined);
  if (np.linkedFolder) {
    const ok = await writeToLinkedFolder(np.id, written).catch(() => false);
    if (!ok) toast('warning', 'Salvato nel browser, ma non nella cartella del dispositivo (permesso negato)');
  }
  return true;
}

export const saveFile = (path: string) => saveFiles([path]);
export const saveAll = () => saveFiles(dirtyFiles());

export function revertFile(path: string): void {
  const p = get().project;
  if (!p || !(path in p.files)) return;
  set((s) => ({ buffers: { ...s.buffers, [path]: p.files[path]! } }));
  updateSaveState();
}

/* ───────────── editor groups & tabs ───────────── */
export function openFile(path: string, opts: { group?: number; line?: number; column?: number } = {}): void {
  const s = get();
  if (!s.project || !(path in s.project.files)) return;
  const gi = opts.group ?? s.activeGroup;
  const groups = s.groups.map((g, i) => (i === gi ? { ...g, tabs: g.tabs.includes(path) ? g.tabs : [...g.tabs, path], active: path } : g));
  // expand ancestors in the explorer
  const expanded = new Set(s.expanded);
  for (let d = dirname(path); d; d = dirname(d)) expanded.add(d);
  set({ groups, activeGroup: gi, expanded: [...expanded] });
  if (opts.line) set({ revealRequest: { path, line: opts.line, column: opts.column ?? 1, nonce: Math.random() } });
}

export async function closeTab(path: string, groupIndex = get().activeGroup): Promise<boolean> {
  const s = get();
  const openElsewhere = s.groups.some((g, i) => i !== groupIndex && g.tabs.includes(path));
  if (!openElsewhere && isDirty(path)) {
    const choice = await confirmDialog({
      title: 'Salvare le modifiche?',
      message: `Il file "${basename(path)}" contiene modifiche non salvate.`,
      buttons: [
        { id: 'cancel', label: 'Annulla' },
        { id: 'discard', label: 'Non salvare', variant: 'danger' },
        { id: 'save', label: 'Salva', variant: 'primary' },
      ],
    });
    if (choice === 'cancel') return false;
    if (choice === 'save') await saveFile(path);
    else revertFile(path);
  }
  set((st) => {
    const groups = st.groups.map((g, i) => {
      if (i !== groupIndex) return g;
      const idx = g.tabs.indexOf(path);
      const tabs = g.tabs.filter((t) => t !== path);
      const active = g.active === path ? tabs[Math.min(idx, tabs.length - 1)] ?? null : g.active;
      return { ...g, tabs, active };
    });
    // collapse an empty secondary group
    if (groups.length > 1 && groups[groupIndex]!.tabs.length === 0) {
      const rest = groups.filter((_, i) => i !== groupIndex).map((g, i) => ({ ...g, id: i }));
      return { groups: rest, layout: 'single' as SplitLayout, activeGroup: 0 };
    }
    return { groups };
  });
  return true;
}

export async function closeAllTabs(groupIndex = get().activeGroup): Promise<void> {
  for (const t of [...(get().groups[groupIndex]?.tabs ?? [])]) {
    if (!(await closeTab(t, groupIndex))) return;
  }
}

export function setActiveTab(groupIndex: number, path: string): void {
  set((s) => ({ activeGroup: groupIndex, groups: s.groups.map((g, i) => (i === groupIndex ? { ...g, active: path } : g)) }));
}

export function setLayout(layout: SplitLayout): void {
  const s = get();
  if (layout === 'single') {
    const merged = [...new Set(s.groups.flatMap((g) => g.tabs))];
    const active = s.groups[s.activeGroup]?.active ?? merged[0] ?? null;
    set({ layout, groups: [{ id: 0, tabs: merged, active }], activeGroup: 0 });
    return;
  }
  if (s.groups.length === 1) {
    const cur = s.groups[0]!.active;
    set({ layout, groups: [s.groups[0]!, { id: 1, tabs: cur ? [cur] : [], active: cur }], activeGroup: 1 });
  } else set({ layout });
}

export function moveTabToOtherGroup(path: string, from: number): void {
  const s = get();
  if (s.groups.length === 1) setLayout('vertical');
  const to = from === 0 ? 1 : 0;
  set((st) => ({
    groups: st.groups.map((g, i) => (i === to ? { ...g, tabs: g.tabs.includes(path) ? g.tabs : [...g.tabs, path], active: path } : g)),
    activeGroup: to,
  }));
}

/* ───────────── file system operations ───────────── */
function requireProject(): Project {
  const p = get().project;
  if (!p) throw new Error('Nessun progetto aperto');
  return p;
}

async function commitFs(files: Record<string, string>, folders: string[], buffers: Record<string, string>): Promise<void> {
  const p = requireProject();
  const np: Project = { ...p, files, folders: allFolders(files, folders), updatedAt: Date.now() };
  set({ project: np, buffers });
  await persistProject(np);
  updateSaveState();
  await refreshProjects();
}

export async function createFile(path: string, content = '', open = true): Promise<boolean> {
  const p = requireProject();
  const segErr = path.split('/').map(validateName).find(Boolean);
  if (segErr) { toast('error', segErr); return false; }
  if (path in p.files || p.folders.includes(path)) { toast('error', `Esiste già "${path}"`); return false; }
  await commitFs({ ...p.files, [path]: content }, p.folders, { ...get().buffers, [path]: content });
  if (p.linkedFolder) await writeToLinkedFolder(p.id, { [path]: content }).catch(() => undefined);
  if (open) openFile(path);
  return true;
}

export async function createFolder(path: string): Promise<boolean> {
  const p = requireProject();
  const segErr = path.split('/').map(validateName).find(Boolean);
  if (segErr) { toast('error', segErr); return false; }
  if (p.folders.includes(path) || path in p.files) { toast('error', `Esiste già "${path}"`); return false; }
  await commitFs(p.files, [...p.folders, path], get().buffers);
  set((s) => ({ expanded: [...new Set([...s.expanded, path, dirname(path)].filter(Boolean))] }));
  if (p.linkedFolder) await writeToLinkedFolder(p.id, {}, [path]).catch(() => undefined);
  return true;
}

/** Rename or move a file/folder. */
export async function renamePath(from: string, to: string): Promise<boolean> {
  const p = requireProject();
  if (from === to) return true;
  const segErr = to.split('/').map(validateName).find(Boolean);
  if (segErr) { toast('error', segErr); return false; }
  if (isWithin(to, from)) { toast('error', 'Non puoi spostare una cartella dentro sé stessa'); return false; }
  if (to in p.files || p.folders.includes(to)) { toast('error', `Esiste già "${to}"`); return false; }
  const remap = (x: string) => (isWithin(x, from) ? to + x.slice(from.length) : x);
  const files: Record<string, string> = {};
  const buffers: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.files)) files[remap(k)] = v;
  for (const [k, v] of Object.entries(get().buffers)) buffers[remap(k)] = v;
  const folders = p.folders.map(remap);
  const bps: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(p.breakpoints)) bps[remap(k)] = v;
  await commitFs(files, folders, buffers);
  await updateProject({ breakpoints: bps });
  mapGroups(remap);
  set((s) => ({ expanded: s.expanded.map(remap) }));
  if (p.linkedFolder) {
    const moved = Object.fromEntries(Object.entries(files).filter(([k]) => isWithin(k, to)));
    await writeToLinkedFolder(p.id, moved).catch(() => undefined);
    await removeFromLinkedFolder(p.id, from).catch(() => undefined);
  }
  return true;
}

export async function deletePath(path: string, ask = true): Promise<boolean> {
  const p = requireProject();
  const isFolder = p.folders.includes(path);
  const affected = Object.keys(p.files).filter((f) => isWithin(f, path));
  if (ask && get().settings.confirmDelete) {
    const ok = await confirmYes({
      title: isFolder ? 'Eliminare la cartella?' : 'Eliminare il file?',
      message: isFolder ? `"${path}" e i ${affected.length} file contenuti verranno eliminati.` : `"${path}" verrà eliminato definitivamente.`,
      confirmLabel: 'Elimina',
      danger: true,
    });
    if (!ok) return false;
  }
  const files = Object.fromEntries(Object.entries(p.files).filter(([k]) => !isWithin(k, path)));
  const buffers = Object.fromEntries(Object.entries(get().buffers).filter(([k]) => !isWithin(k, path)));
  const folders = p.folders.filter((f) => !isWithin(f, path));
  // explicit folders only: recompute from remaining explicit ones
  await commitFs(files, folders, buffers);
  mapGroups((x) => (isWithin(x, path) ? null : x));
  if (get().groups.length > 1 && get().groups.some((g) => g.tabs.length === 0)) setLayout('single');
  if (p.linkedFolder) await removeFromLinkedFolder(p.id, path).catch(() => undefined);
  toast('info', `Eliminato ${basename(path)}`);
  return true;
}

export async function duplicatePath(path: string): Promise<void> {
  const p = requireProject();
  const target = uniqueName(path, (x) => x in p.files || p.folders.includes(x));
  if (p.folders.includes(path)) {
    const files = { ...p.files };
    for (const [k, v] of Object.entries(p.files)) if (isWithin(k, path)) files[target + k.slice(path.length)] = v;
    const folders = [...p.folders, ...p.folders.filter((f) => isWithin(f, path)).map((f) => target + f.slice(path.length))];
    await commitFs(files, folders, { ...get().buffers, ...Object.fromEntries(Object.entries(files).filter(([k]) => isWithin(k, target))) });
  } else {
    await createFile(target, get().buffers[path] ?? p.files[path] ?? '', false);
  }
  toast('success', `Creato ${basename(target)}`);
}

export function setClipboard(mode: 'copy' | 'cut', paths: string[]): void {
  set({ clipboard: { mode, paths } });
  toast('info', mode === 'copy' ? 'Copiato negli appunti di C-Studio' : 'Pronto per lo spostamento: scegli “Incolla” nella cartella di destinazione');
}

export async function pasteInto(dir: string): Promise<void> {
  const clip = get().clipboard;
  if (!clip) return;
  const p0 = requireProject();
  for (const src of clip.paths) {
    const p = get().project ?? p0;
    const dest = uniqueName(join(dir, basename(src)), (x) => x in p.files || p.folders.includes(x), clip.mode === 'copy' ? ' copia' : ' (2)');
    if (clip.mode === 'cut') {
      if (isWithin(dir, src)) {
        toast('error', 'Destinazione non valida');
        continue;
      }
      await renamePath(src, dest);
    } else if (p.folders.includes(src)) {
      const files = { ...p.files };
      for (const [k, v] of Object.entries(p.files)) if (isWithin(k, src)) files[dest + k.slice(src.length)] = v;
      const folders = [...p.folders, dest, ...p.folders.filter((f) => isWithin(f, src)).map((f) => dest + f.slice(src.length))];
      await commitFs(files, folders, { ...get().buffers, ...Object.fromEntries(Object.entries(files).filter(([k]) => isWithin(k, dest))) });
    } else {
      await createFile(dest, get().buffers[src] ?? p.files[src] ?? '', false);
    }
  }
  if (clip.mode === 'cut') set({ clipboard: null });
}

export function toggleExpanded(folder: string, force?: boolean): void {
  set((s) => {
    const has = s.expanded.includes(folder);
    const want = force ?? !has;
    return { expanded: want ? (has ? s.expanded : [...s.expanded, folder]) : s.expanded.filter((x) => x !== folder) };
  });
}

/** Replace a file's contents programmatically (search & replace, VCS restore). */
export function replaceBuffer(path: string, content: string): void {
  setBuffer(path, content);
}

/** Restore all files to a snapshot (VCS checkout). Writes saved state directly. */
export async function restoreSnapshot(files: Record<string, string>): Promise<void> {
  const p = requireProject();
  await commitFs({ ...files }, p.folders, { ...files });
  mapGroups((x) => (x in files ? x : null));
  if (p.linkedFolder) await writeToLinkedFolder(p.id, files).catch(() => undefined);
}

export { toMeta };
