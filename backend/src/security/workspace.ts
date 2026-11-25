/**
 * Per-job temporary workspaces. Each job gets its own directory (mode 0700) owned by a uid
 * taken from a pool, so concurrent jobs cannot read each other's files. Directories are always
 * removed when the job ends.
 */
import { mkdir, writeFile, rm, chown, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { ProjectFile } from '../types.js';
import { logger } from '../services/logger.js';

const UID_BASE = config.sandboxUid === 65534 ? 61000 : config.sandboxUid;
const inUse = new Set<number>();

export class BusyError extends Error {
  constructor() {
    super('Server busy: too many concurrent jobs, retry in a few seconds');
    this.name = 'BusyError';
  }
}

export interface Job {
  id: string;
  dir: string;
  uid: number;
  release(): Promise<void>;
}

async function chownTree(path: string, uid: number): Promise<void> {
  await chown(path, uid, uid);
  const st = await lstat(path);
  if (!st.isDirectory()) return;
  for (const e of await readdir(path)) await chownTree(join(path, e), uid);
}

export async function createJob(files: ProjectFile[]): Promise<Job> {
  let uid = -1;
  for (let i = 0; i < config.limits.concurrentJobs; i++) {
    if (!inUse.has(UID_BASE + i)) {
      uid = UID_BASE + i;
      break;
    }
  }
  if (uid < 0) throw new BusyError();
  inUse.add(uid);
  const id = randomBytes(8).toString('hex');
  const dir = join(config.workRoot, id);
  try {
    await mkdir(config.workRoot, { recursive: true, mode: 0o711 });
    await mkdir(dir, { mode: 0o700 });
    for (const f of files) {
      const target = join(dir, f.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content, { mode: 0o600 });
    }
    await mkdir(join(dir, 'build', 'obj'), { recursive: true });
    if (process.getuid?.() === 0) await chownTree(dir, uid);
  } catch (e) {
    inUse.delete(uid);
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  let released = false;
  return {
    id,
    dir,
    uid,
    async release() {
      if (released) return;
      released = true;
      inUse.delete(uid);
      await rm(dir, { recursive: true, force: true }).catch((e: Error) => logger.warn('cleanup failed', { dir, err: e.message }));
    },
  };
}

export function activeJobs(): number {
  return inUse.size;
}
