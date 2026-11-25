/**
 * File System Access API (Chrome/Edge desktop & Android). Lets a project mirror a real folder:
 * files are read at open time and written back on save. Safari/iOS and Firefox do not support
 * it — callers fall back to <input webkitdirectory> (read-only import).
 */
import { dbGet, dbPut } from './db';
import { dirname } from '../utils/path';

type Perm = 'granted' | 'denied' | 'prompt';
interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
  queryPermission(o: { mode: 'readwrite' }): Promise<Perm>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Perm>;
}
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>;
}

export const fsAccessSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickDirectory(): Promise<DirHandle> {
  const w = window as unknown as { showDirectoryPicker(o?: { mode?: string }): Promise<DirHandle> };
  return w.showDirectoryPicker({ mode: 'readwrite' });
}

const SKIP = new Set(['.git', 'node_modules', 'build', '.vscode', '.idea']);

export async function readDirectory(dir: DirHandle, prefix = ''): Promise<{ entries: { path: string; data: Uint8Array }[]; folders: string[] }> {
  const entries: { path: string; data: Uint8Array }[] = [];
  const folders: string[] = [];
  for await (const h of dir.values()) {
    const path = prefix ? `${prefix}/${h.name}` : h.name;
    if (h.kind === 'directory') {
      if (SKIP.has(h.name)) continue;
      folders.push(path);
      const sub = await readDirectory(h, path);
      entries.push(...sub.entries);
      folders.push(...sub.folders);
    } else {
      const f = await h.getFile();
      if (f.size > 512 * 1024) continue;
      entries.push({ path, data: new Uint8Array(await f.arrayBuffer()) });
    }
    if (entries.length > 600) break;
  }
  return { entries, folders };
}

export async function linkHandle(projectId: string, dir: DirHandle): Promise<void> {
  await dbPut('kv', `handle:${projectId}`, dir);
}

async function getHandle(projectId: string): Promise<DirHandle | null> {
  return ((await dbGet<DirHandle>('kv', `handle:${projectId}`)) as DirHandle | undefined) ?? null;
}

async function ensurePermission(dir: DirHandle): Promise<boolean> {
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
}

async function resolveDir(root: DirHandle, path: string, create: boolean): Promise<DirHandle> {
  let d = root;
  for (const seg of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(seg, { create });
  return d;
}

/** Writes files back to the linked folder. Returns false when no folder is linked or permission was denied. */
export async function writeToLinkedFolder(projectId: string, files: Record<string, string>, folders: string[] = []): Promise<boolean> {
  const root = await getHandle(projectId);
  if (!root || !(await ensurePermission(root))) return false;
  for (const f of folders) await resolveDir(root, f, true);
  for (const [path, content] of Object.entries(files)) {
    const dir = await resolveDir(root, dirname(path), true);
    const fh = await dir.getFileHandle(path.slice(path.lastIndexOf('/') + 1), { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }
  return true;
}

export async function removeFromLinkedFolder(projectId: string, path: string): Promise<boolean> {
  const root = await getHandle(projectId);
  if (!root || !(await ensurePermission(root))) return false;
  try {
    const dir = await resolveDir(root, dirname(path), false);
    await dir.removeEntry(path.slice(path.lastIndexOf('/') + 1), { recursive: true });
  } catch {
    /* already gone */
  }
  return true;
}

export type { DirHandle };
