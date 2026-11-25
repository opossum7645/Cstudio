import { useEffect, useMemo, useState } from 'react';
import { CaseSensitive, WholeWord, Regex, Replace, ChevronDown, ChevronRight, GitCommitHorizontal, GitBranch, RotateCcw, Plus, History, FilePlus2, FolderOpen, Download, Upload, X, ListTree, Puzzle, Check } from 'lucide-react';
import { useApp, openFile, replaceBuffer, restoreSnapshot, ui, openProject, closeProject, updateSettings, dirtyFiles, saveAll } from '../../stores/appStore';
import { searchFiles, replaceInText, replaceOne, SearchOptions } from '../../features/search/search';
import { Repo, initRepo, status, commit, history, headCommit, createBranch, switchBranch, vcsStore, Change, diffSnapshots, Commit } from '../../features/vcs/vcs';
import { FileIcon, Empty, Toggle } from '../common';
import { symbolIndex } from '../../editor/monaco';
import { EXTENSIONS } from '../../features/extensions/registry';
import { useBackend } from '../../services/backendStatus';
import { confirmYes, promptDialog, toast } from '../../stores/uiFeedback';
import { timeAgo } from '../../utils/misc';
import { basename } from '../../utils/path';
import type { CSymbol } from '../../editor/symbols';

/* ───────────── Search ───────────── */
export function SearchView() {
  const project = useApp((s) => s.project);
  const buffers = useApp((s) => s.buffers);
  const [o, setO] = useState<SearchOptions>({ query: '', regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' });
  const [replace, setReplace] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [debounced, setDebounced] = useState(o);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(o), 180);
    return () => clearTimeout(t);
  }, [o]);
  const res = useMemo(() => searchFiles(buffers, debounced), [buffers, debounced]);
  if (!project) return <Empty title="Nessun progetto aperto" />;

  const replaceAll = async () => {
    const n = res.total;
    if (!n || !(await confirmYes({ title: 'Sostituire tutto?', message: `${n} occorrenze in ${res.results.length} file verranno sostituite con "${replace}".`, confirmLabel: 'Sostituisci' }))) return;
    let count = 0;
    for (const r of res.results) {
      const out = replaceInText(buffers[r.path]!, debounced, replace);
      count += out.count;
      replaceBuffer(r.path, out.text);
    }
    toast('success', `${count} sostituzioni effettuate (non ancora salvate)`);
  };

  const Tgl = ({ k, icon, label }: { k: 'caseSensitive' | 'wholeWord' | 'regex'; icon: React.ReactNode; label: string }) => (
    <button className={`icon-btn sm ${o[k] ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={o[k]} onClick={() => setO({ ...o, [k]: !o[k] })}>{icon}</button>
  );

  return (
    <>
      <div className="sidebar-head"><span className="grow">Cerca</span></div>
      <div className="pane" style={{ paddingTop: 0 }}>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn sm" title="Sostituisci" aria-label="Mostra sostituzione" onClick={() => setShowReplace(!showReplace)}>{showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          <input className="input grow" placeholder="Cerca nel progetto" value={o.query} autoFocus onChange={(e) => setO({ ...o, query: e.target.value })} aria-label="Testo da cercare" />
        </div>
        <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
          <Tgl k="caseSensitive" icon={<CaseSensitive size={16} />} label="Maiuscole/minuscole" />
          <Tgl k="wholeWord" icon={<WholeWord size={16} />} label="Parola intera" />
          <Tgl k="regex" icon={<Regex size={16} />} label="Espressione regolare" />
          <button className="btn ghost sm" onClick={() => setShowFilters(!showFilters)}>Filtri</button>
        </div>
        {showReplace && (
          <div className="row" style={{ gap: 4 }}>
            <input className="input grow" placeholder="Sostituisci con" value={replace} onChange={(e) => setReplace(e.target.value)} aria-label="Testo sostitutivo" />
            <button className="icon-btn sm" title="Sostituisci tutto" aria-label="Sostituisci tutto" disabled={!res.total} onClick={() => void replaceAll()}><Replace size={16} /></button>
          </div>
        )}
        {showFilters && (
          <>
            <input className="input" placeholder="File da includere (es. *.c, *.h)" value={o.include} onChange={(e) => setO({ ...o, include: e.target.value })} />
            <input className="input" placeholder="File da escludere (es. README.md)" value={o.exclude} onChange={(e) => setO({ ...o, exclude: e.target.value })} />
          </>
        )}
        {res.error && <div className="err" style={{ fontSize: '0.9em' }}>{res.error}</div>}
        {o.query && !res.error && <div className="muted" style={{ fontSize: '0.9em' }}>{res.total} risultati in {res.results.length} file{res.total >= 2000 ? ' (limite raggiunto)' : ''}</div>}
      </div>
      <div className="sidebar-body scroll">
        {res.results.map((r) => (
          <div key={r.path}>
            <div className="list-item" onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(r.path)) n.delete(r.path); else n.add(r.path); return n; })}>
              {collapsed.has(r.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <FileIcon path={r.path} />
              <span className="ellipsis">{basename(r.path)}</span>
              <span className="muted ellipsis grow" style={{ fontSize: '0.85em' }}>{r.path}</span>
              <span className="chip">{r.matches.length}</span>
            </div>
            {!collapsed.has(r.path) && r.matches.slice(0, 300).map((m, i) => (
              <div key={i} className="list-item" style={{ paddingLeft: 30 }} onClick={() => openFile(r.path, { line: m.line, column: m.column })}>
                <span className="mono ellipsis grow" style={{ fontSize: 12.5 }}>
                  <span className="muted">{m.line}: </span>
                  {m.preview.slice(0, m.previewStart)}
                  <span className="match">{m.preview.slice(m.previewStart, m.previewStart + m.length)}</span>
                  {m.preview.slice(m.previewStart + m.length)}
                </span>
                {showReplace && (
                  <button className="icon-btn sm" title="Sostituisci questa occorrenza" aria-label="Sostituisci" onClick={(e) => (e.stopPropagation(), replaceBuffer(r.path, replaceOne(useApp.getState().buffers[r.path]!, m, replace)))}>
                    <Replace size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/* ───────────── Source control (local) ───────────── */
const kindChip: Record<Change['kind'], { l: string; c: string }> = { added: { l: 'A', c: 'ok' }, modified: { l: 'M', c: 'warn' }, deleted: { l: 'D', c: 'err' } };

export function ScmView() {
  const project = useApp((s) => s.project);
  const [repo, setRepo] = useState<Repo | null | undefined>(undefined);
  const [msg, setMsg] = useState('');
  const [showHistory, setShowHistory] = useState(true);
  useEffect(() => {
    if (!project) return;
    setRepo(undefined);
    void vcsStore.load(project.id).then((r) => setRepo(r ?? null));
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project) return <Empty title="Nessun progetto aperto" />;
  if (repo === undefined) return <div className="pane muted">Caricamento…</div>;

  const persist = async (r: Repo) => {
    await vcsStore.save(project.id, r);
    setRepo(r);
  };

  if (repo === null) {
    return (
      <>
        <div className="sidebar-head"><span className="grow">Controllo versione</span></div>
        <Empty icon={<GitBranch size={30} />} title="Nessun repository">
          <span>Il controllo versione locale registra snapshot (commit) del progetto in questo dispositivo, con cronologia, diff, branch e ripristino. Funziona offline.</span>
          <button className="btn primary" onClick={() => void persist(initRepo())}>Inizializza repository</button>
          <span style={{ fontSize: '0.85em' }}>Nota: non è Git — l’integrazione con repository Git remoti non è ancora implementata.</span>
        </Empty>
      </>
    );
  }

  const files = project.files;
  const changes = status(repo, files);
  const head = headCommit(repo);
  const unsaved = dirtyFiles().length;

  const doCommit = async () => {
    try {
      if (unsaved && (await confirmYes({ title: 'File non salvati', message: `${unsaved} file hanno modifiche non salvate: il commit registra solo il contenuto salvato. Salvare ora?`, confirmLabel: 'Salva e registra' }))) await saveAll();
      const r = commit(repo, useApp.getState().project!.files, msg);
      await persist(r);
      setMsg('');
      toast('success', 'Commit registrato');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const showDiff = (c: Change, base: Record<string, string>, cur: Record<string, string>, title: string) =>
    ui.openDialog({ kind: 'diff', title, path: c.path, original: base[c.path] ?? '', modified: cur[c.path] ?? '' });

  const discard = async (c: Change) => {
    if (!(await confirmYes({ title: 'Annullare le modifiche?', message: `"${c.path}" verrà riportato alla versione dell’ultimo commit.`, confirmLabel: 'Annulla modifiche', danger: true }))) return;
    const next = { ...useApp.getState().project!.files };
    const base = head?.files ?? {};
    if (c.path in base) next[c.path] = base[c.path]!;
    else delete next[c.path];
    await restoreSnapshot(next);
  };

  const checkoutCommit = async (cm: Commit) => {
    if (!(await confirmYes({ title: 'Ripristinare questa versione?', message: `I file del progetto verranno sostituiti con quelli del commit "${cm.message}". Le modifiche non registrate andranno perse.`, confirmLabel: 'Ripristina', danger: true }))) return;
    await restoreSnapshot(cm.files);
    toast('info', 'Versione ripristinata (le modifiche risultano ora come “non registrate”)');
  };

  const newBranch = async () => {
    const n = await promptDialog({ title: 'Nuovo branch', label: `Il branch parte da "${repo.current}"`, placeholder: 'feature/nuova', confirmLabel: 'Crea', validate: (v) => (/^[A-Za-z0-9._\-/]{1,60}$/.test(v) ? (v in repo.branches ? 'Esiste già' : null) : 'Nome non valido') });
    if (!n) return;
    try {
      await persist(createBranch(repo, n));
      toast('success', `Ora sei sul branch ${n}`);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const switchTo = async (name: string) => {
    if (name === repo.current) return;
    if (changes.length && !(await confirmYes({ title: 'Modifiche non registrate', message: `Ci sono ${changes.length} modifiche non registrate che verranno sostituite dal contenuto del branch "${name}".`, confirmLabel: 'Cambia branch', danger: true }))) return;
    const { repo: r, files: snap } = switchBranch(repo, name);
    await persist(r);
    if (snap) await restoreSnapshot(snap);
    toast('info', `Branch: ${name}`);
  };

  const log = history(repo);

  return (
    <>
      <div className="sidebar-head">
        <span className="grow">Controllo versione</span>
        <button className="icon-btn sm" title="Nuovo branch" aria-label="Nuovo branch" onClick={() => void newBranch()}><Plus size={16} /></button>
      </div>
      <div className="sidebar-body scroll">
        <div className="pane" style={{ paddingTop: 0 }}>
          <div className="row">
            <GitBranch size={15} className="muted" />
            <select className="select grow" value={repo.current} onChange={(e) => void switchTo(e.target.value)} aria-label="Branch">
              {Object.keys(repo.branches).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <textarea className="textarea" rows={2} placeholder={`Messaggio di commit (su ${repo.current})`} value={msg} onChange={(e) => setMsg(e.target.value)} style={{ fontFamily: 'var(--font-ui)' }} />
          <button className="btn primary block" disabled={!msg.trim() || changes.length === 0} onClick={() => void doCommit()}>
            <GitCommitHorizontal size={16} /> Commit ({changes.length})
          </button>
          {unsaved > 0 && <div className="warn" style={{ fontSize: '0.88em' }}>{unsaved} file non salvati non sono inclusi nelle modifiche.</div>}
        </div>
        <div className="section-title">Modifiche ({changes.length})</div>
        {changes.length === 0 && <div className="pane muted" style={{ paddingTop: 0 }}>Nessuna modifica rispetto a {head ? `“${head.message}”` : 'repository vuoto'}.</div>}
        {changes.map((c) => (
          <div key={c.path} className="list-item" onClick={() => showDiff(c, head?.files ?? {}, files, `${c.path} — modifiche rispetto all’ultimo commit`)}>
            <FileIcon path={c.path} />
            <span className="ellipsis grow">{c.path}</span>
            <button className="icon-btn sm" title="Annulla modifiche" aria-label="Annulla modifiche" onClick={(e) => (e.stopPropagation(), void discard(c))}><RotateCcw size={14} /></button>
            <span className={`chip ${kindChip[c.kind].c}`}>{kindChip[c.kind].l}</span>
          </div>
        ))}
        <div className="section-title" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <History size={13} /> Cronologia ({log.length})
        </div>
        {showHistory && log.map((cm) => {
          const parent = cm.parent ? repo.commits[cm.parent] : null;
          const ch = diffSnapshots(parent?.files ?? {}, cm.files);
          return (
            <details key={cm.id} style={{ padding: '2px 10px' }}>
              <summary style={{ cursor: 'pointer', padding: '4px 0' }}>
                <span>{cm.message}</span> <span className="muted" style={{ fontSize: '0.85em' }}>· {timeAgo(cm.time)} · {ch.length} file</span>
              </summary>
              {ch.map((c) => (
                <div key={c.path} className="list-item" style={{ paddingLeft: 16 }} onClick={() => showDiff(c, parent?.files ?? {}, cm.files, `${c.path} — ${cm.message}`)}>
                  <span className={`chip ${kindChip[c.kind].c}`}>{kindChip[c.kind].l}</span>
                  <span className="ellipsis">{c.path}</span>
                </div>
              ))}
              <button className="btn sm" style={{ margin: '4px 0 6px 16px' }} onClick={() => void checkoutCommit(cm)}>Ripristina questa versione</button>
            </details>
          );
        })}
      </div>
    </>
  );
}

/* ───────────── Outline ───────────── */
export function OutlineView() {
  const project = useApp((s) => s.project);
  const buffers = useApp((s) => s.buffers);
  const [scope, setScope] = useState<'file' | 'project'>('file');
  const file = useApp((s) => s.groups[s.activeGroup]?.active ?? null);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => tick((n) => n + 1), 400);
    return () => clearTimeout(t);
  }, [buffers]);
  if (!project) return <Empty title="Nessun progetto aperto" />;
  const label: Record<CSymbol['kind'], string> = { function: 'ƒ', prototype: 'ƒ̲', macro: '#', typedef: 'T', struct: 'S', union: 'U', enum: 'E', enumerator: 'e', variable: 'v', local: 'l', parameter: 'p' };
  const syms = scope === 'file' ? (file ? symbolIndex.fileSymbols(file).filter((s) => s.kind !== 'local' && s.kind !== 'parameter') : []) : symbolIndex.globals();
  const grouped = scope === 'project' ? Object.entries(syms.reduce<Record<string, CSymbol[]>>((acc, s) => ((acc[s.file] ??= []).push(s), acc), {})) : [[file ?? '', syms] as [string, CSymbol[]]];
  return (
    <>
      <div className="sidebar-head"><span className="grow">Outline</span></div>
      <div className="pane" style={{ paddingTop: 0 }}>
        <div className="seg"><button className={scope === 'file' ? 'on' : ''} onClick={() => setScope('file')}>File corrente</button><button className={scope === 'project' ? 'on' : ''} onClick={() => setScope('project')}>Progetto</button></div>
      </div>
      <div className="sidebar-body scroll">
        {syms.length === 0 && <Empty icon={<ListTree size={26} />} title={scope === 'file' && !file ? 'Nessun file aperto' : 'Nessun simbolo'} />}
        {grouped.map(([f, list]) => (
          <div key={f}>
            {scope === 'project' && <div className="section-title"><FileIcon path={f} /> {f}</div>}
            {list.sort((a, b) => a.line - b.line).map((s, i) => (
              <div key={i} className="list-item" title={s.detail} onClick={() => openFile(s.file, { line: s.line, column: s.column })}>
                <span className="kbd" style={{ minWidth: 22, textAlign: 'center' }}>{label[s.kind]}</span>
                <span className="mono ellipsis">{s.name}</span>
                <span className="muted ellipsis grow" style={{ fontSize: '0.82em' }}>{s.kind === 'prototype' ? 'prototipo' : s.kind}</span>
                <span className="muted" style={{ fontSize: '0.82em' }}>{s.line}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/* ───────────── Extensions ───────────── */
export function ExtensionsView() {
  const ext = useApp((s) => s.settings.extensions);
  const backend = useBackend();
  return (
    <>
      <div className="sidebar-head"><span className="grow">Estensioni</span></div>
      <div className="sidebar-body scroll">
        <div className="section-title">Integrate</div>
        {EXTENSIONS.map((e) => {
          const unavailable = e.unavailableReason;
          const on = !unavailable && ext[e.id] !== false;
          return (
            <div key={e.id} className="pane" style={{ borderBottom: '1px solid var(--border)', gap: 4 }}>
              <div className="row">
                <e.icon size={18} color="var(--primary)" />
                <b className="grow">{e.name}</b>
                <Toggle on={on} disabled={!!unavailable} label={e.name} onChange={(v) => void updateSettings({ extensions: { ...ext, [e.id]: v } })} />
              </div>
              <div className="muted" style={{ fontSize: '0.88em' }}>{e.description}</div>
              {unavailable && <div className="warn" style={{ fontSize: '0.85em' }}>{unavailable}</div>}
              {e.requiresBackend && !backend.available && on && <div className="warn" style={{ fontSize: '0.85em' }}>Richiede il server: al momento non disponibile.</div>}
            </div>
          );
        })}
        <div className="pane muted" style={{ fontSize: '0.88em' }}>
          <Puzzle size={16} /> Le estensioni esterne non sono ancora supportate. L’architettura (src/features/extensions) definisce manifest e API per le estensioni future.
        </div>
      </div>
    </>
  );
}

/* ───────────── Projects ───────────── */
export function ProjectsView() {
  const projects = useApp((s) => s.projects);
  const current = useApp((s) => s.project);
  return (
    <>
      <div className="sidebar-head"><span className="grow">Progetti</span></div>
      <div className="pane" style={{ paddingTop: 0 }}>
        <button className="btn primary block" onClick={() => ui.openDialog({ kind: 'newProject' })}><FilePlus2 size={16} /> Nuovo progetto</button>
        <div className="row">
          <button className="btn grow" onClick={() => ui.openDialog({ kind: 'import' })}><Upload size={15} /> Importa</button>
          <button className="btn grow" onClick={() => ui.openDialog({ kind: 'export' })}><Download size={15} /> Esporta</button>
        </div>
        {current && <button className="btn block" onClick={() => void closeProject()}><X size={15} /> Chiudi “{current.name}”</button>}
      </div>
      <div className="section-title">Recenti</div>
      <div className="sidebar-body scroll">
        {projects.map((p) => (
          <div key={p.id} className={`list-item ${current?.id === p.id ? 'active' : ''}`} onClick={() => void openProject(p.id)}>
            {current?.id === p.id ? <Check size={15} color="var(--primary)" /> : <FolderOpen size={15} className="muted" />}
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis">{p.name}</div>
              <div className="muted" style={{ fontSize: '0.82em' }}>{p.fileCount} file · {timeAgo(p.updatedAt)}</div>
            </div>
          </div>
        ))}
        <div className="pane"><button className="btn sm" onClick={() => ui.openDialog({ kind: 'openProject' })}>Gestisci tutti i progetti…</button></div>
      </div>
    </>
  );
}
