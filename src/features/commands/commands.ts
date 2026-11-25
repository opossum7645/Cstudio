/** Command registry: used by the command palette, menus, toolbar and global keyboard shortcuts. */
import {
  useApp, ui, saveAll, saveFile, activeFile, closeTab, closeProject, setLayout, setActiveConfig, isDirty, revertFile, updateSettings,
} from '../../stores/appStore';
import { compileProject, useBuild } from '../compiler/buildStore';
import { runActions, useRun } from '../execution/runStore';
import { debugActions, isDebugging, useDebug } from '../debugger/debugStore';
import { useBackend } from '../../services/backendStatus';
import { getActiveEditor } from '../../editor/editorRegistry';
import { newFileFlow, newFolderFlow } from '../projects/flows';
import { toast } from '../../stores/uiFeedback';

export interface Command {
  id: string;
  label: string;
  category: string;
  keys?: string;
  /** returns null when enabled, otherwise the reason it is disabled */
  disabledReason?: () => string | null;
  run: () => unknown;
}

const needProject = () => (useApp.getState().project ? null : 'Apri un progetto');
const needEditor = () => (activeFile() ? null : 'Nessun file aperto');
const needBackend = () => needProject() ?? (useBackend.getState().available ? null : useBackend.getState().message);
const busy = () => (runActions.busy || isDebugging() ? 'Un programma è già in esecuzione' : null);
const editorAction = (id: string) => () => {
  const ed = getActiveEditor();
  if (!ed) return;
  ed.focus();
  ed.trigger('cstudio', id, null);
};

export const COMMANDS: Command[] = [
  // File
  { id: 'file.save', label: 'Salva', category: 'File', keys: 'Ctrl+S', disabledReason: needEditor, run: () => { const f = activeFile(); if (f) void saveFile(f); } },
  { id: 'file.saveAll', label: 'Salva tutto', category: 'File', keys: 'Ctrl+Alt+S', disabledReason: needProject, run: () => saveAll() },
  { id: 'file.new', label: 'Nuovo file…', category: 'File', keys: 'Alt+N', disabledReason: needProject, run: () => newFileFlow('') },
  { id: 'folder.new', label: 'Nuova cartella…', category: 'File', disabledReason: needProject, run: () => newFolderFlow('') },
  { id: 'file.close', label: 'Chiudi scheda', category: 'File', keys: 'Alt+W', disabledReason: needEditor, run: () => { const f = activeFile(); if (f) void closeTab(f); } },
  { id: 'file.revert', label: 'Ripristina file dall’ultimo salvataggio', category: 'File', disabledReason: () => needEditor() ?? (isDirty(activeFile()!) ? null : 'Nessuna modifica'), run: () => { const f = activeFile(); if (f) revertFile(f); } },
  // Project
  { id: 'project.new', label: 'Nuovo progetto…', category: 'Progetto', keys: 'Ctrl+Alt+N', run: () => ui.openDialog({ kind: 'newProject' }) },
  { id: 'project.open', label: 'Apri progetto…', category: 'Progetto', keys: 'Ctrl+O', run: () => ui.openDialog({ kind: 'openProject' }) },
  { id: 'project.import', label: 'Importa progetto (ZIP / cartella)…', category: 'Progetto', run: () => ui.openDialog({ kind: 'import' }) },
  { id: 'project.export', label: 'Esporta progetto / backup…', category: 'Progetto', run: () => ui.openDialog({ kind: 'export' }) },
  { id: 'project.close', label: 'Chiudi progetto', category: 'Progetto', disabledReason: needProject, run: () => closeProject() },
  // Edit
  { id: 'edit.undo', label: 'Annulla', category: 'Modifica', disabledReason: needEditor, run: editorAction('undo') },
  { id: 'edit.redo', label: 'Ripristina', category: 'Modifica', disabledReason: needEditor, run: editorAction('redo') },
  { id: 'edit.find', label: 'Trova nel file', category: 'Modifica', disabledReason: needEditor, run: editorAction('actions.find') },
  { id: 'edit.replace', label: 'Sostituisci nel file', category: 'Modifica', disabledReason: needEditor, run: editorAction('editor.action.startFindReplaceAction') },
  { id: 'edit.format', label: 'Formatta documento (clang-format)', category: 'Modifica', keys: 'Shift+Alt+F', disabledReason: () => needEditor() ?? needBackend(), run: editorAction('editor.action.formatDocument') },
  { id: 'edit.comment', label: 'Commenta/decommenta riga', category: 'Modifica', disabledReason: needEditor, run: editorAction('editor.action.commentLine') },
  { id: 'edit.goToDefinition', label: 'Vai alla definizione', category: 'Navigazione', disabledReason: needEditor, run: editorAction('editor.action.revealDefinition') },
  { id: 'edit.references', label: 'Trova riferimenti', category: 'Navigazione', disabledReason: needEditor, run: editorAction('editor.action.referenceSearch.trigger') },
  { id: 'edit.symbols', label: 'Vai al simbolo nel file…', category: 'Navigazione', disabledReason: needEditor, run: editorAction('editor.action.quickOutline') },
  { id: 'edit.goToLine', label: 'Vai alla riga…', category: 'Navigazione', keys: 'Ctrl+G', disabledReason: needEditor, run: editorAction('editor.action.gotoLine') },
  { id: 'edit.bracket', label: 'Vai alla parentesi corrispondente', category: 'Navigazione', disabledReason: needEditor, run: editorAction('editor.action.jumpToBracket') },
  { id: 'edit.fold', label: 'Comprimi tutto', category: 'Modifica', disabledReason: needEditor, run: editorAction('editor.foldAll') },
  { id: 'edit.unfold', label: 'Espandi tutto', category: 'Modifica', disabledReason: needEditor, run: editorAction('editor.unfoldAll') },
  { id: 'edit.addCursorBelow', label: 'Aggiungi cursore sotto', category: 'Modifica', disabledReason: needEditor, run: editorAction('editor.action.insertCursorBelow') },
  { id: 'edit.selectAllOccurrences', label: 'Seleziona tutte le occorrenze', category: 'Modifica', disabledReason: needEditor, run: editorAction('editor.action.selectHighlights') },
  // Build & run
  { id: 'build.compile', label: 'Compila', category: 'Build', keys: 'F7', disabledReason: () => needBackend() ?? (useBuild.getState().building ? 'Compilazione in corso' : null), run: () => compileProject() },
  { id: 'build.compile2', label: 'Compila (Ctrl+Shift+B)', category: 'Build', keys: 'Ctrl+Shift+B', disabledReason: () => needBackend(), run: () => compileProject() },
  { id: 'run.run', label: 'Esegui ultima build', category: 'Build', disabledReason: () => needBackend() ?? busy() ?? (useBuild.getState().lastBuild ? null : 'Compila prima il progetto'), run: () => runActions.runLastBuild() },
  { id: 'run.compileRun', label: 'Compila ed esegui', category: 'Build', keys: 'Ctrl+F5', disabledReason: () => needBackend() ?? busy(), run: () => runActions.compileAndRun() },
  { id: 'run.stop', label: 'Interrompi esecuzione', category: 'Build', keys: 'Shift+F5', disabledReason: () => (runActions.busy || isDebugging() ? null : 'Nessun programma in esecuzione'), run: () => { if (isDebugging()) debugActions.command('stop'); else runActions.stop(); } },
  { id: 'config.toggle', label: 'Cambia configurazione Debug/Release', category: 'Build', disabledReason: needProject, run: () => { const p = useApp.getState().project; if (p) setActiveConfig(p.activeConfig === 'debug' ? 'release' : 'debug'); } },
  // Debug
  { id: 'debug.start', label: 'Avvia debug / Continua', category: 'Debug', keys: 'F5', disabledReason: () => (useDebug.getState().status === 'stopped' ? null : needBackend() ?? (runActions.busy ? 'Un programma è in esecuzione' : isDebugging() ? 'Il programma è in esecuzione' : null)), run: () => (useDebug.getState().status === 'stopped' ? debugActions.command('continue') : debugActions.start()) },
  { id: 'debug.next', label: 'Step Over', category: 'Debug', keys: 'F10', disabledReason: () => (useDebug.getState().status === 'stopped' ? null : 'Debug non in pausa'), run: () => debugActions.command('next') },
  { id: 'debug.step', label: 'Step Into', category: 'Debug', keys: 'F11', disabledReason: () => (useDebug.getState().status === 'stopped' ? null : 'Debug non in pausa'), run: () => debugActions.command('step') },
  { id: 'debug.finish', label: 'Step Out', category: 'Debug', keys: 'Shift+F11', disabledReason: () => (useDebug.getState().status === 'stopped' ? null : 'Debug non in pausa'), run: () => debugActions.command('finish') },
  { id: 'debug.pause', label: 'Pausa', category: 'Debug', keys: 'F6', disabledReason: () => (useDebug.getState().status === 'running' ? null : 'Il programma non è in esecuzione'), run: () => debugActions.command('pause') },
  { id: 'debug.toggleBreakpoint', label: 'Attiva/disattiva breakpoint', category: 'Debug', keys: 'F9', disabledReason: needEditor, run: () => { const ed = getActiveEditor(); const f = activeFile(); const pos = ed?.getPosition(); if (f && pos) void debugActions.toggleBreakpoint(f, pos.lineNumber); } },
  { id: 'debug.clearBreakpoints', label: 'Rimuovi tutti i breakpoint', category: 'Debug', disabledReason: needProject, run: () => debugActions.clearBreakpoints() },
  // View
  { id: 'view.palette', label: 'Vai al file…', category: 'Vista', keys: 'Ctrl+P', run: () => ui.openPalette('files') },
  { id: 'view.commands', label: 'Mostra tutti i comandi', category: 'Vista', keys: 'Ctrl+Shift+P', run: () => ui.openPalette('commands') },
  { id: 'view.explorer', label: 'Mostra Explorer', category: 'Vista', keys: 'Ctrl+Shift+E', run: () => ui.setSidebar('explorer') },
  { id: 'view.search', label: 'Cerca nel progetto', category: 'Vista', keys: 'Ctrl+Shift+F', run: () => ui.setSidebar('search') },
  { id: 'view.scm', label: 'Mostra controllo versione', category: 'Vista', keys: 'Ctrl+Shift+G', run: () => ui.setSidebar('scm') },
  { id: 'view.outline', label: 'Mostra outline / simboli', category: 'Vista', keys: 'Ctrl+Shift+O', run: () => ui.setSidebar('outline') },
  { id: 'view.toggleSidebar', label: 'Mostra/nascondi barra laterale', category: 'Vista', keys: 'Ctrl+B', run: () => ui.toggleSidebar() },
  { id: 'view.togglePanel', label: 'Mostra/nascondi pannello inferiore', category: 'Vista', keys: 'Ctrl+J', run: () => ui.togglePanel() },
  { id: 'view.terminal', label: 'Terminale', category: 'Vista', keys: 'Ctrl+`', run: () => ui.openPanel('terminal') },
  { id: 'view.problems', label: 'Problems', category: 'Vista', keys: 'Ctrl+Shift+M', run: () => ui.openPanel('problems') },
  { id: 'view.output', label: 'Output', category: 'Vista', run: () => ui.openPanel('output') },
  { id: 'view.runPanel', label: 'Run', category: 'Vista', run: () => ui.openPanel('run') },
  { id: 'view.debugPanel', label: 'Debug Console', category: 'Vista', run: () => ui.openPanel('debug') },
  { id: 'view.splitVertical', label: 'Dividi editor verticalmente', category: 'Vista', keys: 'Ctrl+\\', disabledReason: needProject, run: () => setLayout('vertical') },
  { id: 'view.splitHorizontal', label: 'Dividi editor orizzontalmente', category: 'Vista', disabledReason: needProject, run: () => setLayout('horizontal') },
  { id: 'view.single', label: 'Editor singolo', category: 'Vista', disabledReason: needProject, run: () => setLayout('single') },
  { id: 'view.zoomIn', label: 'Aumenta dimensione carattere editor', category: 'Vista', run: async () => { await updateSettings({ editorFontSize: Math.min(32, useApp.getState().settings.editorFontSize + 1) }); } },
  { id: 'view.zoomOut', label: 'Riduci dimensione carattere editor', category: 'Vista', run: async () => { await updateSettings({ editorFontSize: Math.max(9, useApp.getState().settings.editorFontSize - 1) }); } },
  // Tools
  { id: 'settings.open', label: 'Impostazioni', category: 'Preferenze', keys: 'Ctrl+,', run: () => ui.openDialog({ kind: 'settings' }) },
  { id: 'settings.theme', label: 'Gestione temi', category: 'Preferenze', run: () => ui.openDialog({ kind: 'settings', category: 'appearance' }) },
  { id: 'settings.keyboard', label: 'Scorciatoie e tastiera tablet', category: 'Preferenze', run: () => ui.openDialog({ kind: 'settings', category: 'keyboard' }) },
  { id: 'settings.compiler', label: 'Opzioni del compilatore', category: 'Preferenze', run: () => ui.openDialog({ kind: 'settings', category: 'compiler' }) },
  { id: 'snippets.manage', label: 'Gestione snippet', category: 'Preferenze', run: () => ui.openDialog({ kind: 'snippets' }) },
  { id: 'docs.open', label: 'Documentazione C', category: 'Aiuto', run: () => {
    const ed = getActiveEditor();
    const word = ed?.getModel() && ed.getPosition() ? ed.getModel()!.getWordAtPosition(ed.getPosition()!)?.word : undefined;
    ui.openDialog({ kind: 'docs', query: word });
  } },
  { id: 'app.about', label: 'Informazioni su C-Studio', category: 'Aiuto', run: () => ui.openDialog({ kind: 'about' }) },
  { id: 'ai.explain', label: 'AI: spiega il codice selezionato', category: 'AI', disabledReason: () => 'AI Assistant non configurato (funzione non ancora implementata)', run: () => toast('info', 'AI Assistant non disponibile') },
];

export const commandById = new Map(COMMANDS.map((c) => [c.id, c]));

export function runCommand(id: string): void {
  const c = commandById.get(id);
  if (!c) return;
  const reason = c.disabledReason?.();
  if (reason) {
    toast('warning', reason);
    return;
  }
  void Promise.resolve(c.run()).catch((e: Error) => toast('error', e.message));
}

/* ───────────── keyboard ───────────── */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (e.code === 'Backquote') key = '`';
  else if (e.code === 'Backslash') key = '\\';
  else if (e.code === 'Comma') key = ',';
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

const byKeys = new Map(COMMANDS.filter((c) => c.keys).map((c) => [c.keys!, c]));

export function installKeyboardShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const combo = comboFromEvent(e);
    const cmd = byKeys.get(combo);
    if (!cmd) return;
    // let dialogs/inputs keep plain typing; shortcuts with modifiers or F-keys always apply
    const target = e.target as HTMLElement | null;
    const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.closest('.monaco-editor');
    if (inField && !/^(Ctrl|F\d)/.test(combo)) return;
    if (useApp.getState().dialog && !['file.save', 'view.palette', 'view.commands'].includes(cmd.id)) return;
    e.preventDefault();
    e.stopPropagation();
    runCommand(cmd.id);
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}

export { useRun };
