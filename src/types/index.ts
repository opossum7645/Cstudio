/* ───────────── Backend API (mirror of backend/src/types.ts) ───────────── */
export type CompilerId = 'gcc' | 'clang';
export type CStandard = 'c89' | 'c99' | 'c11' | 'c17' | 'c23' | 'gnu11' | 'gnu17';
export type OptLevel = 'O0' | 'O1' | 'O2' | 'O3' | 'Os' | 'Og';

export interface BuildConfig {
  compiler: CompilerId;
  std: CStandard;
  optimization: OptLevel;
  mode: 'debug' | 'release';
  warnings: { all: boolean; extra: boolean; pedantic: boolean; asErrors: boolean };
  debugInfo: boolean;
  defines: string[];
  libraries: string[];
  extraFlags: string[];
  sanitizeUndefined: boolean;
}

export type Severity = 'error' | 'warning' | 'note' | 'info';

export interface Diagnostic {
  file: string | null;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  source: 'compiler' | 'linker';
}

export interface StepLog {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CompileResult {
  success: boolean;
  diagnostics: Diagnostic[];
  steps: StepLog[];
  durationMs: number;
  compilerVersion: string;
  binarySize?: number;
}

export interface ToolInfo {
  available: boolean;
  version: string;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  sandbox: { ok: boolean; driver: string; detail: string };
  toolchain: { gcc: ToolInfo; clang: ToolInfo; gdb: ToolInfo; clangFormat: ToolInfo };
  limits: { runCpuSeconds: number; runWallDefaultMs: number; runWallMaxMs: number; memoryBytes: number; maxOutputBytes: number; compileTimeoutMs: number };
  features: { compile: boolean; run: boolean; debug: boolean; format: boolean };
}

export interface ExitInfo {
  exitCode: number | null;
  signal: string | null;
  signalDescription?: string | null;
  reason: 'exited' | 'signal' | 'timeout' | 'output-limit' | 'stopped' | 'compile-failed' | 'error' | 'debugger-exited';
  durationMs?: number;
  timedOut?: boolean;
}

/* ───────────── Projects ───────────── */
export type ConfigName = 'debug' | 'release';

export interface ProjectSession {
  groups: { tabs: string[]; active: string | null }[];
  layout: SplitLayout;
  activeGroup: number;
  expanded: string[];
}

export interface Project {
  id: string;
  name: string;
  template: string;
  createdAt: number;
  updatedAt: number;
  /** path → saved content */
  files: Record<string, string>;
  /** explicit folders (so empty folders survive) */
  folders: string[];
  buildConfigs: Record<ConfigName, BuildConfig>;
  activeConfig: ConfigName;
  runArgs: string;
  breakpoints: Record<string, number[]>;
  watches: string[];
  session?: ProjectSession;
  /** true when the project mirrors a folder on the device (File System Access API) */
  linkedFolder?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  fileCount: number;
  template: string;
  linkedFolder?: string;
}

/* ───────────── Editor ───────────── */
export type SplitLayout = 'single' | 'vertical' | 'horizontal';

export interface EditorGroupState {
  id: number;
  tabs: string[];
  active: string | null;
}

/* ───────────── Settings ───────────── */
export type UiTheme = 'dark' | 'light' | 'oled';
export type Density = 'compact' | 'comfortable' | 'touch';
export type SyntaxScheme = 'cstudio' | 'classic' | 'ember' | 'frost';

export interface Snippet {
  id: string;
  prefix: string;
  name: string;
  description: string;
  body: string;
  builtin?: boolean;
}

export interface Settings {
  theme: UiTheme;
  primaryColor: string;
  accentColor: string;
  syntaxScheme: SyntaxScheme;
  uiFontSize: number;
  density: Density | 'auto';
  animations: boolean;

  editorFontFamily: string;
  editorFontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  autoClosingBrackets: boolean;
  folding: boolean;
  bracketColors: boolean;
  renderWhitespace: boolean;
  stickyScroll: boolean;
  autoSave: 'off' | 'afterDelay' | 'onFocusChange';
  autoSaveDelay: number;
  formatOnSave: boolean;
  formatStyle: 'LLVM' | 'Google' | 'Mozilla' | 'WebKit' | 'GNU' | 'Microsoft';

  defaultBuildConfig: BuildConfig;
  runTimeoutSec: number;
  compilerEngine: 'auto' | 'server' | 'browser';
  liveDiagnostics: boolean;
  backendUrl: string;

  tabletKeys: 'auto' | 'always' | 'never';
  tabletKeySet: string;

  startup: 'welcome' | 'lastProject';
  recentLimit: number;
  confirmDelete: boolean;

  customSnippets: Snippet[];
  extensions: Record<string, boolean>;
}
