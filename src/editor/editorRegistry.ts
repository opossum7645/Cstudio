/** Registry of mounted Monaco editors (kept free of runtime monaco imports so it can be used eagerly). */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useApp } from '../stores/appStore';

const editors = new Map<number, Monaco.editor.IStandaloneCodeEditor>();

export function registerEditor(group: number, ed: Monaco.editor.IStandaloneCodeEditor | null): void {
  if (ed) editors.set(group, ed);
  else editors.delete(group);
}

export function getActiveEditor(): Monaco.editor.IStandaloneCodeEditor | null {
  return editors.get(useApp.getState().activeGroup) ?? editors.values().next().value ?? null;
}
