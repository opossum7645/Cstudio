import { X, Columns2, Rows2, Square, ChevronRight, MoreHorizontal, FilePlus2, FolderOpen } from 'lucide-react';
import { useRef } from 'react';
import { useApp, setActiveTab, closeTab, setLayout, isDirty, moveTabToOtherGroup, closeAllTabs, saveFile, revertFile } from '../../stores/appStore';
import { CodeEditor } from './CodeEditor';
import { FileIcon, openMenu, Empty, Logo } from '../common';
import { basename } from '../../utils/path';
import { useBuild } from '../../features/compiler/buildStore';
import { useLongPress } from '../../hooks/useLayout';
import { modKey } from '../../utils/misc';
import { newFileFlow } from '../../features/projects/flows';
import type { LayoutMode } from '../../hooks/useLayout';

function Tab({ path, group, active }: { path: string; group: number; active: boolean }) {
  const dirty = useApp((s) => isDirty(path, s));
  const errors = useBuild((s) => s.diagnostics.filter((d) => d.file === path && d.severity === 'error').length);
  const ref = useRef<HTMLDivElement>(null);
  const menu = (x: number, y: number) =>
    openMenu(x, y, [
      { label: 'Chiudi', keys: 'Alt+W', run: () => void closeTab(path, group) },
      { label: 'Chiudi tutte', run: () => void closeAllTabs(group) },
      { separator: true },
      { label: 'Salva', disabled: !dirty, run: () => void saveFile(path) },
      { label: 'Ripristina dal salvataggio', disabled: !dirty, run: () => revertFile(path) },
      { separator: true },
      { label: group === 0 ? 'Sposta nell’editor a destra' : 'Sposta nel primo editor', run: () => moveTabToOtherGroup(path, group) },
      { label: 'Copia percorso', run: () => void navigator.clipboard?.writeText(path) },
    ]);
  const lp = useLongPress(menu);
  return (
    <div
      ref={ref}
      className={`tab ${active ? 'active' : ''} ${dirty ? 'dirty' : ''}`}
      role="tab"
      aria-selected={active}
      title={path}
      onClick={() => setActiveTab(group, path)}
      onAuxClick={(e) => e.button === 1 && void closeTab(path, group)}
      onContextMenu={(e) => (e.preventDefault(), menu(e.clientX, e.clientY))}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/x-cstudio-tab', JSON.stringify({ path, group }))}
      {...lp}
    >
      <FileIcon path={path} />
      <span className="ellipsis" style={errors ? { color: 'var(--error)' } : undefined}>{basename(path)}</span>
      <button className="close" aria-label={dirty ? `Chiudi ${basename(path)} (non salvato)` : `Chiudi ${basename(path)}`} title={dirty ? 'Modifiche non salvate — chiudi' : 'Chiudi'} onClick={(e) => (e.stopPropagation(), void closeTab(path, group))}>
        {dirty && <span className="dot" />}
        <X size={14} className="x" />
      </button>
    </div>
  );
}

function Group({ index, touch, mode }: { index: number; touch: boolean; mode: LayoutMode }) {
  const g = useApp((s) => s.groups[index]);
  const isActive = useApp((s) => s.activeGroup === index);
  const layout = useApp((s) => s.layout);
  const groupsCount = useApp((s) => s.groups.length);
  if (!g) return null;
  return (
    <div
      className={`editor-group ${isActive ? '' : 'inactive'}`}
      onPointerDown={() => !isActive && useApp.setState({ activeGroup: index })}
      onDragOver={(e) => e.dataTransfer.types.includes('text/x-cstudio-tab') && e.preventDefault()}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData('text/x-cstudio-tab');
        if (!raw) return;
        const { path, group } = JSON.parse(raw) as { path: string; group: number };
        if (group !== index) moveTabToOtherGroup(path, group);
      }}
    >
      <div className="tabs" role="tablist">
        <div className="tabs-scroll">
          {g.tabs.map((t) => <Tab key={t} path={t} group={index} active={g.active === t} />)}
        </div>
        <div className="tabs-actions">
          {index === groupsCount - 1 && mode !== 'phone' && (
            <>
              <button className={`icon-btn sm ${layout === 'vertical' ? 'active' : ''}`} title={`Dividi verticalmente (${modKey}+\\)`} aria-label="Dividi verticalmente" onClick={() => setLayout('vertical')}><Columns2 size={15} /></button>
              <button className={`icon-btn sm ${layout === 'horizontal' ? 'active' : ''}`} title="Dividi orizzontalmente" aria-label="Dividi orizzontalmente" onClick={() => setLayout('horizontal')}><Rows2 size={15} /></button>
              {layout !== 'single' && <button className="icon-btn sm" title="Editor singolo" aria-label="Editor singolo" onClick={() => setLayout('single')}><Square size={14} /></button>}
            </>
          )}
          <button className="icon-btn sm" aria-label="Azioni editor" title="Azioni editor" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu(r.right - 220, r.bottom, [
              { label: 'Chiudi tutte le schede', run: () => void closeAllTabs(index) },
              { label: 'Dividi verticalmente', run: () => setLayout('vertical') },
              { label: 'Dividi orizzontalmente', run: () => setLayout('horizontal') },
              { label: 'Editor singolo', run: () => setLayout('single') },
            ]);
          }}><MoreHorizontal size={15} /></button>
        </div>
      </div>
      {g.active ? (
        <>
          <div className="breadcrumbs">
            {g.active.split('/').map((seg, i, arr) => (
              <span key={i} className="row" style={{ gap: 4 }}>
                {i > 0 && <ChevronRight size={12} />}
                <span style={i === arr.length - 1 ? { color: 'var(--text)' } : undefined}>{seg}</span>
              </span>
            ))}
          </div>
          <CodeEditor group={index} path={g.active} touch={touch} />
        </>
      ) : (
        <div className="welcome-editor">
          <Empty icon={<Logo size={48} className="" />} title="Nessun file aperto">
            <span>Apri un file dall’Explorer o cercalo con {modKey}+P.</span>
            <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => useApp.setState({ palette: 'files' })}><FolderOpen size={15} /> Vai al file</button>
              <button className="btn" onClick={() => void newFileFlow('')}><FilePlus2 size={15} /> Nuovo file</button>
            </div>
          </Empty>
        </div>
      )}
    </div>
  );
}

export function EditorArea({ touch, mode }: { touch: boolean; mode: LayoutMode }) {
  const layout = useApp((s) => s.layout);
  const count = useApp((s) => s.groups.length);
  return (
    <div className={`editor-area ${layout === 'horizontal' ? 'horizontal' : 'vertical'}`}>
      {Array.from({ length: count }, (_, i) => <Group key={i} index={i} touch={touch} mode={mode} />)}
    </div>
  );
}
