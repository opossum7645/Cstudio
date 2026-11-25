/** Persistence of projects, drafts (unsaved buffers) and the recent-projects list in IndexedDB. */
import { dbAll, dbDelete, dbGet, dbPut } from '../../services/db';
import type { BuildConfig, CStandard, ConfigName, Project, ProjectMeta } from '../../types';
import { uid } from '../../utils/misc';
import { dirname } from '../../utils/path';
import { TemplateDef, releaseFrom } from './templates';

export interface Drafts {
  buffers: Record<string, string>;
  savedAt: number;
}

export function toMeta(p: Project): ProjectMeta {
  return { id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, fileCount: Object.keys(p.files).length, template: p.template, linkedFolder: p.linkedFolder };
}

/** Every ancestor folder of every file plus explicit folders, sorted. */
export function allFolders(files: Record<string, string>, folders: string[]): string[] {
  const set = new Set<string>();
  const add = (d: string) => {
    while (d) {
      set.add(d);
      d = dirname(d);
    }
  };
  folders.forEach(add);
  Object.keys(files).forEach((f) => add(dirname(f)));
  return [...set].sort();
}

export function newProjectFromTemplate(opts: { name: string; template: TemplateDef; std: CStandard; config: ConfigName; base: BuildConfig }): Project {
  const debug: BuildConfig = { ...opts.base, std: opts.std, mode: 'debug', libraries: [...new Set([...opts.base.libraries, ...(opts.template.libraries ?? [])])] };
  const now = Date.now();
  return {
    id: uid('p_'),
    name: opts.name.trim(),
    template: opts.template.id,
    createdAt: now,
    updatedAt: now,
    files: { ...opts.template.files },
    folders: allFolders(opts.template.files, opts.template.folders),
    buildConfigs: { debug, release: releaseFrom(debug) },
    activeConfig: opts.config,
    runArgs: '',
    breakpoints: {},
    watches: [],
    session: {
      groups: [{ tabs: opts.template.open.slice(0, 3), active: opts.template.open[0] ?? null }],
      layout: 'single',
      activeGroup: 0,
      expanded: allFolders(opts.template.files, opts.template.folders),
    },
  };
}

export const projectRepo = {
  async list(): Promise<ProjectMeta[]> {
    const all = await dbAll<Project>('projects');
    return all.map(toMeta).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get: (id: string) => dbGet<Project>('projects', id),
  async save(p: Project): Promise<void> {
    await dbPut('projects', p.id, p);
  },
  async remove(id: string): Promise<void> {
    await dbDelete('projects', id);
    await dbDelete('drafts', id);
    await dbDelete('vcs', id);
    await dbDelete('kv', `handle:${id}`);
    const recent = await this.recent();
    await dbPut('kv', 'recent', recent.filter((r) => r !== id));
  },
  async duplicate(id: string, name: string): Promise<Project | null> {
    const p = await this.get(id);
    if (!p) return null;
    const copy: Project = { ...structuredClone(p), id: uid('p_'), name, createdAt: Date.now(), updatedAt: Date.now(), linkedFolder: undefined };
    await this.save(copy);
    return copy;
  },
  getDrafts: (id: string) => dbGet<Drafts>('drafts', id),
  saveDrafts: (id: string, d: Drafts) => dbPut('drafts', id, d),
  clearDrafts: (id: string) => dbDelete('drafts', id),
  async recent(): Promise<string[]> {
    return (await dbGet<string[]>('kv', 'recent')) ?? [];
  },
  async touchRecent(id: string, limit: number): Promise<void> {
    const r = (await this.recent()).filter((x) => x !== id);
    r.unshift(id);
    await dbPut('kv', 'recent', r.slice(0, Math.max(1, limit)));
    await dbPut('kv', 'lastProject', id);
  },
  async clearRecent(): Promise<void> {
    await dbPut('kv', 'recent', []);
  },
  lastProject: () => dbGet<string>('kv', 'lastProject'),
};
