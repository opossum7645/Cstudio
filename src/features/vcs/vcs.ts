/**
 * Local version control (snapshot-based, stored in IndexedDB). This is NOT Git: it provides
 * repository init, commits, history, branches, diffs and restore, entirely offline.
 * Git interoperability (push/pull, .git format) is not implemented.
 */
import { dbDelete, dbGet, dbPut } from '../../services/db';
import { uid } from '../../utils/misc';

export interface Commit {
  id: string;
  message: string;
  parent: string | null;
  time: number;
  branch: string;
  files: Record<string, string>;
}

export interface Repo {
  version: 1;
  current: string;
  branches: Record<string, string | null>;
  commits: Record<string, Commit>;
}

export type ChangeKind = 'added' | 'modified' | 'deleted';
export interface Change {
  path: string;
  kind: ChangeKind;
}

export function initRepo(): Repo {
  return { version: 1, current: 'main', branches: { main: null }, commits: {} };
}

export function headCommit(repo: Repo): Commit | null {
  const id = repo.branches[repo.current];
  return id ? repo.commits[id] ?? null : null;
}

export function diffSnapshots(base: Record<string, string>, current: Record<string, string>): Change[] {
  const out: Change[] = [];
  for (const p of Object.keys(current)) {
    if (!(p in base)) out.push({ path: p, kind: 'added' });
    else if (base[p] !== current[p]) out.push({ path: p, kind: 'modified' });
  }
  for (const p of Object.keys(base)) if (!(p in current)) out.push({ path: p, kind: 'deleted' });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function status(repo: Repo, files: Record<string, string>): Change[] {
  return diffSnapshots(headCommit(repo)?.files ?? {}, files);
}

export function commit(repo: Repo, files: Record<string, string>, message: string): Repo {
  const msg = message.trim();
  if (!msg) throw new Error('Il messaggio di commit è obbligatorio');
  if (status(repo, files).length === 0) throw new Error('Nessuna modifica da registrare');
  const c: Commit = { id: uid('c'), message: msg, parent: repo.branches[repo.current] ?? null, time: Date.now(), branch: repo.current, files: { ...files } };
  return { ...repo, commits: { ...repo.commits, [c.id]: c }, branches: { ...repo.branches, [repo.current]: c.id } };
}

export function history(repo: Repo, branch = repo.current, limit = 200): Commit[] {
  const out: Commit[] = [];
  let id = repo.branches[branch] ?? null;
  while (id && out.length < limit) {
    const c = repo.commits[id];
    if (!c) break;
    out.push(c);
    id = c.parent;
  }
  return out;
}

export function createBranch(repo: Repo, name: string): Repo {
  const n = name.trim();
  if (!/^[A-Za-z0-9._\-/]{1,60}$/.test(n)) throw new Error('Nome del branch non valido');
  if (n in repo.branches) throw new Error(`Il branch "${n}" esiste già`);
  return { ...repo, branches: { ...repo.branches, [n]: repo.branches[repo.current] ?? null }, current: n };
}

/** Switch branch; returns the snapshot to restore (null = branch without commits → keep files). */
export function switchBranch(repo: Repo, name: string): { repo: Repo; files: Record<string, string> | null } {
  if (!(name in repo.branches)) throw new Error(`Branch "${name}" inesistente`);
  const next = { ...repo, current: name };
  return { repo: next, files: headCommit(next)?.files ?? null };
}

export function deleteBranch(repo: Repo, name: string): Repo {
  if (name === repo.current) throw new Error('Non puoi eliminare il branch corrente');
  const branches = { ...repo.branches };
  delete branches[name];
  return { ...repo, branches };
}

export const vcsStore = {
  load: (projectId: string) => dbGet<Repo>('vcs', projectId),
  save: (projectId: string, repo: Repo) => dbPut('vcs', projectId, repo),
  remove: (projectId: string) => dbDelete('vcs', projectId),
};
