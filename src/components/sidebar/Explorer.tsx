import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, FilePlus, FolderPlus, ChevronsDownUp, MoreHorizontal, Pencil, Copy, Scissors, ClipboardPaste, Trash2, CopyPlus, FolderInput, Link, Download, FolderOpen, Folder } from 'lucide-react';
import { useApp, openFile, toggleExpanded, deletePath, duplicatePath, setClipboard, pasteInto, renamePath, isDirty, activeFile, moveTabToOtherGroup } from '../../stores/appStore';
import { newFileFlow, newFolderFlow, renameFlow, moveFlow } from '../../features/projects/flows';
import { FileIcon, openMenu, MenuItem, Empty } from '../common';
import { basename, dirname, isWithin, join } from '../../utils/path';
import { useLongPress } from '../../hooks/useLayout';
import { downloadBlob } from '../../utils/misc';
import { toast } from '../../stores/uiFeedback';
import { useBuild } from '../../features/compiler/buildStore';

interface Node {
  path: string;
  name: string;
  dir: boolean;
  children: Node[];
}

function buildTree(files: string[], folders: string[]): Node {
  const root: Node = { path: '', name: '', dir: true, children: [] };
  const index = new Map<string, Node>([['', root]]);
  const ensureDir = (p: string): Node => {
    if (index.has(p)) return index.get(p)!;
    const parent = ensureDir(dirname(p));
    const n: Node = { path: p, name: basename(p), dir: true, children: [] };
    parent.children.push(n);
    index.set(p, n);
    return n;
  };
  folders.forEach(ensureDir);
  for (const f of files) ensureDir(dirname(f)).children.push({ path: f, name: basename(f), dir: false, children: [] });
  const sort = (n: Node) => {
    n.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function itemMenu(path: string, isDir: boolean): MenuItem[] {
  const st = useApp.getState();
  const target = isDir ? path : dirname(path);
  const items: MenuItem[] = [];
  if (!isDir) {
    items.push({ label: 'Apri', icon: <FolderOpen size={14} />, run: () => openFile(path) });
    items.push({ label: 'Apri nell’altro editor (split)', run: () => { openFile(path); moveTabToOtherGroup(path, st.activeGroup); } });
    items.push({ separator: true });
  }
  items.push(
    { label: 'Nuovo file…', icon: <FilePlus size={14} />, run: () => void newFileFlow(target) },
    { label: 'Nuova cartella…', icon: <FolderPlus size={14} />, run: () => void newFolderFlow(target) },
    { separator: true },
    { label: 'Rinomina…', icon: <Pencil size={14} />, keys: 'F2', run: () => void renameFlow(path) },
    { label: 'Duplica', icon: <CopyPlus size={14} />, run: () => void duplicatePath(path) },
    { label: 'Sposta in…', icon: <FolderInput size={14} />, run: () => void moveFlow(path) },
    { label: 'Copia', icon: <Copy size={14} />, run: () => setClipboard('copy', [path]) },
    { label: 'Taglia', icon: <Scissors size={14} />, run: () => setClipboard('cut', [path]) },
    { label: `Incolla${st.clipboard ? ` (${st.clipboard.paths.map(basename).join(', ')})` : ''}`, icon: <ClipboardPaste size={14} />, disabled: !st.clipboard, run: () => void pasteInto(target) },
    { separator: true },
    { label: 'Copia percorso', icon: <Link size={14} />, run: () => void navigator.clipboard?.writeText(path).then(() => toast('info', 'Percorso copiato')) },
  );
  if (!isDir) items.push({ label: 'Scarica file', icon: <Download size={14} />, run: () => downloadBlob(new Blob([st.buffers[path] ?? st.project?.files[path] ?? ''], { type: 'text/plain' }), basename(path)) });
  items.push({ separator: true }, { label: 'Elimina', icon: <Trash2 size={14} />, danger: true, keys: 'Canc', run: () => void deletePath(path) });
  return items;
}

function Row({ node, depth, dropTarget, setDropTarget }: { node: Node; depth: number; dropTarget: string | null; setDropTarget: (p: string | null) => void }) {
  const expanded = useApp((s) => s.expanded.includes(node.path));
  const active = useApp((s) => activeFile(s) === node.path);
  const dirty = useApp((s) => !node.dir && isDirty(node.path, s));
  const cut = useApp((s) => s.clipboard?.mode === 'cut' && s.clipboard.paths.includes(node.path));
  const problems = useBuild((s) => (node.dir ? 0 : s.diagnostics.filter((d) => d.file === node.path && d.severity === 'error').length));
  const [focused, setFocused] = useState(false);
  const menu = (x: number, y: number) => openMenu(x, y, itemMenu(node.path, node.dir));
  const lp = useLongPress(menu);
  const activate = () => (node.dir ? toggleExpanded(node.path) : openFile(node.path));
  return (
    <>
      <div
        className={`tree-row ${active ? 'active' : ''} ${focused ? 'focused' : ''} ${dropTarget === node.path ? 'drop' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-expanded={node.dir ? expanded : undefined}
        aria-selected={active}
        tabIndex={0}
        draggable
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter') activate();
          else if (e.key === 'F2') void renameFlow(node.path);
          else if (e.key === 'Delete') void deletePath(node.path);
          else if (e.key === 'ArrowRight' && node.dir) toggleExpanded(node.path, true);
          else if (e.key === 'ArrowLeft' && node.dir) toggleExpanded(node.path, false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          menu(e.clientX, e.clientY);
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/x-cstudio-path', node.path);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/x-cstudio-path')) return;
          e.preventDefault();
          setDropTarget(node.dir ? node.path : dirname(node.path));
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget(null);
          const src = e.dataTransfer.getData('text/x-cstudio-path');
          const destDir = node.dir ? node.path : dirname(node.path);
          if (src && dirname(src) !== destDir && !isWithin(destDir, src)) void renamePath(src, join(destDir, basename(src)));
        }}
        {...lp}
      >
        <span className="twisty">{node.dir ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}</span>
        {node.dir ? expanded ? <FolderOpen size={16} color="var(--primary)" /> : <Folder size={16} color="var(--primary)" /> : <FileIcon path={node.path} />}
        <span className={`name ${dirty ? 'dirty' : ''} ${cut ? 'cut' : ''}`} style={problems ? { color: 'var(--error)' } : undefined}>{node.name}</span>
        {problems > 0 && <span className="chip err" style={{ padding: '0 6px' }}>{problems}</span>}
        {dirty && <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--warning)' }} title="Non salvato" />}
        <button
          className="icon-btn sm more"
          aria-label={`Azioni per ${node.name}`}
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            menu(r.left, r.bottom);
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {node.dir && expanded && node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} dropTarget={dropTarget} setDropTarget={setDropTarget} />)}
    </>
  );
}

export function ExplorerView() {
  const project = useApp((s) => s.project);
  const [drop, setDrop] = useState<string | null>(null);
  const tree = useMemo(() => (project ? buildTree(Object.keys(project.files), project.folders) : null), [project]);
  if (!project || !tree) return <Empty title="Nessun progetto aperto" />;
  return (
    <>
      <div className="sidebar-head">
        <span className="grow ellipsis" title={project.name}>{project.name}</span>
        <button className="icon-btn sm" title="Nuovo file" aria-label="Nuovo file" onClick={() => void newFileFlow('')}><FilePlus size={16} /></button>
        <button className="icon-btn sm" title="Nuova cartella" aria-label="Nuova cartella" onClick={() => void newFolderFlow('')}><FolderPlus size={16} /></button>
        <button className="icon-btn sm" title="Comprimi tutto" aria-label="Comprimi tutto" onClick={() => useApp.setState({ expanded: [] })}><ChevronsDownUp size={16} /></button>
      </div>
      <div
        className="sidebar-body scroll tree"
        role="tree"
        aria-label="File del progetto"
        onDragOver={(e) => {
          if (e.target === e.currentTarget && e.dataTransfer.types.includes('text/x-cstudio-path')) {
            e.preventDefault();
            setDrop('');
          }
        }}
        onDrop={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setDrop(null);
          const src = e.dataTransfer.getData('text/x-cstudio-path');
          if (src && dirname(src) !== '') void renamePath(src, basename(src));
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          const st = useApp.getState();
          openMenu(e.clientX, e.clientY, [
            { label: 'Nuovo file…', icon: <FilePlus size={14} />, run: () => void newFileFlow('') },
            { label: 'Nuova cartella…', icon: <FolderPlus size={14} />, run: () => void newFolderFlow('') },
            { label: 'Incolla', icon: <ClipboardPaste size={14} />, disabled: !st.clipboard, run: () => void pasteInto('') },
          ]);
        }}
      >
        {tree.children.length === 0 && (
          <Empty title="Progetto vuoto">
            <button className="btn primary sm" onClick={() => void newFileFlow('')}>Crea un file</button>
          </Empty>
        )}
        {tree.children.map((c) => <Row key={c.path} node={c} depth={0} dropTarget={drop} setDropTarget={setDrop} />)}
      </div>
    </>
  );
}
