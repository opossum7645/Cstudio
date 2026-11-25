/**
 * Monaco integration: loading, models (one per project file), C language services
 * (completion, hover, signature help, definition, references, outline, formatting),
 * diagnostics markers, themes and the registry of mounted editors.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { useApp, openFile, setBuffer, setBeforeSaveHook } from '../stores/appStore';
import { useBuild } from '../features/compiler/buildStore';
import { useBackend } from '../services/backendStatus';
import { api } from '../services/api';
import { monacoThemeData } from '../features/settings/themes';
import { languageFor } from '../utils/path';
import { SymbolIndex, CSymbol } from './symbols';
import { STD_FUNCTIONS, STD_BY_NAME, STD_HEADERS, C_KEYWORDS, C_TYPES, C_MACROS } from './cStdlib';
import { BUILTIN_SNIPPETS } from './snippets';
import type { Settings } from '../types';

export { monaco };

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export const symbolIndex = new SymbolIndex();

/* ───────────── models ───────────── */
let projectId: string | null = null;
const uriFor = (path: string) => monaco.Uri.from({ scheme: 'cstudio', authority: projectId ?? 'none', path: '/' + path });
export const pathFromUri = (uri: monaco.Uri) => uri.path.replace(/^\//, '');
let applyingExternal = false;

export function getModel(path: string): monaco.editor.ITextModel | null {
  const s = useApp.getState();
  if (!s.project) return null;
  const uri = uriFor(path);
  let model = monaco.editor.getModel(uri);
  const content = s.buffers[path] ?? s.project.files[path];
  if (content === undefined) return null;
  if (!model) {
    model = monaco.editor.createModel(content, languageFor(path), uri);
    model.updateOptions({ tabSize: s.settings.tabSize, insertSpaces: s.settings.insertSpaces });
    model.onDidChangeContent(() => {
      if (!applyingExternal) setBuffer(path, model!.getValue());
    });
  }
  return model;
}

function disposeAllModels() {
  for (const m of monaco.editor.getModels()) if (m.uri.scheme === 'cstudio') m.dispose();
  symbolIndex.clear();
}

/** Keep Monaco models in sync with store-side changes (rename, delete, replace, revert, restore). */
function syncModels() {
  const s = useApp.getState();
  if ((s.project?.id ?? null) !== projectId) {
    disposeAllModels();
    projectId = s.project?.id ?? null;
  }
  if (!s.project) return;
  for (const m of monaco.editor.getModels()) {
    if (m.uri.scheme !== 'cstudio') continue;
    const path = pathFromUri(m.uri);
    const content = s.buffers[path];
    if (content === undefined) {
      m.dispose();
      symbolIndex.remove(path);
    } else if (m.getValue() !== content) {
      applyingExternal = true;
      m.pushEditOperations([], [{ range: m.getFullModelRange(), text: content }], () => null);
      applyingExternal = false;
    }
  }
}

let indexTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleIndex() {
  if (indexTimer) clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    const s = useApp.getState();
    if (!s.project) return;
    // headers first so their typedefs are known when indexing .c files
    const paths = Object.keys(s.buffers).sort((a, b) => Number(b.endsWith('.h')) - Number(a.endsWith('.h')));
    for (const p of paths) symbolIndex.update(p, s.buffers[p]!);
  }, 250);
}

export { registerEditor, getActiveEditor } from './editorRegistry';

/* ───────────── settings → editor options ───────────── */
export function editorOptions(s: Settings, touch: boolean): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    fontFamily: s.editorFontFamily,
    fontSize: s.editorFontSize,
    fontLigatures: true,
    lineHeight: Math.round(s.editorFontSize * 1.55),
    tabSize: s.tabSize,
    insertSpaces: s.insertSpaces,
    wordWrap: s.wordWrap ? 'on' : 'off',
    minimap: { enabled: s.minimap && !touch, renderCharacters: false, scale: 1 },
    lineNumbers: s.lineNumbers ? 'on' : 'off',
    autoClosingBrackets: s.autoClosingBrackets ? 'languageDefined' : 'never',
    autoClosingQuotes: s.autoClosingBrackets ? 'languageDefined' : 'never',
    folding: s.folding,
    showFoldingControls: touch ? 'always' : 'mouseover',
    bracketPairColorization: { enabled: s.bracketColors },
    guides: { indentation: true, bracketPairs: s.bracketColors ? 'active' : false, highlightActiveIndentation: true },
    renderWhitespace: s.renderWhitespace ? 'all' : 'selection',
    stickyScroll: { enabled: s.stickyScroll },
    glyphMargin: true,
    automaticLayout: true,
    smoothScrolling: s.animations,
    cursorSmoothCaretAnimation: s.animations ? 'on' : 'off',
    cursorBlinking: 'smooth',
    renderLineHighlight: 'all',
    matchBrackets: 'always',
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
    quickSuggestions: useApp.getState().settings.extensions.intellisense ? { other: true, comments: false, strings: false } : false,
    suggestOnTriggerCharacters: true,
    parameterHints: { enabled: true },
    hover: { enabled: true, delay: touch ? 200 : 400 },
    formatOnPaste: false,
    multiCursorModifier: 'alt',
    dragAndDrop: !touch,
    scrollbar: { verticalScrollbarSize: touch ? 14 : 10, horizontalScrollbarSize: touch ? 14 : 10, useShadows: false },
    contextmenu: true,
    mouseWheelZoom: true,
    fixedOverflowWidgets: true,
    accessibilitySupport: 'auto',
    'semanticHighlighting.enabled': false,
  };
}

export function applyMonacoTheme(s: Settings) {
  monaco.editor.defineTheme('cstudio', monacoThemeData(s) as monaco.editor.IStandaloneThemeData);
  monaco.editor.setTheme('cstudio');
  for (const m of monaco.editor.getModels()) m.updateOptions({ tabSize: s.tabSize, insertSpaces: s.insertSpaces });
}

/* ───────────── diagnostics → markers ───────────── */
function applyMarkers() {
  const { diagnostics } = useBuild.getState();
  const byFile = new Map<string, monaco.editor.IMarkerData[]>();
  for (const d of diagnostics) {
    if (!d.file || d.line < 1) continue;
    const sev = d.severity === 'error' ? monaco.MarkerSeverity.Error : d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info;
    const list = byFile.get(d.file) ?? [];
    list.push({ severity: sev, message: d.message, startLineNumber: d.line, startColumn: Math.max(1, d.column), endLineNumber: d.line, endColumn: Math.max(1, d.column) + 1, source: d.source === 'linker' ? 'ld' : 'gcc' });
    byFile.set(d.file, list);
  }
  for (const m of monaco.editor.getModels()) {
    if (m.uri.scheme !== 'cstudio') continue;
    const list = byFile.get(pathFromUri(m.uri)) ?? [];
    // widen the marker to the word at the column
    const widened = list.map((mk) => {
      const w = m.getWordAtPosition({ lineNumber: Math.min(mk.startLineNumber, m.getLineCount()), column: mk.startColumn });
      return w ? { ...mk, startColumn: w.startColumn, endColumn: w.endColumn } : { ...mk, endColumn: m.getLineMaxColumn(Math.min(mk.startLineNumber, m.getLineCount())) };
    });
    monaco.editor.setModelMarkers(m, 'cstudio', widened);
  }
}

/* ───────────── language features ───────────── */
const K = monaco.languages.CompletionItemKind;
const kindMap: Record<CSymbol['kind'], monaco.languages.CompletionItemKind> = {
  function: K.Function, prototype: K.Function, macro: K.Constant, typedef: K.Class, struct: K.Struct, union: K.Struct, enum: K.Enum,
  enumerator: K.EnumMember, variable: K.Variable, local: K.Variable, parameter: K.Variable,
};
const SymK = monaco.languages.SymbolKind;
const symKindMap: Record<CSymbol['kind'], monaco.languages.SymbolKind> = {
  function: SymK.Function, prototype: SymK.Function, macro: SymK.Constant, typedef: SymK.Class, struct: SymK.Struct, union: SymK.Struct, enum: SymK.Enum,
  enumerator: SymK.EnumMember, variable: SymK.Variable, local: SymK.Variable, parameter: SymK.Variable,
};

const ext = (id: string) => useApp.getState().settings.extensions[id] !== false;

function registerLanguageFeatures() {
  monaco.languages.setLanguageConfiguration('c', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] }, { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '/*', close: ' */', notIn: ['string'] },
    ],
    surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' }, { open: "'", close: "'" }],
    onEnterRules: [
      { beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/, afterText: /^\s*\*\/$/, action: { indentAction: monaco.languages.IndentAction.IndentOutdent, appendText: ' * ' } },
      { beforeText: /^\s*\/\*\*(?!\/)([^*]|\*(?!\/))*$/, action: { indentAction: monaco.languages.IndentAction.None, appendText: ' * ' } },
      { beforeText: /^(\t|( {2}))* \*( ([^*]|\*(?!\/))*)?$/, action: { indentAction: monaco.languages.IndentAction.None, appendText: '* ' } },
    ],
    folding: { markers: { start: /^\s*#pragma\s+region\b/, end: /^\s*#pragma\s+endregion\b/ } },
  });

  monaco.languages.registerCompletionItemProvider('c', {
    triggerCharacters: ['.', '>', '#', '<', '"'],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions: monaco.languages.CompletionItem[] = [];
      const path = pathFromUri(model.uri);

      // #include <…> / "…"
      const inc = /^\s*#\s*include\s*([<"])([\w./]*)$/.exec(line);
      if (inc) {
        const startCol = position.column - inc[2]!.length;
        const r = new monaco.Range(position.lineNumber, startCol, position.lineNumber, position.column);
        if (inc[1] === '<') {
          for (const [h, d] of Object.entries(STD_HEADERS)) suggestions.push({ label: h, kind: K.File, insertText: h + '>', documentation: d, range: r });
        } else {
          const headers = Object.keys(useApp.getState().project?.files ?? {}).filter((f) => f.endsWith('.h'));
          for (const h of headers) {
            const name = h.split('/').pop()!;
            suggestions.push({ label: name, kind: K.File, insertText: name + '"', detail: h, range: r });
          }
        }
        return { suggestions };
      }
      if (/^\s*#\s*\w*$/.test(line)) {
        for (const d of ['include', 'define', 'ifdef', 'ifndef', 'if', 'elif', 'else', 'endif', 'undef', 'pragma', 'error']) {
          suggestions.push({ label: d, kind: K.Keyword, insertText: d, range });
        }
        return { suggestions };
      }
      if (!ext('intellisense')) return { suggestions };
      // member access: suggest nothing structural for now beyond words (Monaco word-based suggestions disabled)
      if (/(\.|->)\w*$/.test(line)) return { suggestions };

      for (const k of C_KEYWORDS) suggestions.push({ label: k, kind: K.Keyword, insertText: k, range, sortText: '3' + k });
      for (const t of C_TYPES) suggestions.push({ label: t, kind: K.TypeParameter, insertText: t, range, sortText: '2' + t });
      for (const [m, d] of C_MACROS) suggestions.push({ label: m, kind: K.Constant, insertText: m, detail: d, range, sortText: '2' + m });
      for (const f of STD_FUNCTIONS) {
        suggestions.push({
          label: { label: f.name, description: f.header },
          kind: K.Function,
          insertText: f.params.length ? `${f.name}($0)` : `${f.name}()`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: f.signature,
          documentation: { value: `${f.doc}\n\n\`#include <${f.header}>\`` },
          range,
          sortText: '1' + f.name,
          command: { id: 'editor.action.triggerParameterHints', title: '' },
        });
      }
      const seen = new Set<string>();
      for (const s of symbolIndex.visibleAt(path, position.lineNumber)) {
        const key = s.name + s.kind;
        if (seen.has(s.name) || seen.has(key)) continue;
        seen.add(s.name);
        const fn = s.kind === 'function' || s.kind === 'prototype';
        suggestions.push({
          label: { label: s.name, description: s.kind === 'local' || s.kind === 'parameter' ? 'locale' : s.file.split('/').pop() },
          kind: kindMap[s.kind],
          insertText: fn ? `${s.name}($0)` : s.name,
          insertTextRules: fn ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          detail: s.detail,
          range,
          sortText: (s.kind === 'local' || s.kind === 'parameter' ? '0' : '05') + s.name,
          command: fn ? { id: 'editor.action.triggerParameterHints', title: '' } : undefined,
        });
      }
      if (ext('snippets')) {
        const snippets = [...BUILTIN_SNIPPETS, ...useApp.getState().settings.customSnippets];
        for (const sn of snippets) {
          suggestions.push({
            label: { label: sn.prefix, description: sn.name },
            kind: K.Snippet,
            insertText: sn.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: { value: `${sn.description}\n\n\`\`\`c\n${sn.body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, '')}\n\`\`\`` },
            range,
            sortText: '4' + sn.prefix,
          });
        }
      }
      return { suggestions };
    },
  });

  monaco.languages.registerHoverProvider('c', {
    provideHover(model, position) {
      if (!ext('docsHover')) return null;
      const w = model.getWordAtPosition(position);
      if (!w) return null;
      const range = new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn);
      const path = pathFromUri(model.uri);
      const sym = symbolIndex.definition(w.word, path, position.lineNumber);
      if (sym) {
        const where = `${sym.file}:${sym.line}`;
        const label = { function: 'funzione', prototype: 'prototipo', macro: 'macro', typedef: 'typedef', struct: 'struct', union: 'union', enum: 'enum', enumerator: 'costante enum', variable: 'variabile globale', local: 'variabile locale', parameter: 'parametro' }[sym.kind];
        return { range, contents: [{ value: '```c\n' + sym.detail + '\n```' }, { value: `*${label}* — ${where}` }] };
      }
      const f = STD_BY_NAME.get(w.word);
      if (f) {
        return { range, contents: [{ value: '```c\n' + f.signature + '\n```' }, { value: `${f.doc}${f.returns ? `\n\n**Restituisce:** ${f.returns}` : ''}\n\n\`#include <${f.header}>\`` }] };
      }
      const macro = C_MACROS.find(([m]) => m === w.word);
      if (macro) return { range, contents: [{ value: `**${macro[0]}** — ${macro[1]}` }] };
      return null;
    },
  });

  monaco.languages.registerSignatureHelpProvider('c', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],
    provideSignatureHelp(model, position) {
      if (!ext('intellisense')) return null;
      const text = model.getValueInRange(new monaco.Range(Math.max(1, position.lineNumber - 5), 1, position.lineNumber, position.column));
      let depth = 0;
      let commas = 0;
      let i = text.length - 1;
      for (; i >= 0; i--) {
        const c = text[i];
        if (c === ')') depth++;
        else if (c === '(') {
          if (depth === 0) break;
          depth--;
        } else if (c === ',' && depth === 0) commas++;
        else if (c === ';' || c === '{' || c === '}') return null;
      }
      if (i < 0) return null;
      const name = /([A-Za-z_]\w*)\s*$/.exec(text.slice(0, i))?.[1];
      if (!name) return null;
      let label: string | null = null;
      let params: string[] = [];
      let doc = '';
      const std = STD_BY_NAME.get(name);
      const sym = symbolIndex.globals().find((s) => s.name === name && (s.kind === 'function' || s.kind === 'prototype'));
      if (sym) {
        label = sym.detail;
        const inner = sym.detail.slice(sym.detail.indexOf('(') + 1, sym.detail.lastIndexOf(')'));
        params = inner.trim() && inner.trim() !== 'void' ? inner.split(',').map((p) => p.trim()) : [];
        doc = `${sym.file}:${sym.line}`;
      } else if (std) {
        label = std.signature;
        params = std.params;
        doc = std.doc;
      }
      if (!label) return null;
      return {
        value: { signatures: [{ label, documentation: doc, parameters: params.map((p) => ({ label: p })) }], activeSignature: 0, activeParameter: Math.min(commas, Math.max(0, params.length - 1)) },
        dispose() {},
      };
    },
  });

  monaco.languages.registerDefinitionProvider('c', {
    provideDefinition(model, position) {
      const w = model.getWordAtPosition(position);
      const path = pathFromUri(model.uri);
      // #include "file.h" → open the header
      const lineText = model.getLineContent(position.lineNumber);
      const inc = /#\s*include\s*"([^"]+)"/.exec(lineText);
      if (inc) {
        const files = Object.keys(useApp.getState().project?.files ?? {});
        const target = files.find((f) => f === inc[1] || f.endsWith('/' + inc[1]));
        if (target) {
          getModel(target);
          return { uri: uriFor(target), range: new monaco.Range(1, 1, 1, 1) };
        }
      }
      if (!w) return null;
      const sym = symbolIndex.definition(w.word, path, position.lineNumber);
      if (!sym) return null;
      getModel(sym.file);
      return { uri: uriFor(sym.file), range: new monaco.Range(sym.line, sym.column, sym.line, sym.column + sym.name.length) };
    },
  });

  monaco.languages.registerReferenceProvider('c', {
    provideReferences(model, position) {
      const w = model.getWordAtPosition(position);
      if (!w) return [];
      const s = useApp.getState();
      const out: monaco.languages.Location[] = [];
      const re = new RegExp(`\\b${w.word}\\b`, 'g');
      for (const path of Object.keys(s.buffers)) {
        if (!/\.(c|h)$/.test(path)) continue;
        const m = getModel(path);
        if (!m) continue;
        for (const match of m.findMatches(re.source, false, true, true, null, false)) out.push({ uri: m.uri, range: match.range });
      }
      return out;
    },
  });

  monaco.languages.registerDocumentSymbolProvider('c', {
    provideDocumentSymbols(model) {
      const path = pathFromUri(model.uri);
      symbolIndex.update(path, model.getValue());
      return symbolIndex
        .fileSymbols(path)
        .filter((s) => s.kind !== 'local' && s.kind !== 'parameter')
        .map((s) => {
          const end = s.endLine ?? s.line;
          return {
            name: s.name,
            detail: s.detail,
            kind: symKindMap[s.kind],
            tags: [],
            range: new monaco.Range(s.line, 1, end, model.getLineMaxColumn(Math.min(end, model.getLineCount()))),
            selectionRange: new monaco.Range(s.line, s.column, s.line, s.column + s.name.length),
          };
        });
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider('c', {
    async provideDocumentFormattingEdits(model) {
      const code = await formatCode(model.getValue());
      if (code === null) return [];
      return [{ range: model.getFullModelRange(), text: code }];
    },
  });

  // cross-file navigation (go to definition / references peek → open tab)
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== 'cstudio') return false;
      const path = pathFromUri(resource);
      const pos = selectionOrPosition && 'startLineNumber' in selectionOrPosition ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn } : selectionOrPosition ? { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column } : { line: 1, column: 1 };
      openFile(path, pos);
      return true;
    },
  });
}

/** Format C code through clang-format on the server. Returns null when unavailable. */
export async function formatCode(code: string): Promise<string | null> {
  const s = useApp.getState().settings;
  if (!ext('formatter')) throw new Error('Il formatter è disattivato nelle estensioni');
  if (!useBackend.getState().available) throw new Error('Formattazione non disponibile offline (richiede clang-format sul server)');
  const res = await api.format(code, { base: s.formatStyle, indentWidth: s.tabSize, useTabs: !s.insertSpaces, columnLimit: 100 });
  return res.code;
}

/* ───────────── bootstrap ───────────── */
let initialized = false;
export function initMonaco(): void {
  if (initialized) return;
  initialized = true;
  registerLanguageFeatures();
  applyMonacoTheme(useApp.getState().settings);
  useApp.subscribe((s, prev) => {
    if (s.project !== prev.project || s.buffers !== prev.buffers) {
      syncModels();
      if (s.buffers !== prev.buffers) scheduleIndex();
    }
    if (s.settings !== prev.settings) applyMonacoTheme(s.settings);
  });
  useBuild.subscribe((s, prev) => {
    if (s.diagnostics !== prev.diagnostics) applyMarkers();
  });
  setBeforeSaveHook(async (path, content) => {
    const st = useApp.getState().settings;
    if (!st.formatOnSave || !/\.(c|h)$/.test(path) || !useBackend.getState().available || !ext('formatter')) return content;
    return (await formatCode(content)) ?? content;
  });
  syncModels();
  scheduleIndex();
}

/** Re-apply diagnostics after models are created (new tabs). */
export function refreshMarkers(): void {
  applyMarkers();
}
