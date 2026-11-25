import type { Settings } from '../../types';
import { defaultDebugConfig } from '../projects/templates';
import { dbGet, dbPut } from '../../services/db';

export const DEFAULT_TABLET_KEYS = '{ } [ ] ( ) ; : , . = + - * / % & | ! < > # " \' \\ TAB S-TAB ← → ↑ ↓ UNDO REDO COPY PASTE FIND SAVE';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  primaryColor: '#6C8CFF',
  accentColor: '#42D6B0',
  syntaxScheme: 'cstudio',
  uiFontSize: 13,
  density: 'auto',
  animations: true,

  editorFontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  editorFontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: false,
  minimap: true,
  lineNumbers: true,
  autoClosingBrackets: true,
  folding: true,
  bracketColors: true,
  renderWhitespace: false,
  stickyScroll: true,
  autoSave: 'afterDelay',
  autoSaveDelay: 1500,
  formatOnSave: false,
  formatStyle: 'LLVM',

  defaultBuildConfig: defaultDebugConfig,
  runTimeoutSec: 60,
  compilerEngine: 'auto',
  liveDiagnostics: true,
  backendUrl: '',

  tabletKeys: 'auto',
  tabletKeySet: DEFAULT_TABLET_KEYS,

  startup: 'lastProject',
  recentLimit: 10,
  confirmDelete: true,

  customSnippets: [],
  extensions: { intellisense: true, snippets: true, formatter: true, tabletKeys: true, liveDiagnostics: true, docsHover: true, ai: false },
};

export async function loadSettings(): Promise<Settings> {
  const stored = await dbGet<Partial<Settings>>('kv', 'settings').catch(() => undefined);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    extensions: { ...DEFAULT_SETTINGS.extensions, ...stored?.extensions },
    defaultBuildConfig: { ...DEFAULT_SETTINGS.defaultBuildConfig, ...stored?.defaultBuildConfig },
  };
}

export async function persistSettings(s: Settings): Promise<void> {
  await dbPut('kv', 'settings', s);
}
